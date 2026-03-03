package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// CreateContract inserts a contract and its milestones in a transaction.
func (r *PostgresRepository) CreateContract(ctx context.Context, contract *domain.Contract, milestones []domain.MilestoneInput) (*domain.Contract, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create contract begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Generate contract number using sequence: NM-YYYY-NNNNN
	var seqVal int64
	err = tx.QueryRow(ctx, `SELECT nextval('contract_number_seq')`).Scan(&seqVal)
	if err != nil {
		return nil, fmt.Errorf("create contract nextval: %w", err)
	}
	contractNumber := fmt.Sprintf("NM-%d-%05d", time.Now().Year(), seqVal)

	var contractID string
	var createdAt, updatedAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO contracts (
			contract_number, job_id, customer_id, provider_id, bid_id,
			amount_cents, payment_timing, terms_json, schedule_json,
			status, customer_accepted, provider_accepted,
			acceptance_deadline, cancellation_reason
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9,
			$10, $11, $12,
			$13, ''
		)
		RETURNING id, created_at, updated_at`,
		contractNumber, contract.JobID, contract.CustomerID, contract.ProviderID, contract.BidID,
		contract.AmountCents, contract.PaymentTiming, contract.TermsJSON, contract.ScheduleJSON,
		contract.Status, contract.CustomerAccepted, contract.ProviderAccepted,
		contract.AcceptanceDeadline,
	).Scan(&contractID, &createdAt, &updatedAt)
	if err != nil {
		return nil, fmt.Errorf("create contract insert: %w", err)
	}

	// Insert milestones.
	for i, m := range milestones {
		_, err = tx.Exec(ctx, `
			INSERT INTO milestones (contract_id, description, amount_cents, sort_order, status)
			VALUES ($1, $2, $3, $4, 'pending')`,
			contractID, m.Description, m.AmountCents, i+1)
		if err != nil {
			return nil, fmt.Errorf("create contract insert milestone: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create contract commit: %w", err)
	}

	return r.GetContract(ctx, contractID)
}

// GetContract retrieves a contract with milestones and change orders.
func (r *PostgresRepository) GetContract(ctx context.Context, contractID string) (*domain.Contract, error) {
	var c domain.Contract
	var cancelledBy *string
	var cancellationReason *string

	err := r.pool.QueryRow(ctx, `
		SELECT id, contract_number, job_id, customer_id, provider_id, bid_id,
		       amount_cents, payment_timing, terms_json, schedule_json,
		       status, customer_accepted, provider_accepted,
		       acceptance_deadline, accepted_at, started_at, completed_at,
		       cancelled_at, cancelled_by, cancellation_reason,
		       created_at, updated_at
		FROM contracts
		WHERE id = $1`, contractID).Scan(
		&c.ID, &c.ContractNumber, &c.JobID, &c.CustomerID, &c.ProviderID, &c.BidID,
		&c.AmountCents, &c.PaymentTiming, &c.TermsJSON, &c.ScheduleJSON,
		&c.Status, &c.CustomerAccepted, &c.ProviderAccepted,
		&c.AcceptanceDeadline, &c.AcceptedAt, &c.StartedAt, &c.CompletedAt,
		&c.CancelledAt, &cancelledBy, &cancellationReason,
		&c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get contract: %w", domain.ErrContractNotFound)
		}
		return nil, fmt.Errorf("get contract: %w", err)
	}
	if cancelledBy != nil {
		c.CancelledBy = cancelledBy
	}
	if cancellationReason != nil {
		c.CancellationReason = *cancellationReason
	}

	// Load milestones.
	milestones, err := r.getContractMilestones(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("get contract milestones: %w", err)
	}
	c.Milestones = milestones

	// Load change orders.
	changeOrders, err := r.getContractChangeOrders(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("get contract change orders: %w", err)
	}
	c.ChangeOrders = changeOrders

	return &c, nil
}

// AcceptContract sets the acceptance flag for the given user role.
func (r *PostgresRepository) AcceptContract(ctx context.Context, contractID string, userID string, isCustomer bool) (*domain.Contract, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("accept contract begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var col string
	if isCustomer {
		col = "customer_accepted"
	} else {
		col = "provider_accepted"
	}

	// Update the acceptance flag.
	tag, err := tx.Exec(ctx, fmt.Sprintf(`
		UPDATE contracts SET %s = true, updated_at = now()
		WHERE id = $1 AND status = 'pending_acceptance'`, col), contractID)
	if err != nil {
		return nil, fmt.Errorf("accept contract update: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("accept contract: %w", domain.ErrContractNotFound)
	}

	// Check if both parties have now accepted.
	var custAccepted, provAccepted bool
	err = tx.QueryRow(ctx, `
		SELECT customer_accepted, provider_accepted FROM contracts WHERE id = $1`,
		contractID).Scan(&custAccepted, &provAccepted)
	if err != nil {
		return nil, fmt.Errorf("accept contract check: %w", err)
	}

	if custAccepted && provAccepted {
		_, err = tx.Exec(ctx, `
			UPDATE contracts SET status = 'active', accepted_at = now(), updated_at = now()
			WHERE id = $1`, contractID)
		if err != nil {
			return nil, fmt.Errorf("accept contract activate: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("accept contract commit: %w", err)
	}

	return r.GetContract(ctx, contractID)
}

// StartWork sets the contract to active with started_at and advances the first milestone.
func (r *PostgresRepository) StartWork(ctx context.Context, contractID string) (*domain.Contract, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("start work begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE contracts SET started_at = now(), updated_at = now()
		WHERE id = $1 AND status = 'active'`, contractID)
	if err != nil {
		return nil, fmt.Errorf("start work update: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("start work: %w", domain.ErrContractNotActive)
	}

	// Advance first milestone to in_progress.
	_, err = tx.Exec(ctx, `
		UPDATE milestones SET status = 'in_progress', updated_at = now()
		WHERE id = (
			SELECT id FROM milestones
			WHERE contract_id = $1 AND status = 'pending'
			ORDER BY sort_order ASC
			LIMIT 1
		)`, contractID)
	if err != nil {
		return nil, fmt.Errorf("start work advance milestone: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("start work commit: %w", err)
	}

	return r.GetContract(ctx, contractID)
}

// ListContracts lists contracts for a user with optional status filter and pagination.
func (r *PostgresRepository) ListContracts(ctx context.Context, userID string, statusFilter *string, page, pageSize int) ([]*domain.Contract, *domain.Pagination, error) {
	where := "(customer_id = $1 OR provider_id = $1)"
	args := []interface{}{userID}
	argIdx := 2

	if statusFilter != nil && *statusFilter != "" {
		where += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, *statusFilter)
		argIdx++
	}

	// Count.
	var totalCount int
	err := r.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT COUNT(*) FROM contracts WHERE %s`, where), args...).Scan(&totalCount)
	if err != nil {
		return nil, nil, fmt.Errorf("list contracts count: %w", err)
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

	totalPages := 0
	if totalCount > 0 {
		totalPages = (totalCount + pageSize - 1) / pageSize
	}
	offset := (page - 1) * pageSize

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, contract_number, job_id, customer_id, provider_id, bid_id,
		       amount_cents, payment_timing, status,
		       customer_accepted, provider_accepted,
		       acceptance_deadline, accepted_at, started_at, completed_at,
		       cancelled_at, created_at, updated_at
		FROM contracts
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1), args...)
	if err != nil {
		return nil, nil, fmt.Errorf("list contracts query: %w", err)
	}
	defer rows.Close()

	var contracts []*domain.Contract
	for rows.Next() {
		var c domain.Contract
		err := rows.Scan(
			&c.ID, &c.ContractNumber, &c.JobID, &c.CustomerID, &c.ProviderID, &c.BidID,
			&c.AmountCents, &c.PaymentTiming, &c.Status,
			&c.CustomerAccepted, &c.ProviderAccepted,
			&c.AcceptanceDeadline, &c.AcceptedAt, &c.StartedAt, &c.CompletedAt,
			&c.CancelledAt, &c.CreatedAt, &c.UpdatedAt,
		)
		if err != nil {
			return nil, nil, fmt.Errorf("list contracts scan: %w", err)
		}
		contracts = append(contracts, &c)
	}

	return contracts, &domain.Pagination{
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasNext:    page < totalPages,
	}, nil
}

// SubmitMilestone validates the milestone is in_progress and updates it to submitted.
func (r *PostgresRepository) SubmitMilestone(ctx context.Context, milestoneID string) (*domain.Milestone, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE milestones SET status = 'submitted', submitted_at = now(), updated_at = now()
		WHERE id = $1 AND status IN ('in_progress', 'revision_requested')`,
		milestoneID)
	if err != nil {
		return nil, fmt.Errorf("submit milestone: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Check if exists.
		_, err := r.GetMilestone(ctx, milestoneID)
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("submit milestone: %w", domain.ErrInvalidStatusTransition)
	}
	return r.GetMilestone(ctx, milestoneID)
}

