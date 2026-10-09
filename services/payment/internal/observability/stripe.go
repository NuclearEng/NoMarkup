package observability

import (
	"context"
	"errors"

	"github.com/stripe/stripe-go/v82"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// stripeTracerName identifies the instrumentation scope for Stripe spans.
const stripeTracerName = "github.com/nomarkup/nomarkup/services/payment/stripe"

// StartStripeSpan opens a CLIENT span for a Stripe API call. op is the Stripe
// resource+verb, e.g. "PaymentIntent.Create" — a constant per call site, so
// span names stay low-cardinality.
//
// Prefer TraceStripeCall / TraceStripeVoid; this is for the list iterators,
// where the unit of work spans the whole iteration rather than one call.
func StartStripeSpan(ctx context.Context, op string) (context.Context, trace.Span) {
	return otel.GetTracerProvider().Tracer(stripeTracerName).Start(ctx, "stripe."+op,
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("peer.service", "stripe"),
			attribute.String("stripe.operation", op),
		),
	)
}

// EndStripeSpan records the outcome and closes the span. Passing a *stripe.Error
// also records the Stripe request id, error code and type — the three fields
// Stripe support asks for and the ones that turn "payments were slow" into a
// specific, answerable question.
func EndStripeSpan(span trace.Span, err error) {
	defer span.End()

	if err == nil {
		return
	}

	span.RecordError(err)
	span.SetStatus(codes.Error, err.Error())

	var stripeErr *stripe.Error
	if errors.As(err, &stripeErr) {
		attrs := []attribute.KeyValue{
			attribute.String("stripe.error_type", string(stripeErr.Type)),
			attribute.Int("stripe.http_status", stripeErr.HTTPStatusCode),
		}
		if stripeErr.RequestID != "" {
			attrs = append(attrs, attribute.String("stripe.request_id", stripeErr.RequestID))
		}
		if stripeErr.Code != "" {
			attrs = append(attrs, attribute.String("stripe.error_code", string(stripeErr.Code)))
		}
		span.SetAttributes(attrs...)
	}
}

// TraceStripeCall wraps a Stripe SDK call that returns a value and an error.
//
// Stripe is the slowest external dependency in the request path and the one
// most likely to be blamed during an incident; without these spans its latency
// is invisible inside the payment service's gRPC span.
func TraceStripeCall[T any](ctx context.Context, op string, fn func(context.Context) (T, error)) (T, error) {
	ctx, span := StartStripeSpan(ctx, op)
	result, err := fn(ctx)
	EndStripeSpan(span, err)
	return result, err
}

// TraceStripeVoid wraps a Stripe SDK call that returns only an error.
func TraceStripeVoid(ctx context.Context, op string, fn func(context.Context) error) error {
	ctx, span := StartStripeSpan(ctx, op)
	err := fn(ctx)
	EndStripeSpan(span, err)
	return err
}
