package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// InsuranceService implements insurance business logic.
type InsuranceService struct {
	repo   domain.InsuranceRepository
	stripe *StripeService
}

// NewInsuranceService creates a new insurance service.
func NewInsuranceService(repo domain.InsuranceRepository, stripe *StripeService) *InsuranceService {
	return &InsuranceService{repo: repo, stripe: stripe}
}

// ListProducts returns all active insurance products.
func (s *InsuranceService) ListProducts(ctx context.Context) ([]*domain.InsuranceProduct, error) {
	products, err := s.repo.ListInsuranceProducts(ctx, true)
	if err != nil {
		return nil, fmt.Errorf("list insurance products: %w", err)
	}
	return products, nil
}

// GetInsuranceQuote calculates a premium for a given product and contract amount.
func (s *InsuranceService) GetInsuranceQuote(ctx context.Context, productID string, contractAmountCents int64, categorySlug string) (*domain.InsuranceQuote, error) {
	product, err := s.repo.GetInsuranceProduct(ctx, productID)
	if err != nil {
		return nil, fmt.Errorf("get insurance quote: %w", err)
	}

	if !product.Active {
		return nil, fmt.Errorf("get insurance quote: %w", domain.ErrInsuranceProductNotFound)
	}

	// Base premium = contract_amount * base_rate_bps / 10000
	premium := contractAmountCents * int64(product.BaseRateBPS) / 10000

	// Apply category risk multiplier.
	categoryMultiplier := categoryRiskMultiplier(categorySlug)
	premium = int64(float64(premium) * categoryMultiplier)

	// Enforce min_premium_cents floor.
	if premium < product.MinPremiumCents {
		premium = product.MinPremiumCents
	}

	// Coverage amount is the contract amount (capped by max_coverage if set).
	coverageAmount := contractAmountCents
	if product.MaxCoverageCents != nil && coverageAmount > *product.MaxCoverageCents {
		coverageAmount = *product.MaxCoverageCents
	}

	now := time.Now().UTC()
	effectiveDate := now.Truncate(24 * time.Hour)
	expirationDate := effectiveDate.AddDate(0, 0, product.CoverageDurationDays)

	return &domain.InsuranceQuote{
		ProductID:            product.ID,
		ProductName:          product.Name,
		CoverageType:         product.CoverageType,
		PremiumCents:         premium,
		CoverageAmountCents:  coverageAmount,
		DeductibleCents:      product.DeductibleCents,
		CoverageDurationDays: product.CoverageDurationDays,
		EffectiveDate:        effectiveDate,
		ExpirationDate:       expirationDate,
	}, nil
}

// PurchaseInsurance creates a policy and a Stripe PaymentIntent for the premium.
func (s *InsuranceService) PurchaseInsurance(ctx context.Context, input domain.PurchaseInsuranceInput) (*domain.InsurancePolicy, string, error) {
	// Get the quote for this product and contract.
	quote, err := s.GetInsuranceQuote(ctx, input.ProductID, input.ContractAmountCents, "")
	if err != nil {
		return nil, "", fmt.Errorf("purchase insurance quote: %w", err)
	}

	// Generate policy number.
	policyNumber, err := s.repo.NextPolicyNumber(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("purchase insurance policy number: %w", err)
	}

	policyID := uuid.New().String()
	idempotencyKey := fmt.Sprintf("ins-pol-%s", policyID)

	// Create Stripe PaymentIntent for premium — NO destination (pure platform revenue).
	piID, clientSecret, err := s.stripe.CreateInsurancePaymentIntent(ctx, quote.PremiumCents, "usd", idempotencyKey, policyID)
	if err != nil {
		return nil, "", fmt.Errorf("purchase insurance stripe: %w", err)
	}

	policy := &domain.InsurancePolicy{
		ID:                    policyID,
		PolicyNumber:          policyNumber,
		ProductID:             input.ProductID,
		ContractID:            input.ContractID,
		CustomerID:            input.CustomerID,
		ProviderID:            input.ProviderID,
		CoverageAmountCents:   quote.CoverageAmountCents,
		PremiumCents:          quote.PremiumCents,
		DeductibleCents:       quote.DeductibleCents,
		StripePaymentIntentID: piID,
		EffectiveDate:         quote.EffectiveDate,
		ExpirationDate:        quote.ExpirationDate,
		Status:                "pending_payment",
	}

	if err := s.repo.CreateInsurancePolicy(ctx, policy); err != nil {
		return nil, "", fmt.Errorf("purchase insurance create: %w", err)
	}

	slog.Info("insurance policy created",
		"policy_id", policyID,
		"policy_number", policyNumber,
		"product_id", input.ProductID,
		"contract_id", input.ContractID,
		"premium_cents", quote.PremiumCents,
	)

	return policy, clientSecret, nil
}

