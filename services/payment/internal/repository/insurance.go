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

// --- Insurance Products ---

func (r *PostgresRepository) ListInsuranceProducts(ctx context.Context, activeOnly bool) ([]*domain.InsuranceProduct, error) {
	query := `
		SELECT id, name, slug, description, coverage_type, base_rate_bps,
		       min_premium_cents, max_coverage_cents, coverage_duration_days,
		       deductible_cents, terms_markdown, active, created_at, updated_at
		FROM insurance_products`
	if activeOnly {
		query += ` WHERE active = true`
	}
	query += ` ORDER BY created_at`

	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list insurance products: %w", err)
	}
	defer rows.Close()

	var products []*domain.InsuranceProduct
	for rows.Next() {
		p := &domain.InsuranceProduct{}
		err := rows.Scan(
			&p.ID, &p.Name, &p.Slug, &p.Description, &p.CoverageType, &p.BaseRateBPS,
			&p.MinPremiumCents, &p.MaxCoverageCents, &p.CoverageDurationDays,
			&p.DeductibleCents, &p.TermsMarkdown, &p.Active, &p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("list insurance products scan: %w", err)
		}
		products = append(products, p)
	}

	return products, nil
}

func (r *PostgresRepository) GetInsuranceProduct(ctx context.Context, id string) (*domain.InsuranceProduct, error) {
	p := &domain.InsuranceProduct{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, name, slug, description, coverage_type, base_rate_bps,
		       min_premium_cents, max_coverage_cents, coverage_duration_days,
		       deductible_cents, terms_markdown, active, created_at, updated_at
		FROM insurance_products
		WHERE id = $1`, id).Scan(
		&p.ID, &p.Name, &p.Slug, &p.Description, &p.CoverageType, &p.BaseRateBPS,
		&p.MinPremiumCents, &p.MaxCoverageCents, &p.CoverageDurationDays,
		&p.DeductibleCents, &p.TermsMarkdown, &p.Active, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get insurance product: %w", domain.ErrInsuranceProductNotFound)
		}
		return nil, fmt.Errorf("get insurance product: %w", err)
	}
	return p, nil
}

func (r *PostgresRepository) GetInsuranceProductBySlug(ctx context.Context, slug string) (*domain.InsuranceProduct, error) {
	p := &domain.InsuranceProduct{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, name, slug, description, coverage_type, base_rate_bps,
		       min_premium_cents, max_coverage_cents, coverage_duration_days,
		       deductible_cents, terms_markdown, active, created_at, updated_at
		FROM insurance_products
		WHERE slug = $1`, slug).Scan(
		&p.ID, &p.Name, &p.Slug, &p.Description, &p.CoverageType, &p.BaseRateBPS,
		&p.MinPremiumCents, &p.MaxCoverageCents, &p.CoverageDurationDays,
		&p.DeductibleCents, &p.TermsMarkdown, &p.Active, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get insurance product by slug: %w", domain.ErrInsuranceProductNotFound)
		}
		return nil, fmt.Errorf("get insurance product by slug: %w", err)
	}
	return p, nil
}

// --- Insurance Policies ---

