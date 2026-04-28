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
	"github.com/stripe/stripe-go/v82"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	grpclib "google.golang.org/grpc"

	paymentgrpc "github.com/nomarkup/nomarkup/services/payment/internal/grpc"
	"github.com/nomarkup/nomarkup/services/payment/internal/repository"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	port := os.Getenv("PAYMENT_SERVICE_PORT")
	if port == "" {
		port = "50054"
	}

	// ENVIRONMENT is the canonical deployment-environment env var across the
	// whole payment service. Must be one of: development, staging, production.
	// Required (fail closed); defaults are not allowed so that a missing value
	// can't silently grant dev-only bypasses in production.
	env := os.Getenv("ENVIRONMENT")
	if env == "" {
		slog.Error("ENVIRONMENT is required (development|staging|production)")
		os.Exit(1)
	}
	switch env {
	case "development", "staging", "production":
	default:
		slog.Error("ENVIRONMENT must be one of development|staging|production", "got", env)
		os.Exit(1)
	}

	// Initialize Sentry error tracking.
	if sentryDSN := os.Getenv("SENTRY_DSN"); sentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:              sentryDSN,
			Environment:      env,
			Release:          os.Getenv("APP_VERSION"),
			TracesSampleRate: 0.1,
			EnableTracing:    true,
		}); err != nil {
			slog.Error("failed to initialize sentry", "error", err)
		} else {
			slog.Info("sentry initialized", "service", "payment-service")
			defer sentry.Flush(2 * time.Second)
		}
	}

	// Initialize OpenTelemetry tracing.
	tracerShutdown, err := initTracer(context.Background(), "payment-service")
	if err != nil {
		slog.Error("failed to initialize tracer", "error", err)
		os.Exit(1)
	}
	defer tracerShutdown()

	// Database connection.
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	for attempt := 1; ; attempt++ {
		if err := pool.Ping(context.Background()); err != nil {
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

	// Initialize Stripe key. A placeholder value (e.g. "sk_test_..." from the
	// committed .env template) would silently route real money flows through
	// the in-memory DevStore on startup, so reject placeholders in
	// non-development environments. Empty AND placeholder are both treated as
	// "missing" — see service.IsPlaceholderStripeKey for the exact rules.
	stripeKey := os.Getenv("STRIPE_SECRET_KEY")
	stripeKeyPlaceholder := service.IsPlaceholderStripeKey(stripeKey)
	if stripeKeyPlaceholder && env != "development" {
		slog.Error("STRIPE_SECRET_KEY is missing or a placeholder; refusing to start in non-development environment", "environment", env)
		os.Exit(1)
	}
	if !stripeKeyPlaceholder {
		stripe.Key = stripeKey
		slog.Info("stripe key configured")
	} else {
		// env=="development" by the check above.
		slog.Warn("STRIPE_SECRET_KEY missing or placeholder; payment/subscription flows will use the in-memory DevStore (development only)")
	}

	// Stripe webhook signature verification is MANDATORY in every environment.
	// A missing webhook secret would allow forged events (e.g. a spoofed
	// payment_intent.succeeded) to release escrow, so we fail closed at
	// startup rather than silently disabling verification per-request.
	// Tests inject a fake WebhookEventValidator directly; they do not go
	// through this code path.
	webhookSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")
	if webhookSecret == "" {
		slog.Error("STRIPE_WEBHOOK_SECRET is required — refusing to start without webhook signature verification")
		os.Exit(1)
	}

	// Wire up services.
	repo := repository.NewPostgresRepository(pool)
	stripeSvc := service.NewStripeService(env)
	paymentSvc := service.NewPaymentService(repo, stripeSvc)
	paymentSvc.SetWebhookValidator(service.NewStripeWebhookValidator(webhookSecret))
	grpcServer := paymentgrpc.NewServer(paymentSvc)

	// Wire up subscription service (shares same repo and stripe service).
	// Subscription has its own proto service, so it keeps a separate gRPC server.
	subscriptionSvc := service.NewSubscriptionService(repo, stripeSvc)
	subscriptionGRPCServer := paymentgrpc.NewSubscriptionServer(subscriptionSvc)

	// Wire subscription event delegation so payment events route subscription
	// events (customer.subscription.*, invoice.*) to the subscription service.
	paymentSvc.SetSubscriptionWebhookHandler(subscriptionSvc)

	// Installment (BNPL) and insurance live under the same PaymentService proto
	// surface, so their domain services are attached to the main gRPC server
	// rather than registered as separate services.
	installmentSvc := service.NewInstallmentService(repo, stripeSvc)
	grpcServer.SetInstallmentService(installmentSvc)
	paymentSvc.SetInstallmentPaymentHandler(installmentSvc)

	insuranceSvc := service.NewInsuranceService(repo, stripeSvc)
	grpcServer.SetInsuranceService(insuranceSvc)

	// GDPR/CCPA Stripe deletion adapter — called by the user service's
	// Erasure pipeline via DeleteStripeAccounts. In dev mode this short-
	// circuits to "skipped_no_client" outcomes. See
	// docs/operations/gdpr-delete.md.
	grpcServer.SetStripeDeleter(service.NewStripeDeleter(stripeSvc))

	// Create and register gRPC server.
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	s := grpclib.NewServer(
		grpclib.StatsHandler(otelgrpc.NewServerHandler()),
		grpclib.ChainUnaryInterceptor(loggingUnaryInterceptor),
		grpclib.ChainStreamInterceptor(loggingStreamInterceptor),
	)
	paymentgrpc.Register(s, grpcServer)
	paymentgrpc.RegisterSubscription(s, subscriptionGRPCServer)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Observability HTTP server (healthz / readyz / metrics) on a separate port.
	// Also exposes stripe_webhook_processing_duration_seconds — see observability.go.
	startObservabilityServer(ctx, "payment-service", port, pool)

	go func() {
		slog.Info("payment service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down payment service")
	s.GracefulStop()
	slog.Info("payment service stopped")
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
