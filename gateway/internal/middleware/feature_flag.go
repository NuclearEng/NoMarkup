package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

// Wiring instructions for router.go:
//
//   r.Route("/installment-plans", func(r chi.Router) {
//       r.Use(middleware.RequireFlag(dbPool, cacheClient, "customer_bnpl"))
//       // ... existing routes
//   })
//
// Wrap only OPTIONAL / monetization feature route groups. Core surfaces
// (auth, jobs, bids, listings, payments-core, trust, fraud, chat) must NOT
// be gated.

const (
	featureFlagPrefix = "feature_flag"
	// featureFlagCacheTTL keeps a flag's enabled state in Redis so RequireFlag
	// is not a DB hit per request. 30s is short enough that an admin toggle in
	// the dashboard takes effect almost immediately.
	featureFlagCacheTTL = 30 * time.Second
)

// featureFlagState is the cached value for a single flag. We cache an explicit
// "found" marker so a missing flag (treated as enabled / fail-open) is also
// cached rather than re-queried every request.
type featureFlagState struct {
	Found   bool `json:"found"`
	Enabled bool `json:"enabled"`
}

// RequireFlag returns middleware that gates a route group behind a feature
// flag stored in the feature_flags table.
//
// Behavior:
//   - Flag row exists and enabled = true  → call next (feature live).
//   - Flag row exists and enabled = false → 503 with an intuitive JSON body.
//   - Flag row MISSING                     → FAIL OPEN (treat as enabled).
//     A missing flag must never break a route; only an explicitly-disabled
//     flag gates. This keeps a typo'd key or an un-seeded environment from
//     silently taking a working feature offline.
//   - DB error / db == nil                → FAIL OPEN (treat as enabled).
//     These features are core-adjacent (payments/insurance/advances); failing
//     closed on an infra blip would be worse than serving them, so we fail
//     open and log loudly for the admin to investigate.
//
// The flag's enabled state is cached in Redis for featureFlagCacheTTL so the
// hot path is a Redis GET, not a Postgres query, on every request.
func RequireFlag(db *pgxpool.Pool, cacheClient *cache.Client, flagKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !flagDisabled(r.Context(), db, cacheClient, flagKey) {
				next.ServeHTTP(w, r)
				return
			}

			slog.Info("feature flag gate: request blocked, feature disabled",
				"flag", flagKey,
				"method", r.Method,
				"path", r.URL.Path,
			)
			http.Error(w, `{"error":"This feature is currently unavailable"}`, http.StatusServiceUnavailable)
		})
	}
}

// flagDisabled reports whether the named flag is EXPLICITLY disabled.
// It returns false (i.e. allow the request) for: enabled flags, missing flags,
// DB errors, and a nil DB — every fail-open case — so only a real row with
// enabled = false blocks.
func flagDisabled(ctx context.Context, db *pgxpool.Pool, cacheClient *cache.Client, flagKey string) bool {
	redisKey := cache.Key(featureFlagPrefix, flagKey)

	// 1. Try the cache.
	if cacheClient != nil {
		var st featureFlagState
		if cacheClient.GetJSON(ctx, redisKey, &st) {
			return st.Found && !st.Enabled
		}
	}

	// 2. Cache miss — read from Postgres.
	if db == nil {
		return false // fail open
	}

	var enabled bool
	err := db.QueryRow(ctx,
		`SELECT enabled FROM feature_flags WHERE key = $1`, flagKey).Scan(&enabled)

	st := featureFlagState{}
	switch {
	case err == nil:
		st.Found = true
		st.Enabled = enabled
	case errors.Is(err, pgx.ErrNoRows):
		// Missing flag → fail open (enabled). Cache the "not found" marker so
		// we don't re-query every request for an un-seeded key.
		st.Found = false
	default:
		// Real DB error: fail open but do NOT cache, so we retry next request.
		slog.Error("feature flag gate: failed to read flag, failing open",
			"flag", flagKey,
			"error", err,
		)
		return false
	}

	if cacheClient != nil {
		cacheClient.SetJSON(ctx, redisKey, st, featureFlagCacheTTL)
	}

	return st.Found && !st.Enabled
}
