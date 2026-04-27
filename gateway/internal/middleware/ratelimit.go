package middleware

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

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
)

const (
	defaultStandardLimit = 60
	defaultStrictLimit   = 10
	// CLAUDE.md §6: 5 attempts / 15 min on auth endpoints.
	defaultAuthLimit = 5

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

	// Auth endpoints (unauthenticated) — auth tier.
	{"/api/v1/auth/register", TierAuth},
	{"/api/v1/auth/login", TierAuth},
	{"/api/v1/auth/refresh", TierAuth},
	{"/api/v1/auth/verify-email", TierAuth},
	{"/api/v1/auth/verify-phone", TierAuth},
	{"/api/v1/auth/reset-password", TierAuth},
	{"/api/v1/auth/mfa/verify", TierAuth},

	// Strict tier — expensive operations.
	{"/api/v1/auth/send-phone-otp", TierStrict},
	{"/api/v1/auth/request-password-reset", TierStrict},
	{"/api/v1/auth/mfa/enable", TierStrict},
	{"/api/v1/auth/mfa/verify-setup", TierStrict},
	{"/api/v1/auth/mfa/disable", TierStrict},
	{"/api/v1/users/me/enable-role", TierStrict},
	{"/api/v1/users/me/deactivate", TierStrict},
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
	for _, rt := range routeTiers {
		if strings.HasPrefix(path, rt.prefix) {
			return rt.tier
		}
	}
	// Default: standard tier for all authenticated routes.
	return TierStandard
}

// --- Rate Limiter (Redis-backed with in-memory fallback) ---

// RateLimiter performs per-IP and per-user rate limiting. When a cache.Client is
// provided, limits are enforced in Redis (distributed). Otherwise it falls back
// to in-memory sliding windows.
type RateLimiter struct {
	cache    *cache.Client
	fallback *memoryLimiter

	standardLimit int
	strictLimit   int
	authLimit     int
}

// NewRateLimiter creates a RateLimiter. Pass nil for cacheClient to use in-memory only.
// When production is false, all rate limits are multiplied by 10 to allow
// comfortable development testing. The authLimitOverride, if > 0, takes
// precedence over the computed auth limit.
func NewRateLimiter(cacheClient *cache.Client, production bool, authLimitOverride int) *RateLimiter {
	stdLimit := defaultStandardLimit
	strictLimit := defaultStrictLimit
	authLimit := defaultAuthLimit

	if !production {
		stdLimit *= devMultiplier
		strictLimit *= devMultiplier
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
		"window", rateLimitWindow,
	)

	return &RateLimiter{
		cache:         cacheClient,
		fallback:      newMemoryLimiter(),
		standardLimit: stdLimit,
		strictLimit:   strictLimit,
		authLimit:     authLimit,
	}
}

func (rl *RateLimiter) limitForTier(tier RateLimitTier) int {
	switch tier {
	case TierStandard:
		return rl.standardLimit
	case TierStrict:
		return rl.strictLimit
	case TierAuth:
		return rl.authLimit
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

func (rl *RateLimiter) allow(key string, limit int, window time.Duration) (bool, int) {
	if rl.cache != nil {
		redisKey := cache.Key("rl", key)
		return rl.cache.RateLimitCheck(context.Background(), redisKey, limit, window)
	}
	return rl.fallback.allow(key, limit, window)
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

		// Per-user check: if the request has authenticated claims, also apply
		// a per-user rate limit (same tier limits). This prevents a single
		// user from consuming the entire IP bucket (e.g., shared office IP).
		if claims, ok := GetClaims(r.Context()); ok && claims.UserID != "" {
			userKey := tierName + ":user:" + claims.UserID
			allowed, retryAfter = rl.allow(userKey, limit, window)
			if !allowed {
				writeRateLimitResponse(w, ip, path, tierName, limit, retryAfter)
				return
			}
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
	default:
		return "none"
	}
}

// extractIP is retained for backward compatibility; it defers to the shared
// trust-aware ClientIP helper.
func extractIP(r *http.Request) string {
	return ClientIP(r)
}
