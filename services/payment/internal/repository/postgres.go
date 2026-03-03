package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// PostgresRepository implements domain.PaymentRepository using pgx.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository creates a new PostgreSQL-backed payment repository.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) CreatePayment(ctx context.Context, payment *domain.Payment) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO payments (
			id, contract_id, milestone_id, recurring_instance_id,
			customer_id, provider_id, amount_cents,
			platform_fee_cents, guarantee_fee_cents, provider_payout_cents,
			stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id, stripe_refund_id,
			idempotency_key, status, failure_reason,
			refund_amount_cents, refund_reason,
			installment_number, total_installments,
			retry_count
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7,
			$8, $9, $10,
			$11, $12, $13, $14,
			$15, $16, $17,
			$18, $19,
			$20, $21,
			$22
		)`,
		payment.ID, payment.ContractID, payment.MilestoneID, payment.RecurringInstanceID,
		payment.CustomerID, payment.ProviderID, payment.AmountCents,
		payment.PlatformFeeCents, payment.GuaranteeFeeCents, payment.ProviderPayoutCents,
		payment.StripePaymentIntentID, payment.StripeChargeID, payment.StripeTransferID, payment.StripeRefundID,
		payment.IdempotencyKey, payment.Status, payment.FailureReason,
		payment.RefundAmountCents, payment.RefundReason,
		payment.InstallmentNumber, payment.TotalInstallments,
		payment.RetryCount,
	)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") && strings.Contains(err.Error(), "idempotency_key") {
			return fmt.Errorf("create payment: %w", domain.ErrIdempotencyConflict)
		}
		return fmt.Errorf("create payment: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetPayment(ctx context.Context, id string) (*domain.Payment, error) {
	p := &domain.Payment{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, contract_id, milestone_id, recurring_instance_id,
		       customer_id, provider_id, amount_cents,
		       platform_fee_cents, guarantee_fee_cents, provider_payout_cents,
		       COALESCE(stripe_payment_intent_id, ''), COALESCE(stripe_charge_id, ''), COALESCE(stripe_transfer_id, ''), COALESCE(stripe_refund_id, ''),
		       COALESCE(idempotency_key, ''), status, COALESCE(failure_reason, ''),
		       refund_amount_cents, COALESCE(refund_reason, ''), refunded_at,
		       installment_number, total_installments,
		       retry_count, next_retry_at,
		       escrow_at, released_at, completed_at,
		       created_at, updated_at
		FROM payments
		WHERE id = $1`, id).Scan(
		&p.ID, &p.ContractID, &p.MilestoneID, &p.RecurringInstanceID,
		&p.CustomerID, &p.ProviderID, &p.AmountCents,
		&p.PlatformFeeCents, &p.GuaranteeFeeCents, &p.ProviderPayoutCents,
		&p.StripePaymentIntentID, &p.StripeChargeID, &p.StripeTransferID, &p.StripeRefundID,
		&p.IdempotencyKey, &p.Status, &p.FailureReason,
		&p.RefundAmountCents, &p.RefundReason, &p.RefundedAt,
		&p.InstallmentNumber, &p.TotalInstallments,
		&p.RetryCount, &p.NextRetryAt,
		&p.EscrowAt, &p.ReleasedAt, &p.CompletedAt,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get payment: %w", domain.ErrPaymentNotFound)
		}
		return nil, fmt.Errorf("get payment: %w", err)
	}
	return p, nil
}

func (r *PostgresRepository) UpdatePaymentStatus(ctx context.Context, id string, status string) error {
	var query string
	switch status {
	case "escrow":
		query = `UPDATE payments SET status = $1, escrow_at = now(), updated_at = now() WHERE id = $2`
	case "released":
		query = `UPDATE payments SET status = $1, released_at = now(), updated_at = now() WHERE id = $2`
	case "completed":
		query = `UPDATE payments SET status = $1, completed_at = now(), updated_at = now() WHERE id = $2`
	default:
		query = `UPDATE payments SET status = $1, updated_at = now() WHERE id = $2`
	}

	tag, err := r.pool.Exec(ctx, query, status, id)
	if err != nil {
		return fmt.Errorf("update payment status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update payment status: %w", domain.ErrPaymentNotFound)
	}
	return nil
}

