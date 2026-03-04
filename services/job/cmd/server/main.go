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
	grpclib "google.golang.org/grpc"

	grpcserver "github.com/nomarkup/nomarkup/services/job/internal/grpc"
	"github.com/nomarkup/nomarkup/services/job/internal/repository"
	"github.com/nomarkup/nomarkup/services/job/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	port := os.Getenv("JOB_SERVICE_PORT")
	if port == "" {
		port = "50052"
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	// Initialize OpenTelemetry tracing.
	tracerShutdown, err := initTracer(context.Background(), "job-service")
	if err != nil {
		slog.Error("failed to initialize tracer", "error", err)
		os.Exit(1)
	}
	defer tracerShutdown()

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

	// Optional Meilisearch integration.
	meiliHost := os.Getenv("MEILISEARCH_HOST")
	meiliKey := os.Getenv("MEILISEARCH_API_KEY")

	var searchEngine *service.SearchEngine
	if meiliHost != "" {
		se, err := service.NewSearchEngine(meiliHost, meiliKey)
		if err != nil {
			slog.Warn("failed to initialize search engine, continuing without search", "error", err)
		} else {
			searchEngine = se
			slog.Info("connected to meilisearch", "host", meiliHost)
		}
	}

	// Wire up dependencies.
	repo := repository.NewPostgresRepository(pool)
	jobService := service.NewJobService(repo, searchEngine)
	srv := grpcserver.NewServer(jobService)

	// Wire up contract service (shares same repo/pool).
	contractService := service.NewContractService(repo, repo)
	contractSrv := grpcserver.NewContractServer(contractService)

	// Wire up review service (shares same repo/pool).
	reviewService := service.NewReviewService(repo, repo)
	reviewSrv := grpcserver.NewReviewServer(reviewService)

	// Wire up analytics service (shares same repo/pool).
	analyticsService := service.NewAnalyticsService(repo)
	analyticsSrv := grpcserver.NewAnalyticsServer(analyticsService)

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
	grpcserver.RegisterContract(s, contractSrv)
	grpcserver.RegisterReview(s, reviewSrv)
	grpcserver.RegisterAnalytics(s, analyticsSrv)

	sigCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("job service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-sigCtx.Done()
	slog.Info("shutting down job service")
	s.GracefulStop()
	slog.Info("job service stopped")
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
