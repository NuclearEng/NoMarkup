package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

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
//
// ARC-10 partial rollout:
//   - feature_flags.rollout_percent (0-100, default 100) is a sticky cohort
//     when enabled=true. Public GET /flags stays binary (CDN-safe).
//   - Money / regulated keys are binary-only: allow only when enabled=true AND
//     rollout_percent=100. Partial percent on money keys fails closed.
//   - Every check increments feature_flag_checks_total (exposure foundation).

const (
	// featureFlagPrefix is the Redis key namespace for cached flag state.
	// Bumped to v2 when rollout_percent was added so stale v1 entries
	// (enabled-only JSON) cannot deserialize as rollout_percent=0 and
	// accidentally block traffic.
	featureFlagPrefix = "feature_flag_v2"
	// featureFlagCacheTTL keeps a flag's enabled state in Redis so RequireFlag
	// is not a DB hit per request. 30s is short enough that an admin toggle in
	// the dashboard takes effect almost immediately.
	featureFlagCacheTTL = 30 * time.Second
)

// featureFlagChecksTotal is the ARC-10 exposure hook: one increment per gate
// evaluation with a low-cardinality result label. Not a full experiment
// analytics pipeline — Prometheus only.
var featureFlagChecksTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "feature_flag_checks_total",
		Help: "Feature flag gate evaluations (ARC-10 exposure foundation).",
	},
	[]string{"flag", "result"},
)

// binaryOnlyFlagKeys must stay fully on or fully off. Partial rollout on
// money/liability surfaces would split cohorts mid-checkout and is rejected.
// Keep in sync with SEC-GATE-03 money keys + web FINANCIAL_FEATURE_FLAG_KEYS
// (plus nomarkup_guarantee which is a money claim path).
var binaryOnlyFlagKeys = map[string]struct{}{
	"customer_bnpl":         {},
	"working_capital":       {},
	"per_job_insurance":     {},
	"insurance_competition": {},
	"instant_payout":        {},
	"lead_gen":              {},
	"legal_services":        {},
	"nomarkup_guarantee":    {},
}

// IsBinaryOnlyFlag reports whether the key must remain 0% or 100% rollout
// (no sticky partial). Used by RequireFlag and the admin update handler.
func IsBinaryOnlyFlag(flagKey string) bool {
	_, ok := binaryOnlyFlagKeys[flagKey]
	return ok
}