// GetPolicy retrieves a policy by ID.
func (s *InsuranceService) GetPolicy(ctx context.Context, policyID string) (*domain.InsurancePolicy, error) {
	return s.repo.GetInsurancePolicy(ctx, policyID)
}

// ListPolicies returns policies for a user.
func (s *InsuranceService) ListPolicies(ctx context.Context, userID string, page, pageSize int) ([]*domain.InsurancePolicy, int, error) {
	return s.repo.ListInsurancePolicies(ctx, userID, page, pageSize)
}

// ActivatePolicy activates a policy after payment confirmation.
func (s *InsuranceService) ActivatePolicy(ctx context.Context, stripePaymentIntentID string) error {
	policy, err := s.repo.FindPolicyByStripePaymentIntentID(ctx, stripePaymentIntentID)
	if err != nil {
		return fmt.Errorf("activate insurance policy: %w", err)
	}

	if policy.Status != "pending_payment" {
		slog.Warn("insurance policy not in pending_payment status",
			"policy_id", policy.ID,
			"status", policy.Status,
		)
		return nil
	}

	if err := s.repo.UpdateInsurancePolicyPaid(ctx, policy.ID, stripePaymentIntentID); err != nil {
		return fmt.Errorf("activate insurance policy update: %w", err)
	}

	slog.Info("insurance policy activated",
		"policy_id", policy.ID,
		"policy_number", policy.PolicyNumber,
	)

	return nil
}

// FileInsuranceClaim files a new claim against an active policy.
func (s *InsuranceService) FileInsuranceClaim(ctx context.Context, input domain.FileInsuranceClaimInput) (*domain.InsuranceClaim, error) {
	// Verify the policy exists, is active, and not expired.
	policy, err := s.repo.GetInsurancePolicy(ctx, input.PolicyID)
	if err != nil {
		return nil, fmt.Errorf("file insurance claim: %w", err)
	}

	if policy.Status != "active" {
		return nil, fmt.Errorf("file insurance claim: %w", domain.ErrPolicyNotActive)
	}

	now := time.Now().UTC()
	if now.After(policy.ExpirationDate) {
		return nil, fmt.Errorf("file insurance claim: %w", domain.ErrPolicyExpired)
	}

	// Verify claimed amount does not exceed coverage.
	if input.ClaimedAmountCents > policy.CoverageAmountCents {
		return nil, fmt.Errorf("file insurance claim: %w", domain.ErrClaimExceedsCoverage)
	}

	// Generate claim number.
	claimNumber, err := s.repo.NextClaimNumber(ctx)
	if err != nil {
		return nil, fmt.Errorf("file insurance claim number: %w", err)
	}

	claimID := uuid.New().String()

	claim := &domain.InsuranceClaim{
		ID:                 claimID,
		ClaimNumber:        claimNumber,
		PolicyID:           input.PolicyID,
		ClaimantID:         input.ClaimantID,
		ClaimType:          input.ClaimType,
		Description:        input.Description,
		EvidenceURLs:       input.EvidenceURLs,
		ClaimedAmountCents: input.ClaimedAmountCents,
		Status:             "filed",
	}

	if err := s.repo.CreateInsuranceClaim(ctx, claim); err != nil {
		return nil, fmt.Errorf("file insurance claim create: %w", err)
	}

	slog.Info("insurance claim filed",
		"claim_id", claimID,
		"claim_number", claimNumber,
		"policy_id", input.PolicyID,
		"claimed_amount_cents", input.ClaimedAmountCents,
	)

	return claim, nil
}

// GetClaim retrieves a claim by ID.
func (s *InsuranceService) GetClaim(ctx context.Context, claimID string) (*domain.InsuranceClaim, error) {
	return s.repo.GetInsuranceClaim(ctx, claimID)
}

// AdminListClaims lists all claims with optional status filter.
func (s *InsuranceService) AdminListClaims(ctx context.Context, statusFilter string, page, pageSize int) ([]*domain.InsuranceClaim, int, error) {
	return s.repo.AdminListInsuranceClaims(ctx, statusFilter, page, pageSize)
}

