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
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/meilisearch/meilisearch-go"
	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	chatv1 "github.com/nomarkup/nomarkup/proto/chat/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	fraudv1 "github.com/nomarkup/nomarkup/proto/fraud/v1"
	imagingv1 "github.com/nomarkup/nomarkup/proto/imaging/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
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
	"google.golang.org/grpc"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/config"
	gatewaycrypto "github.com/nomarkup/nomarkup/gateway/internal/crypto"
	"github.com/nomarkup/nomarkup/gateway/internal/handler"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"github.com/nomarkup/nomarkup/gateway/internal/observability"
	"github.com/nomarkup/nomarkup/gateway/internal/router"
	"github.com/nomarkup/nomarkup/gateway/internal/vault"
	"github.com/nomarkup/nomarkup/pkg/grpmtls"
)

func main() {
	// The ContextHandler decorator stamps request_id / trace_id / span_id onto
	// every record logged with a *Context variant, so existing call sites become
	// correlatable without touching them.
	logger := slog.New(observability.NewContextHandler(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Fail fast on §12-required infrastructure vars in production, before
	// anything dials out or binds a port. In dev the gateway degrades
	// gracefully (feature flags off, in-memory rate limits, localhost Redis
	// default), but production booting green without a database or Redis is
	// fail-open. Mirrors the Meilisearch production check below (e4208e7).
	if cfg.IsProduction() {
		if missing := config.MissingProductionVars(); len(missing) > 0 {
			slog.Error("required environment variables missing in production", "missing", missing)
			os.Exit(1)
		}
	}

	// OPS-25: optional in-process Vault overlay. When VAULT_ADDR is unset the
	// client is a no-op and every GetString falls through to env (K8s Secret
	// / .env.local) — zero behavior change. When set, Vault wins for keys
	// present at the platform path; missing keys still use env. ESO →
	// nomarkup-secrets remains the primary prod path (OPS-04); this wire is
	// the migration bridge documented in docs/operations/vault-client.md.
	bootCtx := context.Background()
	vaultClient, err := vault.New(bootCtx)
	if err != nil {
		slog.Error("failed to initialize vault client", "error", err)
		os.Exit(1)
	}
	defer vaultClient.Close()
	vaultPath := vaultPlatformPath(cfg.Environment)
	if ws := vaultClient.GetString(bootCtx, vaultPath, "INTERNAL_WS_SECRET", "INTERNAL_WS_SECRET"); ws != "" {
		cfg.InternalWSSecret = ws
	} else if alias := os.Getenv("GATEWAY_CHAT_SECRET"); alias != "" {
		// Preserve config.Load alias when Vault + INTERNAL_WS_SECRET are empty.
		cfg.InternalWSSecret = alias
	}

	// Initialize Sentry error tracking. When SENTRY_DSN is not set, this is a
	// no-op — all sentry.CaptureException / hub.Recover calls become silent.
	if sentryDSN := vaultClient.GetString(bootCtx, vaultPath, "SENTRY_DSN", "SENTRY_DSN"); sentryDSN != "" {
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

	// Shared dial options for every backend connection. otelgrpc's stats handler
	// continues the inbound HTTP server span across the hop; the interceptors
	// bound the call, observe the outbound gRPC metrics and forward the request
	// id as metadata.
	//
	// RES-01: the timeout interceptor is chained OUTERMOST so a wedged backend
	// releases the gateway goroutine after middleware.GRPCCallTimeout rather
	// than being held for the full http.Server.WriteTimeout (which does not
	// cancel r.Context() anyway), and so the metrics interceptor beneath it
	// records the resulting DeadlineExceeded status instead of never firing.
	// Keepalive makes a black-holed connection fail fast instead of hanging on
	// the OS TCP timeout.
	//
	// Mesh mTLS (C1): transport credentials come from grpmtls. When unconfigured
	// this is still insecure.NewCredentials() — local dev and compose stay
	// plaintext. When GRPC_MTLS + cert paths are set, peer identity is
	// cryptographic and network position alone is no longer sufficient to call
	// a service.
	mtlsCfg, err := grpmtls.Load()
	if err != nil {
		slog.Error("failed to load gRPC mTLS config", "error", err)
		os.Exit(1)
	}
	transportCreds, err := mtlsCfg.ClientCredentials()
	if err != nil {
		slog.Error("failed to build gRPC client credentials", "error", err)
		os.Exit(1)
	}
	if mtlsCfg.Enabled {
		slog.Info("gRPC mesh mTLS enabled for gateway dials", "server_name", mtlsCfg.ServerName)
	} else {
		slog.Warn("gRPC mesh mTLS disabled; dialing with insecure credentials (network position is the auth boundary)")
	}
	grpcDialOpts := []grpc.DialOption{
		grpc.WithTransportCredentials(transportCreds),
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
		grpc.WithChainUnaryInterceptor(
			middleware.GRPCTimeoutUnaryInterceptor,
			middleware.GRPCClientInterceptor,
		),
		grpc.WithStreamInterceptor(middleware.GRPCStreamClientInterceptor),
		grpc.WithKeepaliveParams(middleware.GRPCClientKeepalive()),
	}

	// Connect to User Service via gRPC.
	userConn, err := grpc.NewClient(cfg.UserServiceAddr, grpcDialOpts...)
	if err != nil {
		slog.Error("failed to connect to user service", "addr", cfg.UserServiceAddr, "error", err)
		os.Exit(1)
	}
	defer userConn.Close()

	userClient := userv1.NewUserServiceClient(userConn)

	// Connect to Job Service via gRPC.
	jobConn, err := grpc.NewClient(cfg.JobServiceAddr, grpcDialOpts...)
	if err != nil {
		slog.Error("failed to connect to job service", "addr", cfg.JobServiceAddr, "error", err)
		os.Exit(1)
	}
	defer jobConn.Close()

	jobClient := jobv1.NewJobServiceClient(jobConn)

	// Contract service lives on the same gRPC server as the job service.
	contractClient := contractv1.NewContractServiceClient(jobConn)

	// Connect to Bid Engine via gRPC.
	bidConn, err := grpc.NewClient(cfg.BidEngineAddr, grpcDialOpts...)
	if err != nil {
		slog.Error("failed to connect to bid engine", "addr", cfg.BidEngineAddr, "error", err)
		os.Exit(1)
	}
	defer bidConn.Close()

	bidClient := bidv1.NewBidServiceClient(bidConn)

	// Connect to Payment Service via gRPC.
	paymentConn, err := grpc.NewClient(cfg.PaymentServiceAddr, grpcDialOpts...)
	if err != nil {
		slog.Error("failed to connect to payment service", "addr", cfg.PaymentServiceAddr, "error", err)
		os.Exit(1)
	}
	defer paymentConn.Close()

	paymentClient := paymentv1.NewPaymentServiceClient(paymentConn)

	// Connect to Chat Service via gRPC.
	chatConn, err := grpc.NewClient(cfg.ChatServiceAddr, grpcDialOpts...)
	if err != nil {
		slog.Error("failed to connect to chat service", "addr", cfg.ChatServiceAddr, "error", err)
		os.Exit(1)
	}
	defer chatConn.Close()

	chatClient := chatv1.NewChatServiceClient(chatConn)

	// Connect to Trust Engine via gRPC.
	trustConn, err := grpc.NewClient(cfg.TrustEngineAddr, grpcDialOpts...)
	if err != nil {
		slog.Error("failed to connect to trust engine", "addr", cfg.TrustEngineAddr, "error", err)
		os.Exit(1)
	}
	defer trustConn.Close()

	trustClient := trustv1.NewTrustServiceClient(trustConn)

	// Connect to Fraud Engine via gRPC.
	fraudConn, err := grpc.NewClient(cfg.FraudEngineAddr, grpcDialOpts...)
	if err != nil {
		slog.Error("failed to connect to fraud engine", "addr", cfg.FraudEngineAddr, "error", err)
		os.Exit(1)
	}
	defer fraudConn.Close()

	fraudClient := fraudv1.NewFraudServiceClient(fraudConn)

	// Connect to Notification Service via gRPC.
	notifConn, err := grpc.NewClient(cfg.NotificationServiceAddr, grpcDialOpts...)
	if err != nil {
		slog.Error("failed to connect to notification service", "addr", cfg.NotificationServiceAddr, "error", err)
		os.Exit(1)
	}
	defer notifConn.Close()

	notifClient := notificationv1.NewNotificationServiceClient(notifConn)

	// Connect to Imaging Service via gRPC.
	imagingConn, err := grpc.NewClient(cfg.ImagingServiceAddr, grpcDialOpts...)
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

	// Connect to PostgreSQL for gateway-level queries (feature flags, admin, direct reads).
	// The pool is nil-safe — handlers degrade gracefully if DATABASE_URL is not set.
	var dbPool *pgxpool.Pool
	if cfg.DatabaseURL != "" {
		dbPool, err = observability.NewPGXPool(context.Background(), cfg.DatabaseURL)
		if err != nil {
			slog.Error("failed to connect to database", "error", err)
			os.Exit(1)
		}
		defer dbPool.Close()
		slog.Info("database (write) pool initialized")
	} else {
		slog.Warn("DATABASE_URL not set, feature flags disabled")
	}

	// Read replica pool for analytics, search, public catalog, profiles (NFR-12, scaling-blockers).
	// Falls back to write pool if DATABASE_URL_REPLICA not set (dev simplicity + safe rollout).
	var dbReadPool *pgxpool.Pool
	readURL := cfg.DatabaseReadURL
	if readURL != "" && readURL != cfg.DatabaseURL {
		dbReadPool, err = observability.NewPGXPool(context.Background(), readURL)
		if err != nil {
			slog.Error("failed to connect to database replica", "error", err)
			os.Exit(1)
		}
		defer dbReadPool.Close()
		slog.Info("database read replica pool initialized", "url", "REPLICA")
	} else {
		dbReadPool = dbPool // safe default
		if dbPool != nil {
			slog.Info("database read replica not configured; using primary pool for reads")
		}
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
	// SESSION_SECRET HMAC-signs the has_session soft-gate cookie (SEC-07).
	// HAS_SESSION_SECRET is an optional override so the web edge and gateway
	// can share a dedicated key without rotating the broader session secret.
	// Vault path (when VAULT_ADDR set) uses property SESSION_SECRET; env fallback.
	sessionSecret := os.Getenv("HAS_SESSION_SECRET")
	if sessionSecret == "" {
		sessionSecret = vaultClient.GetString(context.Background(), vaultPath, "SESSION_SECRET", "SESSION_SECRET")
	}
	if sessionSecret == "" {
		slog.Warn("SESSION_SECRET unset: has_session soft-gate cookie will not be issued")
	}
	authMW := middleware.NewAuthMiddleware(publicKey, cacheClient)
	authHandler := handler.NewAuthHandler(userClient, secureCookie, sessionSecret)
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
	// FR-18: approve visit + auto-approve complete may CreatePayment (real PI + client_secret).
	contractHandler.SetPaymentClient(paymentClient)

	// Review service lives on the same gRPC server as the job service.
	reviewClient := reviewv1.NewReviewServiceClient(jobConn)
	reviewHandler := handler.NewReviewHandler(reviewClient, trustClient, userClient, dbPool)

	// Subscription service lives on the same gRPC server as the payment service.
	subscriptionClient := subscriptionv1.NewSubscriptionServiceClient(paymentConn)
	subscriptionHandler := handler.NewSubscriptionHandler(subscriptionClient)

	// Analytics service lives on the same gRPC server as the job service.
	analyticsClient := analyticsv1.NewAnalyticsServiceClient(jobConn)
	analyticsHandler := handler.NewAnalyticsHandler(analyticsClient, jobClient)

	// Installment, insurance, and tax/invoice RPCs are all part of the unified
	// PaymentService (proto consolidated — no separate sub-clients), so they
	// share the single paymentClient.
	paymentHandler := handler.NewPaymentHandler(paymentClient, dbPool)
	// FR-18.8: after successful ProcessPayment on a visit PI, resume paused recurring.
	paymentHandler.SetContractClient(contractClient)
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
	adminDisputesHandler := handler.NewAdminDisputesHandler(contractClient, dbPool, paymentClient)
	adminReviewsHandler := handler.NewAdminReviewsHandler(reviewClient)
	adminPaymentsHandler := handler.NewAdminPaymentsHandler(paymentClient, dbPool, cacheClient)
	adminBankingHandler := handler.NewAdminBankingHandler(paymentClient)
	adminPlatformHandler := handler.NewAdminPlatformHandler(analyticsClient, subscriptionClient)
	featureFlagHandler := handler.NewFeatureFlagHandler(dbReadPool, cacheClient) // public flags + admin are safe on replica (small table)
	// Construct the PII cipher BEFORE any handler that needs it. Several
	// handlers take it as a variadic and fall back to building their own from
	// the environment — which is not a security regression (FromEnv still
	// fails closed outside development) but means each one silently owns a
	// separate cipher, and a future change to key loading would have to be
	// found in four places instead of one. Pass the shared instance.
	piiCipher, err := gatewaycrypto.FromEnv()
	if err != nil {
		slog.Error("crypto: load encryption key", "error", err)
		os.Exit(1)
	}
	insuranceCompetitionHandler := handler.NewInsuranceCompetitionHandler(dbPool)
	providerLicenseHandler := handler.NewProviderLicenseHandler(dbPool, piiCipher)
	pricingHandler := handler.NewPricingHandler(dbReadPool) // fair price + analytics reads
	auctionReplayHandler := handler.NewAuctionReplayHandler(dbPool)
	challengeHandler := handler.NewChallengeHandler(dbPool)
	installmentHandler := handler.NewInstallmentHandler(paymentClient)
	oauthHandler := handler.NewOAuthHandler(userClient, secureCookie, sessionSecret)
	// WebAuthn passkeys (IOS-SEC.2). Fails fast on invalid RP config (§12);
	// routes are additionally gated behind the `passkeys` feature flag.
	passkeyHandler, err := handler.NewPasskeyHandler(dbPool, cacheClient, userClient, authHandler)
	if err != nil {
		slog.Error("failed to initialize passkey handler", "error", err)
		os.Exit(1)
	}
	workspaceHandler := handler.NewWorkspaceHandler(cacheClient, imagingClient, dbPool, piiCipher)
	instantMatchHandler := handler.NewInstantMatchHandler(jobClient, bidClient, contractClient, cacheClient, userClient, dbPool)
	disputeHandler := handler.NewDisputeHandler(contractClient, dbPool)
	employeesHandler := handler.NewEmployeesHandler(dbPool, piiCipher)
	adminMarketplaceHandler := handler.NewAdminMarketplaceHandler(dbPool)
	listingOrdersHandler := handler.NewListingOrdersHandler(dbPool)
	// Wire ChargeListingWinner for POST /orders/{id}/pay (buyer pay-retry /
	// SCA resume). Without this the route returns 503 and the web surface
	// degrades to "not available yet".
	listingOrdersHandler.SetPaymentClient(paymentClient)
	listingsHandler := handler.NewListingsHandler(dbPool, cacheClient)
	watchlistHandler := handler.NewWatchlistHandler(dbPool, cacheClient)
	wishlistHandler := handler.NewWishlistHandler(dbPool)
	// Wire the wishlist price-alert fan-out into the listing-create path so a
	// new active listing that matches a buyer's wishlist notifies the owner.
	listingsHandler.SetWishlist(wishlistHandler)
	// Wire the trust engine so the listing-detail seller card shows the
	// seller's real computed trust score/tier instead of null.
	listingsHandler.SetTrustClient(trustClient)
	// Wire ChargeListingWinner for buy-now closeouts (MON-06: pending_payment
	// + PI, never held without payment).
	listingsHandler.SetPaymentClient(paymentClient)
	followsHandler := handler.NewFollowsHandler(dbPool)
	pushSubscriptionsHandler := handler.NewPushSubscriptionsHandler(dbPool)
	complianceHandler := handler.NewComplianceHandler(dbPool, piiCipher)
	bidBondHandler := handler.NewBidBondHandler(dbPool, paymentClient)
	offersHandler := handler.NewOffersHandler(dbPool)
	// Wire ChargeListingWinner for offer-accept closeouts (same MON-06 rule).
	offersHandler.SetPaymentClient(paymentClient)
	listingReplayHandler := handler.NewListingReplayHandler(dbPool)
	referralsHandler := handler.NewReferralsHandler(dbPool)
	// Wave 5 power-seller surface (Agent R) — analytics dashboard, paid
	// promotions, CSV export. All three are gateway-direct (no gRPC
	// hop) since they're either pure SQL or thin wrappers around the
	// existing payment service.
	sellerAnalyticsHandler := handler.NewSellerAnalyticsHandler(dbReadPool) // analytics are read-heavy
	promotedListingsHandler := handler.NewPromotedListingsHandler(dbPool, paymentClient)
	csvExportHandler := handler.NewCSVExportHandler(dbPool)
	// GDPR Art. 15 / CCPA right-to-access — self-service personal-data export.
	// Gateway-direct (pure owner-scoped SQL, no gRPC hop), mirroring the
	// erasure cascade's table set.
	// Pass the cipher explicitly. The GDPR Art. 15 export previously held no
	// cipher at all and returned raw ciphertext to the data subject, so the
	// dependency is load-bearing rather than optional — wiring it here means a
	// missing key is a startup failure (FromEnv already ran above) instead of
	// a silent per-request fallback.
	dataExportHandler := handler.NewDataExportHandler(dbPool, piiCipher)
	// Wave 5 Agent Q surface — wired here since main.go is the shared
	// composition root (router signature already references these). The
	// handler implementations live in agent Q's owned files.
	categoryQuestionsHandler := handler.NewCategoryQuestionsHandler(dbPool)
	quoteTemplatesHandler := handler.NewQuoteTemplatesHandler(dbPool)
	contractTipHandler := handler.NewContractTipHandler(dbPool, paymentClient)
	calendarExportHandler := handler.NewCalendarExportHandler(dbPool, publicKey, piiCipher)
	marketsHandler := handler.NewMarketsHandler(dbPool)
	adminMarketsHandler := handler.NewAdminMarketsHandler(dbPool)

	// Optional Meilisearch client for listings autocomplete + "similar"
	// rails. Mirrors the env conventions used by services/job
	// (MEILISEARCH_URL / MEILISEARCH_API_KEY, with MEILISEARCH_HOST as a
	// deprecated fallback). When not configured, the search handler returns
	// empty payloads — non-fatal in dev/sandbox, but a hard startup error in
	// production: booting green with search silently dead is fail-open.
	var meiliClient meilisearch.ServiceManager
	if meiliURL := config.ResolveMeilisearchURL(); meiliURL != "" {
		meiliAPIKey := vaultClient.GetString(context.Background(), vaultPath, "MEILISEARCH_API_KEY", "MEILISEARCH_API_KEY")
		meiliClient = meilisearch.New(meiliURL,
			meilisearch.WithAPIKey(meiliAPIKey),
			// Traced transport: Meilisearch has no OTel integration of its own,
			// so without this a slow search is an unexplained gap in the trace.
			meilisearch.WithCustomClient(observability.NewTracedHTTPClient("meilisearch")),
		)
		slog.Info("meilisearch client initialized", "url", meiliURL)
	} else if cfg.IsProduction() {
		slog.Error("MEILISEARCH_URL is required in production (search would be silently disabled)")
		os.Exit(1)
	} else {
		slog.Info("MEILISEARCH_URL not set, listings search disabled")
	}
	listingsSearchHandler := handler.NewListingsSearchHandler(dbReadPool, meiliClient, listingsHandler) // read replica for discovery

	// webhookHandler uses stripe.webhooks.constructEvent on the backend for signature verification.
	r := router.New(
		cfg.AllowedOrigins, cfg.IsProduction(), dbPool, dbReadPool, cacheClient, rateLimiter, authMW,
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
		passkeyHandler,
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

	// FR-16.7: when next_retry_at is due, re-run CreatePayment with attempt-N
	// sticky keys (off-session confirm inside payment service). Never cancels
	// contracts; 3-strike pause via existing payment_retry_count helpers.
	handler.RunRecurringPaymentRetryCron(
		ctx,
		contractHandler,
		handler.RecurringPaymentRetryIntervalFromEnv(),
		handler.RecurringPaymentRetryInitialDelayFromEnv(),
		handler.RecurringPaymentRetryBatchFromEnv(),
	)

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

// vaultPlatformPath is the KV path for gateway-readable platform secrets.
// Aligns with OPS-04 ExternalSecret remoteRef key `nomarkup/<env>` under the
// `secret` mount (see deploy/k8s/base/externalsecret.sample.yaml).
func vaultPlatformPath(environment string) string {
	switch environment {
	case "production":
		return "secret/nomarkup/production"
	case "staging":
		return "secret/nomarkup/staging"
	default:
		return "secret/nomarkup/dev"
	}
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
