package middleware

import (
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	httpRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests.",
		},
		[]string{"method", "path", "status"},
	)

	httpRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "Duration of HTTP requests in seconds.",
			Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
		},
		[]string{"method", "path"},
	)

	// uuidPattern matches UUIDs (v4, v7, etc.) in URL path segments.
	uuidPattern = regexp.MustCompile(
		`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`,
	)

	// numericIDPattern matches purely numeric IDs in path segments.
	numericIDPattern = regexp.MustCompile(`/\d+(/|$)`)
)

// normalizePath replaces UUIDs and numeric IDs in URL paths with "{id}"
// to prevent high-cardinality label values in Prometheus metrics.
func normalizePath(path string) string {
	path = uuidPattern.ReplaceAllString(path, "{id}")
	path = numericIDPattern.ReplaceAllStringFunc(path, func(match string) string {
		if match[len(match)-1] == '/' {
			return "/{id}/"
		}
		return "/{id}"
	})
	return path
}

// metricsWriter wraps http.ResponseWriter to capture the status code for metrics.
type metricsWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *metricsWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

// Metrics records Prometheus metrics for each HTTP request.
func Metrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		wrapped := &metricsWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)

		normalizedPath := normalizePath(r.URL.Path)
		duration := time.Since(start).Seconds()
		status := strconv.Itoa(wrapped.statusCode)

		httpRequestsTotal.WithLabelValues(r.Method, normalizedPath, status).Inc()
		httpRequestDuration.WithLabelValues(r.Method, normalizedPath).Observe(duration)
	})
}
