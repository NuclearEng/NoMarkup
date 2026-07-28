package middleware

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

// RateLimitTier defines the rate-limiting tier for a route.
type RateLimitTier int

const (
	// TierNone disables rate limiting (health, readiness).
	TierNone RateLimitTier = iota
	// TierStandard is the default for authenticated routes (60 req/min).
	TierStandard
	// TierStrict is for expensive operations (10 req/min).
	TierStrict
	// TierAuth is for unauthenticated auth endpoints (20 req/min).
	TierAuth
	// TierPublicRead is for expensive UNAUTHENTICATED public reads — the
	// Meilisearch-backed catalog autocomplete + search. These take no auth, so
	// the per-IP limit is the only abuse defense; they're throttled below the
	// standard tier so they can't be hammered freely, but kept generous enough
	// for legitimate anonymous browse / search-as-you-type (30 req/min).
	TierPublicRead
)

const (
	defaultStandardLimit = 60
	defaultStrictLimit   = 10
	// CLAUDE.md §6: 5 attempts / 15 min on auth endpoints.
	defaultAuthLimit = 5
	// defaultPublicReadLimit caps expensive unauthenticated Meili-backed reads
	// (autocomplete + catalog search) per IP. Below standard (60) so they can't
	// be hammered freely, above strict (10) so anonymous browse still feels open.
	defaultPublicReadLimit = 30

	// Development multiplier for STANDARD/STRICT tiers only — auth is never
	// inflated in dev so brute-force-style tests behave like prod.
	devMultiplier = 10

	// rateLimitWindow is the sliding window for the standard/strict tiers.
	rateLimitWindow = 1 * time.Minute
	// authRateLimitWindow is the sliding window for the auth tier.
	authRateLimitWindow = 15 * time.Minute
	// cleanupInterval is how often stale entries are removed from the in-memory fallback map.
	cleanupInterval = 5 * time.Minute
)

// --- Degraded-mode observability (SEC-05) ---

var (
	// rateLimitFallbackTotal counts requests whose limit decision came from the
	// per-pod in-memory limiter instead of the shared Redis window.
	//
	// This metric is the point of the fix as much as the fallback is: before it,
	// a Redis outage disabled every tier — including TierAuth's 5-attempts/15-min
	// brute-force defense — and the only trace was a slog.Warn per request. There
	// is no compensating DB-level lockout (the users table has no failed-attempt
	// or locked_until columns), so a silent disablement is a silent removal of
	// the only credential-stuffing defense. Alert on any sustained non-zero rate.
	rateLimitFallbackTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "rate_limit_fallback_total",
			Help: "Rate limit decisions served by the in-memory fallback instead of Redis, by reason.",
		},
		[]string{"reason", "tier"},
	)

	// rateLimitBackendDegraded is 1 while the shared Redis window is unusable
	// and 0 once a check succeeds again, so a dashboard shows the current state
	// rather than only the rate of change.
	rateLimitBackendDegraded = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "rate_limit_backend_degraded",
			Help: "1 when rate limiting has fallen back to per-pod in-memory windows, 0 when Redis is authoritative.",
		},
	)
)

// fallbackReason labels for rateLimitFallbackTotal.
const (
	// reasonNoBackend: Redis was absent at boot (dev, or REDIS_URL unset).
	reasonNoBackend = "no_backend"
	// reasonBackendError: Redis was present at boot and failed at runtime.
	// This is the case that used to fail open.
	reasonBackendError = "backend_error"
)

// fallbackLogInterval throttles the degraded-mode log line. Under a Redis
// outage every single request takes this path; logging each one would push the
// signal out of the log pipeline exactly when it is most needed.
const fallbackLogInterval = 10 * time.Second

// --- In-memory fallback (used when Redis is unavailable) ---

type rateLimitEntry struct {
	mu         sync.Mutex
	timestamps []time.Time
}

type memoryLimiter struct {
	entries sync.Map
	stopCh  chan struct{}
}

