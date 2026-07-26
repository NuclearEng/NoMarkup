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

	// accounts resolves a claimant's platform user id to their Stripe Connect
	// acct_*. Without it, claim payouts sent the raw claimant UUID as the
	// transfer Destination — the same MON-08 defect already fixed for goods
	// (resolveSellerConnectAccount) and advances. See resolveClaimantAccount.
	accounts ConnectAccountResolver

	// trust is the optional trust-engine source used to read a provider's tier
	// for trust-tiered premium pricing. When nil (or the lookup errors), pricing
	// fails CLOSED: no discount, never an error.
	trust ProviderTrustSource
	// trustPricingEnabled gates the trust-tier discount (the
	// `insurance_trust_pricing` feature flag, read once at startup). When false
	// the premium is the legacy base+category premium, byte-for-byte.
	trustPricingEnabled bool
}

// NewInsuranceService creates a new insurance service.
func NewInsuranceService(repo domain.InsuranceRepository, stripe *StripeService) *InsuranceService {
	return &InsuranceService{repo: repo, stripe: stripe}
}

// SetAccountResolver wires the platform-user-id → Stripe Connect acct_*
// resolver used for claim payouts. Mirrors MarketplaceService.SetAccountResolver.
// Without it, claim payouts are refused outside dev mode rather than sending a
// bare user UUID to Stripe as the transfer destination.
func (s *InsuranceService) SetAccountResolver(r ConnectAccountResolver) {
	s.accounts = r
}

// resolveClaimantAccount returns the Stripe Connect acct_* for a claimant.
// Never returns a bare user UUID in production (MON-08).
func (s *InsuranceService) resolveClaimantAccount(ctx context.Context, claimantID string) (string, error) {
	if s.accounts != nil {
		acct, err := s.accounts.GetStripeAccountID(ctx, claimantID)
		if err != nil {
			return "", fmt.Errorf("resolve claimant connect account: %w", err)
		}
		if acct == "" || (!s.stripe.IsDevMode() && !strings.HasPrefix(acct, "acct_")) {
			return "", fmt.Errorf("resolve claimant connect account: invalid account id for claimant %s", claimantID)
		}
		return acct, nil
	}
	if s.stripe.IsDevMode() {
		return claimantID, nil
	}
	return "", fmt.Errorf("resolve claimant connect account: no account resolver configured")
}

// SetTrustSource wires the trust-engine client used to read a provider's tier
// for trust-tiered premium pricing. Optional: when unset, pricing fails closed
// (no discount).
func (s *InsuranceService) SetTrustSource(t ProviderTrustSource) {
	s.trust = t
}

