package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/nomarkup/nomarkup/services/payment/internal/observability"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/account"
	"github.com/stripe/stripe-go/v82/accountlink"
	"github.com/stripe/stripe-go/v82/bankaccount"
	"github.com/stripe/stripe-go/v82/invoice"
	"github.com/stripe/stripe-go/v82/loginlink"
	"github.com/stripe/stripe-go/v82/paymentintent"
	"github.com/stripe/stripe-go/v82/paymentmethod"
	"github.com/stripe/stripe-go/v82/payout"
	"github.com/stripe/stripe-go/v82/refund"
	"github.com/stripe/stripe-go/v82/setupintent"
	stripesub "github.com/stripe/stripe-go/v82/subscription"
	"github.com/stripe/stripe-go/v82/transfer"
)

// Stripe backend tuning.
//
// stripe-go's out-of-the-box backend is built for batch jobs, not for a
// request-serving payment service: its shared http.Client uses an 80s timeout
// and the backend retries twice on top of that. A single unlucky call can
// therefore occupy a goroutine — and the pgx pool connection it is holding —
// for 80s + 0.5s + 80s + ~2s + 80s ≈ 4 minutes, long after the gateway's 15s
// http.Server WriteTimeout (gateway/cmd/server/main.go) has already abandoned
// the client. That is the shortest path from "Stripe is degraded" to "the
// payment service is out of DB connections".
//
// The numbers below are chosen against the budgets in CLAUDE.md §8 (API p99
// < 500ms) and the gateway's 15s write timeout:
//
//   - stripeAttemptTimeout = 5s bounds ONE HTTP attempt. It is 10x the p99 API
//     budget, so it never trips on a healthy Stripe (p99 is a few hundred ms),
//     but it is 16x tighter than the SDK default. It is deliberately not set
//     near 500ms: Stripe is a third party we do not control, and cutting off a
//     mutating call that Stripe is actively processing costs more (ambiguous
//     writes) than waiting a few seconds.
//   - stripeMaxNetworkRetries = 1 still absorbs a genuine transient blip (a
//     dropped connection, a 500, a 409 lock contention) but caps the worst case
//     at 5s + ~0.5s backoff + 5s ≈ 10.5s, which fits inside the gateway's 15s
//     write timeout instead of overrunning it by 16x.
//
// These are only the backstop. The primary control is params.Context: every
// call in this file now propagates the caller's context, so a caller with a
// tighter deadline (or a client that hung up) cancels the in-flight request
// immediately, and stripe-go's shouldRetry declines to retry once the request
// context is in error.
const (
	stripeAttemptTimeout          = 5 * time.Second
	stripeMaxNetworkRetries int64 = 1
	stripeIdleConnsPerHost        = 32
)

// stripeBackendOnce guards the one-time installation of the bounded backend.
// stripe-go's resource clients resolve their backend from package-level state,
// so this is the only place the configuration can be applied; the Once keeps
// repeated NewStripeService calls (tests, multiple constructions) from
// allocating a new backend each time.
var stripeBackendOnce sync.Once

// newStripeBackendConfig returns the bounded backend configuration. Exposed as
// a function (rather than inlined) so tests can assert the timeout/retry values
// actually applied to the SDK.
func newStripeBackendConfig() *stripe.BackendConfig {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = stripeIdleConnsPerHost
	return &stripe.BackendConfig{
		HTTPClient: &http.Client{
			Timeout:   stripeAttemptTimeout,
			Transport: transport,
		},
		MaxNetworkRetries: stripe.Int64(stripeMaxNetworkRetries),
	}
}

// configureStripeBackend installs the bounded backend on the API surface, the
// only stripe-go backend this service talks to (every call in this package and
// in stripe_deleter.go goes through the standard API resource clients).
func configureStripeBackend() {
	stripeBackendOnce.Do(func() {
		stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(stripe.APIBackend, newStripeBackendConfig()))
		slog.Info("stripe backend configured",
			"attempt_timeout", stripeAttemptTimeout.String(),
			"max_network_retries", stripeMaxNetworkRetries,
		)
	})
}

// stripeIdempotencyKey builds a deterministic, length-bounded idempotency key
// from a stable logical scope plus the arguments that identify the operation.
//
// It hashes rather than concatenates because Stripe rejects keys longer than
// 255 characters (stripe-go returns an error before the request leaves the
// process) and some inputs — email addresses, bank-account tokens — can get
// close to that on their own. The output is a pure function of its inputs: the
// same logical operation always produces the same key, which is what makes
// stripe-go's network retries safe on mutating calls.
func stripeIdempotencyKey(scope string, parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return scope + ":" + hex.EncodeToString(sum[:])
}

// getPlatformAccount retrieves the account that owns the configured secret key.
//
// stripe-go's account.Get() takes no *stripe.AccountParams, so there is no way
// to hand it a context; calling it would leave two uncancellable requests in
// the external-bank-account flows. This issues the same GET /v1/account against
// the configured backend with a context-carrying params struct.
func getPlatformAccount(ctx context.Context) (*stripe.Account, error) {
	acct := &stripe.Account{}
	params := &stripe.AccountParams{}
	params.Context = ctx
	if err := stripe.GetBackend(stripe.APIBackend).Call(http.MethodGet, "/v1/account", stripe.Key, params, acct); err != nil {
		return nil, err
	}
	return acct, nil
}

// StripeService wraps Stripe SDK operations.
type StripeService struct {
	devMode bool
	dev     *DevStore
	// devOnce guards the lazy initialization of dev. Without it, DevStore()
	// was an unsynchronized check-then-set: two goroutines could both observe
	// a nil dev and each install their own store, so concurrent refunds and
	// escrow releases recorded their idempotency keys into DIFFERENT maps and
	// the dedup silently stopped working. `go test -race` reported it on every
	// run — which is why the money-race CI job had never passed.
	devOnce sync.Once
}