func newMemoryLimiter() *memoryLimiter {
	ml := &memoryLimiter{stopCh: make(chan struct{})}
	go ml.cleanup()
	return ml
}

func (ml *memoryLimiter) cleanup() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			now := time.Now()
			cutoff := now.Add(-rateLimitWindow)
			var removed int

			ml.entries.Range(func(key, value any) bool {
				entry := value.(*rateLimitEntry)
				entry.mu.Lock()
				entry.timestamps = pruneOld(entry.timestamps, cutoff)
				empty := len(entry.timestamps) == 0
				entry.mu.Unlock()

				if empty {
					ml.entries.Delete(key)
					removed++
				}
				return true
			})

			if removed > 0 {
				slog.Debug("rate limiter cleanup", "removed_entries", removed)
			}
		case <-ml.stopCh:
			return
		}
	}
}

func (ml *memoryLimiter) allow(key string, limit int, window time.Duration) (bool, int) {
	now := time.Now()
	cutoff := now.Add(-window)

	val, _ := ml.entries.LoadOrStore(key, &rateLimitEntry{})
	entry := val.(*rateLimitEntry)

	entry.mu.Lock()
	defer entry.mu.Unlock()

	entry.timestamps = pruneOld(entry.timestamps, cutoff)

	if len(entry.timestamps) >= limit {
		oldest := entry.timestamps[0]
		retryAfter := int(oldest.Add(window).Sub(now).Seconds()) + 1
		if retryAfter < 1 {
			retryAfter = 1
		}
		return false, retryAfter
	}

	entry.timestamps = append(entry.timestamps, now)
	return true, 0
}

func pruneOld(timestamps []time.Time, cutoff time.Time) []time.Time {
	idx := 0
	for _, ts := range timestamps {
		if ts.After(cutoff) {
			timestamps[idx] = ts
			idx++
		}
	}
	return timestamps[:idx]
}

// --- Route-to-Tier mapping ---

// routeTiers maps path prefixes to their rate limit tier.
// Entries are checked in order; the first match wins.
var routeTiers = []struct {
	prefix string
	tier   RateLimitTier
}{
	// Health endpoints — no limiting.
	{"/healthz", TierNone},
	{"/readyz", TierNone},

	// Auth endpoints (unauthenticated) — auth tier (5/15min, abuse defense).
	// NOTE: /auth/refresh is NOT here — it's called on every page navigation
	// by AuthRestorer, so it gets the standard tier instead. Brute-forcing
	// refresh tokens directly would require already having a stolen
	// refresh-token cookie, which is itself an HttpOnly compromise.
	//
	// SEC-06: register-phone, resend-verification, and OAuth init/callback
	// paths are also auth-tier. Prefix "/api/v1/auth/register" already covers
	// register-phone; listed explicitly for clarity.
	{"/api/v1/auth/register", TierAuth},
	{"/api/v1/auth/register-phone", TierAuth},
	{"/api/v1/auth/login", TierAuth},
	{"/api/v1/auth/verify-email", TierAuth},
	{"/api/v1/auth/verify-phone", TierAuth},
	{"/api/v1/auth/reset-password", TierAuth},
	{"/api/v1/auth/resend-verification", TierAuth},
	{"/api/v1/auth/mfa/verify", TierAuth},
	// OAuth init + callback endpoints are unauthenticated entry points and
	// must not share the default standard bucket with authed traffic.
	{"/api/v1/auth/oauth/", TierAuth},
	{"/api/v1/auth/callback/", TierAuth},
	// Native OAuth token exchange (SIWA / Google id_token → JWT pair).
	{"/api/v1/auth/apple/native", TierAuth},
	{"/api/v1/auth/google/native", TierAuth},
	// Passkey assertion (unauthenticated login surface, IOS-SEC.2) — same
	// abuse posture as /login. Covers both /assert/options and
	// /assert/verify. The register/* endpoints are authed and stay on the
	// standard tier.
	{"/api/v1/auth/passkeys/assert", TierAuth},

	// Public-read tier — expensive UNAUTHENTICATED Meilisearch-backed catalog
	// reads. These must precede any broader "/api/v1/listings" handling and the
	// default standard tier so they can't be hammered for free. The bare
	// "/api/v1/listings" SEARCH is matched exactly in tierForPath (a prefix here
	// would wrongly catch the cheap "/api/v1/listings/{id}" detail read + bid
	// POSTs). The cheap cached reads (markets, legal/categories) intentionally
	// stay on the standard tier — they're DATA-layer cached (CLAUDE.md §14) and
	// not worth over-throttling.
	{"/api/v1/listings/autocomplete", TierPublicRead},

	// Strict tier — expensive operations.
	{"/api/v1/auth/send-phone-otp", TierStrict},
	{"/api/v1/auth/request-password-reset", TierStrict},
	{"/api/v1/auth/mfa/enable", TierStrict},
	{"/api/v1/auth/mfa/verify-setup", TierStrict},
	{"/api/v1/auth/mfa/disable", TierStrict},
	{"/api/v1/users/me/enable-role", TierStrict},
	{"/api/v1/users/me/deactivate", TierStrict},
	// GDPR data export fans out ~19 owner-scoped queries — throttle it so a
	// caller can't hammer the full-account read on a loop.
	{"/api/v1/users/me/export", TierStrict},
	{"/api/v1/verification/documents", TierStrict},
	{"/api/v1/admin/", TierStrict},
	{"/api/v1/bids/", TierStrict},
	{"/api/v1/payments", TierStrict},
	{"/api/v1/contracts/", TierStrict},
	{"/api/v1/reviews", TierStrict},
	{"/api/v1/subscriptions", TierStrict},
}

