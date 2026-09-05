package repository

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/payment/internal/crypto"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// PostgresRepository implements domain.PaymentRepository using pgx.
type PostgresRepository struct {
	pool   *pgxpool.Pool
	cipher *crypto.Cipher
}

// NewPostgresRepository creates a new PostgreSQL-backed payment repository.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// SetCipher wires the PII cipher used to decrypt at-rest provider PII (e.g.
// provider_profiles.service_address when generating 1099-NEC tax forms). It is
// set after construction so the constructor signature stays stable. When nil,
// plaintext-shaped values still pass through; secretbox-shaped values fail
// closed rather than leaking ciphertext.
func (r *PostgresRepository) SetCipher(c *crypto.Cipher) {
	r.cipher = c
}

// IsEnabled implements service.FeatureFlagChecker. Fail closed: missing row or
// DB error ⇒ false so lead_gen (and similar) cannot charge when the product
// flag is off or the flags table is unreachable (SEC-GATE-03 / R6.2).
func (r *PostgresRepository) IsEnabled(ctx context.Context, key string) bool {
	if r == nil || r.pool == nil || key == "" {
		return false
	}
	var enabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT enabled FROM feature_flags WHERE key = $1`, key).Scan(&enabled)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.ErrorContext(ctx, "feature flag read failed; treating as disabled",
				"flag", key, "error", err)
		}
		return false
	}
	return enabled
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
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			// Prefer constraint name when present (pgx always fills it for
			// unique_violation). Fall back to substring match for drivers that
			// only put the index name in the message.
			switch {
			case pgErr.ConstraintName == "uq_payments_recurring_instance",
				strings.Contains(pgErr.ConstraintName, "recurring_instance"),
				strings.Contains(err.Error(), "uq_payments_recurring_instance"),
				strings.Contains(err.Error(), "recurring_instance_id"):
				return fmt.Errorf("create payment: %w", domain.ErrRecurringInstancePaymentExists)
			case pgErr.ConstraintName == "payments_idempotency_key_key",
				strings.Contains(pgErr.ConstraintName, "idempotency_key"),
				strings.Contains(err.Error(), "idempotency_key"):
				return fmt.Errorf("create payment: %w", domain.ErrIdempotencyConflict)
			}
			// Unknown unique constraint — still surface as idempotency-shaped
			// conflict so CreatePayment can attempt soft-replay rather than 500.
			return fmt.Errorf("create payment: %w", domain.ErrIdempotencyConflict)
		}
		if strings.Contains(err.Error(), "duplicate key") && strings.Contains(err.Error(), "idempotency_key") {
			return fmt.Errorf("create payment: %w", domain.ErrIdempotencyConflict)
		}
		if strings.Contains(err.Error(), "duplicate key") && strings.Contains(err.Error(), "recurring_instance") {
			return fmt.Errorf("create payment: %w", domain.ErrRecurringInstancePaymentExists)
		}
		return fmt.Errorf("create payment: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetPayment(ctx context.Context, id string) (*domain.Payment, error) {
	return r.scanPayment(ctx, `
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
		WHERE id = $1`, id)
}

// GetPaymentByRecurringInstanceID loads the payment for a recurring visit.
// Enforced unique by uq_payments_recurring_instance (migration 111).
func (r *PostgresRepository) GetPaymentByRecurringInstanceID(ctx context.Context, recurringInstanceID string) (*domain.Payment, error) {
	if recurringInstanceID == "" {
		return nil, fmt.Errorf("get payment by recurring instance: %w", domain.ErrPaymentNotFound)
	}
	return r.scanPayment(ctx, `
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
		WHERE recurring_instance_id = $1`, recurringInstanceID)
}

// GetPaymentByIdempotencyKey loads by the UNIQUE payments.idempotency_key.
func (r *PostgresRepository) GetPaymentByIdempotencyKey(ctx context.Context, idempotencyKey string) (*domain.Payment, error) {
	if idempotencyKey == "" {
		return nil, fmt.Errorf("get payment by idempotency key: %w", domain.ErrPaymentNotFound)
	}
	return r.scanPayment(ctx, `
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
		WHERE idempotency_key = $1`, idempotencyKey)
}

func (r *PostgresRepository) scanPayment(ctx context.Context, query string, arg any) (*domain.Payment, error) {
	p := &domain.Payment{}
	err := r.pool.QueryRow(ctx, query, arg).Scan(
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
		// Guard against double-release: only transition when not already released.
		query = `UPDATE payments SET status = $1, released_at = now(), updated_at = now() WHERE id = $2 AND status <> 'released'`
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
		// For released CAS, distinguish "already released" from "not found".
		if status == "released" {
			var cur string
			err := r.pool.QueryRow(ctx, `SELECT status FROM payments WHERE id = $1`, id).Scan(&cur)
			if err == nil && cur == "released" {
				return fmt.Errorf("update payment status: %w", domain.ErrInvalidStatus)
			}
		}
		return fmt.Errorf("update payment status: %w", domain.ErrPaymentNotFound)
	}
	return nil
}

// ClaimPaymentStatus atomically transitions status from fromStatus to toStatus.
// Returns ErrInvalidStatus when the row is not currently in fromStatus.
func (r *PostgresRepository) ClaimPaymentStatus(ctx context.Context, id, fromStatus, toStatus string) error {
	var query string
	switch toStatus {
	case "escrow":
		query = `UPDATE payments SET status = $1, escrow_at = now(), updated_at = now() WHERE id = $2 AND status = $3`
	case "released":
		query = `UPDATE payments SET status = $1, released_at = now(), updated_at = now() WHERE id = $2 AND status = $3`
	case "completed":
		query = `UPDATE payments SET status = $1, completed_at = now(), updated_at = now() WHERE id = $2 AND status = $3`
	default:
		query = `UPDATE payments SET status = $1, updated_at = now() WHERE id = $2 AND status = $3`
	}

	tag, err := r.pool.Exec(ctx, query, toStatus, id, fromStatus)
	if err != nil {
		return fmt.Errorf("claim payment status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Distinguish not-found from lost CAS race.
		var cur string
		scanErr := r.pool.QueryRow(ctx, `SELECT status FROM payments WHERE id = $1`, id).Scan(&cur)
		if errors.Is(scanErr, pgx.ErrNoRows) {
			return fmt.Errorf("claim payment status: %w", domain.ErrPaymentNotFound)
		}
		return fmt.Errorf("claim payment status: current=%s want=%s: %w", cur, fromStatus, domain.ErrInvalidStatus)
	}
	return nil
}

func (r *PostgresRepository) ListPayments(ctx context.Context, userID string, statusFilter string, contractID string, page, pageSize int) ([]*domain.Payment, int, error) {
	where := []string{"(customer_id = $1 OR provider_id = $1)"}
	args := []interface{}{userID}
	argIdx := 2

	if statusFilter != "" {
		where = append(where, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}
	if contractID != "" {
		where = append(where, fmt.Sprintf("contract_id = $%d", argIdx))
		args = append(args, contractID)
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
		       min_fee_cents, max_fee_cents,
		       lead_gen_enabled, lead_gen_percentage, lead_gen_min_fee_cents, lead_gen_max_fee_cents,
		       active, effective_from,
		       created_at, updated_at
		FROM platform_fee_config
		WHERE category_id = $1 AND active = true
		ORDER BY effective_from DESC
		LIMIT 1`, categoryID).Scan(
		&fc.ID, &fc.CategoryID, &fc.FeePercentage, &fc.GuaranteePercentage,
		&fc.MinFeeCents, &fc.MaxFeeCents,
		&fc.LeadGenEnabled, &fc.LeadGenPercentage, &fc.LeadGenMinFeeCents, &fc.LeadGenMaxFeeCents,
		&fc.Active, &fc.EffectiveFrom,
		&fc.CreatedAt, &fc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get fee config: %w", domain.ErrFeeConfigNotFound)
		}
		return nil, fmt.Errorf("get fee config: %w", err)
	}
	normalizeFeeCaps(fc)
	return fc, nil
}

