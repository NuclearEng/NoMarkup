package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// GetRecurringConfigByContract returns the recurring config for a contract, if any.
func (r *PostgresRepository) GetRecurringConfigByContract(ctx context.Context, contractID string) (*domain.RecurringConfig, error) {
	cfg, err := r.scanRecurringConfig(ctx, `
		SELECT id, contract_id, frequency, rate_cents, auto_approve, status,
		       paused_at, pause_max_date, next_occurrence, cancelled_at, cancelled_by,
		       notice_period_end, created_at, updated_at
		FROM recurring_configs
		WHERE contract_id = $1`, contractID)
	if err != nil {
		if errors.Is(err, domain.ErrRecurringNotFound) {
			return nil, fmt.Errorf("get recurring config by contract: %w", domain.ErrRecurringNotFound)
		}
		return nil, fmt.Errorf("get recurring config by contract: %w", err)
	}
	return cfg, nil
}

// GetRecurringConfigByID returns a recurring config by primary key.
func (r *PostgresRepository) GetRecurringConfigByID(ctx context.Context, recurringID string) (*domain.RecurringConfig, error) {
	cfg, err := r.scanRecurringConfig(ctx, `
		SELECT id, contract_id, frequency, rate_cents, auto_approve, status,
		       paused_at, pause_max_date, next_occurrence, cancelled_at, cancelled_by,
		       notice_period_end, created_at, updated_at
		FROM recurring_configs
		WHERE id = $1`, recurringID)
	if err != nil {
		if errors.Is(err, domain.ErrRecurringNotFound) {
			return nil, fmt.Errorf("get recurring config: %w", domain.ErrRecurringNotFound)
		}
		return nil, fmt.Errorf("get recurring config: %w", err)
	}
	return cfg, nil
}

func (r *PostgresRepository) scanRecurringConfig(ctx context.Context, query string, arg any) (*domain.RecurringConfig, error) {
	var cfg domain.RecurringConfig
	var nextOcc time.Time
	var noticeEnd *time.Time
	err := r.pool.QueryRow(ctx, query, arg).Scan(
		&cfg.ID, &cfg.ContractID, &cfg.Frequency, &cfg.RateCents, &cfg.AutoApprove, &cfg.Status,
		&cfg.PausedAt, &cfg.PauseMaxDate, &nextOcc, &cfg.CancelledAt, &cfg.CancelledBy,
		&noticeEnd, &cfg.CreatedAt, &cfg.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrRecurringNotFound
	}
	if err != nil {
		return nil, err
	}
	cfg.NextOccurrence = dateOnlyUTC(nextOcc)
	if noticeEnd != nil {
		t := dateOnlyUTC(*noticeEnd)
		cfg.NoticePeriodEnd = &t
	}
	return &cfg, nil
}

// CreateRecurringConfig inserts a new recurring_configs row.
func (r *PostgresRepository) CreateRecurringConfig(ctx context.Context, cfg *domain.RecurringConfig) (*domain.RecurringConfig, error) {
	if cfg == nil {
		return nil, fmt.Errorf("create recurring config: nil config")
	}
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO recurring_configs (
			contract_id, frequency, rate_cents, auto_approve, status,
			next_occurrence, paused_at, pause_max_date
		) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)
		RETURNING id`,
		cfg.ContractID, cfg.Frequency, cfg.RateCents, cfg.AutoApprove, cfg.Status,
		cfg.NextOccurrence.UTC().Format("2006-01-02"),
		cfg.PausedAt, cfg.PauseMaxDate,
	).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("create recurring config: %w", err)
	}
	return r.GetRecurringConfigByID(ctx, id)
}

// UpdateRecurringConfig persists status/rate/auto_approve/pause/cancel fields.
func (r *PostgresRepository) UpdateRecurringConfig(ctx context.Context, cfg *domain.RecurringConfig) (*domain.RecurringConfig, error) {
	if cfg == nil || cfg.ID == "" {
		return nil, fmt.Errorf("update recurring config: missing id")
	}
	var notice *string
	if cfg.NoticePeriodEnd != nil {
		s := cfg.NoticePeriodEnd.UTC().Format("2006-01-02")
		notice = &s
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE recurring_configs SET
			frequency = $2,
			rate_cents = $3,
			auto_approve = $4,
			status = $5,
			paused_at = $6,
			pause_max_date = $7,
			next_occurrence = $8::date,
			cancelled_at = $9,
			cancelled_by = $10,
			notice_period_end = $11::date,
			updated_at = now()
		WHERE id = $1`,
		cfg.ID, cfg.Frequency, cfg.RateCents, cfg.AutoApprove, cfg.Status,
		cfg.PausedAt, cfg.PauseMaxDate,
		cfg.NextOccurrence.UTC().Format("2006-01-02"),
		cfg.CancelledAt, cfg.CancelledBy, notice,
	)
	if err != nil {
		return nil, fmt.Errorf("update recurring config: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("update recurring config: %w", domain.ErrRecurringNotFound)
	}
	return r.GetRecurringConfigByID(ctx, cfg.ID)
}

