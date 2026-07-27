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
	blocked := flagDisabled(context.Background(), nil, nil, "instant_payout", "")
	assert.True(t, blocked, "production + nil db must fail closed")
}

func TestFlagDisabled_nilDB_dev_failOpen(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	blocked := flagDisabled(context.Background(), nil, nil, "instant_payout", "")
	assert.False(t, blocked, "dev + nil db must fail open")
}

func TestFlagDisabled_staging_missing_failOpen(t *testing.T) {
	t.Setenv("ENVIRONMENT", "staging")
	// nil db is treated as missing infrastructure — staging stays fail-open
	// for missing flags (documented exception; production is fail-closed).
	blocked := flagDisabled(context.Background(), nil, nil, "customer_bnpl", "")
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
		"nomarkup_guarantee",
		// Live auction / spectator (migration 013) — same RequireFlag fail-closed.
		"live_auction",
		"spectator_mode",
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

func TestLiveAuctionEnvEnabled(t *testing.T) {
	t.Setenv("ENABLE_LIVE_AUCTION", "true")
	assert.True(t, LiveAuctionEnvEnabled())

	t.Setenv("ENABLE_LIVE_AUCTION", "false")
	assert.False(t, LiveAuctionEnvEnabled())

	t.Setenv("ENABLE_LIVE_AUCTION", "1")
	assert.False(t, LiveAuctionEnvEnabled(), "only exact true enables")

	t.Setenv("ENABLE_LIVE_AUCTION", "")
	assert.False(t, LiveAuctionEnvEnabled())
}

// RequireFlag on live_auction / spectator_mode routes: production nil DB → 503.
func TestRequireFlag_liveAuctionAndSpectator_production_nilDB_503(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	for _, key := range []string{"live_auction", "spectator_mode"} {
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
			require.Equal(t, http.StatusServiceUnavailable, rec.Code)
			assert.False(t, called)
			assert.Contains(t, rec.Body.String(), "currently unavailable")
		})
	}
}

func TestInStickyRollout_stableAndBounded(t *testing.T) {
	t.Parallel()
	// Same subject+key always lands in the same cohort.
	a := inStickyRollout("user-1", "smart_matching", 50)
	b := inStickyRollout("user-1", "smart_matching", 50)
	assert.Equal(t, a, b)

	// 0% never, 100% always.
	assert.False(t, inStickyRollout("user-1", "smart_matching", 0))
	assert.True(t, inStickyRollout("user-1", "smart_matching", 100))

	// Different subjects can differ; at least one of a small set is in and one out
	// is not guaranteed — just assert stability per subject and that some variety exists.
	seenIn, seenOut := false, false
	for i := 0; i < 64; i++ {
		subj := "user-" + string(rune('a'+i%26)) + "-" + string(rune('0'+i/26))
		if inStickyRollout(subj, "smart_matching", 50) {
			seenIn = true
		} else {
			seenOut = true
		}
	}
	assert.True(t, seenIn, "expected at least one subject in 50% cohort")
	assert.True(t, seenOut, "expected at least one subject out of 50% cohort")
}

func TestEvaluateFlagState_moneyPartialFailsClosed(t *testing.T) {
	t.Parallel()
	st := featureFlagState{Found: true, Enabled: true, RolloutPercent: 50}
	blocked := evaluateFlagState(st, true, "instant_payout", "user-1")
	assert.True(t, blocked, "money flag with partial rollout must fail closed")
}

func TestEvaluateFlagState_moneyFullOnAllows(t *testing.T) {
	t.Parallel()
	st := featureFlagState{Found: true, Enabled: true, RolloutPercent: 100}
	blocked := evaluateFlagState(st, true, "instant_payout", "user-1")
	assert.False(t, blocked)
}

func TestEvaluateFlagState_platformSticky(t *testing.T) {
	t.Parallel()
	st := featureFlagState{Found: true, Enabled: true, RolloutPercent: 50}
	// No subject → blocked.
	assert.True(t, evaluateFlagState(st, true, "smart_matching", ""))
	// With subject: result equals inStickyRollout.
	subject := "sticky-user-abc"
	wantIn := inStickyRollout(subject, "smart_matching", 50)
	gotBlocked := evaluateFlagState(st, true, "smart_matching", subject)
	assert.Equal(t, !wantIn, gotBlocked)
}

func TestEvaluateFlagState_disabledBlocksRegardlessOfRollout(t *testing.T) {
	t.Parallel()
	st := featureFlagState{Found: true, Enabled: false, RolloutPercent: 100}
	assert.True(t, evaluateFlagState(st, true, "smart_matching", "user-1"))
}

func TestIsBinaryOnlyFlag(t *testing.T) {
	t.Parallel()
	assert.True(t, IsBinaryOnlyFlag("instant_payout"))
	assert.True(t, IsBinaryOnlyFlag("customer_bnpl"))
	assert.True(t, IsBinaryOnlyFlag("nomarkup_guarantee"))
	assert.False(t, IsBinaryOnlyFlag("smart_matching"))
	assert.False(t, IsBinaryOnlyFlag("live_auction"))
}

func TestClampRolloutPercent(t *testing.T) {
	t.Parallel()
	assert.Equal(t, 0, clampRolloutPercent(-5))
	assert.Equal(t, 100, clampRolloutPercent(150))
	assert.Equal(t, 42, clampRolloutPercent(42))
}

func TestAssignVariant_stable(t *testing.T) {
	t.Parallel()
	v1, b1 := assignVariant("user-x", "exp_a", 10)
	v2, b2 := assignVariant("user-x", "exp_a", 10)
	assert.Equal(t, v1, v2)
	assert.Equal(t, b1, b2)
	assert.Less(t, b1, uint32(1000))
	// 0% always control.
	v, _ := assignVariant("user-x", "exp_a", 0)
	assert.Equal(t, "control", v)
	// 100% always treatment.
	v, _ = assignVariant("user-x", "exp_a", 100)
	assert.Equal(t, "treatment", v)
}

func TestRequireFlag_deviceID_usedAsSubject(t *testing.T) {
	// Without DB, production still 503s — this only checks subject extraction
	// does not panic when X-Device-ID is set.
	t.Setenv("ENVIRONMENT", "development")
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	h := RequireFlag(nil, nil, "smart_matching")(next)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/gated", nil)
	req.Header.Set("X-Device-ID", "device-xyz")
	h.ServeHTTP(rec, req)
	// Dev + nil DB fail-open.
	require.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
}
