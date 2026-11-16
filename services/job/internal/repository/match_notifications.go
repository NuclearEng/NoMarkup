package repository

import (
	"context"
	"fmt"
)

// RecordJobMatchNotification records that a provider was selected for a job
// match notify. ON CONFLICT DO NOTHING so a retry or a failed-soft push
// cannot invent a second row.
func (r *PostgresRepository) RecordJobMatchNotification(ctx context.Context, jobID, providerID string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO job_match_notifications (job_id, provider_id)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING`,
		jobID, providerID)
	if err != nil {
		return fmt.Errorf("record job match notification: %w", err)
	}
	return nil
}
