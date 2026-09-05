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

func TestLoadRecurringPaymentRetryFields_nilDB(t *testing.T) {
	t.Parallel()
	count, next, ok := loadRecurringPaymentRetryFields(context.Background(), nil, testRecurringID)
	assert.False(t, ok)
	assert.Equal(t, 0, count)
	assert.Nil(t, next)
}

func TestLoadRecurringPaymentRetryFields_emptyID(t *testing.T) {
	t.Parallel()
	count, next, ok := loadRecurringPaymentRetryFields(context.Background(), nil, "")
	assert.False(t, ok)
	assert.Equal(t, 0, count)
	assert.Nil(t, next)
}

func TestAttachPaymentRetryFieldsToConfig_nilDBNoOp(t *testing.T) {
	t.Parallel()
	cfg := map[string]interface{}{
		"id":     testRecurringID,
		"status": "active",
	}
	attachPaymentRetryFieldsToConfig(context.Background(), nil, cfg)
	_, hasCount := cfg["payment_retry_count"]
	_, hasNext := cfg["next_retry_at"]
	assert.False(t, hasCount, "nil db must not invent payment_retry_count")
	assert.False(t, hasNext, "nil db must not invent next_retry_at")
}

func TestAttachPaymentRetryFieldsToConfig_nilAndEmptySafe(t *testing.T) {
	t.Parallel()
	// Must not panic.
	attachPaymentRetryFieldsToConfig(context.Background(), nil, nil)
	attachPaymentRetryFieldsToConfig(context.Background(), nil, map[string]interface{}{})
	attachPaymentRetryFieldsToConfig(context.Background(), nil, map[string]interface{}{"id": ""})
}