// NewStripeService creates a new StripeService for the given deployment
// environment ("development", "staging", or "production").
//
// Dev mode (in-memory DevStore stubs) is ONLY enabled when env=="development".
// In staging/production, callers MUST provide a real STRIPE_SECRET_KEY before
// reaching this function — main.go validates the key with IsPlaceholderStripeKey
// and exits non-zero rather than allowing this constructor to silently fall
// back to fakes. This invariant exists so a missing/placeholder key in
// production cannot route real money flows through an in-memory map that
// resets on restart.
func NewStripeService(env string) *StripeService {
	key := os.Getenv("STRIPE_SECRET_KEY")
	placeholder := IsPlaceholderStripeKey(key)

	if placeholder && env != "development" {
		// Defense in depth: main.go should have already exited. If we ever
		// reach here in non-development with a placeholder/missing key, panic
		// rather than silently routing payments through DevStore.
		panic(fmt.Sprintf("NewStripeService: refuse to construct dev-mode Stripe service in env=%q with placeholder/missing STRIPE_SECRET_KEY (main.go should have validated this at startup)", env))
	}

	devMode := placeholder // implies env=="development" by the check above
	if devMode {
		slog.Warn("Stripe service running in dev mode (ENVIRONMENT=development with placeholder/missing STRIPE_SECRET_KEY); payment/subscription flows use an in-memory store that resets on restart")
	} else {
		// Only when we will actually talk to Stripe. Dev mode short-circuits
		// every method before the SDK, so configuring a backend there would be
		// pure overhead and would mutate global SDK state from tests.
		configureStripeBackend()
	}
	return &StripeService{devMode: devMode, dev: newDevStore()}
}

// IsDevMode lets the service layer branch on Stripe availability.
func (s *StripeService) IsDevMode() bool { return s.devMode }

// DevStore exposes the backing store for service-layer dev paths. Lazily
// initializes if a caller (e.g. tests) constructed StripeService directly
// without NewStripeService.
func (s *StripeService) DevStore() *DevStore {
	s.devOnce.Do(func() {
		if s.dev == nil {
			s.dev = newDevStore()
		}
	})
	return s.dev
}

// IsPlaceholderStripeKey reports whether a STRIPE_SECRET_KEY value is missing,
// the committed .env template literal, or otherwise too short to be a real
// Stripe key. Exported so main.go can fail-closed at startup in non-development
// environments before ever constructing a StripeService.
func IsPlaceholderStripeKey(key string) bool {
	if key == "" {
		return true
	}
	// Real keys are sk_test_<24+ chars> or sk_live_<24+ chars>. The
	// committed .env template uses "sk_test_..." which satisfies the prefix
	// but not the length, so this rejects it.
	if !strings.HasPrefix(key, "sk_test_") && !strings.HasPrefix(key, "sk_live_") {
		return true
	}
	if len(key) < 24 {
		return true
	}
	if strings.Contains(key, "...") {
		return true
	}
	return false
}

