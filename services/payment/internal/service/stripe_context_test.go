package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stripe/stripe-go/v82"
)

// These tests prove that Stripe calls are cancellable and bounded.
//
// The defect they guard: every *stripe.XxxParams built in stripe.go used to
// leave Context nil, so stripe-go never called req.WithContext and the outbound
// HTTP request ignored the caller entirely. Combined with the SDK's default 80s
// per-attempt timeout and 2 network retries, one slow Stripe call could pin a
// goroutine (and the pgx pool connection it held) for ~4 minutes — long after
// the gateway's 15s http.Server WriteTimeout had abandoned the client.
//
// They mutate package-level stripe-go state (the API backend and stripe.Key),
// which is the only place stripe-go's resource clients read their transport
// from, so they must not run in parallel with each other.

const (
	// fakeStripeKeyForBackendTests is a syntactically valid but non-functional
	// key. It only has to survive stripe-go's header construction; every
	// request in these tests is served by a local httptest server.
	fakeStripeKeyForBackendTests = "sk_" + "test_" + "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

	// cancelBudget is how long a cancelled call is allowed to take before we
	// call it hung. Generous enough to be stable on a loaded CI box, and three
	// orders of magnitude below the ~4 minute pre-fix worst case.
	cancelBudget = 3 * time.Second
)

// useStripeTestBackend points the package-level Stripe API backend at url and
// restores the previous backend (and key) when the test ends.
func useStripeTestBackend(t *testing.T, url string, retries int64, attemptTimeout time.Duration) {
	t.Helper()

	prevBackend := stripe.GetBackend(stripe.APIBackend)
	prevKey := stripe.Key

	cfg := newStripeBackendConfig()
	cfg.URL = stripe.String(url)
	cfg.MaxNetworkRetries = stripe.Int64(retries)
	cfg.LeveledLogger = &stripe.LeveledLogger{Level: stripe.LevelNull}
	if attemptTimeout > 0 {
		cfg.HTTPClient.Timeout = attemptTimeout
	}

	stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(stripe.APIBackend, cfg))
	stripe.Key = fakeStripeKeyForBackendTests

	t.Cleanup(func() {
		stripe.SetBackend(stripe.APIBackend, prevBackend)
		stripe.Key = prevKey
	})
}

// newHangingStripeServer returns a server that never answers. It unblocks only
// when the client goes away (request context cancelled) or the test finishes,
// which is exactly the "Stripe is not responding" condition.
func newHangingStripeServer(t *testing.T) *httptest.Server {
	t.Helper()

	release := make(chan struct{})
	var closeOnce sync.Once

	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))

	t.Cleanup(func() {
		closeOnce.Do(func() { close(release) })
		srv.Close()
	})
	return srv
}