// ApproveMilestone approves a milestone and advances the next one to in_progress.
func (r *PostgresRepository) ApproveMilestone(ctx context.Context, milestoneID string) (*domain.Milestone, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("approve milestone begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get the milestone's contract_id and sort_order before updating.
	var contractID string
	var sortOrder int
	err = tx.QueryRow(ctx, `
		SELECT contract_id, sort_order FROM milestones WHERE id = $1 AND status = 'submitted'`,
		milestoneID).Scan(&contractID, &sortOrder)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Check if milestone exists at all.
			var exists bool
			_ = r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM milestones WHERE id = $1)`, milestoneID).Scan(&exists)
			if !exists {
				return nil, fmt.Errorf("approve milestone: %w", domain.ErrMilestoneNotFound)
			}
			return nil, fmt.Errorf("approve milestone: %w", domain.ErrInvalidStatusTransition)
		}
		return nil, fmt.Errorf("approve milestone lookup: %w", err)
	}

	// Approve the milestone.
	_, err = tx.Exec(ctx, `
		UPDATE milestones SET status = 'approved', approved_at = now(), updated_at = now()
		WHERE id = $1`, milestoneID)
	if err != nil {
		return nil, fmt.Errorf("approve milestone update: %w", err)
	}

	// Advance the next pending milestone to in_progress.
	_, err = tx.Exec(ctx, `
		UPDATE milestones SET status = 'in_progress', updated_at = now()
		WHERE id = (
			SELECT id FROM milestones
			WHERE contract_id = $1 AND sort_order > $2 AND status = 'pending'
			ORDER BY sort_order ASC
			LIMIT 1
		)`, contractID, sortOrder)
	if err != nil {
		return nil, fmt.Errorf("approve milestone advance next: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("approve milestone commit: %w", err)
	}

	return r.GetMilestone(ctx, milestoneID)
}

// RequestRevision checks revision count and updates milestone status.
func (r *PostgresRepository) RequestRevision(ctx context.Context, milestoneID string, notes string) (*domain.Milestone, error) {
	// Check current revision count.
	var revisionCount int
	var currentStatus string
	err := r.pool.QueryRow(ctx, `
		SELECT revision_count, status FROM milestones WHERE id = $1`, milestoneID).
		Scan(&revisionCount, &currentStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("request revision: %w", domain.ErrMilestoneNotFound)
		}
		return nil, fmt.Errorf("request revision lookup: %w", err)
	}

	if currentStatus != "submitted" {
		return nil, fmt.Errorf("request revision: %w", domain.ErrInvalidStatusTransition)
	}

	if revisionCount >= 3 {
		return nil, fmt.Errorf("request revision: %w", domain.ErrMaxRevisions)
	}

	// Set to in_progress with incremented revision count.
	tag, err := r.pool.Exec(ctx, `
		UPDATE milestones
		SET status = 'in_progress',
		    revision_count = revision_count + 1,
		    revision_notes = $2,
		    updated_at = now()
		WHERE id = $1`,
		milestoneID, notes)
	if err != nil {
		return nil, fmt.Errorf("request revision update: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("request revision: %w", domain.ErrMilestoneNotFound)
	}

	return r.GetMilestone(ctx, milestoneID)
}

// MarkComplete marks a contract as completed.
func (r *PostgresRepository) MarkComplete(ctx context.Context, contractID string) (*domain.Contract, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE contracts SET status = 'completed', completed_at = now(), updated_at = now()
		WHERE id = $1 AND status = 'active'`, contractID)
	if err != nil {
		return nil, fmt.Errorf("mark complete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		_, err := r.GetContract(ctx, contractID)
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("mark complete: %w", domain.ErrContractNotActive)
	}
	return r.GetContract(ctx, contractID)
}

