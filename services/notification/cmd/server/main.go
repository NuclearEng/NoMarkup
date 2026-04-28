package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"google.golang.org/grpc"

	notificationgrpc "github.com/nomarkup/nomarkup/services/notification/internal/grpc"
	"github.com/nomarkup/nomarkup/services/notification/internal/repository"
	"github.com/nomarkup/nomarkup/services/notification/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	port := os.Getenv("NOTIFICATION_SERVICE_PORT")
	if port == "" {
		port = "50059"
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
			slog.Info("sentry initialized", "service", "notification-service")
			defer sentry.Flush(2 * time.Second)
		}
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	// Initialize OpenTelemetry tracing.
	tracerShutdown, err := initTracer(context.Background(), "notification-service")
	if err != nil {
		slog.Error("failed to initialize tracer", "error", err)
		os.Exit(1)
	}
	defer tracerShutdown()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Initialize PostgreSQL connection pool.
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		slog.Error("failed to create database pool", "error", err)
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

	// Initialize dispatchers from environment variables.
	emailDispatcher := service.NewEmailDispatcher(
		os.Getenv("SENDGRID_API_KEY"),
		os.Getenv("SENDGRID_FROM_EMAIL"),
		os.Getenv("SENDGRID_FROM_NAME"),
	)

	pushDispatcher := service.NewPushDispatcher(
		os.Getenv("FCM_SERVER_KEY"),
		os.Getenv("FCM_PROJECT_ID"),
	)

	// W3C Web Push (RFC 8030) dispatcher — coexists with FCM. Closes
	// audit Section J's "FCM-only push" gap. When VAPID_PRIVATE_KEY is
	// empty, the dispatcher logs and skips (dev-mode parity with FCM).
	webPushDispatcher := service.NewWebPushDispatcher(
		pool,
		os.Getenv("VAPID_PUBLIC_KEY"),
		os.Getenv("VAPID_PRIVATE_KEY"),
		os.Getenv("VAPID_SUBJECT"),
	)

	smsDispatcher := service.NewSMSDispatcher(
		os.Getenv("TWILIO_ACCOUNT_SID"),
		os.Getenv("TWILIO_AUTH_TOKEN"),
		os.Getenv("TWILIO_FROM_NUMBER"),
	)

	// Log dispatcher modes.
	if os.Getenv("SENDGRID_API_KEY") == "" {
		slog.Info("email dispatcher running in dev mode (SENDGRID_API_KEY not set)")
	}
	if os.Getenv("FCM_SERVER_KEY") == "" {
		slog.Info("push dispatcher running in dev mode (FCM_SERVER_KEY not set)")
	}
	if os.Getenv("VAPID_PRIVATE_KEY") == "" {
		slog.Warn("web push dispatcher running in dev mode (VAPID_PRIVATE_KEY not set) — generate keys with: go run github.com/SherClockHolmes/webpush-go/cmd/webpush-cli@latest generate")
	}
	if os.Getenv("TWILIO_ACCOUNT_SID") == "" {
		slog.Info("sms dispatcher running in dev mode (TWILIO_ACCOUNT_SID not set)")
	}

	// Wire up dependencies.
	repo := repository.New(pool)
	svc := service.New(repo, repo, emailDispatcher, pushDispatcher, webPushDispatcher, smsDispatcher)
	srv := notificationgrpc.NewServer(svc)

	// Goods-marketplace retention loop: closing-soon, closing-now, and
	// outbid notifications. Best-effort; failures log-and-continue.
	runListingNotificationScheduler(ctx, pool, svc, os.Getenv("REDIS_URL"))

	// Welcome-email cadence (day-1 / day-3 / day-7). Idempotent via
	// users.welcome_*_sent_at timestamps stamped on dispatch.
	runWelcomeEmailScheduler(ctx, pool, svc)

	// New-listing fan-out to seller followers. Subscribes to
	// `notify:seller_new_listing:*` published by the job service when a
	// listing flips to status='active'. Skipped when REDIS_URL is unset.
	runFollowsPubsubScheduler(ctx, pool, svc, os.Getenv("REDIS_URL"))

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	s := grpc.NewServer(
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		grpc.ChainUnaryInterceptor(loggingUnaryInterceptor),
		grpc.ChainStreamInterceptor(loggingStreamInterceptor),
	)
	notificationgrpc.Register(s, srv)

	// Observability HTTP server (healthz / readyz / metrics) on a separate port.
	startObservabilityServer(ctx, "notification-service", port, pool)

	go func() {
		slog.Info("notification service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down notification service")
	s.GracefulStop()
	slog.Info("notification service stopped")
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

// loggingUnaryInterceptor logs every unary gRPC call with method name, duration, and any error.
func loggingUnaryInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
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
func loggingStreamInterceptor(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
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