// tierForPath returns the rate limit tier for a given request path.
func tierForPath(path string) RateLimitTier {
	// Exact-path tiers come first: the bare "/api/v1/listings" catalog SEARCH is
	// Meilisearch-backed and unauthenticated, but it shares its prefix with the
	// cheap "/api/v1/listings/{id}" detail read and the bid/offer POSTs — so it
	// must be matched exactly, not by prefix, to avoid over-throttling those.
	if path == "/api/v1/listings" {
		return TierPublicRead
	}
	for _, rt := range routeTiers {
		if strings.HasPrefix(path, rt.prefix) {
			return rt.tier
		}
	}
	// Default: standard tier for all authenticated routes.
	return TierStandard
}

// --- Rate Limiter (Redis-backed with in-memory fallback) ---

// rateLimitBackend is the shared, cross-pod sliding window. Satisfied by
// *cache.Client; an interface so the degraded path is testable without a live
// Redis.
type rateLimitBackend interface {
	RateLimitCheckErr(ctx context.Context, key string, limit int, window time.Duration) (bool, int, error)
}

// RateLimiter performs per-IP and per-user rate limiting. When a cache.Client is
// provided, limits are enforced in Redis (distributed). Otherwise — and whenever
// Redis fails at runtime — it falls back to in-memory sliding windows.
type RateLimiter struct {
	cache    rateLimitBackend
	fallback *memoryLimiter

	// lastFallbackLog is a unix-nano timestamp used to throttle the degraded
	// mode log line. Atomic: allow() runs on every request goroutine.
	lastFallbackLog atomic.Int64

	standardLimit   int
	strictLimit     int
	authLimit       int
	publicReadLimit int
}