// featureFlagState is the cached value for a single flag. We cache an explicit
// "found" marker so a missing flag is also cached rather than re-queried every
// request. Interpretation of Found=false depends on the environment:
// production fail-closed (missing ⇒ disabled); dev/staging fail-open
// (missing ⇒ enabled). See flagDisabled.
//
// RolloutPercent is 0-100 when Found; ignored when missing. Default 100 on
// rows that predate migration 115 is handled by SQL COALESCE / column default.
type featureFlagState struct {
	Found          bool `json:"found"`
	Enabled        bool `json:"enabled"`
	RolloutPercent int  `json:"rollout_percent"`
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
//   - Flag row exists and enabled = true  → call next (feature live), subject
//     to sticky rollout_percent for non-money keys.
//   - Flag row exists and enabled = false → 503.
//   - Flag row MISSING                     → 503 (treat as disabled).
//   - DB error / db == nil                → 503 (treat as disabled).
//   - Money key with rollout_percent ∉ {100} while enabled → 503 (binary-only).
//
// Behavior (development / staging — fail open for missing only):
//   - Flag row exists and enabled = true  → call next (same rollout rules).
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
			subject := rolloutSubjectFromRequest(r)
			if !flagDisabled(r.Context(), db, cacheClient, flagKey, subject) {
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
// return true (disabled). Only an explicit enabled=true row allows traffic
// (plus sticky rollout for non-money keys).
//
// Non-production (fail-open for missing/error): only an explicit enabled=false
// row blocks; missing flags and infra blips allow the request through.
//
// Sticky subject is taken from JWT claims in ctx only (no HTTP headers here).
func IsFeatureDisabled(ctx context.Context, db *pgxpool.Pool, cacheClient *cache.Client, flagKey string) bool {
	return flagDisabled(ctx, db, cacheClient, flagKey, rolloutSubject(ctx))
}

// flagDisabled is the internal implementation; call IsFeatureDisabled from
// handlers and RequireFlag from the router. subject is the sticky identity for
// partial rollout (userID or device); may be empty.
func flagDisabled(ctx context.Context, db *pgxpool.Pool, cacheClient *cache.Client, flagKey, subject string) bool {
	prod := isProductionEnv()
	redisKey := cache.Key(featureFlagPrefix, flagKey)

	// 1. Try the cache.
	if cacheClient != nil {
		var st featureFlagState
		if cacheClient.GetJSON(ctx, redisKey, &st) {
			return evaluateFlagState(st, prod, flagKey, subject)
		}
	}

	// 2. Cache miss — read from Postgres.
	if db == nil {
		if prod {
			slog.Error("feature flag gate: no database configured, failing closed",
				"flag", flagKey,
			)
			recordFlagCheck(flagKey, "blocked_error")
			return true
		}
		recordFlagCheck(flagKey, "allowed_fail_open")
		return false // fail open in non-prod
	}

	var enabled bool
	var rollout int
	err := db.QueryRow(ctx,
		`SELECT enabled, rollout_percent FROM feature_flags WHERE key = $1`, flagKey).
		Scan(&enabled, &rollout)

	st := featureFlagState{}
	switch {
	case err == nil:
		st.Found = true
		st.Enabled = enabled
		st.RolloutPercent = clampRolloutPercent(rollout)
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
			recordFlagCheck(flagKey, "blocked_error")
			return true
		}
		slog.Error("feature flag gate: failed to read flag, failing open",
			"flag", flagKey,
			"error", err,
		)
		recordFlagCheck(flagKey, "allowed_fail_open")
		return false
	}

	if cacheClient != nil {
		cacheClient.SetJSON(ctx, redisKey, st, featureFlagCacheTTL)
	}

	return evaluateFlagState(st, prod, flagKey, subject)
}

// evaluateFlagState applies binary kill-switch, money binary-only, sticky
// rollout, and records the exposure metric.
func evaluateFlagState(st featureFlagState, production bool, flagKey, subject string) bool {
	if interpretFlagState(st, production) {
		if !st.Found {
			recordFlagCheck(flagKey, "blocked_missing")
		} else {
			recordFlagCheck(flagKey, "blocked_disabled")
		}
		return true
	}

	// Missing + fail-open (non-prod): no row → no rollout to apply.
	if !st.Found {
		recordFlagCheck(flagKey, "allowed_fail_open")
		return false
	}

	pct := clampRolloutPercent(st.RolloutPercent)

	// Money / regulated: binary only. Allow solely when fully on (100%).
	if IsBinaryOnlyFlag(flagKey) {
		if pct != 100 {
			slog.Error("feature flag gate: binary-only flag has non-100 rollout_percent, failing closed",
				"flag", flagKey,
				"rollout_percent", pct,
			)
			recordFlagCheck(flagKey, "blocked_partial_money")
			return true
		}
		recordFlagCheck(flagKey, "allowed")
		return false
	}

	// Full open.
	if pct >= 100 {
		recordFlagCheck(flagKey, "allowed")
		return false
	}
	// Explicit zero cohort.
	if pct <= 0 {
		recordFlagCheck(flagKey, "blocked_rollout")
		return true
	}

	if subject == "" {
		// Partial rollout without a sticky identity: fail closed so anonymous
		// traffic cannot all land in the same empty-string bucket.
		recordFlagCheck(flagKey, "blocked_no_subject")
		return true
	}

	if inStickyRollout(subject, flagKey, pct) {
		recordFlagCheck(flagKey, "allowed_rollout")
		return false
	}
	recordFlagCheck(flagKey, "blocked_rollout")
	return true
}

// interpretFlagState maps a cached/loaded flag state to "should block" for the
// binary enabled column only (rollout applied separately in evaluateFlagState).
// production: missing (Found=false) ⇒ disabled; found ⇒ !Enabled.
// non-prod: only Found && !Enabled blocks.
func interpretFlagState(st featureFlagState, production bool) bool {
	if !st.Found {
		return production // fail-closed in prod, fail-open otherwise
	}
	return !st.Enabled
}

// clampRolloutPercent normalizes out-of-range values (corrupt cache / old
// clients) into 0-100.
func clampRolloutPercent(p int) int {
	if p < 0 {
		return 0
	}
	if p > 100 {
		return 100
	}
	return p
}

// rolloutSubject picks a sticky identity from JWT claims. Empty means partial
// rollout cannot proceed safely (fail closed).
func rolloutSubject(ctx context.Context) string {
	if claims, ok := GetClaims(ctx); ok && claims != nil && claims.UserID != "" {
		return claims.UserID
	}
	return ""
}

// rolloutSubjectFromRequest prefers userID from claims, then X-Device-ID.
func rolloutSubjectFromRequest(r *http.Request) string {
	if s := rolloutSubject(r.Context()); s != "" {
		return s
	}
	return r.Header.Get("X-Device-ID")
}

// inStickyRollout returns true when subject is in the [0, percent) cohort for
// flagKey. Hash is SHA256(subject|key) → first 4 bytes → % 100 so assignment
// is stable across pods and restarts (same algorithm as experiment.assignVariant
// but percent is 0-100 buckets, not 0-999).
func inStickyRollout(subject, flagKey string, percent int) bool {
	if percent <= 0 {
		return false
	}
	if percent >= 100 {
		return true
	}
	h := sha256.Sum256([]byte(subject + "|" + flagKey))
	bucket := binary.BigEndian.Uint32(h[:4]) % 100
	return int(bucket) < percent
}

func recordFlagCheck(flagKey, result string) {
	featureFlagChecksTotal.WithLabelValues(flagKey, result).Inc()
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
