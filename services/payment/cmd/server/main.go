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

	// Initialize Stripe key.
	stripeKey := os.Getenv("STRIPE_SECRET_KEY")
	if stripeKey != "" {
		stripe.Key = stripeKey
		slog.Info("stripe key configured")
	} else {
		slog.Warn("STRIPE_SECRET_KEY not set, Stripe operations will return stubs")
	}

	// Refuse to start without a Stripe key in non-development environments.
	appEnv := os.Getenv("APP_ENV")
	if stripeKey == "" && appEnv != "development" && appEnv != "" {
		slog.Error("STRIPE_SECRET_KEY is required in non-development environments")
		os.Exit(1)
	}

	// Wire up services.
	repo := repository.NewPostgresRepository(pool)
	stripeSvc := service.NewStripeService()
	paymentSvc := service.NewPaymentService(repo, stripeSvc)
	grpcServer := paymentgrpc.NewServer(paymentSvc)

	// Wire up subscription service (shares same repo and stripe service).
	subscriptionSvc := service.NewSubscriptionService(repo, stripeSvc)
	subscriptionGRPCServer := paymentgrpc.NewSubscriptionServer(subscriptionSvc)

	// Wire up insurance service (shares same repo and stripe service).
	insuranceSvc := service.NewInsuranceService(repo, stripeSvc)
	insuranceGRPCServer := paymentgrpc.NewInsuranceServer(insuranceSvc)

	// Wire subscription event delegation so payment events route subscription
	// events (customer.subscription.*, invoice.*) to the subscription service.
	paymentSvc.SetSubscriptionWebhookHandler(subscriptionSvc)

	// Wire up installment (BNPL) service.
	installmentSvc := service.NewInstallmentService(repo, stripeSvc)
	installmentGRPCServer := paymentgrpc.NewInstallmentServer(installmentSvc)
	paymentSvc.SetInstallmentPaymentHandler(installmentSvc)

	// Create and register gRPC server.
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		slog.Error("failed to listen", "error", err)
		os.Exit(1)
	}

	s := grpclib.NewServer(
		grpclib.StatsHandler(otelgrpc.NewServerHandler()),
	)
	paymentgrpc.Register(s, grpcServer)
	paymentgrpc.RegisterSubscription(s, subscriptionGRPCServer)
	paymentgrpc.RegisterInstallmentServer(s, installmentGRPCServer)
	paymentgrpc.RegisterInsurance(s, insuranceGRPCServer)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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
