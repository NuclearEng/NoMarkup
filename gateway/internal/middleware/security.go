package middleware

import (
	"net/http"
)

// SecurityHeaders adds security-related HTTP headers to every response.
// When production is true, it additionally sets Strict-Transport-Security (HSTS).
func SecurityHeaders(production bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()

			// Content-Security-Policy: restrict resource loading to same origin with
			// specific exceptions for inline styles, data/blob images from S3, and WSS.
			h.Set("Content-Security-Policy",
				"default-src 'self'; "+
					"script-src 'self'; "+
					"style-src 'self' 'unsafe-inline'; "+
					"img-src 'self' data: blob: *.amazonaws.com; "+
					"connect-src 'self' wss:; "+
					"frame-ancestors 'none'")

			// Prevent MIME-type sniffing.
			h.Set("X-Content-Type-Options", "nosniff")

			// Prevent clickjacking.
			h.Set("X-Frame-Options", "DENY")

			// Disable legacy XSS auditor (CSP handles this in modern browsers).
			h.Set("X-XSS-Protection", "0")

			// Control referrer information leakage.
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")

			// Restrict access to browser features.
			h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")

			// HSTS: only set in production to avoid issues with local development.
			if production {
				h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
			}

			next.ServeHTTP(w, r)
		})
	}
}
