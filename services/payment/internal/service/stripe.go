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
	"github.com/stripe/stripe-go/v82/customer"
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
	// testFailOffSession forces CreateOffSessionPaymentIntent to error (unit
	// tests only — never set in production). Used to prove MON-15: charge
	// failure must not disburse the provider transfer.
	testFailOffSession bool
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

// CreateStripeCustomer creates a Stripe Customer for a platform user.
//
// The idempotency key is DETERMINISTIC in platformUserID and nothing else. That
// is the single most important property of this function, and the reason it
// takes the platform user id as a separate argument from the display fields: if
// two requests race to provision the same person, both send the same key and
// Stripe returns the SAME Customer object to both. Duplicate Customers are not
// merely wasteful — they silently split a person's saved cards across two
// objects, so a card saved through one is invisible and uncharageable through
// the other, and unwinding it requires re-collecting the card from the user.
//
// Email/name are labels for the Stripe dashboard only. They are deliberately
// NOT part of the key: a user who changes their display name must not thereby
// mint a second Customer.
//
// Caveat the caller must know: Stripe idempotency keys expire after 24 hours.
// Two provisioning attempts more than 24h apart that both reach Stripe WILL
// create two Customers. CustomerProvisioner closes that window by consulting the
// database first and by claiming the id with a guarded UPDATE; this function is
// only the Stripe half.
func (s *StripeService) CreateStripeCustomer(ctx context.Context, platformUserID, email, name string) (string, error) {
	if platformUserID == "" {
		return "", fmt.Errorf("create stripe customer: platform user id required")
	}
	if s.devMode {
		return s.DevStore().EnsureCustomer(platformUserID), nil
	}

	params := &stripe.CustomerParams{}
	if email != "" {
		params.Email = stripe.String(email)
	}
	if name != "" {
		params.Name = stripe.String(name)
	}
	// The reverse index: given a Stripe object, which platform user is it? Used
	// by findStripeCustomerByUser below and by anyone reconciling in the Stripe
	// dashboard after an incident.
	params.AddMetadata("platform_user_id", platformUserID)
	params.IdempotencyKey = stripe.String(stripeIdempotencyKey("customer-create", platformUserID))

	c, err := observability.TraceStripeCall(ctx, "Customer.Create", func(ctx context.Context) (*stripe.Customer, error) {
		params.Context = ctx
		return customer.New(params)
	})
	if err != nil {
		return "", fmt.Errorf("create stripe customer: %w", err)
	}
	return c.ID, nil
}

// FindStripeCustomerByUser looks for an existing Customer tagged with this
// platform user id, using Stripe's search index.
//
// This is the reconciliation backstop for the one window CreateStripeCustomer
// cannot cover: an attempt that created a Customer at Stripe but crashed before
// the DB claim, more than 24h ago (so the idempotency key no longer replays).
// Without this, the next attempt mints a second Customer and orphans the first
// along with any card attached to it.
//
// Returns ("", nil) when nothing matches — the ordinary first-time case.
//
// Search is EVENTUALLY CONSISTENT (Stripe documents up to ~a minute of indexing
// lag), so it is explicitly NOT a substitute for the deterministic idempotency
// key on the concurrent path — it would happily miss a Customer created one
// second ago. The two mechanisms cover different windows: the key covers
// seconds-to-24h, search covers beyond that.
func (s *StripeService) FindStripeCustomerByUser(ctx context.Context, platformUserID string) (string, error) {
	if platformUserID == "" {
		return "", fmt.Errorf("find stripe customer: platform user id required")
	}
	if s.devMode {
		return s.DevStore().LookupCustomer(platformUserID), nil
	}

	// Stripe search query syntax; the user id is a UUID we generated, so it
	// cannot contain a quote, but escape defensively anyway.
	query := fmt.Sprintf("metadata['platform_user_id']:'%s'", strings.ReplaceAll(platformUserID, "'", ""))
	params := &stripe.CustomerSearchParams{
		SearchParams: stripe.SearchParams{Query: query},
	}

	spanCtx, span := observability.StartStripeSpan(ctx, "Customer.Search")
	params.Context = spanCtx

	iter := customer.Search(params)
	var found string
	for iter.Next() {
		found = iter.Customer().ID
		break
	}
	if err := iter.Err(); err != nil {
		observability.EndStripeSpan(span, err)
		return "", fmt.Errorf("find stripe customer: %w", err)
	}
	observability.EndStripeSpan(span, nil)
	return found, nil
}