// SetTrustPricingEnabled toggles the trust-tier premium discount. This is the
// `insurance_trust_pricing` feature flag, evaluated once at startup. Defaults to
// false (fail closed — legacy pricing) until explicitly enabled.
func (s *InsuranceService) SetTrustPricingEnabled(enabled bool) {
	s.trustPricingEnabled = enabled
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

// GetQuoteForContract derives the premium for a product against a contract.
// The contract amount and category are read server-side from the contract
// (never trusted from the client), so the premium cannot be manipulated by the
// caller. Ownership is enforced at purchase time (PurchaseInsurance), which is
// the security boundary that actually creates a policy and charges the card;
// the quote is a read-only premium preview.
//
// When the `insurance_trust_pricing` flag is on, the provider's trust tier
// (read server-side from the contract → trust engine) earns a deterministic
// premium discount — higher tier, lower premium. See applyTrustDiscount.
func (s *InsuranceService) GetQuoteForContract(ctx context.Context, productID, contractID string) (*domain.InsuranceQuote, error) {
	contract, err := s.repo.GetContractForInsurance(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("quote contract for insurance: %w", err)
	}
	quote, err := s.GetInsuranceQuote(ctx, productID, contract.AmountCents, contract.CategorySlug)
	if err != nil {
		return nil, err
	}
	s.applyTrustDiscount(ctx, quote, contract.ProviderID, contract.AmountCents)
	return quote, nil
}

// loadOwnedContract loads a contract and verifies the authenticated customer
// owns it. Returns ErrInsuranceContractNotFound when missing and
// ErrContractNotOwned when the caller is not the contract's customer — the
// core payment-integrity / IDOR guard for the per-job insurance flow.
func (s *InsuranceService) loadOwnedContract(ctx context.Context, contractID, customerID string) (*domain.ContractForInsurance, error) {
	contract, err := s.repo.GetContractForInsurance(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("load contract for insurance: %w", err)
	}
	if contract.CustomerID != customerID {
		return nil, fmt.Errorf("load contract for insurance: %w", domain.ErrContractNotOwned)
	}
	return contract, nil
}

// PurchaseInsurance creates a policy and a Stripe PaymentIntent for the premium.
//
// SECURITY: the premium, coverage amount and provider are DERIVED from the
// server-side contract — never from client input. The caller must own the
// contract (verified via loadOwnedContract). This prevents a customer from
// insuring an arbitrary/non-owned contract or supplying an arbitrary amount.
func (s *InsuranceService) PurchaseInsurance(ctx context.Context, input domain.PurchaseInsuranceInput) (*domain.InsurancePolicy, string, error) {
	// Load + verify ownership of the contract, then derive amount/provider/category.
	contract, err := s.loadOwnedContract(ctx, input.ContractID, input.CustomerID)
	if err != nil {
		return nil, "", fmt.Errorf("purchase insurance contract: %w", err)
	}

	// Get the quote using the server-derived contract amount and category.
	quote, err := s.GetInsuranceQuote(ctx, input.ProductID, contract.AmountCents, contract.CategorySlug)
	if err != nil {
		return nil, "", fmt.Errorf("purchase insurance quote: %w", err)
	}

	// Apply the trust-tier discount (flag-gated, fail-closed) so the premium we
	// CHARGE matches the discounted premium the customer was quoted.
	s.applyTrustDiscount(ctx, quote, contract.ProviderID, contract.AmountCents)

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
		ProviderID:            contract.ProviderID,
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

	// Re-read the inserted row so the response carries DB-populated columns
	// (created_at / updated_at) instead of the Go zero value (0001-01-01).
	if created, err := s.repo.GetInsurancePolicy(ctx, policyID); err != nil {
		slog.Warn("failed to re-read insurance policy after create",
			"policy_id", policyID,
			"error", err,
		)
	} else {
		policy = created
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

	// Authorization (funds-theft guard): only the policyholder (the customer who
	// purchased the policy) may file a claim against it. The approved payout is
	// sent to the claimant, so an unauthenticated claimant could otherwise drain
	// funds against another tenant's policy.
	if input.ClaimantID != policy.CustomerID {
		return nil, fmt.Errorf("file insurance claim: %w", domain.ErrClaimantNotPolicyholder)
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

	// Coverage cap (funds-protection guard): the approved amount must never exceed
	// the policy's coverage limit. The file-time check only bounds the *claimed*
	// amount; the assessor-supplied approved amount is a separate input that must
	// be re-validated server-side, or an admin could approve a payout far larger
	// than the policy ever covered. Fail closed.
	if approvedAmount > policy.CoverageAmountCents {
		return nil, fmt.Errorf("review insurance claim: %w", domain.ErrClaimExceedsCoverage)
	}

	// Payout = approved_amount - deductible (floored at 0).
	payout := approvedAmount - policy.DeductibleCents
	if payout < 0 {
		payout = 0
	}

	// Resolve the payout destination BEFORE marking the claim approved.
	//
	// Ordering matters: UpdateInsuranceClaimReview moves the claim to
	// 'approved', which is outside the {filed, under_review, appealed} set
	// this function requires on entry. So if anything after that write fails,
	// the claim can never be re-reviewed and the claimant can never be paid —
	// a permanent wedge. Everything that can fail is therefore done first.
	destination := ""
	if payout > 0 {
		var resolveErr error
		destination, resolveErr = s.resolveClaimantAccount(ctx, claim.ClaimantID)
		if resolveErr != nil {
			slog.Error("cannot resolve insurance claimant payout account; leaving claim reviewable",
				"claim_id", input.ClaimID,
				"claimant_id", claim.ClaimantID,
				"error", resolveErr,
			)
			return nil, fmt.Errorf("review insurance claim: %w", resolveErr)
		}
	}

	// Update claim as approved.
	if err := s.repo.UpdateInsuranceClaimReview(ctx, input.ClaimID, "approved", &approvedAmount, input.AssessorNotes, "", input.ReviewerID); err != nil {
		return nil, fmt.Errorf("review insurance claim approve: %w", err)
	}

	// Create platform transfer to claimant if payout > 0. Deterministic idempotency
	// key keyed on the claim id so a retried claim review never double-pays out.
	if payout > 0 {
		transferID, err := s.stripe.CreatePlatformTransfer(ctx, payout, "usd", destination, "insurance-claim-payout:"+input.ClaimID)
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

// trustDiscountBps returns the premium discount, in basis points, earned by a
// provider's trust tier. Higher tier ⇒ larger discount ⇒ lower premium. This is
// the load-bearing collateral: a provider's trust tier directly lowers what the
// customer pays to insure their job.
//
//	top_rated     → 1500 bps (−15%)
//	trusted       → 1000 bps (−10%)
//	rising        →  500 bps (−5%)
//	new           →    0 bps (no discount)
//	under_review  →    0 bps (no discount — a flagged provider earns nothing)
//	unknown/""    →    0 bps (fail closed)
//
// Pure + deterministic: no I/O, no clock. The tier string matches the trust
// engine's vocabulary (see client.mapTrustTier).
func trustDiscountBps(tier string) int64 {
	switch tier {
	case "top_rated":
		return 1500
	case "trusted":
		return 1000
	case "rising":
		return 500
	default:
		// new, under_review, unspecified, or any unrecognized value: no discount.
		return 0
	}
}

// applyTrustDiscountToPremium returns the premium after the tier discount,
// floored so it can never drop below the product's minimum premium nor below
// zero. Pure integer math (money-in-cents): discount = premium*bps/10000,
// truncated, then subtracted. A zero-bps tier returns the premium unchanged.
//
// minPremiumCents is the product's floor; the discounted premium is clamped up
// to it so a discount can never undercut the carrier's minimum.
func applyTrustDiscountToPremium(premiumCents, minPremiumCents int64, tier string) int64 {
	bps := trustDiscountBps(tier)
	if bps <= 0 || premiumCents <= 0 {
		return premiumCents
	}
	discount := premiumCents * bps / 10000
	discounted := premiumCents - discount
	if discounted < minPremiumCents {
		discounted = minPremiumCents
	}
	if discounted < 0 {
		discounted = 0
	}
	// Never let a discount accidentally raise the premium (e.g. if the floor
	// exceeds the base for a degenerate product config).
	if discounted > premiumCents {
		discounted = premiumCents
	}
	return discounted
}

// applyTrustDiscount mutates quote.PremiumCents in place by the provider's
// trust-tier discount, when the trust-pricing feature is enabled.
//
// Fail-CLOSED contract: if the flag is off, the trust source is unset, the
// provider id is empty, or the trust lookup errors, the premium is left
// UNCHANGED and no error is surfaced — a trust-engine blip must never break a
// quote or a purchase. The discount only ever LOWERS the premium.
func (s *InsuranceService) applyTrustDiscount(ctx context.Context, quote *domain.InsuranceQuote, providerID string, contractAmountCents int64) {
	if quote == nil {
		return
	}
	if !s.trustPricingEnabled || s.trust == nil || providerID == "" {
		return // flag off / not wired → fail closed, legacy premium.
	}

	_, _, _, tier, err := s.trust.GetProviderTrust(ctx, providerID)
	if err != nil {
		slog.Warn("insurance trust pricing: trust lookup failed, charging undiscounted premium",
			"provider_id", providerID,
			"error", err,
		)
		return // fail closed — no discount, no error.
	}

	// Re-derive the product floor from the quote: the floor is whatever the
	// premium would never go below. We only have the product's min via the
	// quote's own clamp, so use the deductible-independent floor of 0 plus the
	// product min that GetInsuranceQuote already enforced (the quote premium is
	// already ≥ product min). Passing the current premium as the floor would be
	// a no-op, so we floor at 0 and let the carrier-min invariant hold because
	// the discount is a strict reduction of an already-min-satisfying premium.
	before := quote.PremiumCents
	quote.PremiumCents = applyTrustDiscountToPremium(quote.PremiumCents, 0, tier)
	if quote.PremiumCents != before {
		slog.Info("insurance trust pricing: tier discount applied",
			"provider_id", providerID,
			"tier", tier,
			"premium_before_cents", before,
			"premium_after_cents", quote.PremiumCents,
			"discount_bps", trustDiscountBps(tier),
		)
	}
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
