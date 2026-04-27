package vault

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNew_NoAddr_FallsThrough(t *testing.T) {
	t.Setenv("VAULT_ADDR", "")
	c, err := New(context.Background())
	if err != nil {
		t.Fatalf("expected nil err in env-fallback mode, got %v", err)
	}
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
	got := c.GetString(context.Background(), "secret/nomarkup/dev/payment", "stripe_secret", "STRIPE_SECRET")
	if got != "sk_test_env" {
		t.Errorf("expected env fallback, got %q", got)
	}
}
