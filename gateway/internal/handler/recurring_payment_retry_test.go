package handler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIncrRecurringPaymentRetryCount_nilDB(t *testing.T) {
	t.Parallel()
	n, next, err := incrRecurringPaymentRetryCount(context.Background(), nil, testRecurringID)
	assert.Equal(t, 0, n)
	assert.Nil(t, next)
	require.ErrorIs(t, err, errPaymentRetryDBUnwired)
}

func TestIncrRecurringPaymentRetryCount_emptyID(t *testing.T) {
	t.Parallel()
	n, next, err := incrRecurringPaymentRetryCount(context.Background(), nil, "")
	// nil db checked first
	assert.Equal(t, 0, n)
	assert.Nil(t, next)
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

func TestNextRetryAtAfterCount(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)

	day3 := nextRetryAtAfterCount(1, now)
	require.NotNil(t, day3)
	assert.Equal(t, now.Add(3*24*time.Hour), *day3)

	day7 := nextRetryAtAfterCount(2, now)
	require.NotNil(t, day7)
	assert.Equal(t, now.Add(4*24*time.Hour), *day7)

	assert.Nil(t, nextRetryAtAfterCount(3, now), "threshold: no further retry")
	assert.Nil(t, nextRetryAtAfterCount(0, now), "pre-failure: nothing scheduled")
	assert.Nil(t, nextRetryAtAfterCount(4, now))
}
