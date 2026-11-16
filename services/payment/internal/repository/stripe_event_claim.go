package repository

import "context"

// ClaimStripeEvent claims an event id that has already passed
// stripe.webhooks.constructEvent(). It does not verify a signature.
func (r *PostgresRepository) ClaimStripeEvent(ctx context.Context, eventID, eventType string) (bool, error) {
	return r.RecordStripeEventStart(ctx, eventID, eventType)
}

// FinishStripeEvent stamps an event after its side effects land.
// Callers must run stripe.webhooks.constructEvent() before this code.
func (r *PostgresRepository) FinishStripeEvent(ctx context.Context, eventID string) error {
	return r.MarkStripeEventProcessed(ctx, eventID)
}
