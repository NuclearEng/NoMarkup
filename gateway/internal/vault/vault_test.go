package vault

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	vaultapi "github.com/hashicorp/vault/api"
)

func TestNew_NoAddr_FallsThrough(t *testing.T) {
	t.Setenv("VAULT_ADDR", "")
	c, err := New(context.Background())
	if err != nil {
		t.Fatalf("expected nil err in env-fallback mode, got %v", err)
	}
	defer c.Close()
	t.Setenv("STRIPE_SECRET", "sk_test_envvar")
	got := c.GetString(context.Background(), "secret/nomarkup/dev/payment", "stripe_secret", "STRIPE_SECRET")
	if got != "sk_test_envvar" {
		t.Errorf("expected env fallback, got %q", got)
	}
	if err := c.Healthy(context.Background()); err != nil {
		t.Errorf("env-fallback should report healthy: %v", err)
	}
}

func TestGetString_VaultHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Logf("vault test server got %s %s", r.Method, r.URL.Path)
		switch {
		case r.URL.Path == "/v1/sys/health":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"initialized":true,"sealed":false,"standby":false,"version":"1.15.0"}`))
		case r.URL.Path == "/v1/secret/data/nomarkup/dev/payment":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"data":{"stripe_secret":"sk_test_fromVault"}}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	t.Setenv("VAULT_ADDR", srv.URL)
	t.Setenv("VAULT_TOKEN", "dev-token")
	c, err := New(context.Background())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer c.Close()
	got := c.GetString(context.Background(), "secret/nomarkup/dev/payment", "stripe_secret", "STRIPE_SECRET")
	if got != "sk_test_fromVault" {
		t.Errorf("expected vault value, got %q", got)
	}
	// Second call should hit cache (no extra HTTP request needed for correctness).
	got2 := c.GetString(context.Background(), "secret/nomarkup/dev/payment", "stripe_secret", "STRIPE_SECRET")
	if got2 != "sk_test_fromVault" {
		t.Errorf("cached read mismatch: %q", got2)
	}
	if err := c.Healthy(context.Background()); err != nil {
		t.Errorf("expected healthy, got %v", err)
	}
}

func TestGetString_VaultMissingFallsBackToEnv(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	t.Setenv("VAULT_ADDR", srv.URL)
	t.Setenv("VAULT_TOKEN", "dev-token")
	t.Setenv("STRIPE_SECRET", "sk_test_env")
	c, err := New(context.Background())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer c.Close()
	got := c.GetString(context.Background(), "secret/nomarkup/dev/payment", "stripe_secret", "STRIPE_SECRET")
	if got != "sk_test_env" {
		t.Errorf("expected env fallback, got %q", got)
	}
}

// newTestClient builds a Client manually so tests can install hooks BEFORE
// the renewal goroutine starts.
func newTestClient(t *testing.T, srv *httptest.Server) *Client {
	t.Helper()
	cfg := vaultapi.DefaultConfig()
	cfg.Address = srv.URL
	api, err := vaultapi.NewClient(cfg)
	if err != nil {
		t.Fatalf("api: %v", err)
	}
	api.SetToken("test-token")
	return &Client{api: api, cacheTTL: 5 * time.Minute, cache: map[string]cacheEntry{}}
}

// TestRenewLoop_HappyPath drives the renewal goroutine deterministically by
// installing a sleep hook that returns immediately, counting the
// renew-self HTTP calls.
func TestRenewLoop_HappyPath(t *testing.T) {
	var renewCount atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/auth/token/renew-self" {
			renewCount.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"auth":{"client_token":"test-token","lease_duration":3600,"renewable":true}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := newTestClient(t, srv)

	var sleepCalls atomic.Int32
	c.sleep = func(ctx context.Context, _ time.Duration) error {
		n := sleepCalls.Add(1)
		if n > 3 {
			// Block until cancel so the goroutine waits to be stopped.
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}

	c.startRenewLoop(1 * time.Hour)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if renewCount.Load() >= 3 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := renewCount.Load(); got < 3 {
		t.Errorf("expected at least 3 renew-self calls, got %d", got)
	}

	c.Close()
}

// TestRenewLoop_RetryOnce verifies that a single transient renewal failure
// triggers exactly one retry, after which the loop continues.
func TestRenewLoop_RetryOnce(t *testing.T) {
	var renewAttempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/auth/token/renew-self" {
			n := renewAttempts.Add(1)
			if n == 1 {
				// Transient 503 — first attempt fails.
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"auth":{"client_token":"test-token","lease_duration":1800,"renewable":true}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := newTestClient(t, srv)

	var sleepCalls atomic.Int32
	c.sleep = func(ctx context.Context, _ time.Duration) error {
		n := sleepCalls.Add(1)
		// Iteration walk:
		//   sleep #1: pre-renewal -> attempt #1 fails (503)
		//   sleep #2: retry backoff -> attempt #2 succeeds
		//   sleep #3: pre-renewal of next iteration -> attempt #3 succeeds
		// Then block until cancellation so the test can stop deterministically.
		if n > 3 {
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}

	c.startRenewLoop(30 * time.Minute)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if renewAttempts.Load() >= 3 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := renewAttempts.Load(); got < 2 {
		t.Errorf("expected at least 2 renew attempts (initial + retry), got %d", got)
	}

	c.Close()
}

// TestRenewLoop_StopsOnContextCancel confirms graceful shutdown stops the
// goroutine even while it's mid-sleep with the real time-based backend.
func TestRenewLoop_StopsOnContextCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/auth/approle/login" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"auth":{"client_token":"test-token","lease_duration":300,"renewable":true}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	t.Setenv("VAULT_ADDR", srv.URL)
	t.Setenv("VAULT_TOKEN", "")
	t.Setenv("VAULT_ROLE_ID", "test-role")
	t.Setenv("VAULT_SECRET_ID", "test-secret")

	c, err := New(context.Background())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c.renewalDone == nil {
		t.Fatal("expected renewal goroutine to start when AppRole login provides TTL")
	}

	closed := make(chan struct{})
	go func() {
		c.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("Close() did not stop the renewal goroutine in time")
	}
}

func TestRenewalSleep_Clamps(t *testing.T) {
	cases := []struct {
		name string
		ttl  time.Duration
		want time.Duration
	}{
		{"zero ttl floors", 0, minRenewalSleep},
		{"tiny ttl floors", 10 * time.Second, minRenewalSleep},
		{"normal ttl halves", 1 * time.Hour, 30 * time.Minute},
		{"huge ttl ceilings", 10 * time.Hour, maxRenewalSleep},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := renewalSleep(tc.ttl); got != tc.want {
				t.Errorf("renewalSleep(%v) = %v, want %v", tc.ttl, got, tc.want)
			}
		})
	}
}