// SetCustomerDefaultPaymentMethod points the Customer's invoice settings at a
// payment method, which is what makes an off-session PaymentIntent created with
// a Customer but no explicit PaymentMethod chargeable.
func (s *StripeService) SetCustomerDefaultPaymentMethod(ctx context.Context, customerStripeID, paymentMethodID string) error {
	if customerStripeID == "" || paymentMethodID == "" {
		return fmt.Errorf("set customer default payment method: customer id and payment method id required")
	}
	if s.devMode {
		s.DevStore().SetDefaultPaymentMethod(customerStripeID, paymentMethodID)
		return nil
	}

	params := &stripe.CustomerParams{
		InvoiceSettings: &stripe.CustomerInvoiceSettingsParams{
			DefaultPaymentMethod: stripe.String(paymentMethodID),
		},
	}
	// Mutating POST. The (customer, payment method) pair fully identifies this
	// logical operation, so a network retry replays it rather than racing.
	params.IdempotencyKey = stripe.String(stripeIdempotencyKey("customer-default-pm", customerStripeID, paymentMethodID))

	if _, err := observability.TraceStripeCall(ctx, "Customer.Update", func(ctx context.Context) (*stripe.Customer, error) {
		params.Context = ctx
		return customer.Update(customerStripeID, params)
	}); err != nil {
		return fmt.Errorf("set customer default payment method: %w", err)
	}
	return nil
}

// GetPaymentMethod fetches one PaymentMethod's display fields.
//
// Needed because the setup_intent.succeeded event carries the payment method as
// a bare id, not an expanded object, so brand/last4/expiry have to be read back
// before they can be persisted.
func (s *StripeService) GetPaymentMethod(ctx context.Context, paymentMethodID string) (domain.PaymentMethod, error) {
	if paymentMethodID == "" {
		return domain.PaymentMethod{}, fmt.Errorf("get payment method: payment method id required")
	}
	if s.devMode {
		return s.DevStore().GetPaymentMethod(paymentMethodID), nil
	}

	pm, err := observability.TraceStripeCall(ctx, "PaymentMethod.Get", func(ctx context.Context) (*stripe.PaymentMethod, error) {
		params := &stripe.PaymentMethodParams{}
		params.Context = ctx
		return paymentmethod.Get(paymentMethodID, params)
	})
	if err != nil {
		return domain.PaymentMethod{}, fmt.Errorf("get payment method: %w", err)
	}
	out := domain.PaymentMethod{ID: pm.ID, Type: string(pm.Type)}
	if pm.Card != nil {
		out.LastFour = pm.Card.Last4
		out.Brand = string(pm.Card.Brand)
		out.ExpMonth = int32(pm.Card.ExpMonth)
		out.ExpYear = int32(pm.Card.ExpYear)
	}
	return out, nil
}

