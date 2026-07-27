package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
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
// "found" marker so a missing flag is also cached rather than re-queried every
// request. Interpretation of Found=false depends on the environment:
// production fail-closed (missing ⇒ disabled); dev/staging fail-open
// (missing ⇒ enabled). See flagDisabled.
type featureFlagState struct {
	Found   bool `json:"found"`
	Enabled bool `json:"enabled"`
}

// isProductionEnv reports whether ENVIRONMENT=production. Feature-flag gates
// use this to fail closed on missing/error (SEC-01). Staging and development
// keep fail-open for missing flags so un-seeded local stacks keep working.
func isProductionEnv() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("ENVIRONMENT")), "production")
}

// RequireFlag returns middleware that gates a route group behind a feature
// flag stored in the feature_flags table.
//
// Behavior (production — ALWAYS fail closed, SEC-01):
//   - Flag row exists and enabled = true  → call next (feature live).
//   - Flag row exists and enabled = false → 503.
//   - Flag row MISSING                     → 503 (treat as disabled).
//   - DB error / db == nil                → 503 (treat as disabled).
//
// Behavior (development / staging — fail open for missing only):
//   - Flag row exists and enabled = true  → call next.
//   - Flag row exists and enabled = false → 503.
//   - Flag row MISSING                     → FAIL OPEN (treat as enabled).
//     A missing flag must never break a local/staging route; only an
//     explicitly-disabled flag gates. Documented exception for non-prod so
//     typo'd keys / un-seeded envs don't silently take features offline.
//   - DB error / db == nil                → FAIL OPEN (treat as enabled), log.
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
				"production", isProductionEnv(),
			)
			http.Error(w, `{"error":"This feature is currently unavailable"}`, http.StatusServiceUnavailable)
		})
	}
}

// IsFeatureDisabled reports whether the named flag should block the request
// or suppress a dual-gated money feature (e.g. lead_gen fee). Same semantics
// as RequireFlag — prefer RequireFlag on whole route groups; use this helper
// only when a flag applies to a field inside a shared endpoint (fee config).
//
// Production (SEC-01 fail-closed): missing flag, DB error, or nil DB all
// return true (disabled). Only an explicit enabled=true row allows traffic.
//
// Non-production (fail-open for missing/error): only an explicit enabled=false
// row blocks; missing flags and infra blips allow the request through.
func IsFeatureDisabled(ctx context.Context, db *pgxpool.Pool, cacheClient *cache.Client, flagKey string) bool {
	return flagDisabled(ctx, db, cacheClient, flagKey)
}

// flagDisabled is the internal implementation; call IsFeatureDisabled from
// handlers and RequireFlag from the router.
func flagDisabled(ctx context.Context, db *pgxpool.Pool, cacheClient *cache.Client, flagKey string) bool {
	prod := isProductionEnv()
	redisKey := cache.Key(featureFlagPrefix, flagKey)

	// 1. Try the cache.
	if cacheClient != nil {
		var st featureFlagState
		if cacheClient.GetJSON(ctx, redisKey, &st) {
			return interpretFlagState(st, prod)
		}
	}

	// 2. Cache miss — read from Postgres.
	if db == nil {
		if prod {
			slog.Error("feature flag gate: no database configured, failing closed",
				"flag", flagKey,
			)
			return true
		}
		return false // fail open in non-prod
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
		// Missing flag. Cache the "not found" marker so we don't re-query.
		// Interpretation (fail-closed vs fail-open) happens in interpretFlagState.
		st.Found = false
	default:
		// Real DB error: do NOT cache, so we retry next request.
		if prod {
			slog.Error("feature flag gate: failed to read flag, failing closed",
				"flag", flagKey,
				"error", err,
			)
			return true
		}
		slog.Error("feature flag gate: failed to read flag, failing open",
			"flag", flagKey,
			"error", err,
		)
		return false
	}

	if cacheClient != nil {
		cacheClient.SetJSON(ctx, redisKey, st, featureFlagCacheTTL)
	}

	return interpretFlagState(st, prod)
}

// interpretFlagState maps a cached/loaded flag state to "should block".
// production: missing (Found=false) ⇒ disabled; found ⇒ !Enabled.
// non-prod: only Found && !Enabled blocks.
func interpretFlagState(st featureFlagState, production bool) bool {
	if !st.Found {
		return production // fail-closed in prod, fail-open otherwise
	}
	return !st.Enabled
}

// LiveAuctionEnvEnabled reports whether the ENABLE_LIVE_AUCTION ops kill switch
// allows live-auction / spectator traffic.
//
// Dual gate (product + ops):
//
//  1. DB feature flags (primary, admin-togglable, fail-closed in production):
//     - live_auction   (migration 013) — live arena WS, auction state/events,
//       and CreateJob with auction_type=live
//     - spectator_mode (migration 013) — anonymous /ws/.../spectate sockets
//     Enforced via RequireFlag on route groups, or IsFeatureDisabled for
//     field-level gates inside shared endpoints (e.g. CreateJob).
//
//  2. ENABLE_LIVE_AUCTION env (ops kill switch, AND-ed with the DB flag):
//     Must be exactly "true" for services-side live-auction and services
//     spectator surfaces. When unset or any other value, those surfaces stay
//     off even if the DB flag is enabled — so an emergency kill needs only a
//     process env change, not a DB write. Marketplace spectator uses the
//     spectator_mode DB flag only (no env AND).
//
// Prefer RequireFlag at the router for whole routes; use LiveAuctionEnvEnabled
// inside handlers as the AND kill switch after the middleware has already
// checked the DB flag (or together with IsFeatureDisabled on shared paths).
func LiveAuctionEnvEnabled() bool {
	return os.Getenv("ENABLE_LIVE_AUCTION") == "true"
}