// isContextErr reports whether err carries a context cancellation/deadline,
// however deeply stripe-go wrapped it.
func isContextErr(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

// stripeCallCase is one Stripe-touching method on the service surface.
type stripeCallCase struct {
	name string
	call func(context.Context, *StripeService) error
}

// allStripeCalls covers every Stripe SDK call site reachable from this package
// so the "context is honoured" property is asserted per call site rather than
// spot-checked. Sub-tests are named after the SDK operation(s) they exercise.
func allStripeCalls() []stripeCallCase {
	return []stripeCallCase{
		{"Account.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateStripeAccount(ctx, "provider@example.com", "Acme LLC")
			return err
		}},
		{"AccountLink.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.GetOnboardingLink(ctx, "acct_1", "https://r", "https://f")
			return err
		}},
		{"Account.GetByID", func(ctx context.Context, s *StripeService) error {
			_, err := s.GetAccountStatus(ctx, "acct_1")
			return err
		}},
		{"LoginLink.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.GetDashboardLink(ctx, "acct_1")
			return err
		}},
		{"SetupIntent.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateSetupIntent(ctx, "cus_1", "user-1")
			return err
		}},
		{"SetupIntent.Get", func(ctx context.Context, s *StripeService) error {
			_, err := s.GetSetupIntentStatus(ctx, "seti_1_secret_abc", "")
			return err
		}},
		{"PaymentMethod.List", func(ctx context.Context, s *StripeService) error {
			_, err := s.ListPaymentMethods(ctx, "cus_1")
			return err
		}},
		{"PaymentMethod.Detach", func(ctx context.Context, s *StripeService) error {
			return s.DeletePaymentMethod(ctx, "pm_1")
		}},
		{"PaymentIntent.Create", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.CreatePaymentIntent(ctx, 1000, "usd", "acct_1", 100, "idem-pi", "")
			return err
		}},
		{"PaymentIntent.Capture", func(ctx context.Context, s *StripeService) error {
			return s.CapturePaymentIntent(ctx, "pi_1", "idem-cap")
		}},
		{"Transfer.Create", func(ctx context.Context, s *StripeService) error {
			// ch_ source skips the PaymentIntent.Get resolution branch.
			_, err := s.CreateTransfer(ctx, 1000, "usd", "acct_1", "ch_1", "idem-tr")
			return err
		}},
		{"PaymentIntent.Get-in-CreateTransfer", func(ctx context.Context, s *StripeService) error {
			// pi_ source forces the LatestCharge resolution call.
			_, err := s.CreateTransfer(ctx, 1000, "usd", "acct_1", "pi_1", "idem-tr2")
			return err
		}},
		{"Transfer.Create-platform", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreatePlatformTransfer(ctx, 1000, "usd", "acct_1", "idem-plt")
			return err
		}},
		{"Refund.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateRefund(ctx, "pi_1", 500, "idem-rf")
			return err
		}},
		{"Payout.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateConnectInstantPayout(ctx, 1000, "usd", "acct_1", "idem-po")
			return err
		}},
		{"Account.Get-plus-BankAccount.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreatePlatformExternalBankAccount(ctx, "btok_1", "Acme", "company")
			return err
		}},
		{"Account.Get-plus-BankAccount.Delete", func(ctx context.Context, s *StripeService) error {
			return s.DeletePlatformExternalBankAccount(ctx, "ba_1")
		}},
		{"PaymentIntent.Create-marketplace", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.CreateMarketplacePaymentIntent(ctx, 1000, "usd", "cus_1", "idem-mpi", map[string]string{"order_id": "o1"})
			return err
		}},
		{"PaymentIntent.Get-plus-Transfer.Create-marketplace", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateMarketplaceTransfer(ctx, 1000, "usd", "acct_1", "pi_1", "idem-mtr")
			return err
		}},
		{"Refund.Create-marketplace", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateMarketplaceRefund(ctx, "pi_1", 500, "idem-mrf")
			return err
		}},
		{"PaymentIntent.Create-off-session", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.CreateOffSessionPaymentIntent(ctx, 1000, "usd", "cus_1", "pm_1", "idem-os", nil)
			return err
		}},
		{"PaymentIntent.Create-insurance", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.CreateInsurancePaymentIntent(ctx, 1000, "usd", "idem-ins", "pol_1")
			return err
		}},
		{"Subscription.Create", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.CreateStripeSubscription(ctx, "cus_1", "price_1", "pm_1")
			return err
		}},
		{"Subscription.Cancel", func(ctx context.Context, s *StripeService) error {
			return s.CancelStripeSubscription(ctx, "sub_1", true)
		}},
		{"Subscription.Update-cancel-at-period-end", func(ctx context.Context, s *StripeService) error {
			return s.CancelStripeSubscription(ctx, "sub_1", false)
		}},
		{"Subscription.Get-plus-Update", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.UpdateStripeSubscription(ctx, "sub_1", "price_2")
			return err
		}},
		{"Invoice.List", func(ctx context.Context, s *StripeService) error {
			_, err := s.ListStripeInvoices(ctx, "sub_1")
			return err
		}},
		{"Customer.Delete-gdpr", func(ctx context.Context, s *StripeService) error {
			_, err := NewStripeDeleter(s).DeleteCustomer(ctx, "cus_1")
			return err
		}},
		{"Account.Delete-gdpr", func(ctx context.Context, s *StripeService) error {
			_, err := NewStripeDeleter(s).DeleteConnectAccount(ctx, "acct_1")
			return err
		}},
	}
}

