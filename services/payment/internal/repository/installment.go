package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

func (r *PostgresRepository) CreateInstallmentPlan(ctx context.Context, plan *domain.InstallmentPlan) error {
	err := r.pool.QueryRow(ctx, `
		INSERT INTO installment_plans (
			id, contract_id, customer_id, provider_id,
			total_amount_cents, bnpl_fee_cents, total_with_fee_cents,
			installment_count, per_installment_cents, fee_rate,
			status
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING created_at, updated_at`,
		plan.ID, plan.ContractID, plan.CustomerID, plan.ProviderID,
		plan.TotalAmountCents, plan.BNPLFeeCents, plan.TotalWithFeeCents,
		plan.InstallmentCount, plan.PerInstallmentCents, plan.FeeRate,
		plan.Status,
	).Scan(&plan.CreatedAt, &plan.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create installment plan: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetInstallmentPlan(ctx context.Context, planID string) (*domain.InstallmentPlan, error) {
	p := &domain.InstallmentPlan{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, contract_id, customer_id, provider_id,
		       total_amount_cents, bnpl_fee_cents, total_with_fee_cents,
		       installment_count, per_installment_cents, fee_rate,
		       status, provider_paid_at,
		       COALESCE(stripe_provider_transfer_id, ''),
		       created_at, updated_at
		FROM installment_plans
		WHERE id = $1`, planID).Scan(
		&p.ID, &p.ContractID, &p.CustomerID, &p.ProviderID,
		&p.TotalAmountCents, &p.BNPLFeeCents, &p.TotalWithFeeCents,
		&p.InstallmentCount, &p.PerInstallmentCents, &p.FeeRate,
		&p.Status, &p.ProviderPaidAt,
		&p.StripeProviderTransferID,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get installment plan: %w", domain.ErrInstallmentPlanNotFound)
		}
		return nil, fmt.Errorf("get installment plan: %w", err)
	}

	// Load scheduled installments for this plan.
	installments, err := r.GetScheduledInstallmentsForPlan(ctx, planID)
	if err != nil {
		return nil, fmt.Errorf("get installment plan installments: %w", err)
	}
	p.Installments = installments

	return p, nil
}

func (r *PostgresRepository) ListInstallmentPlans(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*domain.InstallmentPlan, int, error) {
	where := []string{"(customer_id = $1 OR provider_id = $1)"}
	args := []interface{}{userID}
	argIdx := 2

	if statusFilter != "" {
		where = append(where, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	var totalCount int
	err := r.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT COUNT(*) FROM installment_plans WHERE %s`, whereClause),
		args...,
	).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("list installment plans count: %w", err)
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
		SELECT id, contract_id, customer_id, provider_id,
		       total_amount_cents, bnpl_fee_cents, total_with_fee_cents,
		       installment_count, per_installment_cents, fee_rate,
		       status, provider_paid_at,
		       COALESCE(stripe_provider_transfer_id, ''),
		       created_at, updated_at
		FROM installment_plans
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, whereClause, argIdx, argIdx+1)

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list installment plans query: %w", err)
	}
	defer rows.Close()

	var plans []*domain.InstallmentPlan
	for rows.Next() {
		p := &domain.InstallmentPlan{}
		err := rows.Scan(
			&p.ID, &p.ContractID, &p.CustomerID, &p.ProviderID,
			&p.TotalAmountCents, &p.BNPLFeeCents, &p.TotalWithFeeCents,
			&p.InstallmentCount, &p.PerInstallmentCents, &p.FeeRate,
			&p.Status, &p.ProviderPaidAt,
			&p.StripeProviderTransferID,
			&p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("list installment plans scan: %w", err)
		}

		// Load installments for each plan.
		installments, err := r.GetScheduledInstallmentsForPlan(ctx, p.ID)
		if err != nil {
			return nil, 0, fmt.Errorf("list installment plans load installments: %w", err)
		}
		p.Installments = installments

		plans = append(plans, p)
	}

	return plans, totalCount, nil
}