// NewRateLimiter creates a RateLimiter. Pass nil for cacheClient to use in-memory only.
// When production is false, all rate limits are multiplied by 10 to allow
// comfortable development testing. The authLimitOverride, if > 0, takes
// precedence over the computed auth limit.
func NewRateLimiter(cacheClient *cache.Client, production bool, authLimitOverride int) *RateLimiter {
	stdLimit := defaultStandardLimit
	strictLimit := defaultStrictLimit
	authLimit := defaultAuthLimit
	publicReadLimit := defaultPublicReadLimit

	if !production {
		stdLimit *= devMultiplier
		strictLimit *= devMultiplier
		publicReadLimit *= devMultiplier
		// Auth tier does NOT get the dev multiplier — abuse-defense tests
		// (CLAUDE.md: 5 attempts/15 min) need to behave like prod even in dev.
	}

	if authLimitOverride > 0 {
		authLimit = authLimitOverride
	}

	slog.Info("rate limiter initialized",
		"production", production,
		"standard_limit", stdLimit,
		"strict_limit", strictLimit,
		"auth_limit", authLimit,
		"public_read_limit", publicReadLimit,
		"window", rateLimitWindow,
	)

	rl := &RateLimiter{
		fallback:        newMemoryLimiter(),
		standardLimit:   stdLimit,
		strictLimit:     strictLimit,
		authLimit:       authLimit,
		publicReadLimit: publicReadLimit,
	}
	// Guard the typed-nil trap: assigning a nil *cache.Client to the interface
	// field would make `rl.cache != nil` true forever.
	if cacheClient != nil {
		rl.cache = cacheClient
	} else {
		rateLimitBackendDegraded.Set(1)
	}

	return rl
}

func (rl *RateLimiter) limitForTier(tier RateLimitTier) int {
	switch tier {
	case TierStandard:
		return rl.standardLimit
	case TierStrict:
		return rl.strictLimit
	case TierAuth:
		return rl.authLimit
	case TierPublicRead:
		return rl.publicReadLimit
	default:
		return 0 // TierNone — no limiting
	}
}

// windowForTier returns the sliding window duration for a tier. Auth tier
// uses a 15-minute window per CLAUDE.md §6 (account-lockout policy);
// other tiers use the standard 1-minute window.
func windowForTier(tier RateLimitTier) time.Duration {
	if tier == TierAuth {
		return authRateLimitWindow
	}
	return rateLimitWindow
}

// allow resolves one rate-limit decision, preferring the shared Redis window
// and degrading to the per-pod in-memory window.
//
// SEC-05: this used to consult rl.fallback ONLY when rl.cache was nil — i.e.
// only when Redis was missing AT BOOT. A Redis that died later left the
// fallback unreachable while cache.RateLimitCheck returned "allowed" on every
// pipeline error, so an outage silently removed rate limiting from every tier,
// TierAuth included. There is no DB-level account lockout behind it.
//
// The fallback is per-pod, so N gateway replicas enforce N x the intended
// limit. That is a real weakening and is why it is counted and alerted on —
// but N x 5 login attempts per 15 minutes is still a bounded brute-force
// budget, whereas failing open is an unbounded one.
func (rl *RateLimiter) allow(key string, limit int, window time.Duration) (bool, int) {
	if rl.cache == nil {
		rateLimitFallbackTotal.WithLabelValues(reasonNoBackend, tierLabelFromKey(key)).Inc()
		return rl.fallback.allow(key, limit, window)
	}

	redisKey := cache.Key("rl", key)
	allowed, retryAfter, err := rl.cache.RateLimitCheckErr(context.Background(), redisKey, limit, window)
	if err == nil {
		rateLimitBackendDegraded.Set(0)
		return allowed, retryAfter
	}

	tier := tierLabelFromKey(key)
	rateLimitFallbackTotal.WithLabelValues(reasonBackendError, tier).Inc()
	rateLimitBackendDegraded.Set(1)
	rl.logFallback(tier, err)

	return rl.fallback.allow(key, limit, window)
}

// logFallback emits at most one degraded-mode log line per
// fallbackLogInterval, so an outage is visible without flooding the pipeline.
func (rl *RateLimiter) logFallback(tier string, err error) {
	now := time.Now().UnixNano()
	last := rl.lastFallbackLog.Load()
	if now-last < int64(fallbackLogInterval) {
		return
	}
	if !rl.lastFallbackLog.CompareAndSwap(last, now) {
		return // another goroutine just logged it
	}

	slog.Error("rate limit backend unavailable, falling back to per-pod in-memory limits",
		"tier", tier,
		"error", err,
		"unavailable", errors.Is(err, cache.ErrRateLimitUnavailable),
		"impact", "limits are enforced per gateway pod, not cluster-wide",
	)
}