// TestStripeCalls_HonourCallerDeadline is the core regression test: against a
// Stripe that never answers, every call must abort when the CALLER's deadline
// fires, not when stripe-go's own timeout+retry budget runs out.
//
// Retries are deliberately left at 2 (more than production) to also prove that
// stripe-go's shouldRetry declines to retry once the request context is in
// error — otherwise cancellation would only shorten one attempt out of three.
func TestStripeCalls_HonourCallerDeadline(t *testing.T) {
	srv := newHangingStripeServer(t)
	useStripeTestBackend(t, srv.URL, 2, 0)

	// devMode false: these must take the real Stripe path.
	svc := &StripeService{}

	for _, tc := range allStripeCalls() {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
			defer cancel()

			done := make(chan error, 1)
			start := time.Now()
			go func() { done <- tc.call(ctx, svc) }()

			select {
			case err := <-done:
				elapsed := time.Since(start)
				if err == nil {
					t.Fatalf("expected an error from a hanging Stripe, got nil after %s", elapsed)
				}
				if !isContextErr(err) {
					t.Fatalf("expected a context error, got %v (after %s)", err, elapsed)
				}
				if elapsed > cancelBudget {
					t.Fatalf("call took %s, want < %s: the caller's deadline is not aborting the request", elapsed, cancelBudget)
				}
			case <-time.After(cancelBudget):
				t.Fatalf("call still running after %s: params.Context is not reaching the SDK", cancelBudget)
			}
		})
	}
}

// TestStripeCalls_AlreadyCancelledContextReturnsImmediately covers the other
// shape of the same bug: a caller whose client already hung up. The request
// must never leave the process.
func TestStripeCalls_AlreadyCancelledContextReturnsImmediately(t *testing.T) {
	srv := newHangingStripeServer(t)
	useStripeTestBackend(t, srv.URL, 2, 0)

	svc := &StripeService{}

	for _, tc := range allStripeCalls() {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()

			done := make(chan error, 1)
			start := time.Now()
			go func() { done <- tc.call(ctx, svc) }()

			select {
			case err := <-done:
				if err == nil || !errors.Is(err, context.Canceled) {
					t.Fatalf("want context.Canceled, got %v (after %s)", err, time.Since(start))
				}
			case <-time.After(cancelBudget):
				t.Fatalf("call still running after %s on an already-cancelled context", cancelBudget)
			}
		})
	}
}

// TestStripeBackendConfig_BoundsAreSaneForTheRequestPath pins the tuning
// numbers, because they are the whole point of the fix. The arithmetic they
// encode: worst case is stripeAttemptTimeout * (retries+1) plus stripe-go's
// exponential backoff (minNetworkRetriesDelay is 500ms), i.e.
// 5s + 0.5s + 5s = 10.5s — inside the gateway's 15s http.Server WriteTimeout,
// versus the SDK default of 80s * 3 + backoff of roughly four minutes.
func TestStripeBackendConfig_BoundsAreSaneForTheRequestPath(t *testing.T) {
	t.Parallel()

	cfg := newStripeBackendConfig()

	if cfg.HTTPClient == nil {
		t.Fatal("backend config must supply its own http.Client; the SDK default is 80s per attempt")
	}
	if got := cfg.HTTPClient.Timeout; got != stripeAttemptTimeout {
		t.Errorf("per-attempt timeout = %s, want %s", got, stripeAttemptTimeout)
	}
	if cfg.HTTPClient.Timeout <= 0 || cfg.HTTPClient.Timeout > 10*time.Second {
		t.Errorf("per-attempt timeout %s is outside the sane request-path range (0, 10s]", cfg.HTTPClient.Timeout)
	}
	if cfg.MaxNetworkRetries == nil {
		t.Fatal("MaxNetworkRetries must be set explicitly; the SDK default is 2")
	}
	if got := *cfg.MaxNetworkRetries; got != stripeMaxNetworkRetries {
		t.Errorf("MaxNetworkRetries = %d, want %d", got, stripeMaxNetworkRetries)
	}

	// The worst case must fit inside the gateway's 15s WriteTimeout.
	const gatewayWriteTimeout = 15 * time.Second
	const stripeBackoffFloor = 500 * time.Millisecond
	attempts := time.Duration(*cfg.MaxNetworkRetries+1) * cfg.HTTPClient.Timeout
	backoff := time.Duration(*cfg.MaxNetworkRetries) * stripeBackoffFloor
	if worst := attempts + backoff; worst >= gatewayWriteTimeout {
		t.Errorf("worst-case Stripe budget %s >= gateway WriteTimeout %s", worst, gatewayWriteTimeout)
	}
}