// CreateSetupIntent creates a SetupIntent for saving a customer's payment method.
//
// customerStripeID is the cus_... the resulting card will be ATTACHED to.
// platformUserID is the platform user id, recorded as metadata so a later
// confirmation can be bound to the caller who started it (the IDOR guard in
// GetSetupIntentStatus).
//
// Two things here are load-bearing and were both missing before:
//
//   - params.Customer. Without it Stripe creates a "customerless" SetupIntent:
//     the buyer completes Stripe Elements, sees a success screen, and the
//     resulting PaymentMethod is attached to NOTHING. It is unlistable,
//     uncharageable, and garbage-collected. Every card any user ever "saved" on
//     this platform went into that void, which is why GET /payments/methods
//     returned [] for everyone.
//
//   - Usage = off_session. This tells Stripe the card is being collected for
//     LATER merchant-initiated use, so it performs the correct mandate/3DS setup
//     up front. Without it the card is only ever authorized for on-session use,
//     and the first off-session charge fails with authentication_required — at
//     which point the buyer is not present to authenticate. That is the entire
//     point of a SetupIntent, and this is the parameter that delivers it.
func (s *StripeService) CreateSetupIntent(ctx context.Context, customerStripeID, platformUserID string) (string, error) {
	if s.devMode {
		slog.Info("dev mode: CreateSetupIntent issued dev client_secret",
			"customer_stripe_id", customerStripeID, "platform_user_id", platformUserID)
		return s.DevStore().NewSetupIntentForCustomer(platformUserID, customerStripeID), nil
	}

	if customerStripeID == "" {
		// Fail closed. Handing back a customerless client_secret would reproduce
		// exactly the bug this function exists to fix: the buyer would complete
		// card entry, be told it worked, and have saved nothing. Better to error
		// than to lie to the user about their card being on file.
		return "", fmt.Errorf("create setup intent: stripe customer id required (provision one first)")
	}

	params := &stripe.SetupIntentParams{
		Customer:           stripe.String(customerStripeID),
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
		Usage:              stripe.String("off_session"),
	}
	if platformUserID != "" {
		params.AddMetadata("platform_customer_id", platformUserID)
	}

	// No idempotency key by design: nothing in the arguments identifies WHICH
	// setup attempt this is. A key derived from the customer alone would pin one
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
	// CustomerID is the cus_... the confirmed method was attached to. Carried so
	// the caller can persist (customer, payment method) as one consistent pair
	// without a second Stripe round-trip. Empty on a customerless intent — which,
	// since CreateSetupIntent now refuses to make one, only happens for intents
	// created before that fix.
	CustomerID string
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
		pmID, cusID := s.DevStore().ConfirmSetupIntent(clientSecret)
		return SetupIntentStatus{
			Status:          "succeeded",
			Succeeded:       true,
			PaymentMethodID: pmID,
			CustomerID:      cusID,
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
	if si.Customer != nil {
		out.CustomerID = si.Customer.ID
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
//
// customerStripeID, when non-empty, binds the PaymentIntent to the customer's
// Stripe Customer so ConfirmOffSessionPaymentIntent can charge a saved card
// (FR-18 visit auto-charge). Passing "" preserves customerless on-session PIs.
func (s *StripeService) CreatePaymentIntent(ctx context.Context, amountCents int64, currency string, providerAccountID string, platformFeeCents int64, idempotencyKey string, customerStripeID string) (string, string, error) {
	if s.devMode {
		// Deterministic stub id/secret. Record in DevStore so soft-replay
		// (GetPaymentIntentClientSecret) can re-read the same secret — same
		// contract as marketplace CreateMarketplacePaymentIntent.
		piID := "pi_dev_" + idempotencyKey
		secret := "pi_dev_secret_" + idempotencyKey
		s.DevStore().RecordPaymentIntent(piID, customerStripeID, amountCents, secret)
		slog.Info("dev mode: stub CreatePaymentIntent", "amountCents", amountCents, "pi_id", piID, "customer", customerStripeID)
		return piID, secret, nil
	}

	params := &stripe.PaymentIntentParams{
		Amount:        stripe.Int64(amountCents),
		Currency:      stripe.String(currency),
		CaptureMethod: stripe.String(string(stripe.PaymentIntentCaptureMethodManual)),
		// No TransferData / ApplicationFeeAmount: platform holds funds until
		// ReleaseEscrow CreateTransfer. See comment above.
	}
	if customerStripeID != "" {
		params.Customer = stripe.String(customerStripeID)
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
// buyerStripeCustomerID, when non-empty, binds the PaymentIntent to the buyer's
// Stripe Customer. This is what later makes ConfirmOffSessionPaymentIntent
// possible: Stripe will only charge a saved payment method off-session if the
// PaymentIntent and the method belong to the same Customer. Passing "" preserves
// the old customerless behaviour for callers that genuinely have no customer.
func (s *StripeService) CreateMarketplacePaymentIntent(
	ctx context.Context,
	totalCents int64,
	currency string,
	buyerStripeCustomerID string,
	idempotencyKey string,
	metadata map[string]string,
) (string, string, error) {
	if idempotencyKey == "" {
		return "", "", fmt.Errorf("create marketplace payment intent: idempotency key required")
	}
	if s.devMode {
		slog.Info("dev mode: stub CreateMarketplacePaymentIntent",
			"total_cents", totalCents,
			"customer", buyerStripeCustomerID,
			"idem", idempotencyKey,
		)
		// PI id keeps the historical pi_listing_dev_ prefix (tests and logs).
		// client_secret must match Stripe's pi_<id>_secret_<secret> shape (id
		// segment has no underscores) so web hasConfirmablePayment accepts it —
		// the previous "pi_listing_dev_secret_..." form failed that guard and
		// every buy-now/pay retry in dev silently looked unusable.
		piID := "pi_listing_dev_" + idempotencyKey
		safeIdem := strings.Map(func(r rune) rune {
			switch r {
			case '_', ':', ' ', '/':
				return '-'
			default:
				return r
			}
		}, idempotencyKey)
		clientSecret := "pi_listingdev_secret_" + safeIdem
		s.DevStore().RecordPaymentIntent(piID, buyerStripeCustomerID, totalCents, clientSecret)
		return piID, clientSecret, nil
	}

	params := &stripe.PaymentIntentParams{
		Amount:   stripe.Int64(totalCents),
		Currency: stripe.String(currency),
		// Auto-capture: funds move to platform balance. Held in escrow by
		// the marketplace state machine (escrow_status='held').
		CaptureMethod: stripe.String(string(stripe.PaymentIntentCaptureMethodAutomatic)),
	}
	if buyerStripeCustomerID != "" {
		params.Customer = stripe.String(buyerStripeCustomerID)
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

// GetPaymentIntentClientSecret re-reads a PaymentIntent's client_secret.
//
// ChargeListingWinner only persists the PI id on listing_orders. Idempotent
// re-entry (buyer retries pay, settlement sweeper re-visits an attached order)
// must still hand the browser a secret for on-session confirm / SCA. Stripe
// exposes it on PaymentIntent.Get; in dev mode the DevStore records it at
// create time.
func (s *StripeService) GetPaymentIntentClientSecret(ctx context.Context, paymentIntentID string) (string, error) {
	if paymentIntentID == "" {
		return "", fmt.Errorf("get payment intent client secret: id required")
	}
	if s.devMode {
		if secret := s.DevStore().PaymentIntentClientSecret(paymentIntentID); secret != "" {
			return secret, nil
		}
		return "", fmt.Errorf("get payment intent client secret: unknown intent %s", paymentIntentID)
	}

	getParams := &stripe.PaymentIntentParams{}
	pi, err := observability.TraceStripeCall(ctx, "PaymentIntent.Get", func(ctx context.Context) (*stripe.PaymentIntent, error) {
		getParams.Context = ctx
		return paymentintent.Get(paymentIntentID, getParams)
	})
	if err != nil {
		return "", fmt.Errorf("get payment intent client secret: %w", err)
	}
	if pi.ClientSecret == "" {
		return "", fmt.Errorf("get payment intent client secret: stripe returned empty secret for %s", paymentIntentID)
	}
	return pi.ClientSecret, nil
}

// ConfirmOffSessionPaymentIntent confirms an EXISTING PaymentIntent against a
// saved payment method, with the buyer not present.
//
// Why confirm an existing PI rather than create-and-confirm in one call (as
// CreateOffSessionPaymentIntent does for BNPL): a listing order already carries
// exactly one PaymentIntent, created under the deterministic key
// "listing-charge:<orderID>" and persisted on the row. That PI is the order's
// single financial object — the thing the escrow state machine, the
// payment_intent.succeeded handler, the transfer's SourceTransaction and the
// refund path all key on. Creating a second PI per retry would mean an order
// with several PIs, several possible authorization holds on the buyer's card,
// and no single answer to "was this order paid?". So: create once, confirm many.
//
// The idempotency key must be ATTEMPT-scoped, not order-scoped. A declined
// confirm leaves the PI in requires_payment_method, which is retryable — but
// replaying the same key would make Stripe return the cached DECLINE rather than
// re-attempt the card, so a buyer who topped up their balance could never
// succeed. This mirrors the attempt-numbered key already used for BNPL
// installments (processOneInstallment).
//
// Returns the PaymentIntent status on success. A non-nil error from Stripe is
// classified by the caller (classifyChargeError) into the distinct outcomes that
// must not collapse: no instrument, SCA required, insufficient funds, declined.
func (s *StripeService) ConfirmOffSessionPaymentIntent(ctx context.Context, paymentIntentID, paymentMethodID, idempotencyKey string) (string, error) {
	if paymentIntentID == "" {
		return "", fmt.Errorf("confirm off-session payment intent: payment intent id required")
	}
	if paymentMethodID == "" {
		// Fail closed. Confirming with no payment method would either error at
		// Stripe or silently fall through to a customer default we did not
		// choose. "Which card did we charge?" must never be an open question.
		return "", fmt.Errorf("confirm off-session payment intent: %w", ErrNoPaymentInstrument)
	}
	if idempotencyKey == "" {
		return "", fmt.Errorf("confirm off-session payment intent: idempotency key required")
	}
	if s.devMode {
		return s.DevStore().ConfirmPaymentIntent(paymentIntentID, paymentMethodID, idempotencyKey)
	}

	params := &stripe.PaymentIntentConfirmParams{
		PaymentMethod: stripe.String(paymentMethodID),
		// OffSession tells Stripe the customer is NOT in the checkout flow. It
		// changes Stripe's behaviour in two ways that both matter here: it
		// applies the stored mandate from the off_session SetupIntent, and when
		// the issuer demands 3DS it fails fast with authentication_required
		// instead of parking the PI waiting for a browser that will never come.
		OffSession: stripe.Bool(true),
	}
	params.IdempotencyKey = stripe.String(idempotencyKey)

	pi, err := observability.TraceStripeCall(ctx, "PaymentIntent.Confirm", func(ctx context.Context) (*stripe.PaymentIntent, error) {
		params.Context = ctx
		return paymentintent.Confirm(paymentIntentID, params)
	})
	if err != nil {
		return "", fmt.Errorf("confirm off-session payment intent: %w", err)
	}
	return string(pi.Status), nil
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
	// Test-only injection: simulate charge failure without a live Stripe.
	if s != nil && s.testFailOffSession {
		return "", "", fmt.Errorf("create off-session payment intent: forced test failure")
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
//
// Idempotency key is mandatory (same empty-guard as every other money method).
// The only production caller always passes one; the guard is latent safety so a
// future caller cannot mint an unkeyed charge.
func (s *StripeService) CreateInsurancePaymentIntent(ctx context.Context, amountCents int64, currency string, idempotencyKey string, policyID string) (string, string, error) {
	if idempotencyKey == "" {
		return "", "", fmt.Errorf("create insurance payment intent: idempotency key required")
	}
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
