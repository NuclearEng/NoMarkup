package observability

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"

	"github.com/stripe/stripe-go/v82"
	"go.opentelemetry.io/otel"
	otelcodes "go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

func installRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()

	recorder := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	otel.SetTracerProvider(tp)
	t.Cleanup(func() { _ = tp.Shutdown(context.Background()) })
	return recorder
}

// TestTraceStripeCallProducesClientSpan proves the Stripe wrapper emits a real
// child span. Stripe is the slowest external dependency in the payment path;
// before this it contributed nothing to a trace and every slow payment looked
// like an unexplained gap inside the gRPC span.
func TestTraceStripeCallProducesClientSpan(t *testing.T) {
	recorder := installRecorder(t)

	parentCtx, parent := otel.GetTracerProvider().Tracer("test").Start(context.Background(), "rpc.CreatePayment")

	got, err := TraceStripeCall(parentCtx, "PaymentIntent.Create", func(context.Context) (string, error) {
		return "pi_123", nil
	})
	parent.End()

	if err != nil {
		t.Fatalf("TraceStripeCall returned %v", err)
	}
	if got != "pi_123" {
		t.Errorf("result = %q, want pi_123", got)
	}

	spans := recorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("recorded %d spans, want 2", len(spans))
	}

	stripeSpan := spans[0]
	if stripeSpan.Name() != "stripe.PaymentIntent.Create" {
		t.Errorf("span name = %q, want stripe.PaymentIntent.Create", stripeSpan.Name())
	}
	if stripeSpan.SpanKind() != trace.SpanKindClient {
		t.Errorf("span kind = %v, want client", stripeSpan.SpanKind())
	}
	if stripeSpan.Parent().SpanID() != parent.SpanContext().SpanID() {
		t.Error("stripe span is not parented under the caller's span")
	}
	if stripeSpan.Status().Code == otelcodes.Error {
		t.Error("successful call was marked as an error")
	}
}

// TestTraceStripeCallRecordsStripeErrorDetail checks the three fields Stripe
// support asks for land on the span, turning "payments were failing" into an
// answerable question.
func TestTraceStripeCallRecordsStripeErrorDetail(t *testing.T) {
	recorder := installRecorder(t)

	stripeErr := &stripe.Error{
		Type:           stripe.ErrorTypeCard,
		Code:           stripe.ErrorCodeCardDeclined,
		RequestID:      "req_stripe_abc",
		HTTPStatusCode: 402,
	}

	_, err := TraceStripeCall(context.Background(), "PaymentIntent.Capture",
		func(context.Context) (*stripe.PaymentIntent, error) { return nil, stripeErr })
	if !errors.Is(err, stripeErr) {
		t.Fatalf("error = %v, want the stripe error passed through", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("recorded %d spans, want 1", len(spans))
	}
	if spans[0].Status().Code != otelcodes.Error {
		t.Error("failed Stripe call did not set an error status")
	}

	attrs := map[string]string{}
	for _, a := range spans[0].Attributes() {
		attrs[string(a.Key)] = a.Value.Emit()
	}
	for key, want := range map[string]string{
		"stripe.request_id": "req_stripe_abc",
		"stripe.error_code": "card_declined",
		"stripe.error_type": "card_error",
	} {
		if attrs[key] != want {
			t.Errorf("attribute %s = %q, want %q", key, attrs[key], want)
		}
	}
	if len(spans[0].Events()) == 0 {
		t.Error("error was not recorded as a span event")
	}
}

// TestTraceStripeVoidPropagates covers the error-only wrapper.
func TestTraceStripeVoidPropagates(t *testing.T) {
	recorder := installRecorder(t)

	want := errors.New("boom")
	if err := TraceStripeVoid(context.Background(), "PaymentMethod.Detach",
		func(context.Context) error { return want }); !errors.Is(err, want) {
		t.Fatalf("error = %v, want %v", err, want)
	}
	if n := len(recorder.Ended()); n != 1 {
		t.Fatalf("recorded %d spans, want 1", n)
	}
}

// TestRequestIDUnaryInterceptorLiftsMetadata proves the gateway's correlation
// id reaches this service's context, which is what makes a service log line
// traceable back to the user request that caused it.
func TestRequestIDUnaryInterceptorLiftsMetadata(t *testing.T) {
	for _, tc := range []struct {
		name   string
		md     metadata.MD
		wantID string
	}{
		{"forwarded id", metadata.Pairs(MetadataRequestID, "req-abc"), "req-abc"},
		{"no metadata", nil, ""},
		{"empty value", metadata.Pairs(MetadataRequestID, ""), ""},
		{"control characters rejected", metadata.Pairs(MetadataRequestID, "bad\tid"), ""},
		{"oversized rejected", metadata.Pairs(MetadataRequestID, string(bytes.Repeat([]byte("a"), 200))), ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			if tc.md != nil {
				ctx = metadata.NewIncomingContext(ctx, tc.md)
			}

			var seen string
			_, err := RequestIDUnaryInterceptor(ctx, nil, &grpc.UnaryServerInfo{},
				func(ctx context.Context, _ any) (any, error) {
					seen = RequestIDFromContext(ctx)
					return nil, nil
				})
			if err != nil {
				t.Fatalf("interceptor: %v", err)
			}
			if seen != tc.wantID {
				t.Errorf("request id in handler ctx = %q, want %q", seen, tc.wantID)
			}
		})
	}
}

