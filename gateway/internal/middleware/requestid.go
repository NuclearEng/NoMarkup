package middleware

import (
	"context"
	"net/http"

	"github.com/nomarkup/nomarkup/gateway/internal/observability"
)

// RequestID resolves the correlation id for the request and puts it on the
// request context, the response header, and (via observability.ContextHandler)
// every context-aware slog record emitted downstream.
//
// A client-supplied X-Request-ID is honoured so an edge proxy or the web app
// can stitch its own logs to ours, but it is sanitized first — an unbounded or
// non-printable header value would otherwise be echoed into every log line.
//
// This middleware must run before Tracing and Logging so both can read the id.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := observability.SanitizeRequestID(r.Header.Get(observability.HeaderRequestID))
		if id == "" {
			id = observability.NewRequestID()
		}

		w.Header().Set(observability.HeaderRequestID, id)
		next.ServeHTTP(w, r.WithContext(observability.ContextWithRequestID(r.Context(), id)))
	})
}

// GetRequestID returns the correlation id for ctx, or "" when the request did
// not pass through RequestID. Handlers use it for explicit log fields and for
// error envelopes that ask the user to quote an id in a support ticket.
func GetRequestID(ctx context.Context) string {
	return observability.RequestIDFromContext(ctx)
}
