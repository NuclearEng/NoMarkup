package middleware

import (
	"bufio"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/nomarkup/nomarkup/gateway/internal/observability"
)

type wrappedWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *wrappedWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

// Hijack implements http.Hijacker so WebSocket upgrades work through the logging middleware.
func (w *wrappedWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := w.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
}

// Flush implements http.Flusher for streaming responses.
func (w *wrappedWriter) Flush() {
	if fl, ok := w.ResponseWriter.(http.Flusher); ok {
		fl.Flush()
	}
}

// Logging logs each HTTP request with structured fields.
// It logs at INFO for 2xx/3xx, WARN for 4xx, and ERROR for 5xx.
// When a valid JWT is present, the user_id is included in the log entry.
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// RequestID runs earlier in the chain and is the single source of truth:
		// it seeds the context so handlers and downstream services share this id.
		// The fallback keeps Logging usable standalone (and in its own tests).
		requestID := observability.RequestIDFromContext(r.Context())
		if requestID == "" {
			requestID = observability.SanitizeRequestID(r.Header.Get(observability.HeaderRequestID))
			if requestID == "" {
				requestID = observability.NewRequestID()
			}
			r = r.WithContext(observability.ContextWithRequestID(r.Context(), requestID))
		}

		wrapped := &wrappedWriter{ResponseWriter: w, statusCode: http.StatusOK}
		wrapped.Header().Set(observability.HeaderRequestID, requestID)

		next.ServeHTTP(wrapped, r)

		duration := time.Since(start)
		attrs := []any{
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.statusCode,
			"duration_ms", duration.Milliseconds(),
			"request_id", requestID,
			"remote_addr", r.RemoteAddr,
		}

		if q := redactQuery(r.URL.RawQuery); q != "" {
			attrs = append(attrs, "query", q)
		}

		if claims, ok := GetClaims(r.Context()); ok {
			attrs = append(attrs, "user_id", claims.UserID)
		}

		switch {
		case wrapped.statusCode >= 500:
			slog.ErrorContext(r.Context(), "request", attrs...)
		case wrapped.statusCode >= 400:
			slog.WarnContext(r.Context(), "request", attrs...)
		default:
			slog.InfoContext(r.Context(), "request", attrs...)
		}
	})
}
