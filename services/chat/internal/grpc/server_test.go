package grpc

import (
	"fmt"
	"testing"

	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestMapDomainError pins the chat domain-error → gRPC-code mapping. Every
// expected domain error must map to a 4xx-class code, never Internal (a 500 for
// a predictable condition violates the project's error-handling rule).
func TestMapDomainError(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		err  error
		want codes.Code
	}{
		{"no bid for chat", domain.ErrNoBidForChat, codes.FailedPrecondition},
		{"channel not found", domain.ErrChannelNotFound, codes.NotFound},
		{"not channel member", domain.ErrNotChannelMember, codes.PermissionDenied},
		{"channel closed", domain.ErrChannelClosed, codes.FailedPrecondition},
		{"empty message", domain.ErrEmptyMessage, codes.InvalidArgument},
		{"nil error", nil, codes.OK},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := status.Code(mapDomainError(tt.err)); got != tt.want {
				t.Fatalf("mapDomainError(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

// TestMapDomainError_WrappedNoBid_NotInternal is the regression for the chat
// create-channel 500. CreateChannel returns the error wrapped ("create channel:
// %w") when a provider with no active bid tries to chat — a predictable user
// condition that fell through mapDomainError's default to codes.Internal →
// gateway 500. The fix maps it to FailedPrecondition (422). Without the fix this
// test fails (the wrapped error maps to Internal).
func TestMapDomainError_WrappedNoBid_NotInternal(t *testing.T) {
	t.Parallel()
	wrapped := fmt.Errorf("create channel: %w", domain.ErrNoBidForChat)
	got := status.Code(mapDomainError(wrapped))
	if got == codes.Internal {
		t.Fatalf("wrapped no-bid-for-chat error mapped to Internal (500) — regression: a predictable user condition must not 500")
	}
	if got != codes.FailedPrecondition {
		t.Fatalf("mapDomainError(wrapped no-bid) = %v, want FailedPrecondition (gateway 422)", got)
	}
}
