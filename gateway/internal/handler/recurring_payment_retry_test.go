package handler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIncrRecurringPaymentRetryCount_nilDB(t *testing.T) {
	t.Parallel()
	n, err := incrRecurringPaymentRetryCount(context.Background(), nil, testRecurringID)
	assert.Equal(t, 0, n)
	require.ErrorIs(t, err, errPaymentRetryDBUnwired)
}

func TestIncrRecurringPaymentRetryCount_emptyID(t *testing.T) {
	t.Parallel()
	n, err := incrRecurringPaymentRetryCount(context.Background(), nil, "")
	// nil db checked first
	assert.Equal(t, 0, n)
	require.ErrorIs(t, err, errPaymentRetryDBUnwired)
}

func TestResetRecurringPaymentRetryCount_nilDB(t *testing.T) {
	t.Parallel()
	err := resetRecurringPaymentRetryCount(context.Background(), nil, testRecurringID)
	require.ErrorIs(t, err, errPaymentRetryDBUnwired)
}

func TestRecurringPaymentRetryPauseThreshold(t *testing.T) {
	t.Parallel()
	// FR-16.7 partial: three consecutive CreatePayment setup failures → pause.
	assert.Equal(t, 3, recurringPaymentRetryPauseThreshold)
}