// normalizeFeeCaps coerces a stored fee cap of 0 to nil (the domain's "no cap"
// sentinel, per domain.FeeConfig.MaxFeeCents). The column is NOT NULL-tolerant
// but a legacy/seed value of 0 was being loaded as a non-nil 0, which clamped
// the platform fee to $0 (revenue-critical). A cap of 0 cents is meaningless, so
// 0 (or NULL) both mean "no cap". Min-fee caps need no such coercion: a floor of
// 0 cents is valid and simply means "no floor".
func normalizeFeeCaps(fc *domain.FeeConfig) {
	if fc.MaxFeeCents != nil && *fc.MaxFeeCents == 0 {
		fc.MaxFeeCents = nil
	}
	if fc.LeadGenMaxFeeCents != nil && *fc.LeadGenMaxFeeCents == 0 {
		fc.LeadGenMaxFeeCents = nil
	}
}

func (r *PostgresRepository) GetDefaultFeeConfig(ctx context.Context) (*domain.FeeConfig, error) {
	fc := &domain.FeeConfig{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, category_id, fee_percentage, guarantee_percentage,
		       min_fee_cents, max_fee_cents,
		       lead_gen_enabled, lead_gen_percentage, lead_gen_min_fee_cents, lead_gen_max_fee_cents,
		       active, effective_from,
		       created_at, updated_at
		FROM platform_fee_config
		WHERE category_id IS NULL AND active = true
		ORDER BY effective_from DESC
		LIMIT 1`).Scan(
		&fc.ID, &fc.CategoryID, &fc.FeePercentage, &fc.GuaranteePercentage,
		&fc.MinFeeCents, &fc.MaxFeeCents,
		&fc.LeadGenEnabled, &fc.LeadGenPercentage, &fc.LeadGenMinFeeCents, &fc.LeadGenMaxFeeCents,
		&fc.Active, &fc.EffectiveFrom,
		&fc.CreatedAt, &fc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get default fee config: %w", domain.ErrFeeConfigNotFound)
		}
		return nil, fmt.Errorf("get default fee config: %w", err)
	}
	normalizeFeeCaps(fc)
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

// UpdateRefundCAS updates refund fields only when refund_amount_cents still equals
// expectedPrior AND the new total does not exceed amount_cents. Lost races return
// ErrInvalidAmount so callers can re-read remaining balance.
func (r *PostgresRepository) UpdateRefundCAS(ctx context.Context, id string, expectedPrior, newTotal int64, refundReason string, refundedAt time.Time, stripeRefundID, status string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE payments SET
			refund_amount_cents = $2,
			refund_reason = $3,
			refunded_at = $4,
			stripe_refund_id = $5,
			status = $6,
			updated_at = now()
		WHERE id = $1
		  AND refund_amount_cents = $7
		  AND $2 <= amount_cents`,
		id, newTotal, refundReason, refundedAt, stripeRefundID, status, expectedPrior)
	if err != nil {
		return fmt.Errorf("update refund cas: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update refund cas: %w", domain.ErrInvalidAmount)
	}
	return nil
}