// tierLabelFromKey recovers the tier from a rate-limit key
// ("<tier>:ip:<addr>" / "<tier>:user:<id>") for metric labelling. Cardinality
// is bounded by tierString's fixed set.
func tierLabelFromKey(key string) string {
	if idx := strings.Index(key, ":"); idx > 0 {
		return key[:idx]
	}
	return "unknown"
}

// Middleware returns an http.Handler middleware that enforces rate limits.
// It applies per-IP rate limiting to all requests, and additionally per-user
// rate limiting when a JWT user ID is available in the request context.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		tier := tierForPath(path)

		// TierNone — no rate limiting.
		if tier == TierNone {
			next.ServeHTTP(w, r)
			return
		}

		limit := rl.limitForTier(tier)
		window := windowForTier(tier)
		ip := ClientIP(r)
		tierName := tierString(tier)

		// Per-IP check.
		ipKey := tierName + ":ip:" + ip
		allowed, retryAfter := rl.allow(ipKey, limit, window)
		if !allowed {
			writeRateLimitResponse(w, ip, path, tierName, limit, retryAfter)
			return
		}

		// NOTE: the per-user check is deliberately NOT here. This middleware is
		// registered with r.Use() on the top-level mux, which chi runs BEFORE
		// any per-route auth middleware — so GetClaims would always miss and
		// the branch would be dead code. Per-user limiting lives in
		// UserMiddleware, applied inside the authenticated route groups.
		next.ServeHTTP(w, r)
	})
}

// UserMiddleware enforces the per-user half of the rate limit. It MUST be
// mounted after the auth middleware that populates claims — mounting it before
// makes it silently inert.
//
// This exists separately from Middleware because the IP limiter runs on the
// top-level mux (it must cover unauthenticated routes such as /auth/login,
// which is the one that most needs it) while claims only exist inside the
// authenticated groups. Previously both checks lived in Middleware, so the
// per-user bucket — whose stated purpose is stopping one account from
// consuming the whole IP allowance on a shared office or CGNAT address —
// never ran at all.
//
// A request with no claims is passed through untouched: the IP limiter has
// already covered it, and this middleware is not an authentication gate.
func (rl *RateLimiter) UserMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		tier := tierForPath(path)
		if tier == TierNone {
			next.ServeHTTP(w, r)
			return
		}

		claims, ok := GetClaims(r.Context())
		if !ok || claims.UserID == "" {
			next.ServeHTTP(w, r)
			return
		}

		limit := rl.limitForTier(tier)
		window := windowForTier(tier)
		tierName := tierString(tier)

		userKey := tierName + ":user:" + claims.UserID
		if allowed, retryAfter := rl.allow(userKey, limit, window); !allowed {
			writeRateLimitResponse(w, ClientIP(r), path, tierName, limit, retryAfter)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func writeRateLimitResponse(w http.ResponseWriter, ip, path, tier string, limit, retryAfter int) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write([]byte(`{"error":"rate limit exceeded"}`))

	slog.Warn("rate limit exceeded",
		"ip", ip,
		"path", path,
		"tier", tier,
		"limit", limit,
		"retry_after", retryAfter,
	)
}

func tierString(tier RateLimitTier) string {
	switch tier {
	case TierStandard:
		return "standard"
	case TierStrict:
		return "strict"
	case TierAuth:
		return "auth"
	case TierPublicRead:
		return "public_read"
	default:
		return "none"
	}
}

// extractIP is retained for backward compatibility; it defers to the shared
// trust-aware ClientIP helper.
func extractIP(r *http.Request) string {
	return ClientIP(r)
}
