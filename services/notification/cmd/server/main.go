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

	if err := pool.Ping(ctx); err != nil {
		slog.Error("failed to ping database", "error", err)
		os.Exit(1)
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
	if os.Getenv("TWILIO_ACCOUNT_SID") == "" {
		slog.Info("sms dispatcher running in dev mode (TWILIO_ACCOUNT_SID not set)")
	}

	// Wire up dependencies.
	repo := repository.New(pool)
	svc := service.New(repo, repo, emailDispatcher, pushDispatcher, smsDispatcher)
	srv := notificationgrpc.NewServer(svc)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	s := grpc.NewServer(
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
	)
	notificationgrpc.Register(s, srv)

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
