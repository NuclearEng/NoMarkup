package middleware

import (
	"log/slog"
	"net/http"
	"time"

	"crypto/rand"
	"encoding/hex"
)

type wrappedWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *wrappedWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

// Logging logs each HTTP request with structured fields.
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			b := make([]byte, 8)
			_, _ = rand.Read(b)
			requestID = hex.EncodeToString(b)
		}

		wrapped := &wrappedWriter{ResponseWriter: w, statusCode: http.StatusOK}
		wrapped.Header().Set("X-Request-ID", requestID)

		next.ServeHTTP(wrapped, r)

		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.statusCode,
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", requestID,
			"remote_addr", r.RemoteAddr,
		)
	})
}
