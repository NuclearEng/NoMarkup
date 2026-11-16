package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProcessRecurringPaymentRetries_nilWorker(t *testing.T) {
	t.Parallel()
	var w *RecurringPaymentRetryWorker
	n, err := w.ProcessRecurringPaymentRetries(context.Background(), 10)
	assert.Equal(t, 0, n)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "database pool unwired")
}

func TestProcessRecurringPaymentRetries_nilPool(t *testing.T) {
	t.Parallel()
	w := NewRecurringPaymentRetryWorker(nil)
	n, err := w.ProcessRecurringPaymentRetries(context.Background(), 10)
	assert.Equal(t, 0, n)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "database pool unwired")
}

func TestRunRecurringPaymentRetryCron_nilPoolIsNoop(t *testing.T) {
	t.Parallel()
	// Must return immediately without starting a goroutine that would hang the test.
	RunRecurringPaymentRetryCron(context.Background(), NewRecurringPaymentRetryWorker(nil), 0, 0, 0)
}

func TestNewRecurringPaymentRetryWorker(t *testing.T) {
	t.Parallel()
	w := NewRecurringPaymentRetryWorker(nil)
	require.NotNil(t, w)
	assert.Nil(t, w.pool)
}
