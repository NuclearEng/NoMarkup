package grpc

import (
	"errors"
	"fmt"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestMapInstantPayoutError(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		err  error
		code codes.Code
		msg  string
	}{
		{
			name: "insufficient balance",
			err:  fmt.Errorf("claim: %w", domain.ErrInstantPayoutInsufficientBalance),
			code: codes.FailedPrecondition,
			msg:  "instant payout exceeds your available cleared balance",
		},
		{
			name: "daily cap",
			err:  fmt.Errorf("claim: %w", domain.ErrInstantPayoutDailyCap),
			code: codes.FailedPrecondition,
			msg:  "amount exceeds the daily instant payout limit",
		},
		{
			name: "no connect account",
			err:  fmt.Errorf("instant payout: %w", domain.ErrStripeAccountNotFound),
			code: codes.FailedPrecondition,
			msg:  "instant payout unavailable: complete payout verification first",
		},
		{
			name: "per-txn max",
			err:  fmt.Errorf("instant payout: exceeds per-transaction max: %w", domain.ErrInvalidAmount),
			code: codes.FailedPrecondition,
			msg:  "amount exceeds the per-transaction instant payout limit",
		},
		{
			name: "fee floor",
			err:  fmt.Errorf("instant payout: net after fee non-positive: %w", domain.ErrInvalidAmount),
			code: codes.FailedPrecondition,
			msg:  "amount too small for instant payout after fees",
		},
		{
			name: "generic invalid amount",
			err:  domain.ErrInvalidAmount,
			code: codes.InvalidArgument,
			msg:  "invalid amount",
		},
		{
			name: "unknown falls through to internal",
			err:  errors.New("stripe network blip"),
			code: codes.Internal,
			msg:  "internal error",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := mapInstantPayoutError(tc.err)
			st, ok := status.FromError(got)
			require.True(t, ok)
			assert.Equal(t, tc.code, st.Code())
			assert.Equal(t, tc.msg, st.Message())
		})
	}
}