// ApproveCompletion approves the completion of a contract (sets status to completed if not already).
func (r *PostgresRepository) ApproveCompletion(ctx context.Context, contractID string) (*domain.Contract, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE contracts SET status = 'completed', completed_at = now(), updated_at = now()
		WHERE id = $1 AND status = 'active'`, contractID)
	if err != nil {
		return nil, fmt.Errorf("approve completion: %w", err)
	}
	if tag.RowsAffected() == 0 {
		_, err := r.GetContract(ctx, contractID)
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("approve completion: %w", domain.ErrContractNotActive)
	}
	return r.GetContract(ctx, contractID)
}

// CancelContract cancels a contract.
func (r *PostgresRepository) CancelContract(ctx context.Context, contractID string, userID string, reason string) (*domain.Contract, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE contracts
		SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2,
		    cancellation_reason = $3, updated_at = now()
		WHERE id = $1 AND status IN ('pending_acceptance', 'active')`,
		contractID, userID, reason)
	if err != nil {
		return nil, fmt.Errorf("cancel contract: %w", err)
	}
	if tag.RowsAffected() == 0 {
		_, err := r.GetContract(ctx, contractID)
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("cancel contract: %w", domain.ErrInvalidStatusTransition)
	}
	return r.GetContract(ctx, contractID)
}

