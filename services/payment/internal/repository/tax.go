package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// CreateTaxForm inserts a new tax form record.
func (r *PostgresRepository) CreateTaxForm(ctx context.Context, tf *domain.TaxForm) error {
	err := r.pool.QueryRow(ctx, `
		INSERT INTO tax_forms (
			id, provider_id, tax_year, form_type,
			provider_legal_name, provider_tax_id_last4, provider_address,
			total_compensation_cents, federal_tax_withheld_cents, state_tax_withheld_cents,
			platform_ein, platform_name, pdf_url, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT (provider_id, tax_year, form_type)
		DO UPDATE SET
			provider_legal_name = EXCLUDED.provider_legal_name,
			provider_tax_id_last4 = EXCLUDED.provider_tax_id_last4,
			provider_address = EXCLUDED.provider_address,
			total_compensation_cents = EXCLUDED.total_compensation_cents,
			federal_tax_withheld_cents = EXCLUDED.federal_tax_withheld_cents,
			state_tax_withheld_cents = EXCLUDED.state_tax_withheld_cents,
			platform_ein = EXCLUDED.platform_ein,
			platform_name = EXCLUDED.platform_name,
			pdf_url = EXCLUDED.pdf_url,
			status = EXCLUDED.status,
			updated_at = now()
		RETURNING id, created_at, updated_at`,
		tf.ID, tf.ProviderID, tf.TaxYear, tf.FormType,
		tf.ProviderLegalName, tf.ProviderTaxIDLast4, tf.ProviderAddress,
		tf.TotalCompensationCents, tf.FederalTaxWithheldCents, tf.StateTaxWithheldCents,
		tf.PlatformEIN, tf.PlatformName, tf.PDFURL, tf.Status,
	).Scan(&tf.ID, &tf.CreatedAt, &tf.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create tax form: %w", err)
	}
	return nil
}

// GetTaxForm retrieves a tax form by provider ID and tax year.
func (r *PostgresRepository) GetTaxForm(ctx context.Context, providerID string, taxYear int) (*domain.TaxForm, error) {
	tf := &domain.TaxForm{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, provider_id, tax_year, form_type,
		       provider_legal_name, provider_tax_id_last4, provider_address,
		       total_compensation_cents, federal_tax_withheld_cents, state_tax_withheld_cents,
		       platform_ein, platform_name, pdf_url, status,
		       delivered_at, filed_at, created_at, updated_at
		FROM tax_forms
		WHERE provider_id = $1 AND tax_year = $2
		LIMIT 1`, providerID, taxYear).Scan(
		&tf.ID, &tf.ProviderID, &tf.TaxYear, &tf.FormType,
		&tf.ProviderLegalName, &tf.ProviderTaxIDLast4, &tf.ProviderAddress,
		&tf.TotalCompensationCents, &tf.FederalTaxWithheldCents, &tf.StateTaxWithheldCents,
		&tf.PlatformEIN, &tf.PlatformName, &tf.PDFURL, &tf.Status,
		&tf.DeliveredAt, &tf.FiledAt, &tf.CreatedAt, &tf.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get tax form: %w", domain.ErrTaxFormNotFound)
		}
		return nil, fmt.Errorf("get tax form: %w", err)
	}
	return tf, nil
}

// ListTaxForms returns all tax forms for a provider ordered by year descending.
func (r *PostgresRepository) ListTaxForms(ctx context.Context, providerID string) ([]*domain.TaxForm, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, provider_id, tax_year, form_type,
		       provider_legal_name, provider_tax_id_last4, provider_address,
		       total_compensation_cents, federal_tax_withheld_cents, state_tax_withheld_cents,
		       platform_ein, platform_name, pdf_url, status,
		       delivered_at, filed_at, created_at, updated_at
		FROM tax_forms
		WHERE provider_id = $1
		ORDER BY tax_year DESC`, providerID)
	if err != nil {
		return nil, fmt.Errorf("list tax forms query: %w", err)
	}
	defer rows.Close()

	var forms []*domain.TaxForm
	for rows.Next() {
		tf := &domain.TaxForm{}
		err := rows.Scan(
			&tf.ID, &tf.ProviderID, &tf.TaxYear, &tf.FormType,
			&tf.ProviderLegalName, &tf.ProviderTaxIDLast4, &tf.ProviderAddress,
			&tf.TotalCompensationCents, &tf.FederalTaxWithheldCents, &tf.StateTaxWithheldCents,
			&tf.PlatformEIN, &tf.PlatformName, &tf.PDFURL, &tf.Status,
			&tf.DeliveredAt, &tf.FiledAt, &tf.CreatedAt, &tf.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("list tax forms scan: %w", err)
		}
		forms = append(forms, tf)
	}

	return forms, nil
}

