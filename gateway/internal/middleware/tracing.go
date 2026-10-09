package middleware

import (
	"bufio"
	"fmt"
	"net"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/nomarkup/nomarkup/gateway/internal/observability"
)

// tracerName identifies the instrumentation scope for gateway HTTP spans.
const tracerName = "github.com/nomarkup/nomarkup/gateway"

// tracingWriter captures the status code for the server span while preserving
// the Hijacker/Flusher pass-through the WebSocket upgrade routes depend on.
type tracingWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *tracingWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

// Hijack implements http.Hijacker so WebSocket upgrades work through the tracing middleware.
func (w *tracingWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := w.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
}

// Flush implements http.Flusher for streaming responses.
func (w *tracingWriter) Flush() {
	if fl, ok := w.ResponseWriter.(http.Flusher); ok {
		fl.Flush()
	}
}

// Tracing opens the inbound HTTP server span that roots every gateway trace.
// Without it, the otelgrpc client handlers on the outbound connections start
// orphaned traces and the user-facing request never appears at all.
//
// It is hand-rolled rather than otelhttp because the gateway serves WebSocket
// upgrades through the same stack and every wrapper in this package must
// implement http.Hijacker (see Logging/Metrics/Recovery), and because reusing
// normalizePath keeps span names on the same low-cardinality scheme as the
// Prometheus labels.
//
// When no TracerProvider is configured (OTEL_EXPORTER_OTLP_ENDPOINT unset) the
// global provider is a no-op and this costs a context extraction plus two
// no-op calls per request.
func Tracing(next http.Handler) http.Handler {
	tracer := otel.GetTracerProvider().Tracer(tracerName)
	propagator := otel.GetTextMapPropagator()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Continue an upstream trace when the edge/web app sent traceparent.
		ctx := propagator.Extract(r.Context(), propagation.HeaderCarrier(r.Header))

		route := normalizePath(r.URL.Path)
		attrs := []attribute.KeyValue{
			semconv.HTTPRequestMethodKey.String(r.Method),
			semconv.URLPath(r.URL.Path),
			semconv.URLScheme(scheme(r)),
			semconv.ServerAddress(r.Host),
			semconv.UserAgentOriginal(r.UserAgent()),
		}
		if id := observability.RequestIDFromContext(r.Context()); id != "" {
			attrs = append(attrs, attribute.String("request.id", id))
		}

		ctx, span := tracer.Start(ctx, r.Method+" "+route,
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(attrs...),
		)
		defer span.End()

		wrapped := &tracingWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r.WithContext(ctx))

		// chi only knows the matched pattern after routing, and it is a better
		// span name than the regex-normalized path when both are available.
		if rc := chi.RouteContext(r.Context()); rc != nil {
			if pattern := rc.RoutePattern(); pattern != "" {
				span.SetName(r.Method + " " + pattern)
				span.SetAttributes(semconv.HTTPRoute(pattern))
			}
		}

		span.SetAttributes(semconv.HTTPResponseStatusCode(wrapped.statusCode))
		// 4xx is a client problem, not a failed server span; only 5xx marks the
		// trace red so error-rate dashboards stay meaningful.
		if wrapped.statusCode >= 500 {
			span.SetStatus(codes.Error, http.StatusText(wrapped.statusCode))
		}
	})
}

// scheme reports the request scheme, honouring the edge's X-Forwarded-Proto.
func scheme(r *http.Request) string {
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		return proto
	}
	if r.TLS != nil {
		return "https"
	}
	return "http"
}
