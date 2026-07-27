package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInterpretFlagState(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		st         featureFlagState
		production bool
		wantBlock  bool
	}{
		{"prod_enabled", featureFlagState{Found: true, Enabled: true}, true, false},
		{"prod_disabled", featureFlagState{Found: true, Enabled: false}, true, true},
		{"prod_missing_fail_closed", featureFlagState{Found: false}, true, true},
		{"dev_enabled", featureFlagState{Found: true, Enabled: true}, false, false},
		{"dev_disabled", featureFlagState{Found: true, Enabled: false}, false, true},
		{"dev_missing_fail_open", featureFlagState{Found: false}, false, false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := interpretFlagState(tc.st, tc.production)
			assert.Equal(t, tc.wantBlock, got)
		})
	}
}

func TestFlagDisabled_nilDB_production_failClosed(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	// flagDisabled with nil db must block in production (SEC-01).
	blocked := flagDisabled(context.Background(), nil, nil, "instant_payout")
	assert.True(t, blocked, "production + nil db must fail closed")
}

func TestFlagDisabled_nilDB_dev_failOpen(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	blocked := flagDisabled(context.Background(), nil, nil, "instant_payout")
	assert.False(t, blocked, "dev + nil db must fail open")
}

func TestFlagDisabled_staging_missing_failOpen(t *testing.T) {
	t.Setenv("ENVIRONMENT", "staging")
	// nil db is treated as missing infrastructure — staging stays fail-open
	// for missing flags (documented exception; production is fail-closed).
	blocked := flagDisabled(context.Background(), nil, nil, "customer_bnpl")
	assert.False(t, blocked, "staging + nil db must fail open for missing")
}

func TestRequireFlag_production_nilDB_returns503(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	h := RequireFlag(nil, nil, "instant_payout")(next)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/instant-payout", nil)
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.False(t, called, "next must not run when flag gate fails closed")
	assert.Contains(t, rec.Body.String(), "currently unavailable")
}

func TestRequireFlag_dev_nilDB_allows(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	h := RequireFlag(nil, nil, "instant_payout")(next)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/instant-payout", nil)
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
}

// SEC-GATE-03: every regulated money key has the same fail-closed semantics
// when RequireFlag (or IsFeatureDisabled) is used on its entry points.
func TestRequireFlag_regulatedMoneyKeys_production_nilDB_503(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")

	keys := []string{
		"customer_bnpl",
		"working_capital",
		"per_job_insurance",
		"insurance_competition",
		"instant_payout",
		"lead_gen",
		"legal_services",
	}
	for _, key := range keys {
		key := key
		t.Run(key, func(t *testing.T) {
			called := false
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			})
			h := RequireFlag(nil, nil, key)(next)
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/gated", nil)
			h.ServeHTTP(rec, req)
			require.Equal(t, http.StatusServiceUnavailable, rec.Code, "flag %s must 503 in production with nil DB", key)
			assert.False(t, called)
			assert.True(t, IsFeatureDisabled(context.Background(), nil, nil, key))
		})
	}
}

func TestIsFeatureDisabled_matchesFlagDisabled(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	assert.True(t, IsFeatureDisabled(context.Background(), nil, nil, "lead_gen"))
	t.Setenv("ENVIRONMENT", "development")
	assert.False(t, IsFeatureDisabled(context.Background(), nil, nil, "lead_gen"))
}

func TestIsProductionEnv(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	assert.True(t, isProductionEnv())

	t.Setenv("ENVIRONMENT", "PRODUCTION")
	assert.True(t, isProductionEnv())

	t.Setenv("ENVIRONMENT", "development")
	assert.False(t, isProductionEnv())

	t.Setenv("ENVIRONMENT", "staging")
	assert.False(t, isProductionEnv())

	t.Setenv("ENVIRONMENT", "")
	assert.False(t, isProductionEnv())
}