func (r *PostgresRepository) RevertRefundClaim(ctx context.Context, id string, delta int64, pendingID, statusIfZero string) error {
	if delta <= 0 {
		return fmt.Errorf("revert refund claim: %w", domain.ErrInvalidAmount)
	}
	prev := previousRefundIDFromPending(pendingID)
	var restoreID *string
	if prev != "" {
		restoreID = &prev
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE payments SET
			refund_amount_cents = refund_amount_cents - $2,
			stripe_refund_id = CASE
				WHEN refund_amount_cents - $2 = 0 THEN NULL
				ELSE $5
			END,
			status = CASE
				WHEN refund_amount_cents - $2 <= 0 THEN $4
				WHEN refund_amount_cents - $2 < amount_cents THEN 'partially_refunded'
				ELSE status
			END,
			updated_at = now()
		WHERE id = $1
		  AND stripe_refund_id = $3
		  AND refund_amount_cents >= $2`,
		id, delta, pendingID, statusIfZero, restoreID)
	if err != nil {
		return fmt.Errorf("revert refund claim: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("revert refund claim: %w", domain.ErrInvalidAmount)
	}
	return nil
}

// StampRefundID persists the real Stripe refund id only while stripe_refund_id
// still equals pendingKey. Does not touch refund_amount_cents.
func (r *PostgresRepository) StampRefundID(ctx context.Context, id, pendingKey, refundID string) error {
	if pendingKey == "" || refundID == "" || strings.HasPrefix(refundID, "pending:") {
		return fmt.Errorf("stamp refund id: %w", domain.ErrInvalidAmount)
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE payments SET
			stripe_refund_id = $2,
			updated_at = now()
		WHERE id = $1
		  AND stripe_refund_id = $3`,
		id, refundID, pendingKey)
	if err != nil {
		return fmt.Errorf("stamp refund id: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("stamp refund id: %w", domain.ErrInvalidAmount)
	}
	return nil
}

// ConfirmRefundFromWebhook monotonically confirms a refund from a Stripe
// charge.refunded event. It never decreases refund_amount_cents, never writes
// above amount_cents, and never replaces a pending: CreateRefund claim.
// RowsAffected == 0 is success (already confirmed, already higher, or an
// in-flight claim owns the row).
func (r *PostgresRepository) ConfirmRefundFromWebhook(ctx context.Context, id string, refundAmountCents int64, refundReason string, refundedAt time.Time, stripeRefundID string, status string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE payments SET
			refund_amount_cents = $2,
			refund_reason = $3,
			refunded_at = $4,
			stripe_refund_id = CASE WHEN $5 = '' THEN stripe_refund_id ELSE $5 END,
			status = $6,
			updated_at = now()
		WHERE id = $1
		  AND refund_amount_cents <= $2
		  AND $2 <= amount_cents
		  AND (stripe_refund_id IS NULL OR stripe_refund_id NOT LIKE 'pending:%')`,
		id, refundAmountCents, refundReason, refundedAt, stripeRefundID, status)
	if err != nil {
		return fmt.Errorf("confirm refund from webhook: %w", err)
	}
	return nil
}

// previousRefundIDFromPending reads the prior Stripe refund id from
// pending:{origStatus}:{prior}:{total}:{prevID}. Legacy 4-part tokens have no
// prev id. "-" means empty. Never returns a pending: value.
func previousRefundIDFromPending(pendingID string) string {
	parts := strings.Split(pendingID, ":")
	if len(parts) < 5 || parts[0] != "pending" {
		return ""
	}
	prev := parts[len(parts)-1]
	if prev == "" || prev == "-" || strings.HasPrefix(prev, "pending") {
		return ""
	}
	return prev
}

// WithProviderAdvisoryLock serializes fn under a transaction-scoped advisory
// lock keyed on the provider id. Used by RequestAdvance to close the credit
// TOCTOU window and by InstantPayout for ledger claims.
func (r *PostgresRepository) WithProviderAdvisoryLock(ctx context.Context, providerID string, fn func(ctx context.Context) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("provider advisory lock begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, providerID); err != nil {
		return fmt.Errorf("provider advisory lock: %w", err)
	}

	// Run fn with a context that carries the tx so nested repo calls can use it
	// when needed. For simple CreateAdvance paths that use the pool, the lock
	// still serializes concurrent transactions until we commit.
	if err := fn(ctx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("provider advisory lock commit: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetStripeAccountID(ctx context.Context, userID string) (string, error) {
	var accountID *string
	err := r.pool.QueryRow(ctx, `
		SELECT stripe_account_id FROM provider_profiles WHERE user_id = $1`, userID).Scan(&accountID)
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
		UPDATE provider_profiles SET stripe_account_id = $2, updated_at = now() WHERE user_id = $1`,
		userID, stripeAccountID)
	if err != nil {
		return fmt.Errorf("set stripe account: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("set stripe account: provider profile not found")
	}
	return nil
}

// SetStripeOnboardingComplete flips the provider_profiles.stripe_onboarding_complete
// flag for the provider whose Connect account ID matches the given value.
// Returns nil even if no rows match — Stripe sends account.updated for accounts
// the platform doesn't track (e.g. ones created in another environment), and
// those should be silently ignored rather than failing the webhook.
func (r *PostgresRepository) SetStripeOnboardingComplete(ctx context.Context, stripeAccountID string, complete bool) error {
	if stripeAccountID == "" {
		return fmt.Errorf("set stripe onboarding complete: account id required")
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE provider_profiles
		SET stripe_onboarding_complete = $2, updated_at = now()
		WHERE stripe_account_id = $1`,
		stripeAccountID, complete)
	if err != nil {
		return fmt.Errorf("set stripe onboarding complete: %w", err)
	}
	return nil
}

// GetStripeCustomerID returns the Stripe Customer id for a platform user.
//
// It reads users.stripe_customer_id (migration 102) FIRST. That column is the
// billing identity of the person and is the only one that is ever populated —
// see below.
//
// The subscriptions fallback is retained deliberately, and it is dead weight by
// design rather than by accident. Before migration 102 this function read ONLY
// subscriptions.stripe_customer_id, and SubscriptionService.CreateSubscription
// never populated that column: the INSERT wrote ” and no UPDATE ever touched
// it. So this function returned ("", nil) — success, empty — for every user who
// has ever existed, which is why no off-session charge in this repo could work.
// The fallback stays because it costs one indexed lookup only in the
// not-yet-provisioned case, and because if anyone ever backfills that column
// from Stripe the value is still honored. It must NEVER become the primary
// source again.
//
// Returns ("", nil) when the user has no Customer yet. That is a normal state
// and NOT an error — callers that need a chargeable customer must either
// provision one (service.CustomerProvisioner) or fail closed. Callers must not
// substitute the platform user id: it is not a cus_ id and Stripe will reject
// it (or, worse, silently accept it as a metadata-free unknown).
func (r *PostgresRepository) GetStripeCustomerID(ctx context.Context, userID string) (string, error) {
	var customerID *string
	err := r.pool.QueryRow(ctx, `
		SELECT stripe_customer_id FROM users
		WHERE id = $1 AND deleted_at IS NULL`, userID).Scan(&customerID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("get stripe customer id: %w", err)
	}
	if err == nil && customerID != nil && *customerID != "" {
		return *customerID, nil
	}

	// Legacy fallback — see the note above.
	err = r.pool.QueryRow(ctx, `
		SELECT stripe_customer_id FROM subscriptions
		WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due')
		ORDER BY created_at DESC
		LIMIT 1`, userID).Scan(&customerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("get stripe customer id: %w", err)
	}
	if customerID == nil || *customerID == "" {
		return "", nil
	}
	return *customerID, nil
}

// AdminListPayments lists payments with optional filters for admin use.
// Returns payments, total count, total amount cents, and total fees cents.
func (r *PostgresRepository) AdminListPayments(ctx context.Context, userID string, statusFilter string, startTime, endTime *time.Time, page, pageSize int) ([]*domain.Payment, int, int64, int64, error) {
	where := []string{"1=1"}
	args := []interface{}{}
	argIdx := 1

	if userID != "" {
		where = append(where, fmt.Sprintf("(customer_id = $%d OR provider_id = $%d)", argIdx, argIdx))
		args = append(args, userID)
		argIdx++
	}

	if statusFilter != "" {
		where = append(where, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}

	if startTime != nil {
		where = append(where, fmt.Sprintf("created_at >= $%d", argIdx))
		args = append(args, *startTime)
		argIdx++
	}

	if endTime != nil {
		where = append(where, fmt.Sprintf("created_at <= $%d", argIdx))
		args = append(args, *endTime)
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	// Get aggregates (count, total amount, total fees).
	// Use text to avoid int64 overflow from bad test data with huge amounts.
	var totalCount int
	var totalAmountCentsStr, totalFeesCentsStr string
	aggQuery := fmt.Sprintf(`
		SELECT COUNT(*), COALESCE(SUM(amount_cents), 0)::text, COALESCE(SUM(platform_fee_cents + guarantee_fee_cents), 0)::text
		FROM payments WHERE %s`, whereClause)
	err := r.pool.QueryRow(ctx, aggQuery, args...).Scan(&totalCount, &totalAmountCentsStr, &totalFeesCentsStr)
	if err != nil {
		return nil, 0, 0, 0, fmt.Errorf("admin list payments count: %w", err)
	}
	totalAmountCents, _ := strconv.ParseInt(totalAmountCentsStr, 10, 64)
	totalFeesCents, _ := strconv.ParseInt(totalFeesCentsStr, 10, 64)

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
		return nil, 0, 0, 0, fmt.Errorf("admin list payments query: %w", err)
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
			return nil, 0, 0, 0, fmt.Errorf("admin list payments scan: %w", err)
		}
		payments = append(payments, p)
	}

	return payments, totalCount, totalAmountCents, totalFeesCents, nil
}

// AdminGetPaymentDetails returns a payment including its Stripe metadata fields.
func (r *PostgresRepository) AdminGetPaymentDetails(ctx context.Context, paymentID string) (*domain.Payment, error) {
	return r.GetPayment(ctx, paymentID)
}

// UpdateFeeConfig deactivates the current active config (for the given category or default)
// and inserts a new active config row.
func (r *PostgresRepository) UpdateFeeConfig(ctx context.Context, categoryID *string, feePercentage, guaranteePercentage float64, minFeeCents int64, maxFeeCents *int64, leadGenEnabled bool, leadGenPercentage float64, leadGenMinFeeCents int64, leadGenMaxFeeCents *int64) (*domain.FeeConfig, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("update fee config begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Normalize an empty-string category to a true NULL ("default" config).
	// The form sends category_id="" when the optional field is left blank;
	// passing that straight into the UUID column on INSERT below fails with
	// `invalid input syntax for type uuid: ""` (a 500). Collapsing it to nil
	// here keeps the deactivate branch and the INSERT consistent on "default".
	if categoryID != nil && *categoryID == "" {
		categoryID = nil
	}

	// Deactivate current active config for this category (or default).
	if categoryID != nil {
		_, err = tx.Exec(ctx, `
			UPDATE platform_fee_config SET active = false, updated_at = now()
			WHERE category_id = $1 AND active = true`, *categoryID)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE platform_fee_config SET active = false, updated_at = now()
			WHERE category_id IS NULL AND active = true`)
	}
	if err != nil {
		return nil, fmt.Errorf("update fee config deactivate: %w", err)
	}

	// Insert new active config.
	fc := &domain.FeeConfig{}
	err = tx.QueryRow(ctx, `
		INSERT INTO platform_fee_config (category_id, fee_percentage, guarantee_percentage, min_fee_cents, max_fee_cents,
			lead_gen_enabled, lead_gen_percentage, lead_gen_min_fee_cents, lead_gen_max_fee_cents, active, effective_from)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, now())
		RETURNING id, category_id, fee_percentage, guarantee_percentage, min_fee_cents, max_fee_cents,
			lead_gen_enabled, lead_gen_percentage, lead_gen_min_fee_cents, lead_gen_max_fee_cents,
			active, effective_from, created_at, updated_at`,
		categoryID, feePercentage, guaranteePercentage, minFeeCents, maxFeeCents,
		leadGenEnabled, leadGenPercentage, leadGenMinFeeCents, leadGenMaxFeeCents).Scan(
		&fc.ID, &fc.CategoryID, &fc.FeePercentage, &fc.GuaranteePercentage,
		&fc.MinFeeCents, &fc.MaxFeeCents,
		&fc.LeadGenEnabled, &fc.LeadGenPercentage, &fc.LeadGenMinFeeCents, &fc.LeadGenMaxFeeCents,
		&fc.Active, &fc.EffectiveFrom,
		&fc.CreatedAt, &fc.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("update fee config insert: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("update fee config commit: %w", err)
	}

	return fc, nil
}

func scanCustomFee(row pgx.Row) (*domain.CustomFee, error) {
	f := &domain.CustomFee{}
	if err := row.Scan(&f.ID, &f.Name, &f.RateBPS, &f.Active, &f.CreatedAt, &f.UpdatedAt, &f.DeletedAt); err != nil {
		return nil, err
	}
	return f, nil
}

const customFeeSelect = `
		SELECT id, name, rate_bps, active, created_at, updated_at, deleted_at
		FROM platform_custom_fees`

func (r *PostgresRepository) ListCustomFees(ctx context.Context) ([]*domain.CustomFee, error) {
	rows, err := r.pool.Query(ctx, customFeeSelect+`
		WHERE deleted_at IS NULL
		ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list custom fees: %w", err)
	}
	defer rows.Close()

	fees := make([]*domain.CustomFee, 0)
	for rows.Next() {
		f, err := scanCustomFee(rows)
		if err != nil {
			return nil, fmt.Errorf("list custom fees scan: %w", err)
		}
		fees = append(fees, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list custom fees: %w", err)
	}
	return fees, nil
}

func (r *PostgresRepository) ListActiveCustomFees(ctx context.Context) ([]*domain.CustomFee, error) {
	rows, err := r.pool.Query(ctx, customFeeSelect+`
		WHERE deleted_at IS NULL AND active = true
		ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list active custom fees: %w", err)
	}
	defer rows.Close()

	fees := make([]*domain.CustomFee, 0)
	for rows.Next() {
		f, err := scanCustomFee(rows)
		if err != nil {
			return nil, fmt.Errorf("list active custom fees scan: %w", err)
		}
		fees = append(fees, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list active custom fees: %w", err)
	}
	return fees, nil
}

func (r *PostgresRepository) GetCustomFee(ctx context.Context, id string) (*domain.CustomFee, error) {
	f, err := scanCustomFee(r.pool.QueryRow(ctx, customFeeSelect+`
		WHERE id = $1 AND deleted_at IS NULL`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get custom fee: %w", domain.ErrCustomFeeNotFound)
		}
		return nil, fmt.Errorf("get custom fee: %w", err)
	}
	return f, nil
}

func (r *PostgresRepository) CreateCustomFee(ctx context.Context, fee *domain.CustomFee) error {
	err := r.pool.QueryRow(ctx, `
		INSERT INTO platform_custom_fees (name, rate_bps, active)
		VALUES ($1, $2, $3)
		RETURNING id, name, rate_bps, active, created_at, updated_at, deleted_at`,
		fee.Name, fee.RateBPS, fee.Active,
	).Scan(&fee.ID, &fee.Name, &fee.RateBPS, &fee.Active, &fee.CreatedAt, &fee.UpdatedAt, &fee.DeletedAt)
	if err != nil {
		return fmt.Errorf("create custom fee: %w", err)
	}
	return nil
}

func (r *PostgresRepository) UpdateCustomFee(ctx context.Context, fee *domain.CustomFee) error {
	err := r.pool.QueryRow(ctx, `
		UPDATE platform_custom_fees
		SET name = $2, rate_bps = $3, active = $4, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING id, name, rate_bps, active, created_at, updated_at, deleted_at`,
		fee.ID, fee.Name, fee.RateBPS, fee.Active,
	).Scan(&fee.ID, &fee.Name, &fee.RateBPS, &fee.Active, &fee.CreatedAt, &fee.UpdatedAt, &fee.DeletedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("update custom fee: %w", domain.ErrCustomFeeNotFound)
		}
		return fmt.Errorf("update custom fee: %w", err)
	}
	return nil
}

func (r *PostgresRepository) DeactivateCustomFee(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE platform_custom_fees
		SET active = false, deleted_at = now(), updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("deactivate custom fee: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("deactivate custom fee: %w", domain.ErrCustomFeeNotFound)
	}
	return nil
}

// GetRevenueReport aggregates payment data grouped by the specified interval.
func (r *PostgresRepository) GetRevenueReport(ctx context.Context, startTime, endTime *time.Time, groupBy string) (*domain.RevenueReport, error) {
	// Validate and map groupBy to a PostgreSQL date_trunc interval.
	truncInterval := "month"
	switch groupBy {
	case "day":
		truncInterval = "day"
	case "week":
		truncInterval = "week"
	case "month":
		truncInterval = "month"
	}

	where := []string{"status IN ('escrow', 'released', 'completed')"}
	args := []interface{}{}
	argIdx := 1

	if startTime != nil {
		where = append(where, fmt.Sprintf("created_at >= $%d", argIdx))
		args = append(args, *startTime)
		argIdx++
	}
	if endTime != nil {
		where = append(where, fmt.Sprintf("created_at <= $%d", argIdx))
		args = append(args, *endTime)
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	// Get totals.
	report := &domain.RevenueReport{}
	totalsQuery := fmt.Sprintf(`
		SELECT COALESCE(SUM(amount_cents), 0),
		       COALESCE(SUM(platform_fee_cents), 0),
		       COALESCE(SUM(guarantee_fee_cents), 0)
		FROM payments
		WHERE %s`, whereClause)

	var totalGMV, totalRevenue, totalGuarantee int64
	err := r.pool.QueryRow(ctx, totalsQuery, args...).Scan(&totalGMV, &totalRevenue, &totalGuarantee)
	if err != nil {
		return nil, fmt.Errorf("revenue report totals: %w", err)
	}

	report.TotalGMVCents = totalGMV
	report.TotalRevenueCents = totalRevenue
	report.TotalGuaranteeFundCents = totalGuarantee
	if totalGMV > 0 {
		report.EffectiveTakeRate = float64(totalRevenue) / float64(totalGMV)
	}

	// Get grouped data points.
	groupQuery := fmt.Sprintf(`
		SELECT date_trunc('%s', created_at) AS period_start,
		       COALESCE(SUM(amount_cents), 0),
		       COALESCE(SUM(platform_fee_cents), 0),
		       COUNT(*)
		FROM payments
		WHERE %s
		GROUP BY period_start
		ORDER BY period_start`, truncInterval, whereClause)

	rows, err := r.pool.Query(ctx, groupQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("revenue report query: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var dp domain.RevenueDataPoint
		err := rows.Scan(&dp.PeriodStart, &dp.GMVCents, &dp.RevenueCents, &dp.TransactionCount)
		if err != nil {
			return nil, fmt.Errorf("revenue report scan: %w", err)
		}
		report.DataPoints = append(report.DataPoints, dp)
	}

	return report, nil
}

// stripeEventClaimLease is how long one caller's claim on a Stripe event blocks
// other deliveries of the same event from reprocessing it.
//
// It bounds two opposite failures. Too short and two concurrent deliveries of a
// slow handler both run. Too long and a crashed attempt sits un-retried while
// Stripe redelivers (Stripe retries for up to 3 days, so a stuck event does get
// another chance — but only after this window). Five minutes is well past the
// p99 of any handler in dispatchWebhookEvent (all of which are a handful of
// database round trips plus at most one Stripe call) while still recovering a
// crashed pod within one Stripe retry cycle.
const stripeEventClaimLease = 5 * time.Minute

// markStripeEventProcessedAttempts is how many times MarkStripeEventProcessed
// retries before giving up. See its doc comment for why the retry exists.
const markStripeEventProcessedAttempts = 3

// RecordStripeEventStart atomically CLAIMS a Stripe event for processing.
//
// Returns alreadyProcessed=true when this caller must NOT run the handler:
// either the event was already fully handled (processed_at set) or another
// caller currently holds a live claim on it. false means this caller owns the
// event and should process it.
//
// Signature verification is unrelated to and upstream of this function: every
// delivery is verified against STRIPE_WEBHOOK_SECRET by StripeWebhookValidator
// before an event id reaches here.
//
// CONCURRENCY: the previous implementation was check-then-act. It ran
// `INSERT ... ON CONFLICT (id) DO NOTHING`, DISCARDED the insert's RowsAffected,
// and then issued a SEPARATE `SELECT processed_at`. stripe_events.id is the
// primary key, so the row was unique — but nothing CLAIMED it. Two concurrent
// deliveries of the same event both observed processed_at IS NULL and both ran
// the handler to completion: double refunds, double escrow transitions, double
// dispute rows. The INSERT already knew which caller won; the code threw that
// away.
//
// This is now a single statement whose ON CONFLICT DO UPDATE takes a row lock,
// so concurrent callers serialise and exactly one gets a row back. The WHERE on
// the DO UPDATE is what makes it a claim rather than an upsert:
//
//   - processed_at IS NOT NULL  → no row returned → already handled, skip.
//   - a claim newer than the lease → no row returned → another worker owns it.
//   - never claimed, or the claim has expired → this caller takes it.
//
// The lease preserves MON-12 (a crashed attempt must be retryable, since Stripe
// redelivers for up to 3 days) without leaving the "processed_at IS NULL means
// go ahead" hole the old code had. It also bounds the swallowed-stamp failure
// described on MarkStripeEventProcessed: even if processed_at never gets set,
// duplicate work is blocked for the whole lease window instead of not at all.
func (r *PostgresRepository) RecordStripeEventStart(ctx context.Context, eventID, eventType string) (bool, error) {
	var claimed string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO stripe_events (id, type, claimed_at, attempts)
		VALUES ($1, $2, now(), 1)
		ON CONFLICT (id) DO UPDATE
		   SET claimed_at = now(),
		       attempts   = stripe_events.attempts + 1,
		       type       = EXCLUDED.type
		 WHERE stripe_events.processed_at IS NULL
		   AND (stripe_events.claimed_at IS NULL
		        OR stripe_events.claimed_at < now() - $3::interval)
		RETURNING id`, eventID, eventType, stripeEventClaimLease.String()).Scan(&claimed)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Not an error: the claim was refused because the event is already
			// processed or is in flight elsewhere. Both mean "skip".
			return true, nil
		}
		return false, fmt.Errorf("record stripe event start: %w", err)
	}
	return false, nil
}

// MarkStripeEventProcessed stamps processed_at on the stripe_events row for the
// given event ID. Called after the event has been successfully handled.
//
// Retries on failure. The caller (HandleWebhook) deliberately logs and swallows
// an error here — returning one would make Stripe redeliver an event whose side
// effects already landed — so this is the last line of defence. A permanently
// unstamped row leaves processed_at NULL, and once the claim lease expires the
// next redelivery reprocesses an event that in fact succeeded. Retrying a few
// times turns a transient connection blip (by far the most likely cause) into a
// non-event rather than a duplicated payment operation.
//
// Retries use a short fixed backoff and respect ctx cancellation. If every
// attempt fails the error is returned so the caller can log it; the row is then
// discoverable via idx_stripe_events_unprocessed
// (WHERE processed_at IS NULL, ordered by claimed_at) for alerting.
func (r *PostgresRepository) MarkStripeEventProcessed(ctx context.Context, eventID string) error {
	var lastErr error
	for attempt := range markStripeEventProcessedAttempts {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return fmt.Errorf("mark stripe event processed: %w", ctx.Err())
			case <-time.After(time.Duration(attempt) * 100 * time.Millisecond):
			}
		}
		_, err := r.pool.Exec(ctx, `
			UPDATE stripe_events
			SET processed_at = now()
			WHERE id = $1`, eventID)
		if err == nil {
			return nil
		}
		lastErr = err
		slog.WarnContext(ctx, "mark stripe event processed failed, retrying",
			"event_id", eventID, "attempt", attempt+1,
			"max_attempts", markStripeEventProcessedAttempts, "error", err)
	}
	return fmt.Errorf("mark stripe event processed after %d attempts: %w",
		markStripeEventProcessedAttempts, lastErr)
}

// --- Instant payout ledger ---

func (r *PostgresRepository) SumInstantPayoutsLast24h(ctx context.Context, providerID string) (int64, error) {
	var total int64
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_cents), 0)
		  FROM instant_payouts
		 WHERE provider_id = $1
		   AND created_at >= now() - interval '24 hours'
		   AND status IN ('pending', 'completed')`, providerID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("sum instant payouts 24h: %w", err)
	}
	return total, nil
}

func (r *PostgresRepository) SumAllInstantPayouts(ctx context.Context, providerID string) (int64, error) {
	var total int64
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_cents), 0)
		  FROM instant_payouts
		 WHERE provider_id = $1
		   AND status IN ('pending', 'completed')`, providerID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("sum all instant payouts: %w", err)
	}
	return total, nil
}

// SumEligibleInstantPayoutCents sums provider_payout_cents for payments in
// released OR completed status (MON-10: eligibility includes both).
func (r *PostgresRepository) SumEligibleInstantPayoutCents(ctx context.Context, providerID string) (int64, error) {
	var total int64
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(provider_payout_cents), 0)
		  FROM payments
		 WHERE provider_id = $1
		   AND status IN ('released', 'completed')`, providerID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("sum eligible instant payout: %w", err)
	}
	return total, nil
}