func (r *PostgresRepository) CreateScheduledInstallments(ctx context.Context, installments []domain.ScheduledInstallment) error {
	for _, inst := range installments {
		_, err := r.pool.Exec(ctx, `
			INSERT INTO scheduled_installments (
				id, plan_id, installment_number, amount_cents,
				due_date, status, attempts
			) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			inst.ID, inst.PlanID, inst.InstallmentNumber, inst.AmountCents,
			inst.DueDate, inst.Status, inst.Attempts,
		)
		if err != nil {
			return fmt.Errorf("create scheduled installment %d: %w", inst.InstallmentNumber, err)
		}
	}
	return nil
}

func (r *PostgresRepository) GetScheduledInstallmentsForPlan(ctx context.Context, planID string) ([]domain.ScheduledInstallment, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, plan_id, installment_number, amount_cents,
		       due_date, payment_id, status, attempts,
		       last_attempt_at, paid_at,
		       created_at, updated_at
		FROM scheduled_installments
		WHERE plan_id = $1
		ORDER BY installment_number ASC`, planID)
	if err != nil {
		return nil, fmt.Errorf("get scheduled installments for plan: %w", err)
	}
	defer rows.Close()

	var installments []domain.ScheduledInstallment
	for rows.Next() {
		si := domain.ScheduledInstallment{}
		err := rows.Scan(
			&si.ID, &si.PlanID, &si.InstallmentNumber, &si.AmountCents,
			&si.DueDate, &si.PaymentID, &si.Status, &si.Attempts,
			&si.LastAttemptAt, &si.PaidAt,
			&si.CreatedAt, &si.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("get scheduled installments scan: %w", err)
		}
		installments = append(installments, si)
	}

	return installments, nil
}

func (r *PostgresRepository) GetDueInstallments(ctx context.Context, dueDate time.Time) ([]domain.ScheduledInstallment, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT si.id, si.plan_id, si.installment_number, si.amount_cents,
		       si.due_date, si.payment_id, si.status, si.attempts,
		       si.last_attempt_at, si.paid_at,
		       si.created_at, si.updated_at
		FROM scheduled_installments si
		JOIN installment_plans ip ON ip.id = si.plan_id
		WHERE si.due_date <= $1
		  AND si.status IN ('scheduled', 'retrying')
		  AND si.attempts < 3
		  AND ip.status = 'active'
		ORDER BY si.due_date ASC`, dueDate)
	if err != nil {
		return nil, fmt.Errorf("get due installments: %w", err)
	}
	defer rows.Close()

	var installments []domain.ScheduledInstallment
	for rows.Next() {
		si := domain.ScheduledInstallment{}
		err := rows.Scan(
			&si.ID, &si.PlanID, &si.InstallmentNumber, &si.AmountCents,
			&si.DueDate, &si.PaymentID, &si.Status, &si.Attempts,
			&si.LastAttemptAt, &si.PaidAt,
			&si.CreatedAt, &si.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("get due installments scan: %w", err)
		}
		installments = append(installments, si)
	}

	return installments, nil
}

func (r *PostgresRepository) UpdateScheduledInstallmentStatus(ctx context.Context, id string, status string, paymentID *string) error {
	var query string
	var args []interface{}

	switch status {
	case "paid":
		query = `UPDATE scheduled_installments SET
			status = $1, paid_at = now(), payment_id = $2,
			last_attempt_at = now(), attempts = attempts + 1,
			updated_at = now()
			WHERE id = $3`
		args = []interface{}{status, paymentID, id}
	case "processing":
		query = `UPDATE scheduled_installments SET
			status = $1, last_attempt_at = now(), attempts = attempts + 1,
			updated_at = now()
			WHERE id = $2`
		args = []interface{}{status, id}
	case "failed":
		query = `UPDATE scheduled_installments SET
			status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'retrying' END,
			last_attempt_at = now(), attempts = attempts + 1,
			updated_at = now()
			WHERE id = $1`
		args = []interface{}{id}
		// For failed, we auto-set retrying if < 3 attempts, failed if >= 3.
		tag, err := r.pool.Exec(ctx, query, args...)
		if err != nil {
			return fmt.Errorf("update scheduled installment status: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("update scheduled installment status: not found")
		}
		return nil
	default:
		query = `UPDATE scheduled_installments SET
			status = $1, updated_at = now()
			WHERE id = $2`
		args = []interface{}{status, id}
	}

	tag, err := r.pool.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("update scheduled installment status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update scheduled installment status: not found")
	}
	return nil
}

func (r *PostgresRepository) UpdateInstallmentPlanStatus(ctx context.Context, planID string, status string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE installment_plans SET status = $1, updated_at = now()
		WHERE id = $2`, status, planID)
	if err != nil {
		return fmt.Errorf("update installment plan status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update installment plan status: %w", domain.ErrInstallmentPlanNotFound)
	}
	return nil
}

func (r *PostgresRepository) UpdateInstallmentPlanProviderPaid(ctx context.Context, planID string, transferID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE installment_plans SET
			provider_paid_at = now(),
			stripe_provider_transfer_id = $2,
			updated_at = now()
		WHERE id = $1`, planID, transferID)
	if err != nil {
		return fmt.Errorf("update installment plan provider paid: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update installment plan provider paid: %w", domain.ErrInstallmentPlanNotFound)
	}
	return nil
}
