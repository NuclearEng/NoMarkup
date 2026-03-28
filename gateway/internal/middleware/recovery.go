package middleware

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/getsentry/sentry-go"
)

// Recovery catches panics, reports them to Sentry, and returns a 500 error
// instead of crashing. When Sentry is not initialized (no DSN set), the
// reporting calls are no-ops.
func Recovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				// Report to Sentry. Prefer the hub attached to the request
				// context (set by sentryhttp middleware) so that request data
				// is included in the event. Fall back to the current hub.
				if hub := sentry.GetHubFromContext(r.Context()); hub != nil {
					hub.RecoverWithContext(r.Context(), rec)
				} else {
					sentry.CurrentHub().Recover(rec)
				}

				slog.Error("panic recovered",
					"error", rec,
					"stack", string(debug.Stack()),
					"method", r.Method,
					"path", r.URL.Path,
				)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":"internal server error"}`))
			}
		}()
		next.ServeHTTP(w, r)
	})
}