func (r *PostgresRepository) CreateInsurancePolicy(ctx context.Context, policy *domain.InsurancePolicy) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO insurance_policies (
			id, policy_number, product_id, contract_id, customer_id, provider_id,
			coverage_amount_cents, premium_cents, deductible_cents,
			stripe_payment_intent_id, effective_date, expiration_date,
			status, paid_at, cancelled_at, cancellation_reason
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9,
			$10, $11, $12,
			$13, $14, $15, $16
		)`,
		policy.ID, policy.PolicyNumber, policy.ProductID, policy.ContractID,
		policy.CustomerID, policy.ProviderID,
		policy.CoverageAmountCents, policy.PremiumCents, policy.DeductibleCents,
		policy.StripePaymentIntentID, policy.EffectiveDate, policy.ExpirationDate,
		policy.Status, policy.PaidAt, policy.CancelledAt, policy.CancellationReason,
	)
	if err != nil {
		return fmt.Errorf("create insurance policy: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetInsurancePolicy(ctx context.Context, id string) (*domain.InsurancePolicy, error) {
	p := &domain.InsurancePolicy{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, policy_number, product_id, contract_id, customer_id, provider_id,
		       coverage_amount_cents, premium_cents, deductible_cents,
		       COALESCE(stripe_payment_intent_id, ''), effective_date, expiration_date,
		       status, paid_at, cancelled_at, COALESCE(cancellation_reason, ''),
		       created_at, updated_at
		FROM insurance_policies
		WHERE id = $1`, id).Scan(
		&p.ID, &p.PolicyNumber, &p.ProductID, &p.ContractID, &p.CustomerID, &p.ProviderID,
		&p.CoverageAmountCents, &p.PremiumCents, &p.DeductibleCents,
		&p.StripePaymentIntentID, &p.EffectiveDate, &p.ExpirationDate,
		&p.Status, &p.PaidAt, &p.CancelledAt, &p.CancellationReason,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get insurance policy: %w", domain.ErrInsurancePolicyNotFound)
		}
		return nil, fmt.Errorf("get insurance policy: %w", err)
	}
	return p, nil
}

func (r *PostgresRepository) ListInsurancePolicies(ctx context.Context, userID string, page, pageSize int) ([]*domain.InsurancePolicy, int, error) {
	where := "(customer_id = $1 OR provider_id = $1)"

	var totalCount int
	err := r.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM insurance_policies WHERE %s`, where), userID).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("list insurance policies count: %w", err)
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

	rows, err := r.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, policy_number, product_id, contract_id, customer_id, provider_id,
		       coverage_amount_cents, premium_cents, deductible_cents,
		       COALESCE(stripe_payment_intent_id, ''), effective_date, expiration_date,
		       status, paid_at, cancelled_at, COALESCE(cancellation_reason, ''),
		       created_at, updated_at
		FROM insurance_policies
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`, where), userID, pageSize, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list insurance policies query: %w", err)
	}
	defer rows.Close()

	var policies []*domain.InsurancePolicy
	for rows.Next() {
		p := &domain.InsurancePolicy{}
		err := rows.Scan(
			&p.ID, &p.PolicyNumber, &p.ProductID, &p.ContractID, &p.CustomerID, &p.ProviderID,
			&p.CoverageAmountCents, &p.PremiumCents, &p.DeductibleCents,
			&p.StripePaymentIntentID, &p.EffectiveDate, &p.ExpirationDate,
			&p.Status, &p.PaidAt, &p.CancelledAt, &p.CancellationReason,
			&p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("list insurance policies scan: %w", err)
		}
		policies = append(policies, p)
	}

	return policies, totalCount, nil
}

func (r *PostgresRepository) UpdateInsurancePolicyStatus(ctx context.Context, id string, status string) error {
	var query string
	switch status {
	case "cancelled":
		query = `UPDATE insurance_policies SET status = $1, cancelled_at = now(), updated_at = now() WHERE id = $2`
	default:
		query = `UPDATE insurance_policies SET status = $1, updated_at = now() WHERE id = $2`
	}

	tag, err := r.pool.Exec(ctx, query, status, id)
	if err != nil {
		return fmt.Errorf("update insurance policy status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update insurance policy status: %w", domain.ErrInsurancePolicyNotFound)
	}
	return nil
}

