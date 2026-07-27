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
	"github.com/stripe/stripe-go/v82"
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

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	subscriptionv1 "github.com/nomarkup/nomarkup/proto/subscription/v1"
	paymentclient "github.com/nomarkup/nomarkup/services/payment/internal/client"
	"github.com/nomarkup/nomarkup/services/payment/internal/crypto"
	paymentgrpc "github.com/nomarkup/nomarkup/services/payment/internal/grpc"
	"github.com/nomarkup/nomarkup/services/payment/internal/observability"
	"github.com/nomarkup/nomarkup/services/payment/internal/repository"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
)

func main() {
	// The ContextHandler decorator stamps request_id / trace_id / span_id onto
	// every record logged with a *Context variant, so existing call sites become
	// correlatable without touching them.
	logger := slog.New(observability.NewContextHandler(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))
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

	pool, err := observability.NewPGXPool(context.Background(), databaseURL)
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

	// PII cipher for decrypting at-rest provider PII (e.g. service_address on
	// 1099-NEC tax forms). Fails closed in production if ENCRYPTION_KEY is
	// missing/invalid; in dev it generates an ephemeral key and logs a WARN.
	piiCipher, err := crypto.FromEnv()
	if err != nil {
		slog.Error("failed to initialize PII cipher", "error", err)
		os.Exit(1)
	}

	// Wire up services.
	repo := repository.NewPostgresRepository(pool)
	repo.SetCipher(piiCipher)
	stripeSvc := service.NewStripeService(env)

	// Stripe Customer provisioning + saved-card persistence (migrations 102/103).
	//
	// Before this existed, no Stripe Customer was ever created anywhere in this
	// repo: CreateSetupIntent never set params.Customer, so every card a user
	// "saved" attached to nothing, ListPaymentMethods returned [] for everyone,
	// and every off-session charge path was structurally impossible. This is the
	// object that makes the payment system have a subject.
	customerProvisioner := service.NewCustomerProvisioner(repo, stripeSvc)

	paymentSvc := service.NewPaymentService(repo, stripeSvc)
	paymentSvc.SetCustomerProvisioner(customerProvisioner)
	paymentSvc.SetWebhookValidator(service.NewStripeWebhookValidator(webhookSecret))
	// Dual-gate lead_gen fee against feature_flags (SEC-GATE-03 / R6.2).
	paymentSvc.SetFeatureFlagChecker(repo)

	// Working-capital underwriting: dial the trust + underwriting engines. Dials
	// are lazy, so an engine being down doesn't block startup — ComputeCreditLimit
	// fails closed (no offer) at request time if a call errors.
	trustAddr := envOrDefault("TRUST_ENGINE_ADDR", "localhost:50057")
	var trustSource service.ProviderTrustSource
	if trustClient, err := paymentclient.NewTrustClient(trustAddr); err != nil {
		slog.Error("failed to create trust client; underwriting will fail closed", "error", err, "addr", trustAddr)
	} else {
		trustSource = trustClient
		paymentSvc.SetTrustSource(trustClient)
		defer func() { _ = trustClient.Close() }()
	}
	uwAddr := envOrDefault("UNDERWRITING_ENGINE_ADDR", "localhost:50060")
	if uwClient, err := paymentclient.NewUnderwritingClient(uwAddr); err != nil {
		slog.Error("failed to create underwriting client; underwriting will fail closed", "error", err, "addr", uwAddr)
	} else {
		paymentSvc.SetUnderwriter(uwClient)
		defer func() { _ = uwClient.Close() }()
	}

	grpcServer := paymentgrpc.NewServer(paymentSvc)

	// Wire up subscription service (shares same repo and stripe service).
	// Subscription has its own proto service, so it keeps a separate gRPC server.
	subscriptionSvc := service.NewSubscriptionService(repo, stripeSvc)
	subscriptionSvc.SetWebhookValidator(service.NewStripeWebhookValidator(webhookSecret))
	subscriptionGRPCServer := paymentgrpc.NewSubscriptionServer(subscriptionSvc)

	// Wire subscription event delegation so payment events route subscription
	// events (customer.subscription.*, invoice.*) to the subscription service.
	paymentSvc.SetSubscriptionWebhookHandler(subscriptionSvc)

	// FR-16.7 + FR-18.8: on payment_intent.payment_failed for a payment with
	// recurring_instance_id, increment recurring_configs.payment_retry_count
	// (shared SQL, same as gateway CreatePayment setup-fail) and only
	// PauseRecurring via job ContractService when count >= 3. Dial residual
	// only means strike/pause residual (payment still flips to failed).
	// Never cancel the contract from this path.
	// Recurring-pause dual-party notifications share the notification client
	// dialed below (SetNotifier when available).
	jobAddr := envOrDefault("JOB_SERVICE_ADDR", "localhost:50052")
	var recurringFailClient *paymentclient.ContractClient
	if contractClient, err := paymentclient.NewContractClient(jobAddr, pool); err != nil {
		slog.Error("failed to create contract client; FR-16.7/FR-18.8 payment_failed residual until job mesh reachable",
			"error", err, "addr", jobAddr)
	} else {
		recurringFailClient = contractClient
		paymentSvc.SetRecurringPaymentFailureHandler(contractClient)
		defer func() { _ = contractClient.Close() }()
		slog.Info("FR-16.7/FR-18.8 recurring payment-failure 3-strike wired", "addr", jobAddr)
	}

	// Installment (BNPL) and insurance live under the same PaymentService proto
	// surface, so their domain services are attached to the main gRPC server
	// rather than registered as separate services.
	installmentSvc := service.NewInstallmentService(repo, stripeSvc)
	grpcServer.SetInstallmentService(installmentSvc)
	paymentSvc.SetInstallmentPaymentHandler(installmentSvc)

	insuranceSvc := service.NewInsuranceService(repo, stripeSvc)
	insuranceSvc.SetAccountResolver(repo) // GetStripeAccountID → acct_* (MON-08)
	// Trust-tiered insurance pricing: a higher provider trust tier lowers the
	// premium. Behind the INSURANCE_TRUST_PRICING flag, default OFF (fail closed
	// → legacy base+category premium). When ON we also need the trust source;
	// if the trust client failed to dial, pricing still fails closed (no
	// discount, never an error) inside applyTrustDiscount.
	if trustSource != nil {
		insuranceSvc.SetTrustSource(trustSource)
	}
	insuranceTrustPricing := envBool("INSURANCE_TRUST_PRICING", false)
	insuranceSvc.SetTrustPricingEnabled(insuranceTrustPricing)
	slog.Info("insurance trust pricing configured",
		"enabled", insuranceTrustPricing,
		"trust_source_wired", trustSource != nil,
	)
	grpcServer.SetInsuranceService(insuranceSvc)

	// Goods marketplace escrow (MON-05/07/08): ChargeListingWinner, pickup,
	// disputes, auto-release. Connect account resolver refuses bare user UUIDs
	// as Stripe destinations. Webhook PI.succeeded delegates via SetMarketplaceHandler.
	marketplaceRepo := repository.NewMarketplaceRepository(pool)
	marketplaceSvc := service.NewMarketplaceService(marketplaceRepo, stripeSvc)
	marketplaceSvc.SetAccountResolver(repo) // GetStripeAccountID → acct_*
	// R6.1: goods take rate from platform_fee_config (same repo as services CalculateFees).
	marketplaceSvc.SetFeeConfigLoader(repo)
	// Buyer-side Stripe Customer + default card, so the settlement sweeper can
	// collect an auction win off-session.
	marketplaceSvc.SetCustomerProvisioner(customerProvisioner)

	// Notifications. SetNotifier was NEVER called here, so every one of
	// MarketplaceNotifier's methods was a silent no-op in production: sellers
	// were never told their escrow released, sellers were never told a dispute
	// had been filed against them, and a buyer whose card failed was never told
	// at all. With off-session collection enabled below, that last case would
	// mean a buyer's only signal was an order quietly expiring.
	//
	// Same client also backs FR-16.7/FR-18.8 dual-party alerts when recurring
	// is paused after the payment-failure retry threshold.
	//
	// Degrades rather than blocks startup: if the notification service cannot be
	// dialled the marketplace keeps its no-op notifier and recurring-pause
	// notifies log residual only. Money correctness never depends on a
	// notification being delivered.
	notificationAddr := envOrDefault("NOTIFICATION_SERVICE_ADDR", "localhost:50059")
	if notifyClient, err := paymentclient.NewNotificationClient(notificationAddr); err != nil {
		slog.Error("failed to create notification client; marketplace + FR-18.8 pause notifications will be dropped",
			"error", err, "addr", notificationAddr)
		if recurringFailClient != nil {
			slog.Warn("FR-16.7/FR-18.8 residual: recurring pause notifications unwired (notification mesh unreachable)",
				"addr", notificationAddr)
		}
	} else {
		marketplaceSvc.SetNotifier(service.NewMarketplaceNotifier(notifyClient))
		if recurringFailClient != nil {
			recurringFailClient.SetNotifier(notifyClient)
			slog.Info("FR-16.7/FR-18.8 recurring pause notifier wired", "addr", notificationAddr)
		}
		defer func() { _ = notifyClient.Close() }()
		slog.Info("marketplace notifier wired", "addr", notificationAddr)
	}

	marketplaceCfg := service.DefaultMarketplaceConfig()
	marketplaceCfg.PaymentWindow = envDurationOr("MARKETPLACE_PAYMENT_WINDOW", marketplaceCfg.PaymentWindow)
	marketplaceSvc.SetConfig(marketplaceCfg)
	// Terminal 'payment_failed' transition for unfunded orders. Default OFF:
	// cancelling someone's won auction is a product decision, and until it is
	// made the sweeper only reports the condition (loudly) rather than acting.
	marketplaceExpiry := envBool("MARKETPLACE_PAYMENT_EXPIRY", false)
	marketplaceSvc.SetExpireUnfunded(marketplaceExpiry)

	// Merchant-initiated collection on auction wins. Default ON: an auction that
	// cannot collect from the winner is not an auction, and the off_session
	// SetupIntent mandate exists precisely to authorize this.
	//
	// DEFAULTS OFF, and the reason is legal rather than technical.
	//
	// Charging a saved card while the buyer is away requires that the bidding
	// terms told them placing a bid authorizes it. Searched the tree: the
	// tos_versions / tos_acceptances tables exist, but no terms text anywhere
	// states that authorization, and the content is admin-managed so it cannot
	// be confirmed from here. Charging without it is a chargeback problem and,
	// under SCA, a mandate problem — both of which land on the platform.
	//
	// Defaulting ON would mean an unverified legal predicate silently becomes
	// a live card charge the first time an auction closes. Defaulting OFF is
	// not a degraded product: buyers pay through the "pay for your win"
	// surface instead, which is how eBay operates, and the settlement sweeper
	// still attaches the PaymentIntent and chases unfunded orders. The asymmetry
	// settles it — enabling this later is a one-line env change, while
	// un-charging a card is a refund, a chargeback and an apology.
	//
	// Set MARKETPLACE_OFFSESSION_CHARGE=true once the terms have shipped.
	offSessionCharge := envBool("MARKETPLACE_OFFSESSION_CHARGE", false)
	marketplaceSvc.SetOffSessionCharge(offSessionCharge)

	slog.Info("goods settlement configured",
		"payment_window", marketplaceCfg.PaymentWindow.String(),
		"expire_unfunded_orders", marketplaceExpiry,
		"off_session_charge", offSessionCharge,
	)
	paymentSvc.SetMarketplaceHandler(marketplaceSvc)
	grpcServer.SetMarketplaceService(marketplaceSvc)

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

	serverOpts := []grpclib.ServerOption{
		grpclib.StatsHandler(otelgrpc.NewServerHandler()),
		// RequestID first: it seeds the context the logging interceptor and
		// every downstream slog.*Context call read.
		// Recovery sits outside logging so a panic in either the logging
		// interceptor or the handler is contained (RES-03).
		grpclib.ChainUnaryInterceptor(observability.RequestIDUnaryInterceptor, recoveryUnaryInterceptor, loggingUnaryInterceptor),
		grpclib.ChainStreamInterceptor(observability.RequestIDStreamInterceptor, recoveryStreamInterceptor, loggingStreamInterceptor),
		grpclib.KeepaliveEnforcementPolicy(grpcKeepaliveEnforcement()),
		grpclib.KeepaliveParams(grpcKeepaliveParams()),
	}
	var errMTLS error
	serverOpts, errMTLS = meshServerOptions(serverOpts)
	if errMTLS != nil {
		slog.Error("failed to configure gRPC server mTLS", "error", errMTLS)
		os.Exit(1)
	}
	s := grpclib.NewServer(serverOpts...)
	paymentgrpc.Register(s, grpcServer)
	paymentgrpc.RegisterSubscription(s, subscriptionGRPCServer)

	// Standard gRPC health service (grpc.health.v1.Health). REQUIRED — the
	// Kubernetes deployment (deploy/k8s/base/payment/deployment.yaml) uses
	// native gRPC liveness/readiness probes, and kubelet queries the EMPTY
	// service name. Without this registration every probe returns
	// UNIMPLEMENTED, readiness never passes and liveness restarts the pod
	// (CrashLoopBackOff). Do not delete as "unused" — the only caller is kubelet.
	healthSrv := health.NewServer()
	healthpb.RegisterHealthServer(s, healthSrv)
	healthSrv.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	healthSrv.SetServingStatus(paymentv1.PaymentService_ServiceDesc.ServiceName, healthpb.HealthCheckResponse_SERVING)
	healthSrv.SetServingStatus(subscriptionv1.SubscriptionService_ServiceDesc.ServiceName, healthpb.HealthCheckResponse_SERVING)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Observability HTTP server (healthz / readyz / metrics) on a separate port.
	// Also exposes stripe_webhook_processing_duration_seconds — see observability.go.
	startObservabilityServer(ctx, "payment-service", port, pool)

	// Auto-release held listing orders past the window (goods escrow).
	go runMarketplaceAutoReleaseCron(ctx, marketplaceSvc, 4*time.Hour, 30*time.Second)

	// Goods settlement: attach the PaymentIntent to auction-won orders that the
	// job service left in 'pending_payment', and report the ones still unfunded
	// past their deadline. ChargeListingWinner had no caller on the auction path
	// before this; see runListingSettlementCron.
	runListingSettlementCron(ctx, marketplaceSvc, pool,
		envDurationOr("MARKETPLACE_SETTLEMENT_INTERVAL", 15*time.Minute),
		time.Minute,
		envIntOr("MARKETPLACE_SETTLEMENT_BATCH", 200),
	)

	// BNPL: collect installments 2..N. ProcessDueInstallments had no caller, so
	// nothing after the first installment was ever charged while the provider had
	// already been paid the full contract amount at plan creation.
	runInstallmentCron(ctx, installmentSvc, pool,
		envDurationOr("BNPL_INSTALLMENT_INTERVAL", 24*time.Hour),
		2*time.Minute,
	)

	go func() {
		slog.Info("payment service starting", "port", port)
		if err := s.Serve(lis); err != nil {
			slog.Error("grpc server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down payment service")
	// Flip every health status to NOT_SERVING *before* draining so the k8s
	// readiness probe pulls this pod out of rotation while in-flight RPCs
	// finish.
	healthSrv.Shutdown()
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

// envOrDefault returns the env var value or a fallback when unset/empty.
func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// envBool reads a boolean feature-flag env var. Recognizes 1/true/t/yes/on
// (case-insensitive) as true; everything else (including unset) returns def.
// Used to gate optional monetization behavior fail-closed at startup.
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
