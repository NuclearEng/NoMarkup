package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

func (r *PostgresRepository) CreateAdvance(ctx context.Context, advance *domain.Advance) error {
	err := r.pool.QueryRow(ctx, `
		INSERT INTO working_capital_advances (
			id, provider_id, contract_id, advance_amount_cents,
			fee_cents, repaid_cents, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at, updated_at`,
		advance.ID, advance.ProviderID, advance.ContractID, advance.AdvanceAmountCents,
		advance.FeeCents, advance.RepaidCents, advance.Status,
	).Scan(&advance.CreatedAt, &advance.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create advance: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ListAdvances(ctx context.Context, providerID string, statusFilter string, page, pageSize int) ([]*domain.Advance, int, error) {
	where := []string{}
	args := []interface{}{}
	argIdx := 1

	if providerID != "" {
		where = append(where, fmt.Sprintf("provider_id = $%d", argIdx))
		args = append(args, providerID)
		argIdx++
	}

	if statusFilter != "" {
		where = append(where, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}

	whereClause := "TRUE"
	if len(where) > 0 {
		whereClause = strings.Join(where, " AND ")
	}

	var totalCount int
	err := r.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT COUNT(*) FROM working_capital_advances WHERE %s`, whereClause),
		args...,
	).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("list advances count: %w", err)
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	selectQuery := fmt.Sprintf(`
		SELECT id, provider_id, contract_id, advance_amount_cents,
		       fee_cents, repaid_cents, status,
		       reviewed_by, reviewed_at, rejection_reason,
		       disbursed_at, repaid_at, stripe_transfer_id,
		       created_at, updated_at
		FROM working_capital_advances
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, whereClause, argIdx, argIdx+1)

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list advances query: %w", err)
	}
	defer rows.Close()

	var advances []*domain.Advance
	for rows.Next() {
		a := &domain.Advance{}
		err := rows.Scan(
			&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
			&a.FeeCents, &a.RepaidCents, &a.Status,
			&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
			&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
			&a.CreatedAt, &a.UpdatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("list advances scan: %w", err)
		}
		advances = append(advances, a)
	}

	return advances, totalCount, nil
}

func (r *PostgresRepository) GetAdvance(ctx context.Context, advanceID string) (*domain.Advance, error) {
	a := &domain.Advance{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, provider_id, contract_id, advance_amount_cents,
		       fee_cents, repaid_cents, status,
		       reviewed_by, reviewed_at, rejection_reason,
		       disbursed_at, repaid_at, stripe_transfer_id,
		       created_at, updated_at
		FROM working_capital_advances
		WHERE id = $1`, advanceID).Scan(
		&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
		&a.FeeCents, &a.RepaidCents, &a.Status,
		&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
		&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get advance: %w", domain.ErrAdvanceNotFound)
		}
		return nil, fmt.Errorf("get advance: %w", err)
	}
	return a, nil
}

func (r *PostgresRepository) UpdateAdvanceReview(ctx context.Context, advanceID string, status string, reviewerID string, rejectionReason *string) (*domain.Advance, error) {
	a := &domain.Advance{}
	err := r.pool.QueryRow(ctx, `
		UPDATE working_capital_advances SET
			status = $2,
			reviewed_by = $3,
			reviewed_at = now(),
			rejection_reason = $4,
			updated_at = now()
		WHERE id = $1 AND status = 'requested'
		RETURNING id, provider_id, contract_id, advance_amount_cents,
		          fee_cents, repaid_cents, status,
		          reviewed_by, reviewed_at, rejection_reason,
		          disbursed_at, repaid_at, stripe_transfer_id,
		          created_at, updated_at`,
		advanceID, status, reviewerID, rejectionReason,
	).Scan(
		&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
		&a.FeeCents, &a.RepaidCents, &a.Status,
		&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
		&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("review advance: %w (may already be reviewed)", domain.ErrAdvanceNotFound)
		}
		return nil, fmt.Errorf("review advance: %w", err)
	}
	return a, nil
}

func (r *PostgresRepository) UpdateAdvanceDisbursement(ctx context.Context, advanceID string, stripeTransferID string) (*domain.Advance, error) {
	a := &domain.Advance{}
	err := r.pool.QueryRow(ctx, `
		UPDATE working_capital_advances SET
			status = 'disbursed',
			disbursed_at = now(),
			stripe_transfer_id = $2,
			updated_at = now()
		WHERE id = $1 AND status = 'approved'
		RETURNING id, provider_id, contract_id, advance_amount_cents,
		          fee_cents, repaid_cents, status,
		          reviewed_by, reviewed_at, rejection_reason,
		          disbursed_at, repaid_at, stripe_transfer_id,
		          created_at, updated_at`,
		advanceID, stripeTransferID,
	).Scan(
		&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
		&a.FeeCents, &a.RepaidCents, &a.Status,
		&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
		&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("disburse advance: %w (may not be in approved status)", domain.ErrAdvanceNotFound)
		}
		return nil, fmt.Errorf("disburse advance: %w", err)
	}
	return a, nil
}

func (r *PostgresRepository) UpdateAdvanceRepayment(ctx context.Context, advanceID string, paymentID string, amountCents int64) (*domain.Advance, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("update advance repayment begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Insert the repayment record.
	_, err = tx.Exec(ctx, `
		INSERT INTO advance_repayments (advance_id, payment_id, amount_cents)
		VALUES ($1, $2, $3)`,
		advanceID, paymentID, amountCents,
	)
	if err != nil {
		return nil, fmt.Errorf("update advance repayment insert: %w", err)
	}

	// Update the advance: increment repaid_cents, determine new status.
	a := &domain.Advance{}
	err = tx.QueryRow(ctx, `
		UPDATE working_capital_advances SET
			repaid_cents = repaid_cents + $2,
			status = CASE
				WHEN repaid_cents + $2 >= advance_amount_cents + fee_cents THEN 'repaid'
				WHEN status = 'disbursed' THEN 'repaying'
				ELSE status
			END,
			repaid_at = CASE
				WHEN repaid_cents + $2 >= advance_amount_cents + fee_cents THEN now()
				ELSE repaid_at
			END,
			updated_at = now()
		WHERE id = $1
		RETURNING id, provider_id, contract_id, advance_amount_cents,
		          fee_cents, repaid_cents, status,
		          reviewed_by, reviewed_at, rejection_reason,
		          disbursed_at, repaid_at, stripe_transfer_id,
		          created_at, updated_at`,
		advanceID, amountCents,
	).Scan(
		&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
		&a.FeeCents, &a.RepaidCents, &a.Status,
		&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
		&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update advance repayment update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("update advance repayment commit: %w", err)
	}

	return a, nil
}

func (r *PostgresRepository) GetActiveAdvancesForProvider(ctx context.Context, providerID string) ([]*domain.Advance, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, provider_id, contract_id, advance_amount_cents,
		       fee_cents, repaid_cents, status,
		       reviewed_by, reviewed_at, rejection_reason,
		       disbursed_at, repaid_at, stripe_transfer_id,
		       created_at, updated_at
		FROM working_capital_advances
		WHERE provider_id = $1 AND status IN ('disbursed', 'repaying')
		ORDER BY created_at ASC`, providerID)
	if err != nil {
		return nil, fmt.Errorf("get active advances: %w", err)
	}
	defer rows.Close()

	var advances []*domain.Advance
	for rows.Next() {
		a := &domain.Advance{}
		err := rows.Scan(
			&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
			&a.FeeCents, &a.RepaidCents, &a.Status,
			&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
			&a.DisbursedAt, &a.RepaidAt, &a.StripeTransferID,
			&a.CreatedAt, &a.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("get active advances scan: %w", err)
		}
		advances = append(advances, a)
	}

	return advances, nil
}

func (r *PostgresRepository) GetCreditLimit(ctx context.Context, providerID string) (*domain.CreditLimit, error) {
	cl := &domain.CreditLimit{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, provider_id, max_advance_cents, total_outstanding_cents,
		       risk_score, last_computed_at, jobs_completed,
		       total_earnings_cents, avg_job_value_cents, on_time_rate,
		       created_at, updated_at
		FROM provider_credit_limits
		WHERE provider_id = $1`, providerID).Scan(
		&cl.ID, &cl.ProviderID, &cl.MaxAdvanceCents, &cl.TotalOutstandingCents,
		&cl.RiskScore, &cl.LastComputedAt, &cl.JobsCompleted,
		&cl.TotalEarningsCents, &cl.AvgJobValueCents, &cl.OnTimeRate,
		&cl.CreatedAt, &cl.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Return a zero-value credit limit for providers without one.
			return &domain.CreditLimit{ProviderID: providerID}, nil
		}
		return nil, fmt.Errorf("get credit limit: %w", err)
	}
	return cl, nil
}

func (r *PostgresRepository) UpsertCreditLimit(ctx context.Context, limit *domain.CreditLimit) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO provider_credit_limits (
			provider_id, max_advance_cents, total_outstanding_cents,
			risk_score, last_computed_at, jobs_completed,
			total_earnings_cents, avg_job_value_cents, on_time_rate
		) VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8)
		ON CONFLICT (provider_id) DO UPDATE SET
			max_advance_cents = EXCLUDED.max_advance_cents,
			total_outstanding_cents = EXCLUDED.total_outstanding_cents,
			risk_score = EXCLUDED.risk_score,
			last_computed_at = now(),
			jobs_completed = EXCLUDED.jobs_completed,
			total_earnings_cents = EXCLUDED.total_earnings_cents,
			avg_job_value_cents = EXCLUDED.avg_job_value_cents,
			on_time_rate = EXCLUDED.on_time_rate`,
		limit.ProviderID, limit.MaxAdvanceCents, limit.TotalOutstandingCents,
		limit.RiskScore, limit.JobsCompleted,
		limit.TotalEarningsCents, limit.AvgJobValueCents, limit.OnTimeRate,
	)
	if err != nil {
		return fmt.Errorf("upsert credit limit: %w", err)
	}
	return nil
}