func (r *PostgresRepository) UpdateInsurancePolicyPaid(ctx context.Context, id string, stripePaymentIntentID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE insurance_policies
		SET status = 'active', paid_at = now(), stripe_payment_intent_id = $2, updated_at = now()
		WHERE id = $1 AND status = 'pending_payment'`, id, stripePaymentIntentID)
	if err != nil {
		return fmt.Errorf("update insurance policy paid: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update insurance policy paid: %w", domain.ErrInsurancePolicyNotFound)
	}
	return nil
}

func (r *PostgresRepository) FindPolicyByStripePaymentIntentID(ctx context.Context, paymentIntentID string) (*domain.InsurancePolicy, error) {
	p := &domain.InsurancePolicy{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, policy_number, product_id, contract_id, customer_id, provider_id,
		       coverage_amount_cents, premium_cents, deductible_cents,
		       COALESCE(stripe_payment_intent_id, ''), effective_date, expiration_date,
		       status, paid_at, cancelled_at, COALESCE(cancellation_reason, ''),
		       created_at, updated_at
		FROM insurance_policies
		WHERE stripe_payment_intent_id = $1`, paymentIntentID).Scan(
		&p.ID, &p.PolicyNumber, &p.ProductID, &p.ContractID, &p.CustomerID, &p.ProviderID,
		&p.CoverageAmountCents, &p.PremiumCents, &p.DeductibleCents,
		&p.StripePaymentIntentID, &p.EffectiveDate, &p.ExpirationDate,
		&p.Status, &p.PaidAt, &p.CancelledAt, &p.CancellationReason,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("find policy by stripe pi: %w", domain.ErrInsurancePolicyNotFound)
		}
		return nil, fmt.Errorf("find policy by stripe pi: %w", err)
	}
	return p, nil
}

// --- Insurance Claims ---

func (r *PostgresRepository) CreateInsuranceClaim(ctx context.Context, claim *domain.InsuranceClaim) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO insurance_claims (
			id, claim_number, policy_id, claimant_id, claim_type,
			description, evidence_urls, claimed_amount_cents,
			status
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8,
			$9
		)`,
		claim.ID, claim.ClaimNumber, claim.PolicyID, claim.ClaimantID, claim.ClaimType,
		claim.Description, claim.EvidenceURLs, claim.ClaimedAmountCents,
		claim.Status,
	)
	if err != nil {
		return fmt.Errorf("create insurance claim: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetInsuranceClaim(ctx context.Context, id string) (*domain.InsuranceClaim, error) {
	c := &domain.InsuranceClaim{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, claim_number, policy_id, claimant_id, claim_type,
		       COALESCE(description, ''), evidence_urls, claimed_amount_cents,
		       assessed_amount_cents, COALESCE(assessor_notes, ''),
		       approved_amount_cents, payout_cents,
		       COALESCE(stripe_transfer_id, ''), status,
		       COALESCE(denial_reason, ''), reviewed_by, reviewed_at, paid_at,
		       created_at, updated_at
		FROM insurance_claims
		WHERE id = $1`, id).Scan(
		&c.ID, &c.ClaimNumber, &c.PolicyID, &c.ClaimantID, &c.ClaimType,
		&c.Description, &c.EvidenceURLs, &c.ClaimedAmountCents,
		&c.AssessedAmountCents, &c.AssessorNotes,
		&c.ApprovedAmountCents, &c.PayoutCents,
		&c.StripeTransferID, &c.Status,
		&c.DenialReason, &c.ReviewedBy, &c.ReviewedAt, &c.PaidAt,
		&c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get insurance claim: %w", domain.ErrInsuranceClaimNotFound)
		}
		return nil, fmt.Errorf("get insurance claim: %w", err)
	}
	return c, nil
}