// CreateStripeAccount creates a Stripe Connect Express account.
func (s *StripeService) CreateStripeAccount(ctx context.Context, email, businessName string) (string, error) {
	if s.devMode {
		slog.Info("dev mode: stub CreateStripeAccount", "email", email)
		return "acct_dev_" + email, nil
	}

	params := &stripe.AccountParams{
		Type:         stripe.String(string(stripe.AccountTypeExpress)),
		Email:        stripe.String(email),
		BusinessType: stripe.String(string(stripe.AccountBusinessTypeIndividual)),
		Capabilities: &stripe.AccountCapabilitiesParams{
			CardPayments: &stripe.AccountCapabilitiesCardPaymentsParams{
				Requested: stripe.Bool(true),
			},
			Transfers: &stripe.AccountCapabilitiesTransfersParams{
				Requested: stripe.Bool(true),
			},
		},
	}
	if businessName != "" {
		params.BusinessProfile = &stripe.AccountBusinessProfileParams{
			Name: stripe.String(businessName),
		}
	}

	// Mutating call: a network retry must not create a second Connect account
	// for the same provider. The email is the stable identity of the account
	// being created, so the key is derived from it.
	params.IdempotencyKey = stripe.String(stripeIdempotencyKey("connect-account", email))

	acct, err := observability.TraceStripeCall(ctx, "Account.Create", func(ctx context.Context) (*stripe.Account, error) {
		params.Context = ctx
		return account.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("create stripe account: %w", err)
	}
	return acct.ID, nil
}

// GetOnboardingLink generates an AccountLink for Stripe Connect onboarding.
func (s *StripeService) GetOnboardingLink(ctx context.Context, accountID, returnURL, refreshURL string) (string, error) {
	if s.devMode {
		slog.Info("dev mode: stub GetOnboardingLink", "accountID", accountID)
		return "https://stripe.com/dev-onboarding?account=" + accountID, nil
	}

	params := &stripe.AccountLinkParams{
		Account:    stripe.String(accountID),
		Type:       stripe.String(string(stripe.AccountLinkTypeAccountOnboarding)),
		ReturnURL:  stripe.String(returnURL),
		RefreshURL: stripe.String(refreshURL),
	}

	// No idempotency key by design: an AccountLink is a single-use, short-lived
	// onboarding URL. Replaying a key would hand the provider back an already
	// consumed or expired link instead of a fresh one.
	link, err := observability.TraceStripeCall(ctx, "AccountLink.Create", func(ctx context.Context) (*stripe.AccountLink, error) {
		params.Context = ctx
		return accountlink.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("get onboarding link: %w", err)
	}
	return link.URL, nil
}

// GetAccountStatus retrieves the status of a Stripe Connect account.
func (s *StripeService) GetAccountStatus(ctx context.Context, accountID string) (*domain.StripeAccountStatus, error) {
	if s.devMode {
		slog.Info("dev mode: stub GetAccountStatus", "accountID", accountID)
		return &domain.StripeAccountStatus{
			AccountID:        accountID,
			ChargesEnabled:   true,
			PayoutsEnabled:   true,
			DetailsSubmitted: true,
		}, nil
	}

	acct, err := observability.TraceStripeCall(ctx, "Account.Get", func(ctx context.Context) (*stripe.Account, error) {
		params := &stripe.AccountParams{}
		params.Context = ctx
		return account.GetByID(accountID, params)
	})
	if err != nil {
		return nil, fmt.Errorf("get account status: %w", err)
	}

	var requirements []string
	if acct.Requirements != nil {
		requirements = append(requirements, acct.Requirements.CurrentlyDue...)
	}

	return &domain.StripeAccountStatus{
		AccountID:        acct.ID,
		ChargesEnabled:   acct.ChargesEnabled,
		PayoutsEnabled:   acct.PayoutsEnabled,
		DetailsSubmitted: acct.DetailsSubmitted,
		Requirements:     requirements,
	}, nil
}

// GetDashboardLink generates a LoginLink for the Stripe Express dashboard.
func (s *StripeService) GetDashboardLink(ctx context.Context, accountID string) (string, error) {
	if s.devMode {
		slog.Info("dev mode: stub GetDashboardLink", "accountID", accountID)
		return "https://dashboard.stripe.com/dev?account=" + accountID, nil
	}

	params := &stripe.LoginLinkParams{
		Account: stripe.String(accountID),
	}

	// No idempotency key by design: a LoginLink is a single-use dashboard URL
	// with a short TTL — see the AccountLink comment above.
	link, err := observability.TraceStripeCall(ctx, "LoginLink.Create", func(ctx context.Context) (*stripe.LoginLink, error) {
		params.Context = ctx
		return loginlink.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("get dashboard link: %w", err)
	}
	return link.URL, nil
}

// CreateSetupIntent creates a SetupIntent for saving customer payment methods.
func (s *StripeService) CreateSetupIntent(ctx context.Context, customerID string) (string, error) {
	if s.devMode {
		slog.Info("dev mode: CreateSetupIntent issued dev client_secret", "customerID", customerID)
		return s.DevStore().NewSetupIntent(customerID), nil
	}

	params := &stripe.SetupIntentParams{
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
	}
	// If the customer has a Stripe customer ID, attach it.
	if customerID != "" {
		params.AddMetadata("platform_customer_id", customerID)
	}

	// No idempotency key by design: nothing in the arguments identifies WHICH
	// setup attempt this is. A key derived from customerID alone would pin one
	// SetupIntent per customer for the 24h key window, so a customer adding a
	// second card (or retrying after abandoning the first) would be handed the
	// stale intent. A random key would defeat the purpose. SetupIntent creation
	// moves no money, so an extra unconfirmed intent is harmless.
	si, err := observability.TraceStripeCall(ctx, "SetupIntent.Create", func(ctx context.Context) (*stripe.SetupIntent, error) {
		params.Context = ctx
		return setupintent.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("create setup intent: %w", err)
	}
	return si.ClientSecret, nil
}

// SetupIntentStatus is the server-verified outcome of a SetupIntent.
type SetupIntentStatus struct {
	Status          string
	Succeeded       bool
	PaymentMethodID string
}

// setupIntentIDFromSecret extracts the SetupIntent id from a client_secret.
// Stripe formats these as "seti_<id>_secret_<random>"; the id is everything
// before the "_secret_" separator.
func setupIntentIDFromSecret(clientSecret string) string {
	if i := strings.Index(clientSecret, "_secret_"); i > 0 {
		return clientSecret[:i]
	}
	return ""
}

// GetSetupIntentStatus retrieves a SetupIntent from Stripe and reports whether
// it actually confirmed.
//
// This exists because a client POST saying "the SetupIntent succeeded" is not
// evidence. Callers that gate a privilege on payment (bid bonds, promoted
// listings) must ask Stripe, not the browser.
//
// customerKey is the platform user id asserted by the caller. When the intent
// carries a platform_customer_id metadata tag (set by CreateSetupIntent) it
// must match, so one user cannot confirm another user's intent.
func (s *StripeService) GetSetupIntentStatus(ctx context.Context, clientSecret, customerKey string) (SetupIntentStatus, error) {
	if clientSecret == "" {
		return SetupIntentStatus{}, fmt.Errorf("get setup intent status: client secret required")
	}

	if s.devMode {
		// Dev intents are the ones DevStore minted, and only for the customer
		// it minted them for. Anything else is refused rather than waved
		// through — dev mode is a stub, not an authorization bypass.
		if !IsDevSetupIntent(clientSecret) {
			return SetupIntentStatus{Status: "unknown"}, nil
		}
		if owner, ok := s.DevStore().SetupIntentOwner(clientSecret); !ok || (customerKey != "" && owner != customerKey) {
			return SetupIntentStatus{Status: "unknown"}, nil
		}
		return SetupIntentStatus{
			Status:          "succeeded",
			Succeeded:       true,
			PaymentMethodID: "pm_dev_setupintent",
		}, nil
	}

	id := setupIntentIDFromSecret(clientSecret)
	if id == "" {
		return SetupIntentStatus{}, fmt.Errorf("get setup intent status: malformed client secret")
	}

	si, err := observability.TraceStripeCall(ctx, "SetupIntent.Get", func(ctx context.Context) (*stripe.SetupIntent, error) {
		getParams := &stripe.SetupIntentParams{
			ClientSecret: stripe.String(clientSecret),
		}
		getParams.Context = ctx
		return setupintent.Get(id, getParams)
	})
	if err != nil {
		return SetupIntentStatus{}, fmt.Errorf("get setup intent status: %w", err)
	}

	// Bind the intent to the asserted caller when we tagged it at creation.
	if customerKey != "" && si.Metadata != nil {
		if tagged, ok := si.Metadata["platform_customer_id"]; ok && tagged != "" && tagged != customerKey {
			return SetupIntentStatus{Status: "unknown"}, nil
		}
	}

	out := SetupIntentStatus{Status: string(si.Status)}
	if si.PaymentMethod != nil {
		out.PaymentMethodID = si.PaymentMethod.ID
	}
	out.Succeeded = si.Status == stripe.SetupIntentStatusSucceeded && out.PaymentMethodID != ""
	return out, nil
}

// ListPaymentMethods lists a customer's payment methods.
func (s *StripeService) ListPaymentMethods(ctx context.Context, customerStripeID string) ([]domain.PaymentMethod, error) {
	if s.devMode {
		return s.DevStore().ListPaymentMethods(customerStripeID), nil
	}

	params := &stripe.PaymentMethodListParams{
		Customer: stripe.String(customerStripeID),
		Type:     stripe.String(string(stripe.PaymentMethodTypeCard)),
	}

	// The span covers the whole iteration, not each page: the Stripe iterator
	// fetches lazily, so ending it at List() would report ~0ms and hide the
	// actual pagination cost.
	spanCtx, span := observability.StartStripeSpan(ctx, "PaymentMethod.List")

	// ListParams.Context is carried onto every page request the iterator makes
	// (stripe.ListParams.ToParams), so a cancelled caller stops the pagination
	// rather than walking the whole customer's history.
	params.Context = spanCtx

	var methods []domain.PaymentMethod
	i := paymentmethod.List(params)
	for i.Next() {
		pm := i.PaymentMethod()
		m := domain.PaymentMethod{
			ID:   pm.ID,
			Type: string(pm.Type),
		}
		if pm.Card != nil {
			m.LastFour = pm.Card.Last4
			m.Brand = string(pm.Card.Brand)
			m.ExpMonth = int32(pm.Card.ExpMonth)
			m.ExpYear = int32(pm.Card.ExpYear)
		}
		methods = append(methods, m)
	}
	if err := i.Err(); err != nil {
		observability.EndStripeSpan(span, err)
		return nil, fmt.Errorf("list payment methods: %w", err)
	}
	observability.EndStripeSpan(span, nil)
	return methods, nil
}

// DeletePaymentMethod detaches a payment method.
func (s *StripeService) DeletePaymentMethod(ctx context.Context, paymentMethodID string) error {
	if s.devMode {
		s.DevStore().DeletePaymentMethod(paymentMethodID)
		return nil
	}

	_, err := observability.TraceStripeCall(ctx, "PaymentMethod.Detach", func(ctx context.Context) (*stripe.PaymentMethod, error) {
		params := &stripe.PaymentMethodDetachParams{}
		params.Context = ctx
		// Mutating POST: the payment method id fully identifies the logical
		// operation, so a network retry replays the original detach instead of
		// erroring with "already detached".
		params.IdempotencyKey = stripe.String(stripeIdempotencyKey("pm-detach", paymentMethodID))
		return paymentmethod.Detach(paymentMethodID, params)
	})
	if err != nil {
		return fmt.Errorf("delete payment method: %w", err)
	}
	return nil
}

// CreatePaymentIntent creates a PaymentIntent with manual capture and NO
// TransferData destination charge.
//
// Connect model (separate charges + transfer): funds are captured onto the
// platform Stripe balance and held in escrow by NoMarkup's state machine.
// Provider payout happens later via CreateTransfer in ReleaseEscrow. This
// avoids the double-move bug of destination charges (auto-transfer on capture)
// PLUS a second explicit CreateTransfer on release.
//
// providerAccountID and platformFeeCents are recorded in metadata for
// reconciliation only — they do not create a destination charge.
// Uses capture_method="manual" for escrow functionality.
func (s *StripeService) CreatePaymentIntent(ctx context.Context, amountCents int64, currency string, providerAccountID string, platformFeeCents int64, idempotencyKey string) (string, string, error) {
	if s.devMode {
		slog.Info("dev mode: stub CreatePaymentIntent", "amountCents", amountCents)
		return "pi_dev_" + idempotencyKey, "pi_dev_secret_" + idempotencyKey, nil
	}

	params := &stripe.PaymentIntentParams{
		Amount:        stripe.Int64(amountCents),
		Currency:      stripe.String(currency),
		CaptureMethod: stripe.String(string(stripe.PaymentIntentCaptureMethodManual)),
		// No TransferData / ApplicationFeeAmount: platform holds funds until
		// ReleaseEscrow CreateTransfer. See comment above.
	}
	if providerAccountID != "" {
		params.AddMetadata("provider_account_id", providerAccountID)
	}
	if platformFeeCents > 0 {
		params.AddMetadata("platform_fee_cents", fmt.Sprintf("%d", platformFeeCents))
	}
	params.IdempotencyKey = stripe.String(idempotencyKey)

	pi, err := observability.TraceStripeCall(ctx, "PaymentIntent.Create", func(ctx context.Context) (*stripe.PaymentIntent, error) {
		params.Context = ctx
		return paymentintent.New(params)
	})
	if err != nil {
		return "", "", fmt.Errorf("create payment intent: %w", err)
	}
	return pi.ID, pi.ClientSecret, nil
}

// CapturePaymentIntent captures a held PaymentIntent (moves funds to platform
// balance / escrow). idempotencyKey is mandatory so concurrent ProcessPayment
// calls cannot double-capture.
func (s *StripeService) CapturePaymentIntent(ctx context.Context, paymentIntentID string, idempotencyKey string) error {
	if idempotencyKey == "" {
		return fmt.Errorf("capture payment intent: idempotency key required")
	}
	if s.devMode {
		slog.Info("dev mode: stub CapturePaymentIntent", "paymentIntentID", paymentIntentID, "idem", idempotencyKey)
		return s.DevStore().RecordCapture(idempotencyKey, paymentIntentID)
	}

	params := &stripe.PaymentIntentCaptureParams{}
	params.IdempotencyKey = stripe.String(idempotencyKey)
	_, err := observability.TraceStripeCall(ctx, "PaymentIntent.Capture", func(ctx context.Context) (*stripe.PaymentIntent, error) {
		params.Context = ctx
		return paymentintent.Capture(paymentIntentID, params)
	})
	if err != nil {
		return fmt.Errorf("capture payment intent: %w", err)
	}
	return nil
}

// CreateTransfer transfers funds to a provider's Connect account from a
// previously captured charge on the platform. idempotencyKey is mandatory
// (e.g. "escrow-release:<paymentID>") so concurrent/retried ReleaseEscrow
// never double-pays.
//
// SourceTransaction must be a Charge ID (ch_...), not a PaymentIntent ID.
// When paymentIntentID is a pi_..., we resolve LatestCharge from Stripe.
func (s *StripeService) CreateTransfer(ctx context.Context, amountCents int64, currency string, destinationAccountID string, paymentIntentID string, idempotencyKey string) (string, error) {
	if idempotencyKey == "" {
		return "", fmt.Errorf("create transfer: idempotency key required")
	}
	if s.devMode {
		slog.Info("dev mode: stub CreateTransfer", "amountCents", amountCents, "idem", idempotencyKey)
		return s.DevStore().RecordTransfer(idempotencyKey, destinationAccountID, amountCents), nil
	}

	sourceTxn := paymentIntentID
	// Stripe SourceTransaction requires a Charge ID. Resolve from PI when needed.
	if strings.HasPrefix(paymentIntentID, "pi_") {
		getParams := &stripe.PaymentIntentParams{}
		getParams.AddExpand("latest_charge")
		pi, err := observability.TraceStripeCall(ctx, "PaymentIntent.Get", func(ctx context.Context) (*stripe.PaymentIntent, error) {
			getParams.Context = ctx
			return paymentintent.Get(paymentIntentID, getParams)
		})
		if err != nil {
			return "", fmt.Errorf("create transfer: resolve payment intent for charge: %w", err)
		}
		if pi.LatestCharge == nil || pi.LatestCharge.ID == "" {
			return "", fmt.Errorf("create transfer: payment intent %s has no latest charge for SourceTransaction", paymentIntentID)
		}
		sourceTxn = pi.LatestCharge.ID
	}

	params := &stripe.TransferParams{
		Amount:      stripe.Int64(amountCents),
		Currency:    stripe.String(currency),
		Destination: stripe.String(destinationAccountID),
	}
	if sourceTxn != "" {
		params.SourceTransaction = stripe.String(sourceTxn)
	}
	// Stamp the originating PaymentIntent in transfer metadata. The
	// transfer.created webhook (handleTransferCreated) looks up the local
	// payment by t.Metadata["payment_intent_id"]; without this, every
	// transfer.created delivery hits the "no payment_intent_id metadata"
	// branch and never reconciles the transfer ID / released status. The
	// synchronous ReleaseEscrow path already stamps these, so this makes the
	// webhook a working backstop rather than dead code.
	if paymentIntentID != "" {
		params.AddMetadata("payment_intent_id", paymentIntentID)
	}
	params.IdempotencyKey = stripe.String(idempotencyKey)

	t, err := observability.TraceStripeCall(ctx, "Transfer.Create", func(ctx context.Context) (*stripe.Transfer, error) {
		params.Context = ctx
		return transfer.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("create transfer: %w", err)
	}
	return t.ID, nil
}

// CreatePlatformTransfer transfers funds from the platform's Stripe balance to a
// provider's Connect account. Unlike CreateTransfer, no SourceTransaction is set
// because the funds come from the platform balance (e.g. for advance disbursements).
// idempotencyKey is mandatory and MUST be deterministic per logical payout
// (e.g. "advance-disburse:<advanceID>"). It is passed straight through to
// Stripe so a retried or racing duplicate call returns the SAME transfer
// rather than moving money twice — closing the double-payout window when two
// concurrent disbursements both pass a non-locking status check before the
// guarded DB write rejects the loser. In dev mode the in-memory store keys on
// it to give the same dedup semantics.
func (s *StripeService) CreatePlatformTransfer(ctx context.Context, amountCents int64, currency string, destinationAccountID string, idempotencyKey string) (string, error) {
	if idempotencyKey == "" {
		return "", fmt.Errorf("create platform transfer: idempotency key required")
	}
	if s.devMode {
		return s.DevStore().RecordAdvance(idempotencyKey, destinationAccountID, amountCents), nil
	}

	params := &stripe.TransferParams{
		Amount:      stripe.Int64(amountCents),
		Currency:    stripe.String(currency),
		Destination: stripe.String(destinationAccountID),
	}
	params.IdempotencyKey = stripe.String(idempotencyKey)

	t, err := observability.TraceStripeCall(ctx, "Transfer.Create", func(ctx context.Context) (*stripe.Transfer, error) {
		params.Context = ctx
		return transfer.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("create platform transfer: %w", err)
	}
	return t.ID, nil
}

// CreateRefund issues a refund for a PaymentIntent. idempotencyKey is
// mandatory (e.g. "refund:<paymentID>:<targetCumulativeCents>") so concurrent
// or retried refunds never over-refund at Stripe.
func (s *StripeService) CreateRefund(ctx context.Context, paymentIntentID string, amountCents int64, idempotencyKey string) (string, error) {
	if idempotencyKey == "" {
		return "", fmt.Errorf("create refund: idempotency key required")
	}
	if s.devMode {
		slog.Info("dev mode: stub CreateRefund", "paymentIntentID", paymentIntentID, "idem", idempotencyKey)
		return s.DevStore().RecordRefund(idempotencyKey, paymentIntentID, amountCents), nil
	}

	params := &stripe.RefundParams{
		PaymentIntent: stripe.String(paymentIntentID),
	}
	if amountCents > 0 {
		params.Amount = stripe.Int64(amountCents)
	}
	params.IdempotencyKey = stripe.String(idempotencyKey)

	r, err := observability.TraceStripeCall(ctx, "Refund.Create", func(ctx context.Context) (*stripe.Refund, error) {
		params.Context = ctx
		return refund.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("create refund: %w", err)
	}
	return r.ID, nil
}

// CreateConnectInstantPayout creates an instant payout on a connected account
// (Stripe Connect Instant Payouts). In dev mode returns a payout_dev_* id
// keyed by idempotencyKey. In production NEVER fabricates a payout id — either
// Stripe succeeds or an error is returned.
func (s *StripeService) CreateConnectInstantPayout(ctx context.Context, amountCents int64, currency, connectAccountID, idempotencyKey string) (string, error) {
	if idempotencyKey == "" {
		return "", fmt.Errorf("create connect instant payout: idempotency key required")
	}
	if connectAccountID == "" {
		return "", fmt.Errorf("create connect instant payout: connect account id required")
	}
	if amountCents <= 0 {
		return "", fmt.Errorf("create connect instant payout: amount must be positive")
	}
	if s.devMode {
		slog.Info("dev mode: stub CreateConnectInstantPayout",
			"amount_cents", amountCents,
			"account", connectAccountID,
			"idem", idempotencyKey,
		)
		return s.DevStore().RecordPayout(idempotencyKey, connectAccountID, amountCents), nil
	}

	params := &stripe.PayoutParams{
		Amount:   stripe.Int64(amountCents),
		Currency: stripe.String(currency),
		Method:   stripe.String(string(stripe.PayoutMethodInstant)),
	}
	params.SetStripeAccount(connectAccountID)
	params.IdempotencyKey = stripe.String(idempotencyKey)

	p, err := observability.TraceStripeCall(ctx, "Payout.Create", func(ctx context.Context) (*stripe.Payout, error) {
		params.Context = ctx
		return payout.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("create connect instant payout: %w", err)
	}
	return p.ID, nil
}

// StripeExternalBankAccount holds the non-sensitive metadata Stripe returns
// after attaching an external bank account to the platform account. Raw
// account/routing numbers are never present.
type StripeExternalBankAccount struct {
	ID           string // ba_...
	BankName     string
	Last4        string
	RoutingLast4 string
	Currency     string
	Country      string
	Status       string
}

// CreatePlatformExternalBankAccount attaches an external bank account to the
// platform's OWN Stripe account from a client-tokenized bank_account token
// (btok_...). Returns the non-sensitive metadata Stripe echoes back. In dev
// mode it returns a fake ba_... id and last4 so the flow works without real
// Stripe credentials.
func (s *StripeService) CreatePlatformExternalBankAccount(ctx context.Context, bankAccountToken, holderName, holderType string) (*StripeExternalBankAccount, error) {
	if bankAccountToken == "" {
		return nil, fmt.Errorf("create platform external bank account: bank_account token required")
	}
	if s.devMode {
		slog.Info("dev mode: stub CreatePlatformExternalBankAccount", "holder", holderName, "holder_type", holderType)
		return &StripeExternalBankAccount{
			ID:           "ba_dev_" + bankAccountToken,
			BankName:     "Dev Bank",
			Last4:        "6789",
			RoutingLast4: "4321",
			Currency:     "usd",
			Country:      "US",
			Status:       "new",
		}, nil
	}

	// Resolve the platform's own account (the account tied to the secret key).
	platformAcct, err := observability.TraceStripeCall(ctx, "Account.Get", getPlatformAccount)
	if err != nil {
		return nil, fmt.Errorf("create platform external bank account: resolve platform account: %w", err)
	}

	params := &stripe.BankAccountParams{
		Account: stripe.String(platformAcct.ID),
		Token:   stripe.String(bankAccountToken),
	}
	if holderName != "" {
		params.AccountHolderName = stripe.String(holderName)
	}
	if holderType != "" {
		params.AccountHolderType = stripe.String(holderType)
	}

	// Mutating call: a bank_account token is single-use and unique per
	// tokenization, so it deterministically identifies this attach. Without a
	// key, a network retry would either double-attach or fail on the consumed
	// token.
	params.IdempotencyKey = stripe.String(stripeIdempotencyKey("platform-bank-attach", bankAccountToken))

	ba, err := observability.TraceStripeCall(ctx, "BankAccount.Create", func(ctx context.Context) (*stripe.BankAccount, error) {
		params.Context = ctx
		return bankaccount.New(params)
	})
	if err != nil {
		return nil, fmt.Errorf("create platform external bank account: %w", err)
	}

	routingLast4 := ba.RoutingNumber
	if len(routingLast4) > 4 {
		routingLast4 = routingLast4[len(routingLast4)-4:]
	}

	return &StripeExternalBankAccount{
		ID:           ba.ID,
		BankName:     ba.BankName,
		Last4:        ba.Last4,
		RoutingLast4: routingLast4,
		Currency:     string(ba.Currency),
		Country:      ba.Country,
		Status:       string(ba.Status),
	}, nil
}

// DeletePlatformExternalBankAccount detaches an external bank account from the
// platform's own Stripe account. In dev mode it is a no-op.
func (s *StripeService) DeletePlatformExternalBankAccount(ctx context.Context, externalAccountID string) error {
	if externalAccountID == "" {
		return fmt.Errorf("delete platform external bank account: external account id required")
	}
	if s.devMode {
		slog.Info("dev mode: stub DeletePlatformExternalBankAccount", "external_account_id", externalAccountID)
		return nil
	}

	platformAcct, err := observability.TraceStripeCall(ctx, "Account.Get", getPlatformAccount)
	if err != nil {
		return fmt.Errorf("delete platform external bank account: resolve platform account: %w", err)
	}

	params := &stripe.BankAccountParams{
		Account: stripe.String(platformAcct.ID),
	}
	// DELETE is a write method: stripe-go would otherwise stamp a RANDOM
	// idempotency key, so a network retry after an ambiguous timeout would be
	// treated as a fresh request. The external account id fully identifies the
	// detach.
	params.IdempotencyKey = stripe.String(stripeIdempotencyKey("platform-bank-detach", externalAccountID))
	if _, err := observability.TraceStripeCall(ctx, "BankAccount.Delete", func(ctx context.Context) (*stripe.BankAccount, error) {
		params.Context = ctx
		return bankaccount.Del(externalAccountID, params)
	}); err != nil {
		return fmt.Errorf("delete platform external bank account: %w", err)
	}
	return nil
}

// --- Marketplace (peer-to-peer goods) Stripe methods ---

// CreateMarketplacePaymentIntent creates a PaymentIntent for the goods
// marketplace flow. Unlike the services CreatePaymentIntent, this DOES NOT
// use TransferData/destination charge — funds land in the platform's Stripe
// account so they can be held in escrow until pickup confirms. The seller is
// paid via a separate transfer in CreateMarketplaceTransfer.
//
// Auto-capture (CaptureMethod=automatic) is used because the buyer is paying
// up front; escrow is enforced by NoMarkup's state machine + delayed transfer,
// not by Stripe's capture mechanism.
//
// Idempotency key is mandatory.
func (s *StripeService) CreateMarketplacePaymentIntent(
	ctx context.Context,
	totalCents int64,
	currency string,
	idempotencyKey string,
	metadata map[string]string,
) (string, string, error) {
	if idempotencyKey == "" {
		return "", "", fmt.Errorf("create marketplace payment intent: idempotency key required")
	}
	if s.devMode {
		slog.Info("dev mode: stub CreateMarketplacePaymentIntent",
			"total_cents", totalCents,
			"idem", idempotencyKey,
		)
		return "pi_listing_dev_" + idempotencyKey, "pi_listing_dev_secret_" + idempotencyKey, nil
	}

	params := &stripe.PaymentIntentParams{
		Amount:   stripe.Int64(totalCents),
		Currency: stripe.String(currency),
		// Auto-capture: funds move to platform balance. Held in escrow by
		// the marketplace state machine (escrow_status='held').
		CaptureMethod: stripe.String(string(stripe.PaymentIntentCaptureMethodAutomatic)),
	}
	for k, v := range metadata {
		params.AddMetadata(k, v)
	}
	params.IdempotencyKey = stripe.String(idempotencyKey)

	pi, err := observability.TraceStripeCall(ctx, "PaymentIntent.Create", func(ctx context.Context) (*stripe.PaymentIntent, error) {
		params.Context = ctx
		return paymentintent.New(params)
	})
	if err != nil {
		return "", "", fmt.Errorf("create marketplace payment intent: %w", err)
	}
	return pi.ID, pi.ClientSecret, nil
}

// CreateMarketplaceTransfer pays the seller for a confirmed listing order.
// Unlike services.CreateTransfer this looks up the seller's Connect account
// indirectly via stripe-customer-id-by-platform-user. In dev mode it's a
// stub; the production path needs a (sellerID -> stripeAccountID) lookup
// which is wired via the PaymentService surface; here we accept the
// stripeAccountID directly so callers can resolve it however they want.
//
// Idempotency key is mandatory.
func (s *StripeService) CreateMarketplaceTransfer(
	ctx context.Context,
	amountCents int64,
	currency string,
	stripeAccountIDOrSellerID string,
	paymentIntentID string,
	idempotencyKey string,
) (string, error) {
	if idempotencyKey == "" {
		return "", fmt.Errorf("create marketplace transfer: idempotency key required")
	}
	if amountCents <= 0 {
		// Zero/negative payouts are a no-op (e.g. full-refund disputes). Return
		// a sentinel transfer ID so callers can log it.
		return "tr_zero_" + idempotencyKey, nil
	}
	if s.devMode {
		slog.Info("dev mode: stub CreateMarketplaceTransfer",
			"amount_cents", amountCents,
			"destination", stripeAccountIDOrSellerID,
			"idem", idempotencyKey,
		)
		return "tr_listing_dev_" + idempotencyKey, nil
	}

	params := &stripe.TransferParams{
		Amount:      stripe.Int64(amountCents),
		Currency:    stripe.String(currency),
		Destination: stripe.String(stripeAccountIDOrSellerID),
	}
	if paymentIntentID != "" {
		sourceTxn := paymentIntentID
		// SourceTransaction must be a Charge ID, not a PaymentIntent.
		if strings.HasPrefix(paymentIntentID, "pi_") {
			getParams := &stripe.PaymentIntentParams{}
			getParams.AddExpand("latest_charge")
			pi, err := observability.TraceStripeCall(ctx, "PaymentIntent.Get", func(ctx context.Context) (*stripe.PaymentIntent, error) {
				getParams.Context = ctx
				return paymentintent.Get(paymentIntentID, getParams)
			})
			if err != nil {
				return "", fmt.Errorf("create marketplace transfer: resolve charge: %w", err)
			}
			if pi.LatestCharge == nil || pi.LatestCharge.ID == "" {
				return "", fmt.Errorf("create marketplace transfer: payment intent %s has no latest charge", paymentIntentID)
			}
			sourceTxn = pi.LatestCharge.ID
		}
		params.SourceTransaction = stripe.String(sourceTxn)
		params.AddMetadata("payment_intent_id", paymentIntentID)
	}
	params.IdempotencyKey = stripe.String(idempotencyKey)

	t, err := observability.TraceStripeCall(ctx, "Transfer.Create", func(ctx context.Context) (*stripe.Transfer, error) {
		params.Context = ctx
		return transfer.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("create marketplace transfer: %w", err)
	}
	return t.ID, nil
}

// CreateMarketplaceRefund issues a refund (full or partial) for a listing
// payment intent. Idempotency key required to prevent double-refund on retry.
func (s *StripeService) CreateMarketplaceRefund(
	ctx context.Context,
	paymentIntentID string,
	amountCents int64,
	idempotencyKey string,
) (string, error) {
	if idempotencyKey == "" {
		return "", fmt.Errorf("create marketplace refund: idempotency key required")
	}
	if s.devMode {
		slog.Info("dev mode: stub CreateMarketplaceRefund",
			"pi_id", paymentIntentID,
			"amount_cents", amountCents,
			"idem", idempotencyKey,
		)
		return "re_listing_dev_" + idempotencyKey, nil
	}

	params := &stripe.RefundParams{
		PaymentIntent: stripe.String(paymentIntentID),
	}
	if amountCents > 0 {
		params.Amount = stripe.Int64(amountCents)
	}
	params.IdempotencyKey = stripe.String(idempotencyKey)

	r, err := observability.TraceStripeCall(ctx, "Refund.Create", func(ctx context.Context) (*stripe.Refund, error) {
		params.Context = ctx
		return refund.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("create marketplace refund: %w", err)
	}
	return r.ID, nil
}

// --- BNPL Stripe methods ---

// CreateOffSessionPaymentIntent creates a PaymentIntent with confirm=true and off_session=true.
// This is used for charging saved payment methods for scheduled installments.
// idempotencyKey is mandatory so cron retries / concurrent BNPL charges never double-bill.
func (s *StripeService) CreateOffSessionPaymentIntent(ctx context.Context, amountCents int64, currency string, customerStripeID string, paymentMethodID string, idempotencyKey string, metadata map[string]string) (string, string, error) {
	if idempotencyKey == "" {
		return "", "", fmt.Errorf("create off-session payment intent: idempotency key required")
	}
	if s.devMode {
		slog.Info("dev mode: stub CreateOffSessionPaymentIntent", "amountCents", amountCents, "customerStripeID", customerStripeID, "idem", idempotencyKey)
		key := "pi_dev_offsession_" + idempotencyKey
		return key, "pi_dev_secret_offsession_" + idempotencyKey, nil
	}

	params := &stripe.PaymentIntentParams{
		Amount:        stripe.Int64(amountCents),
		Currency:      stripe.String(currency),
		Customer:      stripe.String(customerStripeID),
		PaymentMethod: stripe.String(paymentMethodID),
		OffSession:    stripe.Bool(true),
		Confirm:       stripe.Bool(true),
	}
	for k, v := range metadata {
		params.AddMetadata(k, v)
	}
	params.IdempotencyKey = stripe.String(idempotencyKey)

	pi, err := observability.TraceStripeCall(ctx, "PaymentIntent.Create", func(ctx context.Context) (*stripe.PaymentIntent, error) {
		params.Context = ctx
		return paymentintent.New(params)
	})
	if err != nil {
		return "", "", fmt.Errorf("create off-session payment intent: %w", err)
	}
	return pi.ID, pi.ClientSecret, nil
}

// --- Insurance Stripe methods ---

// CreateInsurancePaymentIntent creates a PaymentIntent for an insurance premium.
// Unlike regular payments, insurance premiums are pure platform revenue — no destination charge.
func (s *StripeService) CreateInsurancePaymentIntent(ctx context.Context, amountCents int64, currency string, idempotencyKey string, policyID string) (string, string, error) {
	if s.devMode {
		slog.Info("dev mode: stub CreateInsurancePaymentIntent", "amountCents", amountCents, "policyID", policyID)
		return "pi_ins_dev_" + idempotencyKey, "pi_ins_dev_secret_" + idempotencyKey, nil
	}

	params := &stripe.PaymentIntentParams{
		Amount:   stripe.Int64(amountCents),
		Currency: stripe.String(currency),
	}
	params.AddMetadata("type", "insurance_premium")
	params.AddMetadata("policy_id", policyID)
	params.IdempotencyKey = stripe.String(idempotencyKey)

	pi, err := observability.TraceStripeCall(ctx, "PaymentIntent.Create", func(ctx context.Context) (*stripe.PaymentIntent, error) {
		params.Context = ctx
		return paymentintent.New(params)
	})
	if err != nil {
		return "", "", fmt.Errorf("create insurance payment intent: %w", err)
	}
	return pi.ID, pi.ClientSecret, nil
}

// --- Subscription Stripe methods ---

// CreateStripeSubscription creates a Stripe subscription for a customer.
// Returns the Stripe subscription ID and client secret (for SCA confirmation if needed).
func (s *StripeService) CreateStripeSubscription(ctx context.Context, customerID, stripePriceID, paymentMethodID string) (string, string, error) {
	if s.devMode {
		sub := s.DevStore().UpsertSubscription(customerID, stripePriceID, paymentMethodID)
		return sub.ID, "", nil
	}

	params := &stripe.SubscriptionParams{
		Items: []*stripe.SubscriptionItemsParams{
			{
				Price: stripe.String(stripePriceID),
			},
		},
		PaymentBehavior:      stripe.String("default_incomplete"),
		DefaultPaymentMethod: stripe.String(paymentMethodID),
	}
	params.AddExpand("latest_invoice.payment_intent")
	params.AddMetadata("platform_customer_id", customerID)

	// No idempotency key by design: (customerID, priceID, paymentMethodID) does
	// not identify a unique logical subscription. A customer who cancels and
	// re-subscribes to the same plan inside Stripe's 24h key window would be
	// handed the cancelled subscription back instead of a new one. Duplicate
	// creation is guarded upstream by the subscription table, not here.
	sub, err := observability.TraceStripeCall(ctx, "Subscription.Create", func(ctx context.Context) (*stripe.Subscription, error) {
		params.Context = ctx
		return stripesub.New(params)
	})
	if err != nil {
		return "", "", fmt.Errorf("create stripe subscription: %w", err)
	}

	var clientSecret string
	if sub.LatestInvoice != nil && sub.LatestInvoice.ConfirmationSecret != nil {
		clientSecret = sub.LatestInvoice.ConfirmationSecret.ClientSecret
	}

	return sub.ID, clientSecret, nil
}

// CancelStripeSubscription cancels a Stripe subscription.
func (s *StripeService) CancelStripeSubscription(ctx context.Context, stripeSubscriptionID string, cancelImmediately bool) error {
	if s.devMode {
		s.DevStore().CancelSubscription(stripeSubscriptionID)
		return nil
	}

	if cancelImmediately {
		_, err := observability.TraceStripeCall(ctx, "Subscription.Cancel", func(ctx context.Context) (*stripe.Subscription, error) {
			params := &stripe.SubscriptionCancelParams{}
			params.Context = ctx
			// The subscription id fully identifies this cancellation, so a
			// network retry replays it instead of erroring on an already
			// cancelled subscription.
			params.IdempotencyKey = stripe.String(stripeIdempotencyKey("sub-cancel", stripeSubscriptionID))
			return stripesub.Cancel(stripeSubscriptionID, params)
		})
		if err != nil {
			return fmt.Errorf("cancel stripe subscription: %w", err)
		}
	} else {
		params := &stripe.SubscriptionParams{
			CancelAtPeriodEnd: stripe.Bool(true),
		}
		params.IdempotencyKey = stripe.String(stripeIdempotencyKey("sub-cancel-at-period-end", stripeSubscriptionID))
		_, err := observability.TraceStripeCall(ctx, "Subscription.Update", func(ctx context.Context) (*stripe.Subscription, error) {
			params.Context = ctx
			return stripesub.Update(stripeSubscriptionID, params)
		})
		if err != nil {
			return fmt.Errorf("cancel stripe subscription at period end: %w", err)
		}
	}

	return nil
}

// UpdateStripeSubscription updates a Stripe subscription to a new price.
// Returns the updated subscription ID and the proration amount in cents.
func (s *StripeService) UpdateStripeSubscription(ctx context.Context, stripeSubscriptionID, newStripePriceID string) (string, int64, error) {
	if s.devMode {
		// The subscription row may live in the DB from a prior session
		// (DevStore resets on restart). Tolerate a miss — the DB update is
		// the source of truth in dev mode.
		s.DevStore().UpdateSubscriptionPrice(stripeSubscriptionID, newStripePriceID)
		return stripeSubscriptionID, 0, nil
	}

	// Get current subscription to find the item ID.
	sub, err := observability.TraceStripeCall(ctx, "Subscription.Get", func(ctx context.Context) (*stripe.Subscription, error) {
		getParams := &stripe.SubscriptionParams{}
		getParams.Context = ctx
		return stripesub.Get(stripeSubscriptionID, getParams)
	})
	if err != nil {
		return "", 0, fmt.Errorf("get stripe subscription for update: %w", err)
	}

	if len(sub.Items.Data) == 0 {
		return "", 0, fmt.Errorf("update stripe subscription: no items found")
	}

	itemID := sub.Items.Data[0].ID

	params := &stripe.SubscriptionParams{
		Items: []*stripe.SubscriptionItemsParams{
			{
				ID:    stripe.String(itemID),
				Price: stripe.String(newStripePriceID),
			},
		},
		ProrationBehavior: stripe.String("create_prorations"),
	}
	// Mutating and money-affecting: ProrationBehavior=create_prorations writes
	// proration line items. Without a key, a stripe-go network retry after an
	// ambiguous timeout would prorate the same plan change twice. The
	// (subscription, item, new price) triple deterministically identifies the
	// change.
	params.IdempotencyKey = stripe.String(stripeIdempotencyKey("sub-update", stripeSubscriptionID, itemID, newStripePriceID))

	updated, err := observability.TraceStripeCall(ctx, "Subscription.Update", func(ctx context.Context) (*stripe.Subscription, error) {
		params.Context = ctx
		return stripesub.Update(stripeSubscriptionID, params)
	})
	if err != nil {
		return "", 0, fmt.Errorf("update stripe subscription: %w", err)
	}

	return updated.ID, 0, nil
}

// ListStripeInvoices lists invoices for a Stripe subscription.
func (s *StripeService) ListStripeInvoices(ctx context.Context, stripeSubscriptionID string) ([]*domain.Invoice, error) {
	if s.devMode {
		slog.Info("dev mode: stub ListStripeInvoices", "subscriptionID", stripeSubscriptionID)
		return []*domain.Invoice{}, nil
	}

	params := &stripe.InvoiceListParams{
		Subscription: stripe.String(stripeSubscriptionID),
	}
	params.Filters.AddFilter("limit", "", "50")

	// One span for the whole iteration — see ListPaymentMethods for why.
	spanCtx, span := observability.StartStripeSpan(ctx, "Invoice.List")

	// Carried onto every page the iterator fetches, so a cancelled caller stops
	// paginating immediately.
	params.Context = spanCtx

	var invoices []*domain.Invoice
	i := invoice.List(params)
	for i.Next() {
		inv := i.Invoice()

		di := &domain.Invoice{
			ID:              inv.ID,
			SubscriptionID:  stripeSubscriptionID,
			StripeInvoiceID: inv.ID,
			AmountCents:     inv.AmountDue,
			Status:          string(inv.Status),
			PDFURL:          inv.InvoicePDF,
		}

		if inv.PeriodStart > 0 {
			t := time.Unix(inv.PeriodStart, 0)
			di.PeriodStart = &t
		}
		if inv.PeriodEnd > 0 {
			t := time.Unix(inv.PeriodEnd, 0)
			di.PeriodEnd = &t
		}
		if inv.StatusTransitions != nil && inv.StatusTransitions.PaidAt > 0 {
			t := time.Unix(inv.StatusTransitions.PaidAt, 0)
			di.PaidAt = &t
		}

		invoices = append(invoices, di)
	}
	if err := i.Err(); err != nil {
		observability.EndStripeSpan(span, err)
		return nil, fmt.Errorf("list stripe invoices: %w", err)
	}
	observability.EndStripeSpan(span, nil)

	return invoices, nil
}
