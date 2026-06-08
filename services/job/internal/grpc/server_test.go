package grpc

import (
	"fmt"
	"testing"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestMapDomainError pins the domain-error → gRPC-code mapping. Every expected
// domain error must map to a 4xx-class code, never Internal (a 500 for a
// predictable condition violates the project's error-handling rule).
func TestMapDomainError(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		err  error
		want codes.Code
	}{
		{"draft limit exceeded", domain.ErrDraftLimitExceeded, codes.FailedPrecondition},
		{"job not found", domain.ErrJobNotFound, codes.NotFound},
		{"not draft", domain.ErrNotDraft, codes.FailedPrecondition},
		{"not owner", domain.ErrNotOwner, codes.PermissionDenied},
		{"missing title", domain.ErrMissingTitle, codes.InvalidArgument},
		{"invalid auction type", domain.ErrInvalidAuctionType, codes.InvalidArgument},
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

// TestMapDomainError_WrappedDraftLimit_NotInternal is the regression for the
// draft-limit 500. The service layer returns the error wrapped ("create job:
// %w"), exactly as observed in user.log ("unmapped domain error: create job:
// maximum of 10 draft jobs allowed" → codes.Internal → gateway 500). The fix
// adds the ErrDraftLimitExceeded case so errors.Is unwraps it to a clean 422.
// Without the fix this test fails (the wrapped error falls through to Internal).
func TestMapDomainError_WrappedDraftLimit_NotInternal(t *testing.T) {
	t.Parallel()
	wrapped := fmt.Errorf("create job: %w", domain.ErrDraftLimitExceeded)
	got := status.Code(mapDomainError(wrapped))
	if got == codes.Internal {
		t.Fatalf("wrapped draft-limit error mapped to Internal (500) — regression: a predictable user condition must not 500")
	}
	if got != codes.FailedPrecondition {
		t.Fatalf("mapDomainError(wrapped draft-limit) = %v, want FailedPrecondition (gateway 422)", got)
	}
}
