package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

// noopSubHook satisfies the SubscriptionWebhookHandler interface for testing
// the SetSubscriptionWebhookHandler setter.
type noopSubHook struct{ called bool }

func (n *noopSubHook) HandleSubscriptionWebhook(_ context.Context, _, _ string, _, _ *struct{}) error {
	return nil
}

func TestPaymentService_SetSubscriptionWebhookHandler_AcceptsNil(t *testing.T) {
	t.Parallel()
	svc := newTestPaymentService(&mockPaymentRepo{}, nil)
	// Setter must not panic when given nil. The webhook dispatcher is
	// responsible for the nil-guard.
	assert.NotPanics(t, func() { svc.SetSubscriptionWebhookHandler(nil) })
}

func TestPaymentService_SetInstallmentPaymentHandler_AcceptsNil(t *testing.T) {
	t.Parallel()
	svc := newTestPaymentService(&mockPaymentRepo{}, nil)
	assert.NotPanics(t, func() { svc.SetInstallmentPaymentHandler(nil) })
}