// TestStripeBackend_PerAttemptTimeoutBoundsACallerWithNoDeadline proves the
// backstop half of the fix independently of the context half: a caller with no
// deadline at all (cron/background paths) must still be released by the
// backend's own per-attempt timeout.
//
// The configured timeout is shrunk to keep the test fast; the mechanism under
// test (BackendConfig.HTTPClient.Timeout) is identical, and the production
// values are pinned by TestStripeBackendConfig_BoundsAreSaneForTheRequestPath.
func TestStripeBackend_PerAttemptTimeoutBoundsACallerWithNoDeadline(t *testing.T) {
	srv := newHangingStripeServer(t)
	useStripeTestBackend(t, srv.URL, 0 /* no retries */, 200*time.Millisecond)

	svc := &StripeService{}

	done := make(chan error, 1)
	start := time.Now()
	go func() {
		_, _, err := svc.CreatePaymentIntent(context.Background(), 1000, "usd", "acct_1", 100, "idem-no-deadline", "")
		done <- err
	}()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected a timeout error from a hanging Stripe, got nil")
		}
		if elapsed := time.Since(start); elapsed > cancelBudget {
			t.Fatalf("call took %s, want < %s", elapsed, cancelBudget)
		}
	case <-time.After(cancelBudget):
		t.Fatalf("deadline-less call still running after %s: the per-attempt timeout is not applied", cancelBudget)
	}
}