// GetProviderEarningsForYear computes the total provider payouts for a year.
func (r *PostgresRepository) GetProviderEarningsForYear(ctx context.Context, providerID string, taxYear int) (int64, error) {
	var totalCents int64
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(provider_payout_cents), 0)
		FROM payments
		WHERE provider_id = $1
		  AND status IN ('completed', 'released')
		  AND EXTRACT(YEAR FROM COALESCE(completed_at, released_at, created_at)) = $2`,
		providerID, taxYear).Scan(&totalCents)
	if err != nil {
		return 0, fmt.Errorf("get provider earnings for year: %w", err)
	}
	return totalCents, nil
}

// UpdateTaxFormStatus updates the status and optionally the PDF URL of a tax form.
func (r *PostgresRepository) UpdateTaxFormStatus(ctx context.Context, id string, status string, pdfURL *string) error {
	var err error
	if pdfURL != nil {
		_, err = r.pool.Exec(ctx, `
			UPDATE tax_forms SET status = $2, pdf_url = $3, updated_at = now()
			WHERE id = $1`, id, status, *pdfURL)
	} else {
		_, err = r.pool.Exec(ctx, `
			UPDATE tax_forms SET status = $2, updated_at = now()
			WHERE id = $1`, id, status)
	}
	if err != nil {
		return fmt.Errorf("update tax form status: %w", err)
	}
	return nil
}

// GetContractDetail fetches contract details plus associated user names and job title for invoicing.
func (r *PostgresRepository) GetContractDetail(ctx context.Context, contractID string) (*domain.ContractDetail, error) {
	cd := &domain.ContractDetail{}
	err := r.pool.QueryRow(ctx, `
		SELECT c.id, c.contract_number,
		       COALESCE(j.title, 'Untitled Job'),
		       COALESCE(NULLIF(cu.display_name, ''), cu.email),
		       COALESCE(NULLIF(pu.display_name, ''), pu.email),
		       c.amount_cents, c.payment_timing, c.status,
		       c.accepted_at, c.completed_at, c.created_at
		FROM contracts c
		JOIN jobs j ON j.id = c.job_id
		JOIN users cu ON cu.id = c.customer_id
		JOIN users pu ON pu.id = c.provider_id
		WHERE c.id = $1`, contractID).Scan(
		&cd.ID, &cd.ContractNumber,
		&cd.JobTitle,
		&cd.CustomerName,
		&cd.ProviderName,
		&cd.AmountCents, &cd.PaymentTiming, &cd.Status,
		&cd.AcceptedAt, &cd.CompletedAt, &cd.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get contract detail: %w", domain.ErrContractNotFound)
		}
		return nil, fmt.Errorf("get contract detail: %w", err)
	}
	return cd, nil
}

// GetMilestonesForContract fetches milestones for a contract.
func (r *PostgresRepository) GetMilestonesForContract(ctx context.Context, contractID string) ([]*domain.MilestoneDetail, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, description, amount_cents, sort_order, status, approved_at
		FROM milestones
		WHERE contract_id = $1
		ORDER BY sort_order`, contractID)
	if err != nil {
		return nil, fmt.Errorf("get milestones for contract: %w", err)
	}
	defer rows.Close()

	var milestones []*domain.MilestoneDetail
	for rows.Next() {
		m := &domain.MilestoneDetail{}
		err := rows.Scan(&m.ID, &m.Description, &m.AmountCents, &m.SortOrder, &m.Status, &m.ApprovedAt)
		if err != nil {
			return nil, fmt.Errorf("get milestones scan: %w", err)
		}
		milestones = append(milestones, m)
	}

	return milestones, nil
}

// GetPaymentsForContract fetches all payments associated with a contract.
func (r *PostgresRepository) GetPaymentsForContract(ctx context.Context, contractID string) ([]*domain.Payment, error) {
	rows, err := r.pool.Query(ctx, `
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
		WHERE contract_id = $1
		ORDER BY created_at`, contractID)
	if err != nil {
		return nil, fmt.Errorf("get payments for contract: %w", err)
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
			return nil, fmt.Errorf("get payments for contract scan: %w", err)
		}
		payments = append(payments, p)
	}

	return payments, nil
}

// GetProviderProfile returns the business name and service address for a provider.
func (r *PostgresRepository) GetProviderProfile(ctx context.Context, providerID string) (string, string, error) {
	var businessName, serviceAddress *string
	err := r.pool.QueryRow(ctx, `
		SELECT pp.business_name, pp.service_address
		FROM provider_profiles pp
		WHERE pp.user_id = $1`, providerID).Scan(&businessName, &serviceAddress)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Fall back to the users table for the provider name.
			var displayName *string
			err2 := r.pool.QueryRow(ctx, `
				SELECT display_name FROM users WHERE id = $1`, providerID).Scan(&displayName)
			if err2 != nil {
				return "", "", fmt.Errorf("get provider profile fallback: %w", err2)
			}
			name := ""
			if displayName != nil {
				name = *displayName
			}
			if name == "" {
				name = "Provider"
			}
			return name, "", nil
		}
		return "", "", fmt.Errorf("get provider profile: %w", err)
	}

	name := ""
	if businessName != nil {
		name = *businessName
	}
	addr := ""
	if serviceAddress != nil {
		addr = *serviceAddress
	}

	// If no business name, fall back to user name.
	if name == "" {
		var displayName *string
		err2 := r.pool.QueryRow(ctx, `
			SELECT display_name FROM users WHERE id = $1`, providerID).Scan(&displayName)
		if err2 == nil && displayName != nil {
			name = *displayName
		}
		if name == "" {
			name = "Provider"
		}
	}

	return name, addr, nil
}
