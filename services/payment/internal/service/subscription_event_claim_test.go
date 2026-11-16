package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClaimStripeEvent_DuplicateAndEmptyID(t *testing.T) {
	t.Parallel()

	var calls int
	repo := &mockSubRepo{
		claimStripeEventFn: func(_ context.Context, eventID, eventType string) (bool, error) {
			calls++
			assert.Equal(t, "evt_sub_1", eventID)
			assert.Equal(t, "invoice.paid", eventType)
			return calls > 1, nil
		},
	}
	svc := NewSubscriptionService(repo, nil)

	already, err := svc.ClaimStripeEvent(context.Background(), "evt_sub_1", "invoice.paid")
	require.NoError(t, err)
	assert.False(t, already)

	already, err = svc.ClaimStripeEvent(context.Background(), "evt_sub_1", "invoice.paid")
	require.NoError(t, err)
	assert.True(t, already)

	_, err = svc.ClaimStripeEvent(context.Background(), "  ", "invoice.paid")
	require.Error(t, err)
}
