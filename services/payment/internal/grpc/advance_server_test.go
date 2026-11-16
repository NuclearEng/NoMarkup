package grpc

import (
	"fmt"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestMapAdvanceError pins the working-capital advance error mapping. Every
// expected condition must map to a 4xx-class code, never Internal (a 500 for a
// predictable condition violates the project's error-handling rule).
func TestMapAdvanceError(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		err  error
		want codes.Code
	}{
		{"advance not found", domain.ErrAdvanceNotFound, codes.NotFound},
		{"insufficient credit", service.ErrInsufficientCredit, codes.FailedPrecondition},
		{"invalid amount", domain.ErrInvalidAmount, codes.InvalidArgument},
		{"advance declined (low score)", domain.ErrAdvanceDeclined, codes.FailedPrecondition},
		{"stripe account not set up", domain.ErrStripeAccountNotFound, codes.FailedPrecondition},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := status.Code(mapAdvanceError(tt.err)); got != tt.want {
				t.Fatalf("mapAdvanceError(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

// TestMapAdvanceError_NoInternal_500 is the regression for the two advance 500s
// found by the unmapped-domain-error audit:
//   - RequestAdvance returns the credit-decline wrapped ("request advance
//     declined: ...: %w" ErrAdvanceDeclined) — used to fall through to Internal.
//   - DisburseAdvance returns ErrStripeAccountNotFound when the provider's payout
//     account isn't set up — used to fall through to Internal.
// Both are predictable conditions that must be 422, not 500. Without the fix
// these map to codes.Internal and this test fails.
func TestMapAdvanceError_NoInternal_500(t *testing.T) {
	t.Parallel()
	cases := []error{
		fmt.Errorf("request advance declined: credit score 42 (grade D): %w", domain.ErrAdvanceDeclined),
		fmt.Errorf("disburse advance: %w", domain.ErrStripeAccountNotFound),
	}
	for _, err := range cases {
		if got := status.Code(mapAdvanceError(err)); got == codes.Internal {
			t.Fatalf("mapAdvanceError(%v) = Internal (500) — regression: predictable condition must not 500", err)
		}
	}
}