// ReviewInsuranceClaim approves or denies a claim and handles payout.
func (s *InsuranceService) ReviewInsuranceClaim(ctx context.Context, input domain.ReviewInsuranceClaimInput) (*domain.InsuranceClaim, error) {
	claim, err := s.repo.GetInsuranceClaim(ctx, input.ClaimID)
	if err != nil {
		return nil, fmt.Errorf("review insurance claim: %w", err)
	}

	if claim.Status != "filed" && claim.Status != "under_review" && claim.Status != "appealed" {
		return nil, fmt.Errorf("review insurance claim: %w", domain.ErrClaimNotReviewable)
	}

	if !input.Approved {
		// Denied.
		if err := s.repo.UpdateInsuranceClaimReview(ctx, input.ClaimID, "denied", nil, input.AssessorNotes, input.DenialReason, input.ReviewerID); err != nil {
			return nil, fmt.Errorf("review insurance claim deny: %w", err)
		}

		slog.Info("insurance claim denied",
			"claim_id", input.ClaimID,
			"reviewer_id", input.ReviewerID,
			"denial_reason", input.DenialReason,
		)

		return s.repo.GetInsuranceClaim(ctx, input.ClaimID)
	}

	// Approved — calculate payout.
	policy, err := s.repo.GetInsurancePolicy(ctx, claim.PolicyID)
	if err != nil {
		return nil, fmt.Errorf("review insurance claim get policy: %w", err)
	}

	approvedAmount := input.ApprovedAmountCents
	if approvedAmount <= 0 {
		approvedAmount = claim.ClaimedAmountCents
	}

	// Payout = approved_amount - deductible (floored at 0).
	payout := approvedAmount - policy.DeductibleCents
	if payout < 0 {
		payout = 0
	}

	// Update claim as approved.
	if err := s.repo.UpdateInsuranceClaimReview(ctx, input.ClaimID, "approved", &approvedAmount, input.AssessorNotes, "", input.ReviewerID); err != nil {
		return nil, fmt.Errorf("review insurance claim approve: %w", err)
	}

	// Create platform transfer to claimant if payout > 0.
	if payout > 0 {
		transferID, err := s.stripe.CreatePlatformTransfer(ctx, payout, "usd", claim.ClaimantID)
		if err != nil {
			slog.Error("failed to create insurance claim payout transfer",
				"claim_id", input.ClaimID,
				"payout_cents", payout,
				"error", err,
			)
			return nil, fmt.Errorf("review insurance claim transfer: %w", err)
		}

		if err := s.repo.UpdateInsuranceClaimPayout(ctx, input.ClaimID, payout, transferID); err != nil {
			return nil, fmt.Errorf("review insurance claim payout update: %w", err)
		}
	} else {
		// Zero payout — just mark as paid_out.
		if err := s.repo.UpdateInsuranceClaimPayout(ctx, input.ClaimID, 0, ""); err != nil {
			return nil, fmt.Errorf("review insurance claim zero payout: %w", err)
		}
	}

	// Update policy status to claimed.
	if err := s.repo.UpdateInsurancePolicyStatus(ctx, claim.PolicyID, "claimed"); err != nil {
		slog.Error("failed to update policy status to claimed",
			"policy_id", claim.PolicyID,
			"error", err,
		)
	}

	slog.Info("insurance claim approved and paid",
		"claim_id", input.ClaimID,
		"approved_amount_cents", approvedAmount,
		"payout_cents", payout,
		"reviewer_id", input.ReviewerID,
	)

	return s.repo.GetInsuranceClaim(ctx, input.ClaimID)
}

// categoryRiskMultiplier returns a risk multiplier based on service category.
func categoryRiskMultiplier(categorySlug string) float64 {
	slug := strings.ToLower(categorySlug)

	// Higher risk categories.
	highRiskCategories := map[string]bool{
		"roofing":    true,
		"electrical": true,
		"plumbing":   true,
	}
	if highRiskCategories[slug] {
		return 1.5
	}

	// Lower risk categories.
	lowRiskCategories := map[string]bool{
		"cleaning":    true,
		"landscaping": true,
	}
	if lowRiskCategories[slug] {
		return 0.8
	}

	// Default multiplier.
	return 1.0
}