func (r *PostgresRepository) LookupInstantPayoutByKey(ctx context.Context, providerID, idempotencyKey string) (*domain.InstantPayout, bool, error) {
	if idempotencyKey == "" {
		return nil, false, nil
	}
	p := &domain.InstantPayout{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, provider_id, amount_cents, fee_cents, net_cents,
		       COALESCE(stripe_payout_id, ''), COALESCE(idempotency_key, ''),
		       status, created_at
		  FROM instant_payouts
		 WHERE provider_id = $1 AND idempotency_key = $2`,
		providerID, idempotencyKey).Scan(
		&p.ID, &p.ProviderID, &p.AmountCents, &p.FeeCents, &p.NetCents,
		&p.StripePayoutID, &p.IdempotencyKey, &p.Status, &p.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("lookup instant payout: %w", err)
	}
	return p, true, nil
}

// ClaimInstantPayout inserts a pending ledger row under the per-provider
// advisory lock after re-checking available balance and the daily cap.
func (r *PostgresRepository) ClaimInstantPayout(ctx context.Context, providerID string, amountCents, feeCents, netCents int64, idempotencyKey string) (*domain.InstantPayout, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("claim instant payout begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, providerID); err != nil {
		return nil, fmt.Errorf("claim instant payout lock: %w", err)
	}

	// Idempotent replay under lock.
	if idempotencyKey != "" {
		p := &domain.InstantPayout{}
		err := tx.QueryRow(ctx, `
			SELECT id, provider_id, amount_cents, fee_cents, net_cents,
			       COALESCE(stripe_payout_id, ''), COALESCE(idempotency_key, ''),
			       status, created_at
			  FROM instant_payouts
			 WHERE provider_id = $1 AND idempotency_key = $2`,
			providerID, idempotencyKey).Scan(
			&p.ID, &p.ProviderID, &p.AmountCents, &p.FeeCents, &p.NetCents,
			&p.StripePayoutID, &p.IdempotencyKey, &p.Status, &p.CreatedAt,
		)
		if err == nil {
			if err := tx.Commit(ctx); err != nil {
				return nil, fmt.Errorf("claim instant payout commit replay: %w", err)
			}
			return p, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("claim instant payout replay lookup: %w", err)
		}
	}

	var grossEligible, priorPaidOut, todayCents int64
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(provider_payout_cents), 0)
		  FROM payments
		 WHERE provider_id = $1 AND status IN ('released', 'completed')`, providerID).Scan(&grossEligible); err != nil {
		return nil, fmt.Errorf("claim instant payout eligible: %w", err)
	}
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_cents), 0)
		  FROM instant_payouts
		 WHERE provider_id = $1 AND status IN ('pending', 'completed')`, providerID).Scan(&priorPaidOut); err != nil {
		return nil, fmt.Errorf("claim instant payout prior: %w", err)
	}
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_cents), 0)
		  FROM instant_payouts
		 WHERE provider_id = $1
		   AND created_at >= now() - interval '24 hours'
		   AND status IN ('pending', 'completed')`, providerID).Scan(&todayCents); err != nil {
		return nil, fmt.Errorf("claim instant payout daily: %w", err)
	}

	available := grossEligible - priorPaidOut
	if available < amountCents {
		return nil, fmt.Errorf("claim instant payout: %w", domain.ErrInstantPayoutInsufficientBalance)
	}
	// Daily cap ($10,000) — matches gateway defaultInstantPayoutMaxPerDayCents.
	const maxPerDayCents int64 = 1_000_000
	if todayCents+amountCents > maxPerDayCents {
		return nil, fmt.Errorf("claim instant payout: %w", domain.ErrInstantPayoutDailyCap)
	}

	id := ""
	err = tx.QueryRow(ctx, `
		INSERT INTO instant_payouts (
			provider_id, amount_cents, fee_cents, net_cents,
			idempotency_key, status
		) VALUES ($1, $2, $3, $4, NULLIF($5, ''), 'pending')
		RETURNING id::text`,
		providerID, amountCents, feeCents, netCents, idempotencyKey,
	).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("claim instant payout insert: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("claim instant payout commit: %w", err)
	}

	return &domain.InstantPayout{
		ID:             id,
		ProviderID:     providerID,
		AmountCents:    amountCents,
		FeeCents:       feeCents,
		NetCents:       netCents,
		IdempotencyKey: idempotencyKey,
		Status:         "pending",
		CreatedAt:      time.Now().UTC(),
	}, nil
}

func (r *PostgresRepository) CompleteInstantPayout(ctx context.Context, payoutID, stripePayoutID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE instant_payouts
		   SET status = 'completed',
		       stripe_payout_id = $2
		 WHERE id = $1 AND status = 'pending'`, payoutID, stripePayoutID)
	if err != nil {
		return fmt.Errorf("complete instant payout: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("complete instant payout: %w", domain.ErrPaymentNotFound)
	}
	return nil
}

func (r *PostgresRepository) FailInstantPayout(ctx context.Context, payoutID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE instant_payouts SET status = 'failed' WHERE id = $1 AND status = 'pending'`, payoutID)
	if err != nil {
		return fmt.Errorf("fail instant payout: %w", err)
	}
	return nil
}
