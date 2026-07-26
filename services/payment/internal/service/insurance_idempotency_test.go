package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// CreateInsurancePaymentIntent used to set IdempotencyKey without the empty
// guard every other money method has. Pin the fail-closed behaviour.
func TestCreateInsurancePaymentIntent_requiresIdempotencyKey(t *testing.T) {
	t.Parallel()
	s := &StripeService{devMode: true}
	_, _, err := s.CreateInsurancePaymentIntent(context.Background(), 1000, "usd", "", "pol_1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "idempotency key required")

	// Non-empty still works in dev.
	pi, secret, err := s.CreateInsurancePaymentIntent(context.Background(), 1000, "usd", "idem-ok", "pol_1")
	require.NoError(t, err)
	assert.NotEmpty(t, pi)
	assert.NotEmpty(t, secret)
}