func (r *PostgresRepository) ListPayments(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*domain.Payment, int, error) {
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
	err := r.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM payments WHERE %s`, whereClause), args...).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("list payments count: %w", err)
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
		SELECT id, contract_id, milestone_id, recurring_instance_id,
		       customer_id, provider_id, amount_cents,
		       platform_fee_cents, guarantee_fee_cents, provider_payout_cents,
		       COALESCE(stripe_payment_intent_id, ''), COALESCE(stripe_charge_id, ''), COALESCE(stripe_transfer_id, ''), COALESCE(stripe_refund_id, ''),
		       COALESCE(idempotency_key, ''), status, COALESCE(failure_reason, ''),
		       refund_amount_cents, COALESCE(refund_reason, ''), refunded_at,
		       installment_number, total_installments,
		       retry_count, next_retry_at,
		       escrow_at, released_at, completed_at,
		       created_at, updated_at
		FROM payments
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, whereClause, argIdx, argIdx+1)

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list payments query: %w", err)
	}
	defer rows.Close()

	var payments []*domain.Payment
	for rows.Next() {
		p := &domain.Payment{}
		err := rows.Scan(
			&p.ID, &p.ContractID, &p.MilestoneID, &p.RecurringInstanceID,
			&p.CustomerID, &p.ProviderID, &p.AmountCents,
			&p.PlatformFeeCents, &p.GuaranteeFeeCents, &p.ProviderPayoutCents,
			&p.StripePaymentIntentID, &p.StripeChargeID, &p.StripeTransferID, &p.StripeRefundID,
			&p.IdempotencyKey, &p.Status, &p.FailureReason,
			&p.RefundAmountCents, &p.RefundReason, &p.RefundedAt,
			&p.InstallmentNumber, &p.TotalInstallments,
			&p.RetryCount, &p.NextRetryAt,
			&p.EscrowAt, &p.ReleasedAt, &p.CompletedAt,
			&p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("list payments scan: %w", err)
		}
		payments = append(payments, p)
	}

	return payments, totalCount, nil
}

func (r *PostgresRepository) GetFeeConfig(ctx context.Context, categoryID string) (*domain.FeeConfig, error) {
	fc := &domain.FeeConfig{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, category_id, fee_percentage, guarantee_percentage,
		       min_fee_cents, max_fee_cents, active, effective_from,
		       created_at, updated_at
		FROM platform_fee_config
		WHERE category_id = $1 AND active = true
		ORDER BY effective_from DESC
		LIMIT 1`, categoryID).Scan(
		&fc.ID, &fc.CategoryID, &fc.FeePercentage, &fc.GuaranteePercentage,
		&fc.MinFeeCents, &fc.MaxFeeCents, &fc.Active, &fc.EffectiveFrom,
		&fc.CreatedAt, &fc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get fee config: %w", domain.ErrFeeConfigNotFound)
		}
		return nil, fmt.Errorf("get fee config: %w", err)
	}
	return fc, nil
}