// ListRecurringInstances lists instances for a recurring config, newest first by occurrence.
func (r *PostgresRepository) ListRecurringInstances(ctx context.Context, recurringID string, page, pageSize int) ([]*domain.RecurringInstance, *domain.Pagination, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	var totalCount int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM recurring_instances WHERE recurring_id = $1`, recurringID,
	).Scan(&totalCount)
	if err != nil {
		return nil, nil, fmt.Errorf("list recurring instances count: %w", err)
	}

	totalPages := 0
	if totalCount > 0 {
		totalPages = (totalCount + pageSize - 1) / pageSize
	}
	offset := (page - 1) * pageSize

	rows, err := r.pool.Query(ctx, `
		SELECT id, recurring_id, contract_id, occurrence_date, status, amount_cents,
		       completed_at, approved_at, auto_approved, created_at, updated_at
		FROM recurring_instances
		WHERE recurring_id = $1
		ORDER BY occurrence_date DESC, created_at DESC
		LIMIT $2 OFFSET $3`, recurringID, pageSize, offset)
	if err != nil {
		return nil, nil, fmt.Errorf("list recurring instances: %w", err)
	}
	defer rows.Close()

	var out []*domain.RecurringInstance
	for rows.Next() {
		inst, err := scanRecurringInstance(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("list recurring instances scan: %w", err)
		}
		out = append(out, inst)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("list recurring instances rows: %w", err)
	}

	return out, &domain.Pagination{
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasNext:    page < totalPages,
	}, nil
}

// GetRecurringInstance loads one instance by id.
func (r *PostgresRepository) GetRecurringInstance(ctx context.Context, instanceID string) (*domain.RecurringInstance, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, recurring_id, contract_id, occurrence_date, status, amount_cents,
		       completed_at, approved_at, auto_approved, created_at, updated_at
		FROM recurring_instances
		WHERE id = $1`, instanceID)
	inst, err := scanRecurringInstance(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("get recurring instance: %w", domain.ErrRecurringInstanceNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("get recurring instance: %w", err)
	}
	return inst, nil
}

// CreateRecurringInstance inserts a scheduled (or other) instance.
func (r *PostgresRepository) CreateRecurringInstance(ctx context.Context, inst *domain.RecurringInstance) (*domain.RecurringInstance, error) {
	if inst == nil {
		return nil, fmt.Errorf("create recurring instance: nil instance")
	}
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO recurring_instances (
			recurring_id, contract_id, occurrence_date, status, amount_cents, auto_approved
		) VALUES ($1, $2, $3::date, $4, $5, $6)
		RETURNING id`,
		inst.RecurringID, inst.ContractID,
		inst.OccurrenceDate.UTC().Format("2006-01-02"),
		inst.Status, inst.AmountCents, inst.AutoApproved,
	).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("create recurring instance: %w", err)
	}
	return r.GetRecurringInstance(ctx, id)
}

// UpdateRecurringInstance updates status / completion / approval fields.
func (r *PostgresRepository) UpdateRecurringInstance(ctx context.Context, inst *domain.RecurringInstance) (*domain.RecurringInstance, error) {
	if inst == nil || inst.ID == "" {
		return nil, fmt.Errorf("update recurring instance: missing id")
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE recurring_instances SET
			status = $2,
			amount_cents = $3,
			completed_at = $4,
			approved_at = $5,
			auto_approved = $6,
			updated_at = now()
		WHERE id = $1`,
		inst.ID, inst.Status, inst.AmountCents, inst.CompletedAt, inst.ApprovedAt, inst.AutoApproved,
	)
	if err != nil {
		return nil, fmt.Errorf("update recurring instance: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("update recurring instance: %w", domain.ErrRecurringInstanceNotFound)
	}
	return r.GetRecurringInstance(ctx, inst.ID)
}

type scannable interface {
	Scan(dest ...any) error
}

func scanRecurringInstance(row scannable) (*domain.RecurringInstance, error) {
	var inst domain.RecurringInstance
	var occ time.Time
	err := row.Scan(
		&inst.ID, &inst.RecurringID, &inst.ContractID, &occ, &inst.Status, &inst.AmountCents,
		&inst.CompletedAt, &inst.ApprovedAt, &inst.AutoApproved, &inst.CreatedAt, &inst.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	inst.OccurrenceDate = dateOnlyUTC(occ)
	return &inst, nil
}

func dateOnlyUTC(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
