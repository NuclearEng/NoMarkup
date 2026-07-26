package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	otelcodes "go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc/metadata"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"github.com/nomarkup/nomarkup/gateway/internal/observability"
)

// installRecorder swaps the global TracerProvider for one that records spans
// in memory and restores the previous provider when the test ends.
func installRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()

	recorder := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))

	prevPropagator := otel.GetTextMapPropagator()
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	t.Cleanup(func() {
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(otel.GetTracerProvider())
		otel.SetTextMapPropagator(prevPropagator)
	})
	return recorder
}

// newTracedRouter builds the real global middleware prefix (RequestID then
// Tracing) so the test exercises the shipped ordering, not a bespoke chain.
//
// Tracing captures the TracerProvider when the middleware is constructed, so
// the router must be built after installRecorder.
func newTracedRouter(handler http.HandlerFunc) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Tracing)
	r.Get("/probe/{id}", handler)
	return r
}

// TestTracingProducesRootServerSpanWithChild is the tracing smoke proof that
// does not need a database: work started inside the handler must land under
// the inbound HTTP server span, in the same trace.
func TestTracingProducesRootServerSpanWithChild(t *testing.T) {
	recorder := installRecorder(t)

	var childSpanID trace.SpanID
	router := newTracedRouter(func(w http.ResponseWriter, r *http.Request) {
		// Stand-in for any instrumented outbound call (pgx, redis, gRPC, Stripe):
		// they all start a span from the request context exactly like this.
		_, span := otel.GetTracerProvider().Tracer("test").Start(r.Context(), "downstream.call")
		childSpanID = span.SpanContext().SpanID()
		span.End()
		w.WriteHeader(http.StatusOK)
	})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/probe/abc", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Header().Get(observability.HeaderRequestID) == "" {
		t.Error("response is missing the X-Request-ID header")
	}

	spans := recorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("recorded %d spans, want 2 (server + child): %v", len(spans), spanNames(spans))
	}

	var server, child sdktrace.ReadOnlySpan
	for _, s := range spans {
		if s.SpanKind() == trace.SpanKindServer {
			server = s
		} else if s.SpanContext().SpanID() == childSpanID {
			child = s
		}
	}
	if server == nil {
		t.Fatalf("no SERVER span recorded; got %v", spanNames(spans))
	}
	if child == nil {
		t.Fatal("child span was not recorded")
	}

	// The route pattern, not the raw path, so span names stay low-cardinality.
	if got, want := server.Name(), "GET /probe/{id}"; got != want {
		t.Errorf("server span name = %q, want %q", got, want)
	}
	if server.Parent().IsValid() {
		t.Error("server span should be a root span (no valid parent)")
	}
	if child.Parent().SpanID() != server.SpanContext().SpanID() {
		t.Errorf("child parent = %s, want server span %s",
			child.Parent().SpanID(), server.SpanContext().SpanID())
	}
	if child.SpanContext().TraceID() != server.SpanContext().TraceID() {
		t.Error("child span is in a different trace than the server span")
	}

	var sawRequestID bool
	for _, attr := range server.Attributes() {
		if attr.Key == "request.id" && attr.Value.AsString() != "" {
			sawRequestID = true
		}
	}
	if !sawRequestID {
		t.Error("server span is missing the request.id attribute")
	}
}

// TestTracingContinuesUpstreamTrace proves the gateway joins a trace the edge
// already started rather than beginning a fresh, disconnected one.
func TestTracingContinuesUpstreamTrace(t *testing.T) {
	recorder := installRecorder(t)

	router := newTracedRouter(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	const upstreamTraceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	req := httptest.NewRequest(http.MethodGet, "/probe/abc", nil)
	req.Header.Set("traceparent", "00-"+upstreamTraceID+"-00f067aa0ba902b7-01")

	router.ServeHTTP(httptest.NewRecorder(), req)

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("recorded %d spans, want 1", len(spans))
	}
	if got := spans[0].SpanContext().TraceID().String(); got != upstreamTraceID {
		t.Errorf("trace id = %s, want the upstream %s", got, upstreamTraceID)
	}
}

// TestTracingRecordsServerErrorStatus checks that a 5xx marks the span as an
// error while a 4xx does not — otherwise every bad client request would show
// up red on the error-rate dashboard.
func TestTracingRecordsServerErrorStatus(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		wantError bool
	}{
		{"client error stays unset", http.StatusNotFound, false},
		{"server error is recorded", http.StatusInternalServerError, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := installRecorder(t)
			router := newTracedRouter(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
			})
			router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/probe/abc", nil))

			spans := recorder.Ended()
			if len(spans) != 1 {
				t.Fatalf("recorded %d spans, want 1", len(spans))
			}
			isError := spans[0].Status().Code == otelcodes.Error
			if isError != tc.wantError {
				t.Errorf("span error status = %v, want %v", isError, tc.wantError)
			}
		})
	}
}

