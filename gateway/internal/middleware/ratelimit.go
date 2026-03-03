package middleware

import "net/http"

// RateLimit provides per-IP and per-user rate limiting using a Redis-backed
// token bucket algorithm.
func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// TODO: Implement token bucket with Redis backend
		// - Per-IP: 100 requests/minute general, 5/15min for auth endpoints
		// - Per-User: 1000 requests/minute authenticated
		// - Return 429 with Retry-After header when exceeded
		next.ServeHTTP(w, r)
	})
}
