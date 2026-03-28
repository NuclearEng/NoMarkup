package main

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	grpcserver "github.com/nomarkup/nomarkup/services/user/internal/grpc"
	"github.com/nomarkup/nomarkup/services/user/internal/repository"
	"github.com/nomarkup/nomarkup/services/user/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	port := os.Getenv("USER_SERVICE_PORT")
	if port == "" {
		port = "50051"
	}

	// Initialize Sentry error tracking.
	if sentryDSN := os.Getenv("SENTRY_DSN"); sentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:              sentryDSN,
			Environment:      os.Getenv("APP_ENV"),
			Release:          os.Getenv("APP_VERSION"),
			TracesSampleRate: 0.1,
			EnableTracing:    true,
		}); err != nil {
			slog.Error("failed to initialize sentry", "error", err)
		} else {
			slog.Info("sentry initialized", "service", "user-service")
			defer sentry.Flush(2 * time.Second)
		}
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	// Initialize OpenTelemetry tracing.
	tracerShutdown, err := initTracer(context.Background(), "user-service")
	if err != nil {
		slog.Error("failed to initialize tracer", "error", err)
		os.Exit(1)
	}
	defer tracerShutdown()

	jwtPrivateKeyPath := os.Getenv("JWT_PRIVATE_KEY_PATH")
	if jwtPrivateKeyPath == "" {
		jwtPrivateKeyPath = "./keys/private.pem"
	}

	// Load RSA private key for JWT signing.
	privateKey, err := loadRSAPrivateKey(jwtPrivateKeyPath)
	if err != nil {
		slog.Error("failed to load JWT private key", "path", jwtPrivateKeyPath, "error", err)
		os.Exit(1)
	}

	// Connect to PostgreSQL.
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("failed to ping database", "error", err)
		os.Exit(1)
	}
	slog.Info("connected to database")

	// Load verification secret for email verification tokens.
	verificationSecret := os.Getenv("VERIFICATION_SECRET")
	if verificationSecret == "" {
		verificationSecret = os.Getenv("SESSION_SECRET")
	}
	if verificationSecret == "" {
		slog.Error("VERIFICATION_SECRET (or SESSION_SECRET) is required")
		os.Exit(1)
	}

	// Connect to Redis for OTP storage.
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}
	redisOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		slog.Error("invalid REDIS_URL", "error", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(redisOpts)
	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	slog.Info("connected to Redis")

	// Connect to notification service for SMS delivery and email verification.
	var smsClient service.SMSDelivery
	var notifClient notificationv1.NotificationServiceClient
	notifAddr := os.Getenv("NOTIFICATION_SERVICE_ADDR")
	if notifAddr != "" {
		notifConn, err := grpclib.NewClient(notifAddr,
			grpclib.WithTransportCredentials(insecure.NewCredentials()),
			grpclib.WithStatsHandler(otelgrpc.NewClientHandler()),
		)
		if err != nil {
			slog.Warn("failed to connect to notification service, SMS/email delivery disabled", "addr", notifAddr, "error", err)
		} else {
			notifClient = notificationv1.NewNotificationServiceClient(notifConn)
			smsClient = notifClient
			slog.Info("notification service connected", "addr", notifAddr)
		}
	} else {
		slog.Warn("NOTIFICATION_SERVICE_ADDR not set, SMS/email delivery disabled")
	}

	baseURL := os.Getenv("BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:3000"
	}

	// Wire up dependencies.
	repo := repository.NewPostgresRepository(pool)
	jwtManager := service.NewJWTManager(privateKey)
	authService := service.NewAuth(repo, jwtManager, verificationSecret)
	profileService := service.NewProfile(repo)
	adminService := service.NewAdmin(repo)
	phoneService := service.NewPhoneVerification(repo, rdb, smsClient)
	verificationService := service.NewVerification(repo)
	srv := grpcserver.NewServer(authService, profileService, adminService, phoneService, verificationService, notifClient, baseURL)

	// Start gRPC server.
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	s := grpclib.NewServer(
		grpclib.StatsHandler(otelgrpc.NewServerHandler()),
	)
	grpcserver.Register(s, srv)

	sigCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("user service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-sigCtx.Done()
	slog.Info("shutting down user service")
	s.GracefulStop()
	slog.Info("user service stopped")
}

// initTracer initializes an OpenTelemetry trace exporter. If OTEL_EXPORTER_OTLP_ENDPOINT
// is not set, tracing is silently disabled and a no-op shutdown function is returned.
func initTracer(ctx context.Context, serviceName string) (func(), error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		slog.Info("OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled")
		return func() {}, nil
	}

	exporter, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("create otlp exporter: %w", err)
	}

	name := os.Getenv("OTEL_SERVICE_NAME")
	if name == "" {
		name = serviceName
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceNameKey.String(name),
		)),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	slog.Info("tracing enabled", "service", name, "endpoint", endpoint)

	return func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tp.Shutdown(shutdownCtx)
	}, nil
}

// loadRSAPrivateKey reads and parses a PEM-encoded RSA private key from disk.
func loadRSAPrivateKey(path string) (*rsa.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read private key file: %w", err)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("no PEM block found in %s", path)
	}

	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		// Try PKCS1 format as fallback.
		rsaKey, pkcs1Err := x509.ParsePKCS1PrivateKey(block.Bytes)
		if pkcs1Err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		return rsaKey, nil
	}

	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("private key is not RSA")
	}
	return rsaKey, nil
}
