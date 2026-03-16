package middleware

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

const (
	// defaultGeneralRateLimit is the maximum number of requests per minute for general endpoints.
	defaultGeneralRateLimit = 100
	// defaultAuthRateLimit is the maximum number of requests per minute for auth endpoints (production).
	defaultAuthRateLimit = 10
	// devAuthRateLimit is the more permissive auth rate limit for development environments.
	devAuthRateLimit = 100
	// rateLimitWindow is the duration of the sliding window.
	rateLimitWindow = 1 * time.Minute
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

func (ml *memoryLimiter) allow(key string, limit int) (bool, int) {
	now := time.Now()
	cutoff := now.Add(-rateLimitWindow)

	val, _ := ml.entries.LoadOrStore(key, &rateLimitEntry{})
	entry := val.(*rateLimitEntry)

	entry.mu.Lock()
	defer entry.mu.Unlock()

	entry.timestamps = pruneOld(entry.timestamps, cutoff)

	if len(entry.timestamps) >= limit {
		oldest := entry.timestamps[0]
		retryAfter := int(oldest.Add(rateLimitWindow).Sub(now).Seconds()) + 1
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

// --- Rate Limiter (Redis-backed with in-memory fallback) ---

// RateLimiter performs per-IP rate limiting. When a cache.Client is provided,
// limits are enforced in Redis (distributed). Otherwise falls back to in-memory.
type RateLimiter struct {
	cache            *cache.Client
	fallback         *memoryLimiter
	generalRateLimit int
	authRateLimit    int
}

// NewRateLimiter creates a RateLimiter. Pass nil for cacheClient to use in-memory only.
// When production is false, auth rate limits are 10x more permissive to allow
// multi-profile testing in development. The authLimitOverride, if > 0, takes
// precedence over the default/dev values (set via RATE_LIMIT_AUTH env var).
func NewRateLimiter(cacheClient *cache.Client, production bool, authLimitOverride int) *RateLimiter {
	authLimit := defaultAuthRateLimit
	if !production {
		authLimit = devAuthRateLimit
	}
	if authLimitOverride > 0 {
		authLimit = authLimitOverride
	}

	slog.Info("rate limiter initialized",
		"production", production,
		"general_limit", defaultGeneralRateLimit,
		"auth_limit", authLimit,
		"window", rateLimitWindow,
	)

	return &RateLimiter{
		cache:            cacheClient,
		fallback:         newMemoryLimiter(),
		generalRateLimit: defaultGeneralRateLimit,
		authRateLimit:    authLimit,
	}
}

func (rl *RateLimiter) allow(key string, limit int) (bool, int) {
	if rl.cache != nil {
		redisKey := cache.Key("rl", key)
		return rl.cache.RateLimitCheck(context.Background(), redisKey, limit, rateLimitWindow)
	}
	return rl.fallback.allow(key, limit)
}

// Middleware returns an http.Handler middleware that enforces rate limits.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := extractIP(r)
		path := r.URL.Path

		limit := rl.generalRateLimit
		key := "general:" + ip
		if isAuthPath(path) {
			limit = rl.authRateLimit
			key = "auth:" + ip
		}

		allowed, retryAfter := rl.allow(key, limit)
		if !allowed {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"rate limit exceeded"}`))

			slog.Warn("rate limit exceeded",
				"ip", ip,
				"path", path,
				"limit", limit,
				"retry_after", retryAfter,
			)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// extractIP extracts the client IP address from the request.
func extractIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if ip := strings.TrimSpace(strings.SplitN(xff, ",", 2)[0]); ip != "" {
			return ip
		}
	}

	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func isAuthPath(path string) bool {
	return strings.HasPrefix(path, "/api/v1/auth")
}
