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
	"strings"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/redis/go-redis/extra/redisotel/v9"
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
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/services/user/internal/crypto"
	grpcserver "github.com/nomarkup/nomarkup/services/user/internal/grpc"
	"github.com/nomarkup/nomarkup/services/user/internal/observability"
	"github.com/nomarkup/nomarkup/services/user/internal/repository"
	"github.com/nomarkup/nomarkup/services/user/internal/service"
)

// isDevelopmentEnv reports whether this process is running in development.
// Honors both ENVIRONMENT (service config convention) and APP_ENV (Sentry
// convention), matching gateway/internal/handler/ws_origins.go. Comparison is
// case- and whitespace-insensitive so "Development" or a stray trailing space
// in a ConfigMap cannot silently flip a security decision — note that anything
// that is NOT recognizably development is treated as production, which is the
// fail-closed direction.
func isDevelopmentEnv() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("ENVIRONMENT")), "development") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "development")
}

func main() {
	logger := slog.New(observability.NewContextHandler(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))
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
	pool, err := observability.NewPGXPool(ctx, databaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	for attempt := 1; ; attempt++ {
		if err := pool.Ping(ctx); err != nil {
			if attempt >= 3 {
				slog.Error("database not reachable after retries", "error", err)
				os.Exit(1)
			}
			slog.Warn("database ping failed, retrying", "error", err, "attempt", attempt)
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}
		break
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
	if err := redisotel.InstrumentTracing(rdb); err != nil {
		slog.Warn("redis tracing instrumentation failed", "error", err)
	}

	for attempt := 1; ; attempt++ {
		if err := rdb.Ping(ctx).Err(); err != nil {
			if attempt >= 3 {
				slog.Error("redis not reachable after retries", "error", err)
				os.Exit(1)
			}
			slog.Warn("redis ping failed, retrying", "error", err, "attempt", attempt)
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			continue
		}
		break
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
	//
	// Email verification may only be skipped in development, where there is no
	// notification service to send the mail. Deriving it from
	// `notifClient == nil` alone made it activate on ABSENCE: an unset or
	// typo'd NOTIFICATION_SERVICE_ADDR — and the variable is currently set on
	// the gateway deployment only, not on this service or the shared
	// ConfigMap — silently marked every new account email_verified=true with
	// no mail ever sent. That is the control gating account identity, password
	// reset, and every downstream trust signal; registering as
	// victim@example.com would have yielded a pre-verified account.
	//
	// Outside development a missing notification service is fatal instead:
	// registration that cannot send a verification email must not proceed.
	skipEmailVerification := notifClient == nil && isDevelopmentEnv()
	if notifClient == nil && !isDevelopmentEnv() {
		slog.Error("notification service is not configured; refusing to start outside development because email verification could not be enforced",
			"env", strings.TrimSpace(os.Getenv("ENVIRONMENT")),
		)
		os.Exit(1)
	}
	if skipEmailVerification {
		slog.Warn("DEVELOPMENT ONLY: email verification will be skipped on registration (no notification service)")
	}

	// Build the PII cipher (libsodium-compatible nacl/secretbox). In
	// production a missing ENCRYPTION_KEY is fatal; in development an
	// ephemeral key is generated and a WARN is logged. See CLAUDE.md §6.
	cipher, err := crypto.FromEnv()
	if err != nil {
		slog.Error("failed to initialize PII cipher", "error", err)
		os.Exit(1)
	}

	repo := repository.NewPostgresRepository(pool, cipher)
	jwtManager := service.NewJWTManager(privateKey)
	authService := service.NewAuth(repo, jwtManager, verificationSecret, skipEmailVerification)
	profileService := service.NewProfile(repo)
	adminService := service.NewAdmin(repo)
	phoneService := service.NewPhoneVerification(repo, rdb, smsClient)
	verificationService := service.NewVerification(repo)

	// GDPR/CCPA erasure pipeline.
	//
	// Stripe deletion is now wired to the payment service via the
	// PaymentService/DeleteStripeAccounts gRPC method (added 2026-04).
	// When PAYMENT_SERVICE_ADDR is unset (e.g. unit tests, isolated user-
	// service stack) the deleter is left nil and Erasure falls back to
	// "skipped_no_client" outcomes — see deletion.go's noopStripeDeleter.
	//
	// S3 and OAuth deleters are still TODO.
	var stripeDeleter service.StripeDeleter
	if paymentAddr := os.Getenv("PAYMENT_SERVICE_ADDR"); paymentAddr != "" {
		paymentConn, err := grpclib.NewClient(paymentAddr,
			grpclib.WithTransportCredentials(insecure.NewCredentials()),
			grpclib.WithStatsHandler(otelgrpc.NewClientHandler()),
		)
		if err != nil {
			slog.Warn("failed to connect to payment service, GDPR Stripe deletion disabled",
				"addr", paymentAddr, "error", err)
		} else {
			stripeDeleter = newStripeDeleterClient(paymentv1.NewPaymentServiceClient(paymentConn))
			slog.Info("payment service connected for GDPR deletion", "addr", paymentAddr)
		}
	} else {
		slog.Warn("PAYMENT_SERVICE_ADDR not set; GDPR Stripe deletion will record skipped_no_client")
	}
	erasureService := service.NewErasure(repo, stripeDeleter, nil, nil)
	srv := grpcserver.NewServer(authService, profileService, adminService, phoneService, verificationService, erasureService, notifClient, baseURL)

	// Start gRPC server.
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	s := grpclib.NewServer(
		grpclib.StatsHandler(otelgrpc.NewServerHandler()),
		grpclib.ChainUnaryInterceptor(observability.RequestIDUnaryInterceptor, loggingUnaryInterceptor),
		grpclib.ChainStreamInterceptor(observability.RequestIDStreamInterceptor, loggingStreamInterceptor),
	)
	grpcserver.Register(s, srv)

	// Standard gRPC health service (grpc.health.v1.Health). REQUIRED — the
	// Kubernetes deployment (deploy/k8s/base/user/deployment.yaml) uses native
	// gRPC liveness/readiness probes, and kubelet queries the EMPTY service
	// name. Without this registration every probe returns UNIMPLEMENTED,
	// readiness never passes and liveness restarts the pod (CrashLoopBackOff).
	// Do not delete as "unused" — the only caller is kubelet.
	healthSrv := health.NewServer()
	healthpb.RegisterHealthServer(s, healthSrv)
	healthSrv.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	healthSrv.SetServingStatus(userv1.UserService_ServiceDesc.ServiceName, healthpb.HealthCheckResponse_SERVING)

	sigCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Observability HTTP server (healthz / readyz / metrics) on a separate port.
	startObservabilityServer(sigCtx, "user-service", port, pool, rdb)

	// GDPR cron worker — every 6 hours, drain a batch of users whose
	// 30-day grace window has elapsed. Cleanly stops on SIGINT/SIGTERM.
	gdprInterval := parseDurationOrDefault(os.Getenv("GDPR_WORKER_INTERVAL"), 6*time.Hour)
	gdprBatch := parseIntOrDefault(os.Getenv("GDPR_WORKER_BATCH_SIZE"), 100)
	if os.Getenv("GDPR_WORKER_ENABLED") == "false" {
		slog.Info("gdpr cron worker disabled via GDPR_WORKER_ENABLED=false")
	} else {
		startGDPRWorker(sigCtx, erasureService, gdprInterval, gdprBatch)
	}

	go func() {
		slog.Info("user service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-sigCtx.Done()
	slog.Info("shutting down user service")
	// Flip every health status to NOT_SERVING *before* draining so the k8s
	// readiness probe pulls this pod out of rotation while in-flight RPCs
	// finish.
	healthSrv.Shutdown()
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

// loggingUnaryInterceptor logs every unary gRPC call with method name, duration, and any error.
func loggingUnaryInterceptor(ctx context.Context, req interface{}, info *grpclib.UnaryServerInfo, handler grpclib.UnaryHandler) (interface{}, error) {
	start := time.Now()
	resp, err := handler(ctx, req)
	duration := time.Since(start)
	if err != nil {
		slog.ErrorContext(ctx, "grpc call failed",
			"method", info.FullMethod,
			"duration_ms", duration.Milliseconds(),
			"error", err,
		)
	} else {
		slog.InfoContext(ctx, "grpc call",
			"method", info.FullMethod,
			"duration_ms", duration.Milliseconds(),
		)
	}
	return resp, err
}

// loggingStreamInterceptor logs every streaming gRPC call with method name, duration, and any error.
func loggingStreamInterceptor(srv interface{}, ss grpclib.ServerStream, info *grpclib.StreamServerInfo, handler grpclib.StreamHandler) error {
	start := time.Now()
	err := handler(srv, ss)
	duration := time.Since(start)
	if err != nil {
		slog.ErrorContext(ss.Context(), "grpc stream failed",
			"method", info.FullMethod,
			"duration_ms", duration.Milliseconds(),
			"error", err,
		)
	} else {
		slog.InfoContext(ss.Context(), "grpc stream",
			"method", info.FullMethod,
			"duration_ms", duration.Milliseconds(),
		)
	}
	return err
}