// GetMilestone retrieves a single milestone by ID.
func (r *PostgresRepository) GetMilestone(ctx context.Context, milestoneID string) (*domain.Milestone, error) {
	var m domain.Milestone
	var revisionNotes *string
	err := r.pool.QueryRow(ctx, `
		SELECT id, contract_id, description, amount_cents, sort_order,
		       status, revision_count, revision_notes,
		       submitted_at, approved_at, created_at, updated_at
		FROM milestones
		WHERE id = $1`, milestoneID).Scan(
		&m.ID, &m.ContractID, &m.Description, &m.AmountCents, &m.SortOrder,
		&m.Status, &m.RevisionCount, &revisionNotes,
		&m.SubmittedAt, &m.ApprovedAt, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get milestone: %w", domain.ErrMilestoneNotFound)
		}
		return nil, fmt.Errorf("get milestone: %w", err)
	}
	if revisionNotes != nil {
		m.RevisionNotes = *revisionNotes
	}
	return &m, nil
}

// UpdateJobStatus updates the status of a job.
func (r *PostgresRepository) UpdateJobStatus(ctx context.Context, jobID string, status string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE jobs SET status = $2, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL`, jobID, status)
	if err != nil {
		return fmt.Errorf("update job status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update job status: %w", domain.ErrJobNotFound)
	}
	return nil
}

// getContractMilestones loads milestones for a contract.
func (r *PostgresRepository) getContractMilestones(ctx context.Context, contractID string) ([]domain.Milestone, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, contract_id, description, amount_cents, sort_order,
		       status, revision_count, revision_notes,
		       submitted_at, approved_at, created_at, updated_at
		FROM milestones
		WHERE contract_id = $1
		ORDER BY sort_order`, contractID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var milestones []domain.Milestone
	for rows.Next() {
		var m domain.Milestone
		var revisionNotes *string
		if err := rows.Scan(
			&m.ID, &m.ContractID, &m.Description, &m.AmountCents, &m.SortOrder,
			&m.Status, &m.RevisionCount, &revisionNotes,
			&m.SubmittedAt, &m.ApprovedAt, &m.CreatedAt, &m.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if revisionNotes != nil {
			m.RevisionNotes = *revisionNotes
		}
		milestones = append(milestones, m)
	}
	return milestones, nil
}

// getContractChangeOrders loads change orders for a contract.
func (r *PostgresRepository) getContractChangeOrders(ctx context.Context, contractID string) ([]domain.ChangeOrder, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, contract_id, proposed_by, description,
		       changes_json, amount_delta_cents, status,
		       accepted_at, rejected_at, created_at, updated_at
		FROM change_orders
		WHERE contract_id = $1
		ORDER BY created_at DESC`, contractID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []domain.ChangeOrder
	for rows.Next() {
		var o domain.ChangeOrder
		if err := rows.Scan(
			&o.ID, &o.ContractID, &o.ProposedBy, &o.Description,
			&o.ChangesJSON, &o.AmountDeltaCents, &o.Status,
			&o.AcceptedAt, &o.RejectedAt, &o.CreatedAt, &o.UpdatedAt,
		); err != nil {
			return nil, err
		}
		orders = append(orders, o)
	}
	return orders, nil
}