// TestContextHandlerStampsCorrelationIDs is the proof that request_id becomes
// available on existing log call sites without a sweep: any slog.*Context call
// picks it up from the context automatically.
func TestContextHandlerStampsCorrelationIDs(t *testing.T) {
	recorder := installRecorder(t)
	_ = recorder

	var buf bytes.Buffer
	logger := slog.New(NewContextHandler(slog.NewJSONHandler(&buf, nil)))

	ctx, span := otel.GetTracerProvider().Tracer("test").Start(
		ContextWithRequestID(context.Background(), "req-xyz"), "work")
	logger.InfoContext(ctx, "processing", "payment_id", "pay_1")
	span.End()

	var record map[string]any
	if err := json.Unmarshal(buf.Bytes(), &record); err != nil {
		t.Fatalf("log line is not JSON: %v (%s)", err, buf.String())
	}

	if record["request_id"] != "req-xyz" {
		t.Errorf("request_id = %v, want req-xyz", record["request_id"])
	}
	if got, want := record["trace_id"], span.SpanContext().TraceID().String(); got != want {
		t.Errorf("trace_id = %v, want %v", got, want)
	}
	if record["span_id"] != span.SpanContext().SpanID().String() {
		t.Errorf("span_id = %v, want the active span", record["span_id"])
	}
	if record["payment_id"] != "pay_1" {
		t.Error("the caller's own attributes were dropped")
	}
}

// TestContextHandlerDoesNotDuplicateExplicitRequestID guards the access-log
// case, where the call site already logs request_id itself.
func TestContextHandlerDoesNotDuplicateExplicitRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(NewContextHandler(slog.NewJSONHandler(&buf, nil)))

	ctx := ContextWithRequestID(context.Background(), "req-ctx")
	logger.InfoContext(ctx, "request", "request_id", "req-explicit")

	if got := bytes.Count(buf.Bytes(), []byte(`"request_id"`)); got != 1 {
		t.Errorf("request_id appears %d times in the record, want 1: %s", got, buf.String())
	}
	if !bytes.Contains(buf.Bytes(), []byte("req-explicit")) {
		t.Error("the call site's own request_id was overwritten")
	}
}

// TestCompactSQLBoundsSpanName checks pgx span names stay readable and bounded.
func TestCompactSQLBoundsSpanName(t *testing.T) {
	multiline := "\n\t\tSELECT id, title\n\t\t  FROM listings\n\t\t WHERE seller_id = $1\n\t"
	if got, want := compactSQL(multiline), "SELECT id, title FROM listings WHERE seller_id = $1"; got != want {
		t.Errorf("compactSQL = %q, want %q", got, want)
	}

	long := compactSQL(string(bytes.Repeat([]byte("x"), 500)))
	if len(long) != maxSpanNameSQL+3 {
		t.Errorf("truncated length = %d, want %d", len(long), maxSpanNameSQL+3)
	}
}