// TestStripeMutatingCalls_SendDeterministicIdempotencyKey audits the other half
// of the composition requirement: stripe-go now retries on our behalf, so every
// mutating call must carry a key, and that key must be a pure function of its
// arguments (never random) or the retry would be a second distinct write.
func TestStripeMutatingCalls_SendDeterministicIdempotencyKey(t *testing.T) {
	var mu sync.Mutex
	var keys []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if r.Method != http.MethodGet {
			keys = append(keys, r.Header.Get("Idempotency-Key"))
		}
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		// A body every resource in this file can decode into. latest_charge is
		// present so the transfer paths resolve a source transaction.
		_, _ = w.Write([]byte(`{"id":"obj_1","latest_charge":{"id":"ch_1"},"items":{"data":[{"id":"si_1"}]}}`))
	}))
	t.Cleanup(srv.Close)

	useStripeTestBackend(t, srv.URL, 0, 0)
	svc := &StripeService{}

	reset := func() {
		mu.Lock()
		keys = nil
		mu.Unlock()
	}
	snapshot := func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), keys...)
	}

	mutating := []stripeCallCase{
		{"Account.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateStripeAccount(ctx, "provider@example.com", "Acme LLC")
			return err
		}},
		{"PaymentMethod.Detach", func(ctx context.Context, s *StripeService) error {
			return s.DeletePaymentMethod(ctx, "pm_1")
		}},
		{"PaymentIntent.Create", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.CreatePaymentIntent(ctx, 1000, "usd", "acct_1", 100, "idem-pi", "")
			return err
		}},
		{"PaymentIntent.Capture", func(ctx context.Context, s *StripeService) error {
			return s.CapturePaymentIntent(ctx, "pi_1", "idem-cap")
		}},
		{"Transfer.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateTransfer(ctx, 1000, "usd", "acct_1", "ch_1", "idem-tr")
			return err
		}},
		{"Transfer.Create-platform", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreatePlatformTransfer(ctx, 1000, "usd", "acct_1", "idem-plt")
			return err
		}},
		{"Refund.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateRefund(ctx, "pi_1", 500, "idem-rf")
			return err
		}},
		{"Payout.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateConnectInstantPayout(ctx, 1000, "usd", "acct_1", "idem-po")
			return err
		}},
		{"BankAccount.Create", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreatePlatformExternalBankAccount(ctx, "btok_1", "Acme", "company")
			return err
		}},
		{"BankAccount.Delete", func(ctx context.Context, s *StripeService) error {
			return s.DeletePlatformExternalBankAccount(ctx, "ba_1")
		}},
		{"PaymentIntent.Create-marketplace", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.CreateMarketplacePaymentIntent(ctx, 1000, "usd", "cus_1", "idem-mpi", nil)
			return err
		}},
		{"Transfer.Create-marketplace", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateMarketplaceTransfer(ctx, 1000, "usd", "acct_1", "pi_1", "idem-mtr")
			return err
		}},
		{"Refund.Create-marketplace", func(ctx context.Context, s *StripeService) error {
			_, err := s.CreateMarketplaceRefund(ctx, "pi_1", 500, "idem-mrf")
			return err
		}},
		{"PaymentIntent.Create-off-session", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.CreateOffSessionPaymentIntent(ctx, 1000, "usd", "cus_1", "pm_1", "idem-os", nil)
			return err
		}},
		{"PaymentIntent.Create-insurance", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.CreateInsurancePaymentIntent(ctx, 1000, "usd", "idem-ins", "pol_1")
			return err
		}},
		{"Subscription.Cancel", func(ctx context.Context, s *StripeService) error {
			return s.CancelStripeSubscription(ctx, "sub_1", true)
		}},
		{"Subscription.Update-cancel-at-period-end", func(ctx context.Context, s *StripeService) error {
			return s.CancelStripeSubscription(ctx, "sub_1", false)
		}},
		{"Subscription.Update-price-change", func(ctx context.Context, s *StripeService) error {
			_, _, err := s.UpdateStripeSubscription(ctx, "sub_1", "price_2")
			return err
		}},
		{"Customer.Delete-gdpr", func(ctx context.Context, s *StripeService) error {
			_, err := NewStripeDeleter(s).DeleteCustomer(ctx, "cus_1")
			return err
		}},
		{"Account.Delete-gdpr", func(ctx context.Context, s *StripeService) error {
			_, err := NewStripeDeleter(s).DeleteConnectAccount(ctx, "acct_1")
			return err
		}},
	}

	for _, tc := range mutating {
		t.Run(tc.name, func(t *testing.T) {
			reset()
			if err := tc.call(context.Background(), svc); err != nil {
				t.Fatalf("call failed against the stub server: %v", err)
			}
			first := snapshot()

			if len(first) == 0 {
				t.Fatalf("no write request observed; case does not exercise a mutating call")
			}
			for i, k := range first {
				if strings.TrimSpace(k) == "" {
					t.Errorf("write #%d carried no Idempotency-Key: a stripe-go network retry would be a second distinct write", i)
				}
				if len(k) > 255 {
					t.Errorf("write #%d key is %d chars; Stripe rejects keys over 255", i, len(k))
				}
			}

			// Same arguments must produce the same key. A random key (the SDK's
			// default for write methods) would differ here.
			reset()
			if err := tc.call(context.Background(), svc); err != nil {
				t.Fatalf("second call failed: %v", err)
			}
			second := snapshot()

			if len(second) != len(first) {
				t.Fatalf("write count changed between identical calls: %d then %d", len(first), len(second))
			}
			for i := range first {
				if first[i] != second[i] {
					t.Errorf("write #%d idempotency key is not deterministic: %q then %q", i, first[i], second[i])
				}
			}
		})
	}
}

// TestStripeIdempotencyKey_IsDeterministicAndBounded covers the derivation
// helper directly, including the length bound that motivated hashing.
func TestStripeIdempotencyKey_IsDeterministicAndBounded(t *testing.T) {
	t.Parallel()

	long := strings.Repeat("a", 240) + "@example.com" // 252 chars, a legal email
	a := stripeIdempotencyKey("connect-account", long)
	b := stripeIdempotencyKey("connect-account", long)

	if a != b {
		t.Fatalf("key is not deterministic: %q != %q", a, b)
	}
	if len(a) > 255 {
		t.Fatalf("key is %d chars; Stripe rejects keys over 255", len(a))
	}
	if !strings.HasPrefix(a, "connect-account:") {
		t.Errorf("key %q lost its scope prefix", a)
	}
	if c := stripeIdempotencyKey("connect-account", long+"x"); a == c {
		t.Error("different inputs produced the same key")
	}
	// Separator prevents ("ab","c") and ("a","bc") from colliding.
	if stripeIdempotencyKey("s", "ab", "c") == stripeIdempotencyKey("s", "a", "bc") {
		t.Error("multi-part keys collide across part boundaries")
	}
}
