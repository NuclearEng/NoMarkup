package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/jackc/pgx/v5/pgxpool"
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
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"

	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	reviewv1 "github.com/nomarkup/nomarkup/proto/review/v1"
	"github.com/nomarkup/nomarkup/services/job/internal/client"
	"github.com/nomarkup/nomarkup/services/job/internal/config"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	grpcserver "github.com/nomarkup/nomarkup/services/job/internal/grpc"
	"github.com/nomarkup/nomarkup/services/job/internal/observability"
	"github.com/nomarkup/nomarkup/services/job/internal/repository"
	"github.com/nomarkup/nomarkup/services/job/internal/service"
)

func main() {
	logger := slog.New(observability.NewContextHandler(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))
	slog.SetDefault(logger)

	port := os.Getenv("JOB_SERVICE_PORT")
	if port == "" {
		port = "50052"
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
			slog.Info("sentry initialized", "service", "job-service")
			defer sentry.Flush(2 * time.Second)
		}
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

	// Meilisearch integration: optional in dev, required in production.
	// MEILISEARCH_URL is canonical; MEILISEARCH_HOST is a deprecated
	// fallback (resolved + normalized in internal/config). In production
	// (ENVIRONMENT=production, supplied by the k8s configmap) a missing URL
	// is a startup error — booting green with search silently dead is
	// fail-open, and §15 says fail closed.
	meiliURL := config.ResolveMeilisearchURL()
	meiliKey := os.Getenv("MEILISEARCH_API_KEY")
	if meiliURL == "" {
		if os.Getenv("ENVIRONMENT") == "production" {
			slog.Error("MEILISEARCH_URL is required in production (search would be silently disabled)")
			os.Exit(1)
		}
		slog.Info("MEILISEARCH_URL not set, search disabled")
	}

	// Trust-tiered search ranking (MOVE B2): a higher seller/provider trust tier
	// becomes a modest, explainable ranking signal. Behind the TRUST_RANKING
	// flag, default OFF (fail closed → current ordering unchanged).
	trustRanking := envBool("TRUST_RANKING", false)

	var searchEngine *service.SearchEngine
	var listingSearchEngine *service.ListingSearchEngine
	if meiliURL != "" {
		se, err := service.NewSearchEngine(meiliURL, meiliKey)
		if err != nil {
			slog.Warn("failed to initialize search engine, continuing without search", "error", err)
		} else {
			searchEngine = se
			slog.Info("connected to meilisearch", "url", meiliURL)
		}
		// Listings index is independent of jobs. Failure to configure
		// either does not stop the service from booting.
		lse, err := service.NewListingSearchEngine(meiliURL, meiliKey)
		if err != nil {
			slog.Warn("failed to initialize listing search engine, continuing without listing search", "error", err)
		} else {
			// Apply the trust-ranking mode BEFORE first index use so the ranking
			// rules + sortable attributes are configured for the chosen mode.
			lse.SetTrustRanking(trustRanking)
			if trustRanking {
				if err := lse.ConfigureIndex(); err != nil {
					slog.Error("failed to re-configure listings index for trust ranking", "error", err)
				}
			}
			listingSearchEngine = lse
			slog.Info("listings search index ready", "url", meiliURL, "trust_ranking", trustRanking)
		}
	}
	// Wire up dependencies.
	repo := repository.NewPostgresRepository(pool)
	jobService := service.NewJobService(repo, searchEngine)

	// Wire up ListingService with the listings Meilisearch indexer. The
	// gateway currently bypasses this service for read traffic (see
	// gateway/internal/handler/listings.go) but the service hooks fire
	// from any gRPC writes and from the reindex-listings CLI backfill.
	listingRepo := repository.NewListingPostgresRepository(pool)
	listingHydrate := buildListingHydrator(pool, trustRanking)
	listingService := service.NewListingService(listingRepo).WithSearch(listingSearchEngine, listingHydrate)

	// Optional Redis client — used only for the best-effort auction-close
	// notification seam (auction_won / auction_expired). The auction-close
	// worker functions correctly without it; failures here never block the
	// money path. Wire it only if REDIS_URL is set.
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		if opt, perr := redis.ParseURL(redisURL); perr != nil {
			slog.Warn("auction-close: invalid REDIS_URL, notifications disabled", "error", perr)
		} else {
			rdb := redis.NewClient(opt)
			defer func() { _ = rdb.Close() }()
			if err := redisotel.InstrumentTracing(rdb); err != nil {
				slog.Warn("redis tracing instrumentation failed", "error", err)
			}
			listingService = listingService.WithRedis(rdb)
			slog.Info("auction-close: redis notification seam enabled")
		}
	}

	// Wire up provider matching engine.
	matchingService := service.NewMatchingService(repo)
	jobService.SetMatchingService(matchingService)
	slog.Info("provider matching engine enabled")

	srv := grpcserver.NewServer(jobService)

	// Optional Rust Fair-Price engine client. The connection is lazy, so a down
	// engine never blocks startup — GetFairPrice fails soft (has_data=false).
	// Wire it only if PRICING_ENGINE_ADDR is set.
	var pricingEngine service.PricingEngine
	if pricingAddr := os.Getenv("PRICING_ENGINE_ADDR"); pricingAddr != "" {
		pc, perr := client.NewPricingClient(pricingAddr)
		if perr != nil {
			slog.Warn("fair-price: failed to init pricing engine client, GetFairPrice will return no data", "error", perr)
		} else {
			defer func() { _ = pc.Close() }()
			pricingEngine = pc
			slog.Info("fair-price: pricing engine client enabled", "addr", pricingAddr)
		}
	} else {
		slog.Info("fair-price: PRICING_ENGINE_ADDR not set, GetFairPrice will return no data")
	}

	// Wire up contract service (shares same repo/pool).
	contractService := service.NewContractService(repo, repo)
	contractSrv := grpcserver.NewContractServer(contractService)

	// Wire up review service (shares same repo/pool).
	reviewService := service.NewReviewService(repo, repo)
	reviewSrv := grpcserver.NewReviewServer(reviewService)

	// Wire up analytics service (shares same repo/pool). The Fair-Price engine
	// client is optional; if absent, GetFairPrice fails soft.
	analyticsService := service.NewAnalyticsService(repo)
	if pricingEngine != nil {
		analyticsService = analyticsService.WithPricingEngine(pricingEngine)
	}
	analyticsSrv := grpcserver.NewAnalyticsServer(analyticsService)

	// The GetFairPrice RPC lives on JobService but is powered by the analytics
	// service; wire it onto the job server.
	srv = srv.WithAnalytics(analyticsService)

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
	grpcserver.RegisterContract(s, contractSrv)
	grpcserver.RegisterReview(s, reviewSrv)
	grpcserver.RegisterAnalytics(s, analyticsSrv)

	// Standard gRPC health service (grpc.health.v1.Health). REQUIRED — the
	// Kubernetes deployment (deploy/k8s/base/job/deployment.yaml) uses native
	// gRPC liveness/readiness probes, and kubelet queries the EMPTY service
	// name. Without this registration every probe returns UNIMPLEMENTED,
	// readiness never passes and liveness restarts the pod (CrashLoopBackOff).
	// Do not delete as "unused" — the only caller is kubelet.
	healthSrv := health.NewServer()
	healthpb.RegisterHealthServer(s, healthSrv)
	healthSrv.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	for _, name := range []string{
		jobv1.JobService_ServiceDesc.ServiceName,
		contractv1.ContractService_ServiceDesc.ServiceName,
		reviewv1.ReviewService_ServiceDesc.ServiceName,
		analyticsv1.AnalyticsService_ServiceDesc.ServiceName,
	} {
		healthSrv.SetServingStatus(name, healthpb.HealthCheckResponse_SERVING)
	}

	sigCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Observability HTTP server (healthz / readyz / metrics) on a separate port.
	startObservabilityServer(sigCtx, "job-service", port, pool)

	// Goods-marketplace auction-close worker. Periodically resolves auctions
	// past their deadline that are still active: highest qualifying bidder wins
	// (escrow order created) or the listing expires with no sale. Mirrors the
	// payment service's marketplace auto-release cron. Tied to sigCtx so it
	// stops cleanly on shutdown. Interval/delay/batch are env-tunable.
	runAuctionCloseCron(
		sigCtx,
		listingService,
		envDuration("AUCTION_CLOSE_INTERVAL", 30*time.Second),
		envDuration("AUCTION_CLOSE_INITIAL_DELAY", 15*time.Second),
		envInt("AUCTION_CLOSE_BATCH", 100),
	)

	go func() {
		slog.Info("job service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-sigCtx.Done()
	slog.Info("shutting down job service")
	// Flip every health status to NOT_SERVING *before* draining so the k8s
	// readiness probe pulls this pod out of rotation while in-flight RPCs
	// finish.
	healthSrv.Shutdown()
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

// buildListingHydrator returns a closure that joins service_categories +
// reads the optional condition column to enrich Meilisearch documents.
// The category JOIN is single-row, so the cost is negligible per index op.
//
// Schema note: the `condition` column is added by Agent H in migration 040.
// We probe via information_schema once at startup; if absent we omit it.
func buildListingHydrator(pool *pgxpool.Pool, trustRanking bool) service.ListingHydrator {
	hasCondition := false
	{
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		var exists bool
		_ = pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM information_schema.columns
				 WHERE table_name = 'listings' AND column_name = 'condition'
			)`).Scan(&exists)
		hasCondition = exists
	}
	return func(ctx context.Context, l *domain.Listing) service.ListingExtraFields {
		var extras service.ListingExtraFields
		if pool == nil || l == nil {
			return extras
		}
		// service_categories JOIN.
		_ = pool.QueryRow(ctx, `
			SELECT COALESCE(name,''), COALESCE(slug,'')
			  FROM service_categories WHERE id = $1`, l.CategoryID,
		).Scan(&extras.CategoryName, &extras.CategorySlug)
		// Optional condition column.
		if hasCondition {
			var cond string
			if err := pool.QueryRow(ctx, `
				SELECT COALESCE(condition,'') FROM listings WHERE id = $1`, l.ID,
			).Scan(&cond); err == nil {
				extras.Condition = cond
			}
		}
		// Trust-tiered ranking (MOVE B2): read the seller's provider trust tier
		// from trust_scores so the indexer can emit a numeric trust_rank. Only
		// when the flag is on (skip the lookup otherwise). Fail-soft: a missing
		// row / error leaves TrustTier empty → trust_rank 0 → no boost.
		if trustRanking && l.SellerID != "" {
			var tier string
			if err := pool.QueryRow(ctx, `
				SELECT tier FROM trust_scores
				 WHERE user_id = $1 AND role = 'provider'`, l.SellerID,
			).Scan(&tier); err == nil {
				extras.TrustTier = tier
			}
		}
		return extras
	}
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

// envBool reads a boolean feature-flag env var. Recognizes 1/true/t/yes/on
// (case-insensitive) as true; everything else (including unset) returns def.
// Used to gate optional behavior fail-closed at startup.
func envBool(key string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	switch v {
	case "":
		return def
	case "1", "true", "t", "yes", "on":
		return true
	default:
		return false
	}
}
