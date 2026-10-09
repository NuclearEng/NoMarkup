// Package observability holds the cross-cutting request-correlation primitives
// used by the gateway: the request-id context key, an slog handler that stamps
// every context-aware log record with request_id/trace_id/span_id, and helpers
// for moving the request id across process boundaries (HTTP header inbound,
// gRPC metadata outbound).
//
// It deliberately has no dependency on the middleware or handler packages so
// that any layer — middleware, handler, repository — can read the request id
// without an import cycle.
package observability

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"

	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc/metadata"
)

const (
	// HeaderRequestID is the inbound/outbound HTTP header carrying the id.
	HeaderRequestID = "X-Request-ID"

	// MetadataRequestID is the gRPC metadata key carrying the id to backend
	// services. gRPC metadata keys must be lowercase.
	MetadataRequestID = "x-request-id"

	// maxRequestIDLen bounds a client-supplied request id so an attacker cannot
	// use the header to inflate every log line and every span attribute.
	maxRequestIDLen = 64
)

type requestIDCtxKey struct{}

// NewRequestID returns a fresh 16-hex-character request id.
func NewRequestID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failure is not recoverable here and must not drop the
		// request; an empty id degrades correlation, never availability.
		return ""
	}
	return hex.EncodeToString(b)
}

// SanitizeRequestID trims a client-supplied request id to a safe length and
// rejects non-printable-ASCII input (log/metadata injection). It returns ""
// when the input is unusable, signalling the caller to mint a new id.
func SanitizeRequestID(id string) string {
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

// ContextWithRequestID returns a copy of ctx carrying the request id.
func ContextWithRequestID(ctx context.Context, id string) context.Context {
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, requestIDCtxKey{}, id)
}

// RequestIDFromContext returns the request id carried by ctx, or "" when the
// context did not pass through the RequestID middleware.
func RequestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(requestIDCtxKey{}).(string)
	return id
}

// OutgoingContext appends the request id to the outgoing gRPC metadata so the
// backend services log the same correlation id as the gateway access log.
func OutgoingContext(ctx context.Context) context.Context {
	id := RequestIDFromContext(ctx)
	if id == "" {
		return ctx
	}
	return metadata.AppendToOutgoingContext(ctx, MetadataRequestID, id)
}

// ContextHandler is an slog.Handler decorator that stamps request_id, trace_id
// and span_id onto every record logged through a *Context variant
// (slog.InfoContext, slog.ErrorContext, ...). Call sites need no change.
//
// The cost is two context lookups per record and is only paid for records that
// actually pass the level filter.
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
// logs request_id explicitly (the access log) is not duplicated by the handler.
// Records here carry a handful of attributes, so the scan is negligible.
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
