package repository

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
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
// set after construction so the constructor signature stays stable; when nil,
// PII reads fall back to treating stored values as plaintext.
func (r *PostgresRepository) SetCipher(c *crypto.Cipher) {
	r.cipher = c
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

func (r *PostgresRepository) GetStripeCustomerID(ctx context.Context, userID string) (string, error) {
	var customerID *string
	err := r.pool.QueryRow(ctx, `
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

// RecordStripeEventStart inserts a row into stripe_events for the given event ID.
// If the event was already recorded (ON CONFLICT), returns alreadyProcessed=true
// so the webhook handler can skip reprocessing and return 200 OK to Stripe.
func (r *PostgresRepository) RecordStripeEventStart(ctx context.Context, eventID, eventType string) (bool, error) {
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO stripe_events (id, type)
		VALUES ($1, $2)
		ON CONFLICT (id) DO NOTHING`, eventID, eventType)
	if err != nil {
		return false, fmt.Errorf("record stripe event start: %w", err)
	}
	// RowsAffected == 0 means ON CONFLICT fired -- row already existed.
	return tag.RowsAffected() == 0, nil
}

// MarkStripeEventProcessed stamps processed_at on the stripe_events row for
// the given event ID. Called after the event has been successfully handled.
func (r *PostgresRepository) MarkStripeEventProcessed(ctx context.Context, eventID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE stripe_events
		SET processed_at = now()
		WHERE id = $1`, eventID)
	if err != nil {
		return fmt.Errorf("mark stripe event processed: %w", err)
	}
	return nil
}
