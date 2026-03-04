package middleware

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	// generalRateLimit is the maximum number of requests per minute for general endpoints.
	generalRateLimit = 100
	// authRateLimit is the maximum number of requests per minute for auth endpoints.
	authRateLimit = 10
	// rateLimitWindow is the duration of the sliding window.
	rateLimitWindow = 1 * time.Minute
	// cleanupInterval is how often stale entries are removed from the map.
	cleanupInterval = 5 * time.Minute
)

// rateLimitEntry tracks request timestamps for a single IP within a sliding window.
type rateLimitEntry struct {
	mu         sync.Mutex
	timestamps []time.Time
}

// rateLimiter manages per-IP rate limiting with periodic cleanup of stale entries.
type rateLimiter struct {
	entries sync.Map // map[string]*rateLimitEntry
	stopCh  chan struct{}
}

// newRateLimiter creates a rateLimiter and starts a background goroutine to clean up
// stale entries every cleanupInterval.
func newRateLimiter() *rateLimiter {
	rl := &rateLimiter{
		stopCh: make(chan struct{}),
	}
	go rl.cleanup()
	return rl
}

// cleanup removes entries that have had no requests within the last rateLimitWindow.
// It runs every cleanupInterval until stopCh is closed.
func (rl *rateLimiter) cleanup() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			now := time.Now()
			cutoff := now.Add(-rateLimitWindow)
			var removed int

			rl.entries.Range(func(key, value any) bool {
				entry := value.(*rateLimitEntry)
				entry.mu.Lock()
				// Remove timestamps older than the window.
				entry.timestamps = pruneOld(entry.timestamps, cutoff)
				empty := len(entry.timestamps) == 0
				entry.mu.Unlock()

				if empty {
					rl.entries.Delete(key)
					removed++
				}
				return true
			})

			if removed > 0 {
				slog.Debug("rate limiter cleanup", "removed_entries", removed)
			}
		case <-rl.stopCh:
			return
		}
	}
}

// allow checks whether the given key is allowed to make a request given the limit
// within the rateLimitWindow. It returns true if allowed, false if rate-limited,
// along with the number of seconds until the client can retry.
func (rl *rateLimiter) allow(key string, limit int) (bool, int) {
	now := time.Now()
	cutoff := now.Add(-rateLimitWindow)

	val, _ := rl.entries.LoadOrStore(key, &rateLimitEntry{})
	entry := val.(*rateLimitEntry)

	entry.mu.Lock()
	defer entry.mu.Unlock()

	// Prune timestamps outside the current window.
	entry.timestamps = pruneOld(entry.timestamps, cutoff)

	if len(entry.timestamps) >= limit {
		// Calculate Retry-After: time until the oldest request in the window expires.
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

// pruneOld removes all timestamps before the cutoff.
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

// extractIP extracts the client IP address from the request.
// It checks X-Forwarded-For and X-Real-IP headers first (for proxied requests),
// then falls back to RemoteAddr.
func extractIP(r *http.Request) string {
	// Check X-Forwarded-For first (may contain multiple IPs: client, proxy1, proxy2).
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first (leftmost) IP, which is the original client.
		if ip := strings.TrimSpace(strings.SplitN(xff, ",", 2)[0]); ip != "" {
			return ip
		}
	}

	// Check X-Real-IP.
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}

	// Fall back to RemoteAddr, stripping the port.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		// RemoteAddr might not have a port (unlikely but handle it).
		return r.RemoteAddr
	}
	return host
}

// isAuthPath returns true if the request path is an auth endpoint that should
// receive stricter rate limiting.
func isAuthPath(path string) bool {
	return strings.HasPrefix(path, "/api/v1/auth")
}

// globalLimiter is the package-level rate limiter instance. It is initialized once
// and shared by the RateLimit middleware.
var globalLimiter = newRateLimiter()

// RateLimit provides per-IP rate limiting using a sliding window approach.
// Auth endpoints (/api/v1/auth/*) are limited to 10 requests/minute.
// All other endpoints are limited to 100 requests/minute.
// Returns 429 Too Many Requests with a Retry-After header when exceeded.
func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := extractIP(r)
		path := r.URL.Path

		limit := generalRateLimit
		key := "general:" + ip
		if isAuthPath(path) {
			limit = authRateLimit
			key = "auth:" + ip
		}

		allowed, retryAfter := globalLimiter.allow(key, limit)
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
