package middleware

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/cors"
)

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

	return cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	})
}
