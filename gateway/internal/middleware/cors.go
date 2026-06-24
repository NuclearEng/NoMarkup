package middleware

import (
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/cors"
)

// isLocalDevOrigin reports whether o looks like a typical local dev server origin.
// Used to be forgiving in non-production so that loading the web UI as
// http://127.0.0.1:3000 (or ::1, custom port, etc) still works for API calls
// even if ALLOWED_ORIGINS was set for "localhost".
func isLocalDevOrigin(o string) bool {
	u, err := url.Parse(o)
	if err != nil || u.Scheme == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]"
}

// CORS returns middleware that handles Cross-Origin Resource Sharing.
// When production is true, wildcard origins ("*") are rejected and a warning is logged;
// only explicitly listed origins are allowed. Credentials (cookies, authorization headers)
// are always supported so that JWT refresh via HTTP-only cookies works correctly.
func CORS(allowedOrigins []string, production bool) func(http.Handler) http.Handler {
	if production {
		filtered := make([]string, 0, len(allowedOrigins))
		for _, origin := range allowedOrigins {
			if origin == "*" {
				slog.Error("wildcard CORS origin rejected in production — configure ALLOWED_ORIGINS explicitly")
				continue
			}
			filtered = append(filtered, origin)
		}
		if len(filtered) == 0 {
			slog.Error("no valid CORS origins configured in production — all cross-origin requests will be blocked")
		}
		allowedOrigins = filtered
	}

	// In development, be generous with local origins so that direct cross-origin
	// fetches (when NEXT_PUBLIC_API_URL points at the gateway) succeed even if the
	// developer loaded the web UI using 127.0.0.1, a different port, or IPv6.
	// This prevents the "Fetch API cannot load ... due to access control checks"
	// errors on notifications, bids, etc.
	opts := cors.Options{
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}

	if production || len(allowedOrigins) == 0 {
		opts.AllowedOrigins = allowedOrigins
	} else {
		// Non-prod: use a dynamic func so we echo the exact Origin the browser sent
		// when it is a safe local variant.
		hasLocal := false
		for _, o := range allowedOrigins {
			if isLocalDevOrigin(o) {
				hasLocal = true
				break
			}
		}
		opts.AllowOriginFunc = func(r *http.Request, origin string) bool {
			// Exact match against configured list (the normal path)
			for _, o := range allowedOrigins {
				if o == origin {
					return true
				}
			}
			// Dev convenience: if we were configured for any localhost dev server,
			// also allow other common local representations.
			if hasLocal && isLocalDevOrigin(origin) {
				return true
			}
			return false
		}
	}

	return cors.Handler(opts)
}