func (r *PostgresRepository) GetDefaultFeeConfig(ctx context.Context) (*domain.FeeConfig, error) {
	fc := &domain.FeeConfig{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, category_id, fee_percentage, guarantee_percentage,
		       min_fee_cents, max_fee_cents, active, effective_from,
		       created_at, updated_at
		FROM platform_fee_config
		WHERE category_id IS NULL AND active = true
		ORDER BY effective_from DESC
		LIMIT 1`).Scan(
		&fc.ID, &fc.CategoryID, &fc.FeePercentage, &fc.GuaranteePercentage,
		&fc.MinFeeCents, &fc.MaxFeeCents, &fc.Active, &fc.EffectiveFrom,
		&fc.CreatedAt, &fc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get default fee config: %w", domain.ErrFeeConfigNotFound)
		}
		return nil, fmt.Errorf("get default fee config: %w", err)
	}
	return fc, nil
}

func (r *PostgresRepository) FindByStripePaymentIntentID(ctx context.Context, paymentIntentID string) (*domain.Payment, error) {
	p := &domain.Payment{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, contract_id, milestone_id, recurring_instance_id,
		       customer_id, provider_id, amount_cents,
		       platform_fee_cents, guarantee_fee_cents, provider_payout_cents,
		       COALESCE(stripe_payment_intent_id, ''), COALESCE(stripe_charge_id, ''), COALESCE(stripe_transfer_id, ''), COALESCE(stripe_refund_id, ''),
		       COALESCE(idempotency_key, ''), status, COALESCE(failure_reason, ''),
		       refund_amount_cents, COALESCE(refund_reason, ''), refunded_at,
		       installment_number, total_installments,
		       retry_count, next_retry_at,
		       escrow_at, released_at, completed_at,
		       created_at, updated_at
		FROM payments
		WHERE stripe_payment_intent_id = $1`, paymentIntentID).Scan(
		&p.ID, &p.ContractID, &p.MilestoneID, &p.RecurringInstanceID,
		&p.CustomerID, &p.ProviderID, &p.AmountCents,
		&p.PlatformFeeCents, &p.GuaranteeFeeCents, &p.ProviderPayoutCents,
		&p.StripePaymentIntentID, &p.StripeChargeID, &p.StripeTransferID, &p.StripeRefundID,
		&p.IdempotencyKey, &p.Status, &p.FailureReason,
		&p.RefundAmountCents, &p.RefundReason, &p.RefundedAt,
		&p.InstallmentNumber, &p.TotalInstallments,
		&p.RetryCount, &p.NextRetryAt,
		&p.EscrowAt, &p.ReleasedAt, &p.CompletedAt,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("find by stripe payment intent: %w", domain.ErrPaymentNotFound)
		}
		return nil, fmt.Errorf("find by stripe payment intent: %w", err)
	}
	return p, nil
}

func (r *PostgresRepository) UpdateStripeFields(ctx context.Context, id string, paymentIntentID, chargeID, transferID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE payments SET
			stripe_payment_intent_id = COALESCE(NULLIF($2, ''), stripe_payment_intent_id),
			stripe_charge_id = COALESCE(NULLIF($3, ''), stripe_charge_id),
			stripe_transfer_id = COALESCE(NULLIF($4, ''), stripe_transfer_id),
			updated_at = now()
		WHERE id = $1`, id, paymentIntentID, chargeID, transferID)
	if err != nil {
		return fmt.Errorf("update stripe fields: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update stripe fields: %w", domain.ErrPaymentNotFound)
	}
	return nil
}

func (r *PostgresRepository) UpdateRefund(ctx context.Context, id string, refundAmountCents int64, refundReason string, refundedAt time.Time, stripeRefundID string, status string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE payments SET
			refund_amount_cents = $2,
			refund_reason = $3,
			refunded_at = $4,
			stripe_refund_id = $5,
			status = $6,
			updated_at = now()
		WHERE id = $1`, id, refundAmountCents, refundReason, refundedAt, stripeRefundID, status)
	if err != nil {
		return fmt.Errorf("update refund: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update refund: %w", domain.ErrPaymentNotFound)
	}
	return nil
}

func (r *PostgresRepository) GetStripeAccountID(ctx context.Context, userID string) (string, error) {
	var accountID *string
	err := r.pool.QueryRow(ctx, `
		SELECT stripe_account_id FROM users WHERE id = $1`, userID).Scan(&accountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("get stripe account: %w", domain.ErrStripeAccountNotFound)
		}
		return "", fmt.Errorf("get stripe account: %w", err)
	}
	if accountID == nil || *accountID == "" {
		return "", fmt.Errorf("get stripe account: %w", domain.ErrStripeAccountNotFound)
	}
	return *accountID, nil
}

func (r *PostgresRepository) SetStripeAccountID(ctx context.Context, userID string, stripeAccountID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET stripe_account_id = $2, updated_at = now() WHERE id = $1`,
		userID, stripeAccountID)
	if err != nil {
		return fmt.Errorf("set stripe account: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("set stripe account: user not found")
	}
	return nil
}
