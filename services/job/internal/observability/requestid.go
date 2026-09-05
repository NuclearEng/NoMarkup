// Package observability holds this service's request-correlation primitives:
// the request-id context key, an slog handler that stamps every context-aware
// record with request_id/trace_id/span_id, and the gRPC server interceptors
// that lift the gateway's x-request-id metadata onto the context.
//
// It has no dependency on domain/service/repository so any layer can read the
// request id without an import cycle.
package observability

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// MetadataRequestID is the gRPC metadata key the gateway sends the correlation
// id under. gRPC metadata keys must be lowercase.
const MetadataRequestID = "x-request-id"

// maxRequestIDLen bounds an inbound request id so a hostile caller cannot use
// the metadata to inflate every log line.
const maxRequestIDLen = 64

type requestIDCtxKey struct{}

// ContextWithRequestID returns a copy of ctx carrying the request id.
func ContextWithRequestID(ctx context.Context, id string) context.Context {
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, requestIDCtxKey{}, id)
}

// RequestIDFromContext returns the request id carried by ctx, or "" when the
// caller did not send one.
func RequestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(requestIDCtxKey{}).(string)
	return id
}

// requestIDFromMetadata reads and sanitizes x-request-id from the incoming
// gRPC metadata. It returns "" when absent or unusable.
func requestIDFromMetadata(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	values := md.Get(MetadataRequestID)
	if len(values) == 0 {
		return ""
	}
	id := values[0]
	if id == "" || len(id) > maxRequestIDLen {
		return ""
	}
	for i := 0; i < len(id); i++ {
		if id[i] < 0x21 || id[i] > 0x7e {
			return ""
		}
	}
	return id
}

// RequestIDUnaryInterceptor lifts the gateway's x-request-id metadata onto the
// context so every slog.*Context call in this service logs the same
// correlation id the gateway wrote to its access log.
func RequestIDUnaryInterceptor(
	ctx context.Context,
	req any,
	_ *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (any, error) {
	return handler(ContextWithRequestID(ctx, requestIDFromMetadata(ctx)), req)
}

// requestIDStream overrides Context so the handler sees the enriched context.
type requestIDStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *requestIDStream) Context() context.Context { return s.ctx }

// RequestIDStreamInterceptor is the streaming counterpart of
// RequestIDUnaryInterceptor.
func RequestIDStreamInterceptor(
	srv any,
	ss grpc.ServerStream,
	_ *grpc.StreamServerInfo,
	handler grpc.StreamHandler,
) error {
	id := requestIDFromMetadata(ss.Context())
	if id == "" {
		return handler(srv, ss)
	}
	return handler(srv, &requestIDStream{ServerStream: ss, ctx: ContextWithRequestID(ss.Context(), id)})
}

// ContextHandler is an slog.Handler decorator that stamps request_id, trace_id
// and span_id onto every record logged through a *Context variant
// (slog.InfoContext, slog.ErrorContext, ...). Call sites need no change.
type ContextHandler struct {
	slog.Handler
}

// NewContextHandler wraps h so context-carried correlation ids are attached
// automatically.
func NewContextHandler(h slog.Handler) *ContextHandler {
	return &ContextHandler{Handler: h}
}

// Handle implements slog.Handler.
func (h *ContextHandler) Handle(ctx context.Context, r slog.Record) error {
	if id := RequestIDFromContext(ctx); id != "" && !hasAttr(r, "request_id") {
		r.AddAttrs(slog.String("request_id", id))
	}
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		r.AddAttrs(
			slog.String("trace_id", sc.TraceID().String()),
			slog.String("span_id", sc.SpanID().String()),
		)
	}
	return h.Handler.Handle(ctx, r)
}

// hasAttr reports whether the record already carries key, so a call site that
// logs request_id explicitly is not duplicated by the handler.
func hasAttr(r slog.Record, key string) bool {
	found := false
	r.Attrs(func(a slog.Attr) bool {
		if a.Key == key {
			found = true
			return false
		}
		return true
	})
	return found
}

// WithAttrs implements slog.Handler.
func (h *ContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &ContextHandler{Handler: h.Handler.WithAttrs(attrs)}
}

// WithGroup implements slog.Handler.
func (h *ContextHandler) WithGroup(name string) slog.Handler {
	return &ContextHandler{Handler: h.Handler.WithGroup(name)}
}
