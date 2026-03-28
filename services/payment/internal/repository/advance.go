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
		       disbursed_at, repaid_at,
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
			&a.DisbursedAt, &a.RepaidAt,
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
		       disbursed_at, repaid_at,
		       created_at, updated_at
		FROM working_capital_advances
		WHERE id = $1`, advanceID).Scan(
		&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
		&a.FeeCents, &a.RepaidCents, &a.Status,
		&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
		&a.DisbursedAt, &a.RepaidAt,
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
		          disbursed_at, repaid_at,
		          created_at, updated_at`,
		advanceID, status, reviewerID, rejectionReason,
	).Scan(
		&a.ID, &a.ProviderID, &a.ContractID, &a.AdvanceAmountCents,
		&a.FeeCents, &a.RepaidCents, &a.Status,
		&a.ReviewedBy, &a.ReviewedAt, &a.RejectionReason,
		&a.DisbursedAt, &a.RepaidAt,
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