// TestRequestIDFlowsFromContextToLogsAndDownstream covers the correlation path:
// the middleware seeds the context, the accessor reads it, and the outgoing
// gRPC metadata carries the same value to the backend services.
func TestRequestIDFlowsFromContextToLogsAndDownstream(t *testing.T) {
	var fromContext, fromMetadata string

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Get("/probe", func(_ http.ResponseWriter, r *http.Request) {
		fromContext = middleware.GetRequestID(r.Context())
		md, ok := metadataFromOutgoing(observability.OutgoingContext(r.Context()))
		if ok {
			fromMetadata = md
		}
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.Header.Set(observability.HeaderRequestID, "client-supplied-id")
	router.ServeHTTP(rec, req)

	if fromContext != "client-supplied-id" {
		t.Errorf("context request id = %q, want the client-supplied one", fromContext)
	}
	if fromMetadata != "client-supplied-id" {
		t.Errorf("outgoing gRPC metadata request id = %q, want the client-supplied one", fromMetadata)
	}
	if got := rec.Header().Get(observability.HeaderRequestID); got != "client-supplied-id" {
		t.Errorf("response header request id = %q, want the client-supplied one", got)
	}
}

// TestRequestIDRejectsHostileHeader verifies an oversized or non-printable
// client header is replaced rather than echoed into every log line and span.
func TestRequestIDRejectsHostileHeader(t *testing.T) {
	for _, tc := range []struct{ name, header string }{
		{"oversized", longString(200)},
		{"control characters", "abc\ndef"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var got string
			router := chi.NewRouter()
			router.Use(middleware.RequestID)
			router.Get("/probe", func(_ http.ResponseWriter, r *http.Request) {
				got = middleware.GetRequestID(r.Context())
			})

			req := httptest.NewRequest(http.MethodGet, "/probe", nil)
			req.Header.Set(observability.HeaderRequestID, tc.header)
			router.ServeHTTP(httptest.NewRecorder(), req)

			if got == "" {
				t.Fatal("no request id was generated")
			}
			if got == tc.header {
				t.Error("hostile client header was accepted verbatim")
			}
		})
	}
}

// TestPGXPoolProducesChildSpanUnderHTTPSpan is the end-to-end proof: a real
// query through an otelpgx-instrumented pool, issued from inside a handler,
// must appear as a child of the inbound HTTP server span.
//
// Skips when GATEWAY_TEST_DATABASE_URL / DATABASE_URL is unset, matching the
// other live-DB tests in this repo.
func TestPGXPoolProducesChildSpanUnderHTTPSpan(t *testing.T) {
	dsn := os.Getenv("GATEWAY_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no GATEWAY_TEST_DATABASE_URL/DATABASE_URL set — skipping live-db tracing test")
	}

	recorder := installRecorder(t)

	pool, err := observability.NewPGXPool(context.Background(), dsn)
	if err != nil {
		t.Fatalf("open instrumented pool: %v", err)
	}
	defer pool.Close()

	router := newTracedRouter(func(w http.ResponseWriter, r *http.Request) {
		var n int
		if err := pool.QueryRow(r.Context(), "SELECT 1").Scan(&n); err != nil {
			t.Errorf("query: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/probe/abc", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	spans := recorder.Ended()

	var server sdktrace.ReadOnlySpan
	for _, s := range spans {
		if s.SpanKind() == trace.SpanKindServer {
			server = s
		}
	}
	if server == nil {
		t.Fatalf("no SERVER span recorded; got %v", spanNames(spans))
	}

	// The query span must be a descendant of the server span in the same trace.
	var query sdktrace.ReadOnlySpan
	for _, s := range spans {
		if s.SpanKind() == trace.SpanKindClient &&
			s.SpanContext().TraceID() == server.SpanContext().TraceID() &&
			s.Parent().SpanID() == server.SpanContext().SpanID() {
			query = s
		}
	}
	if query == nil {
		t.Fatalf("no DB client span parented under the HTTP server span; recorded: %v", spanNames(spans))
	}

	var sawStatement bool
	for _, attr := range query.Attributes() {
		if attr.Key == "db.query.text" && attr.Value.AsString() != "" {
			sawStatement = true
		}
	}
	if !sawStatement {
		t.Error("DB span carries no db.query.text attribute — a slow query would be unattributable")
	}

	t.Logf("trace %s: server span %q -> db span %q",
		server.SpanContext().TraceID(), server.Name(), query.Name())
}

// metadataFromOutgoing reads the request id back out of an outgoing gRPC
// context, which is how the backend services receive it.
func metadataFromOutgoing(ctx context.Context) (string, bool) {
	md, ok := metadata.FromOutgoingContext(ctx)
	if !ok {
		return "", false
	}
	values := md.Get(observability.MetadataRequestID)
	if len(values) == 0 {
		return "", false
	}
	return values[0], true
}

func spanNames(spans []sdktrace.ReadOnlySpan) []string {
	names := make([]string, 0, len(spans))
	for _, s := range spans {
		names = append(names, s.Name())
	}
	return names
}

func longString(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = 'a'
	}
	return string(b)
}