func (r *PostgresRepository) AdminListInsuranceClaims(ctx context.Context, statusFilter string, page, pageSize int) ([]*domain.InsuranceClaim, int, error) {
	where := []string{"1=1"}
	args := []interface{}{}
	argIdx := 1

	if statusFilter != "" {
		where = append(where, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	var totalCount int
	err := r.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM insurance_claims WHERE %s`, whereClause), args...).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("admin list insurance claims count: %w", err)
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
		SELECT id, claim_number, policy_id, claimant_id, claim_type,
		       COALESCE(description, ''), evidence_urls, claimed_amount_cents,
		       assessed_amount_cents, COALESCE(assessor_notes, ''),
		       approved_amount_cents, payout_cents,
		       COALESCE(stripe_transfer_id, ''), status,
		       COALESCE(denial_reason, ''), reviewed_by, reviewed_at, paid_at,
		       created_at, updated_at
		FROM insurance_claims
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, whereClause, argIdx, argIdx+1)

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("admin list insurance claims query: %w", err)
	}
	defer rows.Close()

	var claims []*domain.InsuranceClaim
	for rows.Next() {
		c := &domain.InsuranceClaim{}
		err := rows.Scan(
			&c.ID, &c.ClaimNumber, &c.PolicyID, &c.ClaimantID, &c.ClaimType,
			&c.Description, &c.EvidenceURLs, &c.ClaimedAmountCents,
			&c.AssessedAmountCents, &c.AssessorNotes,
			&c.ApprovedAmountCents, &c.PayoutCents,
			&c.StripeTransferID, &c.Status,
			&c.DenialReason, &c.ReviewedBy, &c.ReviewedAt, &c.PaidAt,
			&c.CreatedAt, &c.UpdatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("admin list insurance claims scan: %w", err)
		}
		claims = append(claims, c)
	}

	return claims, totalCount, nil
}

func (r *PostgresRepository) UpdateInsuranceClaimReview(ctx context.Context, id string, status string, approvedAmountCents *int64, assessorNotes string, denialReason string, reviewerID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE insurance_claims
		SET status = $2, approved_amount_cents = $3, assessor_notes = $4,
		    denial_reason = $5, reviewed_by = $6, reviewed_at = now(), updated_at = now()
		WHERE id = $1`,
		id, status, approvedAmountCents, assessorNotes, denialReason, reviewerID)
	if err != nil {
		return fmt.Errorf("update insurance claim review: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update insurance claim review: %w", domain.ErrInsuranceClaimNotFound)
	}
	return nil
}

func (r *PostgresRepository) UpdateInsuranceClaimPayout(ctx context.Context, id string, payoutCents int64, stripeTransferID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE insurance_claims
		SET status = 'paid_out', payout_cents = $2, stripe_transfer_id = $3, paid_at = now(), updated_at = now()
		WHERE id = $1`,
		id, payoutCents, stripeTransferID)
	if err != nil {
		return fmt.Errorf("update insurance claim payout: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update insurance claim payout: %w", domain.ErrInsuranceClaimNotFound)
	}
	return nil
}

// --- Contracts (read-only projection) ---

// GetContractForInsurance loads the minimal contract fields the insurance flow
// needs to verify ownership and derive the premium server-side. The category
// slug is best-effort (NULL/empty when the job's category has no slug or the
// join misses) — the premium calc treats an empty slug as the default 1.0x
// risk multiplier, so a missing slug never fails the purchase.
func (r *PostgresRepository) GetContractForInsurance(ctx context.Context, contractID string) (*domain.ContractForInsurance, error) {
	c := &domain.ContractForInsurance{}
	err := r.pool.QueryRow(ctx, `
		SELECT c.id, c.customer_id, c.provider_id, c.amount_cents, c.status,
		       COALESCE(sc.slug, '')
		FROM contracts c
		JOIN jobs j ON j.id = c.job_id
		LEFT JOIN service_categories sc ON sc.id = j.category_id
		WHERE c.id = $1 AND c.deleted_at IS NULL`, contractID).Scan(
		&c.ID, &c.CustomerID, &c.ProviderID, &c.AmountCents, &c.Status, &c.CategorySlug,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get contract for insurance: %w", domain.ErrInsuranceContractNotFound)
		}
		return nil, fmt.Errorf("get contract for insurance: %w", err)
	}
	return c, nil
}

// --- Sequences ---

func (r *PostgresRepository) NextPolicyNumber(ctx context.Context) (string, error) {
	var seq int64
	err := r.pool.QueryRow(ctx, `SELECT nextval('insurance_policy_number_seq')`).Scan(&seq)
	if err != nil {
		return "", fmt.Errorf("next policy number: %w", err)
	}
	year := time.Now().UTC().Year()
	return fmt.Sprintf("POL-%d-%06d", year, seq), nil
}

func (r *PostgresRepository) NextClaimNumber(ctx context.Context) (string, error) {
	var seq int64
	err := r.pool.QueryRow(ctx, `SELECT nextval('insurance_claim_number_seq')`).Scan(&seq)
	if err != nil {
		return "", fmt.Errorf("next claim number: %w", err)
	}
	year := time.Now().UTC().Year()
	return fmt.Sprintf("CLM-%d-%06d", year, seq), nil
}
