package main

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	chatv1 "github.com/nomarkup/nomarkup/proto/chat/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	fraudv1 "github.com/nomarkup/nomarkup/proto/fraud/v1"
	imagingv1 "github.com/nomarkup/nomarkup/proto/imaging/v1"
	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	reviewv1 "github.com/nomarkup/nomarkup/proto/review/v1"
	subscriptionv1 "github.com/nomarkup/nomarkup/proto/subscription/v1"
	trustv1 "github.com/nomarkup/nomarkup/proto/trust/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/meilisearch/meilisearch-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/config"
	gatewaycrypto "github.com/nomarkup/nomarkup/gateway/internal/crypto"
	"github.com/nomarkup/nomarkup/gateway/internal/handler"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"github.com/nomarkup/nomarkup/gateway/internal/router"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Initialize Sentry error tracking. When SENTRY_DSN is not set, this is a
	// no-op — all sentry.CaptureException / hub.Recover calls become silent.
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
			slog.Info("sentry initialized", "environment", os.Getenv("APP_ENV"))
			defer sentry.Flush(2 * time.Second)
		}
	}

	// Initialize OpenTelemetry tracing.
	tracerShutdown, err := initTracer(context.Background(), "api-gateway")
	if err != nil {
		slog.Error("failed to initialize tracer", "error", err)
		os.Exit(1)
	}
	defer tracerShutdown()

	// Load JWT public key for token verification.
	publicKey, err := loadRSAPublicKey(cfg.JWTPublicKeyPath)
	if err != nil {
		slog.Error("failed to load JWT public key", "path", cfg.JWTPublicKeyPath, "error", err)
		os.Exit(1)
	}

	// Connect to User Service via gRPC.
	userConn, err := grpc.NewClient(cfg.UserServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithStatsHandler(otelgrpc.NewClientHandler()))
	if err != nil {
		slog.Error("failed to connect to user service", "addr", cfg.UserServiceAddr, "error", err)
		os.Exit(1)
	}
	defer userConn.Close()

	userClient := userv1.NewUserServiceClient(userConn)

	// Connect to Job Service via gRPC.
	jobConn, err := grpc.NewClient(cfg.JobServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithStatsHandler(otelgrpc.NewClientHandler()))
	if err != nil {
		slog.Error("failed to connect to job service", "addr", cfg.JobServiceAddr, "error", err)
		os.Exit(1)
	}
	defer jobConn.Close()

	jobClient := jobv1.NewJobServiceClient(jobConn)

	// Contract service lives on the same gRPC server as the job service.
	contractClient := contractv1.NewContractServiceClient(jobConn)

	// Connect to Bid Engine via gRPC.
	bidConn, err := grpc.NewClient(cfg.BidEngineAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithStatsHandler(otelgrpc.NewClientHandler()))
	if err != nil {
		slog.Error("failed to connect to bid engine", "addr", cfg.BidEngineAddr, "error", err)
		os.Exit(1)
	}
	defer bidConn.Close()

	bidClient := bidv1.NewBidServiceClient(bidConn)

	// Connect to Payment Service via gRPC.
	paymentConn, err := grpc.NewClient(cfg.PaymentServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithStatsHandler(otelgrpc.NewClientHandler()))
	if err != nil {
		slog.Error("failed to connect to payment service", "addr", cfg.PaymentServiceAddr, "error", err)
		os.Exit(1)
	}
	defer paymentConn.Close()

	paymentClient := paymentv1.NewPaymentServiceClient(paymentConn)

	// Connect to Chat Service via gRPC.
	chatConn, err := grpc.NewClient(cfg.ChatServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithStatsHandler(otelgrpc.NewClientHandler()))
	if err != nil {
		slog.Error("failed to connect to chat service", "addr", cfg.ChatServiceAddr, "error", err)
		os.Exit(1)
	}
	defer chatConn.Close()

	chatClient := chatv1.NewChatServiceClient(chatConn)

	// Connect to Trust Engine via gRPC.
	trustConn, err := grpc.NewClient(cfg.TrustEngineAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithStatsHandler(otelgrpc.NewClientHandler()))
	if err != nil {
		slog.Error("failed to connect to trust engine", "addr", cfg.TrustEngineAddr, "error", err)
		os.Exit(1)
	}
	defer trustConn.Close()

	trustClient := trustv1.NewTrustServiceClient(trustConn)

	// Connect to Fraud Engine via gRPC.
	fraudConn, err := grpc.NewClient(cfg.FraudEngineAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithStatsHandler(otelgrpc.NewClientHandler()))
	if err != nil {
		slog.Error("failed to connect to fraud engine", "addr", cfg.FraudEngineAddr, "error", err)
		os.Exit(1)
	}
	defer fraudConn.Close()

	fraudClient := fraudv1.NewFraudServiceClient(fraudConn)

	// Connect to Notification Service via gRPC.
	notifConn, err := grpc.NewClient(cfg.NotificationServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithStatsHandler(otelgrpc.NewClientHandler()))
	if err != nil {
		slog.Error("failed to connect to notification service", "addr", cfg.NotificationServiceAddr, "error", err)
		os.Exit(1)
	}
	defer notifConn.Close()

	notifClient := notificationv1.NewNotificationServiceClient(notifConn)

	// Connect to Imaging Service via gRPC.
	imagingConn, err := grpc.NewClient(cfg.ImagingServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithStatsHandler(otelgrpc.NewClientHandler()))
	if err != nil {
		slog.Error("failed to connect to imaging service", "addr", cfg.ImagingServiceAddr, "error", err)
		os.Exit(1)
	}
	defer imagingConn.Close()

	imagingClient := imagingv1.NewImagingServiceClient(imagingConn)

	// Initialize Redis cache (nil-safe — caching disabled if Redis unavailable).
	cacheClient := cache.New(cfg.RedisURL)
	if cacheClient != nil {
		defer cacheClient.Close()
	}

	// Connect to PostgreSQL for gateway-level queries (feature flags).
	// The pool is nil-safe — handlers degrade gracefully if DATABASE_URL is not set.
	var dbPool *pgxpool.Pool
	if cfg.DatabaseURL != "" {
		dbPool, err = pgxpool.New(context.Background(), cfg.DatabaseURL)
		if err != nil {
			slog.Error("failed to connect to database", "error", err)
			os.Exit(1)
		}
		defer dbPool.Close()
		slog.Info("database pool initialized")
	} else {
		slog.Warn("DATABASE_URL not set, feature flags disabled")
	}

	// Determine if we should use secure cookies (production).
	secureCookie := os.Getenv("SECURE_COOKIES") != "false"

	// Rate limiter (Redis-backed if cache available, in-memory fallback).
	// In development (ENVIRONMENT != "production"), auth rate limits are 10x
	// more permissive to allow multi-profile testing. RATE_LIMIT_AUTH env var
	// can override the auth limit in any environment.
	authLimitOverride, _ := strconv.Atoi(os.Getenv("RATE_LIMIT_AUTH"))
	rateLimiter := middleware.NewRateLimiter(cacheClient, cfg.IsProduction(), authLimitOverride)

	// Wire up handlers and middleware.
	authMW := middleware.NewAuthMiddleware(publicKey, cacheClient)
	authHandler := handler.NewAuthHandler(userClient, secureCookie)
	// Wire the idle-session timeout (CLAUDE.md §6) into the auth handler so
	// Login seeds the idle key and Refresh enforces it. authMW owns the cache
	// client + token decode; passing nil cache (Redis down) fails open.
	authHandler.WithIdleSession(authMW)
	userHandler := handler.NewUserHandler(userClient, dbPool)
	providerHandler := handler.NewProviderHandler(userClient, trustClient, dbPool)
	categoriesHandler := handler.NewCategoriesHandler(userClient, cacheClient)
	jobHandler := handler.NewJobHandler(jobClient, cacheClient, fraudClient, dbPool)
	// bidHandler depends on the contract client so awarding a bid also creates
	// a contract row in the same request (fixes severed customer-accept pipeline).
	bidHandler := handler.NewBidHandler(bidClient, contractClient, dbPool)
	// Wire the trust engine so the customer-facing bid list shows each bidder's
	// real computed trust score (otherwise it renders without a trust gauge).
	bidHandler.SetTrustClient(trustClient)
	// Wire the user service so the bid list resolves each bidder's display name
	// + avatar (the bidding engine returns those empty by design).
	bidHandler.SetUserClient(userClient)
	contractHandler := handler.NewContractHandler(contractClient, userClient, dbPool)

	// Review service lives on the same gRPC server as the job service.
	reviewClient := reviewv1.NewReviewServiceClient(jobConn)
	reviewHandler := handler.NewReviewHandler(reviewClient, trustClient, userClient, dbPool)

	// Subscription service lives on the same gRPC server as the payment service.
	subscriptionClient := subscriptionv1.NewSubscriptionServiceClient(paymentConn)
	subscriptionHandler := handler.NewSubscriptionHandler(subscriptionClient)

	// Analytics service lives on the same gRPC server as the job service.
	analyticsClient := analyticsv1.NewAnalyticsServiceClient(jobConn)
	analyticsHandler := handler.NewAnalyticsHandler(analyticsClient)

	// Installment, insurance, and tax/invoice RPCs are all part of the unified
	// PaymentService (proto consolidated — no separate sub-clients), so they
	// share the single paymentClient.
	paymentHandler := handler.NewPaymentHandler(paymentClient, dbPool)
	insuranceHandler := handler.NewInsuranceHandler(paymentClient)
	// Webhook handler receives raw payloads and forwards them to backend services
	// which perform Stripe signature verification via stripe.webhooks.constructEvent().
	webhookHandler := handler.NewWebhookHandler(paymentClient, subscriptionClient)
	propertyHandler := handler.NewPropertyHandler(userClient)
	verificationHandler := handler.NewVerificationHandler(userClient)
	workingCapitalHandler := handler.NewWorkingCapitalHandler(paymentClient, dbPool)
	expenseHandler := handler.NewExpenseHandler(paymentClient)
	taxHandler := handler.NewTaxHandler(paymentClient, analyticsClient, dbPool)
	chatHandler := handler.NewChatHandler(chatClient, userClient, authMW, cfg.ChatWSAddr, cfg.InternalWSSecret, dbPool)
	chatRelayHandler := handler.NewChatRelayHandler(dbPool)
	userBlocksHandler := handler.NewUserBlocksHandler(dbPool)
	userReportsHandler := handler.NewUserReportsHandler(dbPool)
	chatTemplatesHandler := handler.NewChatTemplatesHandler(dbPool)
	auctionWSHandler := handler.NewAuctionWSHandler(authMW, cfg.ChatWSAddr, cfg.InternalWSSecret)
	spectatorWSHandler := handler.NewSpectatorWSHandler(cacheClient)
	marketplaceSpectatorWSHandler := handler.NewMarketplaceSpectatorWSHandler(cacheClient)
	trustHandler := handler.NewTrustHandler(trustClient, cacheClient)
	fraudHandler := handler.NewFraudHandler(fraudClient, trustClient)
	notificationHandler := handler.NewNotificationHandler(notifClient)
	imageHandler := handler.NewImageHandler(imagingClient)

	// Admin handlers — use existing gRPC clients.
	adminUsersHandler := handler.NewAdminUsersHandler(userClient)
	adminVerificationHandler := handler.NewAdminVerificationHandler(userClient)
	adminJobsHandler := handler.NewAdminJobsHandler(jobClient)
	adminDisputesHandler := handler.NewAdminDisputesHandler(contractClient, dbPool)
	adminReviewsHandler := handler.NewAdminReviewsHandler(reviewClient)
	adminPaymentsHandler := handler.NewAdminPaymentsHandler(paymentClient)
	adminBankingHandler := handler.NewAdminBankingHandler(paymentClient)
	adminPlatformHandler := handler.NewAdminPlatformHandler(analyticsClient, subscriptionClient)
	featureFlagHandler := handler.NewFeatureFlagHandler(dbPool, cacheClient)
	insuranceCompetitionHandler := handler.NewInsuranceCompetitionHandler(dbPool)
	providerLicenseHandler := handler.NewProviderLicenseHandler(dbPool)
	pricingHandler := handler.NewPricingHandler(dbPool)
	auctionReplayHandler := handler.NewAuctionReplayHandler(dbPool)
	challengeHandler := handler.NewChallengeHandler(dbPool)
	installmentHandler := handler.NewInstallmentHandler(paymentClient)
	oauthHandler := handler.NewOAuthHandler(userClient, secureCookie)
	workspaceHandler := handler.NewWorkspaceHandler(cacheClient, imagingClient)
	instantMatchHandler := handler.NewInstantMatchHandler(jobClient, bidClient, contractClient, cacheClient)
	disputeHandler := handler.NewDisputeHandler(contractClient, dbPool)
	piiCipher, err := gatewaycrypto.FromEnv()
	if err != nil {
		slog.Error("crypto: load encryption key", "error", err)
		os.Exit(1)
	}
	employeesHandler := handler.NewEmployeesHandler(dbPool, piiCipher)
	adminMarketplaceHandler := handler.NewAdminMarketplaceHandler(dbPool)
	listingOrdersHandler := handler.NewListingOrdersHandler(dbPool)
	listingsHandler := handler.NewListingsHandler(dbPool, cacheClient)
	watchlistHandler := handler.NewWatchlistHandler(dbPool, cacheClient)
	wishlistHandler := handler.NewWishlistHandler(dbPool)
	// Wire the wishlist price-alert fan-out into the listing-create path so a
	// new active listing that matches a buyer's wishlist notifies the owner.
	listingsHandler.SetWishlist(wishlistHandler)
	// Wire the trust engine so the listing-detail seller card shows the
	// seller's real computed trust score/tier instead of null.
	listingsHandler.SetTrustClient(trustClient)
	followsHandler := handler.NewFollowsHandler(dbPool)
	pushSubscriptionsHandler := handler.NewPushSubscriptionsHandler(dbPool)
	complianceHandler := handler.NewComplianceHandler(dbPool)
	bidBondHandler := handler.NewBidBondHandler(dbPool, paymentClient)
	offersHandler := handler.NewOffersHandler(dbPool)
	listingReplayHandler := handler.NewListingReplayHandler(dbPool)
	referralsHandler := handler.NewReferralsHandler(dbPool)
	// Wave 5 power-seller surface (Agent R) — analytics dashboard, paid
	// promotions, CSV export. All three are gateway-direct (no gRPC
	// hop) since they're either pure SQL or thin wrappers around the
	// existing payment service.
	sellerAnalyticsHandler := handler.NewSellerAnalyticsHandler(dbPool)
	promotedListingsHandler := handler.NewPromotedListingsHandler(dbPool, paymentClient)
	csvExportHandler := handler.NewCSVExportHandler(dbPool)
	// GDPR Art. 15 / CCPA right-to-access — self-service personal-data export.
	// Gateway-direct (pure owner-scoped SQL, no gRPC hop), mirroring the
	// erasure cascade's table set.
	dataExportHandler := handler.NewDataExportHandler(dbPool)
	// Wave 5 Agent Q surface — wired here since main.go is the shared
	// composition root (router signature already references these). The
	// handler implementations live in agent Q's owned files.
	categoryQuestionsHandler := handler.NewCategoryQuestionsHandler(dbPool)
	quoteTemplatesHandler := handler.NewQuoteTemplatesHandler(dbPool)
	contractTipHandler := handler.NewContractTipHandler(dbPool)
	calendarExportHandler := handler.NewCalendarExportHandler(dbPool, publicKey)
	marketsHandler := handler.NewMarketsHandler(dbPool)
	adminMarketsHandler := handler.NewAdminMarketsHandler(dbPool)

	// Optional Meilisearch client for listings autocomplete + "similar"
	// rails. Mirrors the env conventions used by services/job
	// (MEILISEARCH_HOST / MEILISEARCH_API_KEY). When not configured, the
	// search handler returns empty payloads — non-fatal in dev/sandbox.
	var meiliClient meilisearch.ServiceManager
	if host := os.Getenv("MEILISEARCH_HOST"); host != "" {
		meiliClient = meilisearch.New(host, meilisearch.WithAPIKey(os.Getenv("MEILISEARCH_API_KEY")))
		slog.Info("meilisearch client initialized", "host", host)
	}
	listingsSearchHandler := handler.NewListingsSearchHandler(dbPool, meiliClient, listingsHandler)

	// webhookHandler uses stripe.webhooks.constructEvent on the backend for signature verification.
	r := router.New(
		cfg.AllowedOrigins, cfg.IsProduction(), dbPool, cacheClient, rateLimiter, authMW,
		authHandler, userHandler, providerHandler, categoriesHandler,
		jobHandler, bidHandler, contractHandler, paymentHandler,
		webhookHandler, chatHandler, reviewHandler, trustHandler,
		fraudHandler, notificationHandler, imageHandler,
		subscriptionHandler, analyticsHandler,
		adminUsersHandler, adminVerificationHandler, adminJobsHandler,
		adminDisputesHandler, adminReviewsHandler, adminPaymentsHandler,
		adminBankingHandler,
		adminPlatformHandler, propertyHandler, verificationHandler,
		workingCapitalHandler, expenseHandler, taxHandler,
		auctionWSHandler,
		spectatorWSHandler,
		marketplaceSpectatorWSHandler,
		featureFlagHandler,
		pricingHandler,
		oauthHandler,
		auctionReplayHandler,
		challengeHandler,
		installmentHandler,
		insuranceHandler,
		workspaceHandler,
		instantMatchHandler,
		disputeHandler,
		employeesHandler,
		adminMarketplaceHandler,
		listingOrdersHandler,
		listingsHandler,
		watchlistHandler,
		wishlistHandler,
		followsHandler,
		listingsSearchHandler,
		pushSubscriptionsHandler,
		complianceHandler,
		bidBondHandler,
		offersHandler,
		listingReplayHandler,
		chatRelayHandler,
		userBlocksHandler,
		userReportsHandler,
		chatTemplatesHandler,
		referralsHandler,
		sellerAnalyticsHandler,
		promotedListingsHandler,
		csvExportHandler,
		categoryQuestionsHandler,
		quoteTemplatesHandler,
		contractTipHandler,
		calendarExportHandler,
		marketsHandler,
		adminMarketsHandler,
		insuranceCompetitionHandler,
		providerLicenseHandler,
		dataExportHandler,
	)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("gateway starting", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down gracefully")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("forced shutdown", "error", err)
	}
	slog.Info("gateway stopped")
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

// loadRSAPublicKey reads and parses a PEM-encoded RSA public key from disk.
func loadRSAPublicKey(path string) (*rsa.PublicKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read public key file: %w", err)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("no PEM block found in %s", path)
	}

	key, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse public key: %w", err)
	}

	rsaKey, ok := key.(*rsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("public key is not RSA")
	}
	return rsaKey, nil
}
