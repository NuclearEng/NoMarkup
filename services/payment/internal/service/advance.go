package service

import (
	"context"
	"fmt"
	"log/slog"
	"math"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// advanceFeeAPY is the annualized percentage rate charged on working capital
// advances (3% APY). The actual fee is prorated over the expected term:
//   fee = amount × APY × (termDays / 365)
const advanceFeeAPY = 0.03

// defaultAdvanceTermDays is the assumed time-to-repayment when the contract
// itself doesn't expose a maturity date. 30 days matches typical short-term
// advance products in the industry.
const defaultAdvanceTermDays = 30

// computeAdvanceFeeCents returns the prorated fee for an advance held for
// termDays at advanceFeeAPY.
func computeAdvanceFeeCents(amountCents int64, termDays int) int64 {
	if termDays <= 0 {
		termDays = defaultAdvanceTermDays
	}
	return int64(float64(amountCents) * advanceFeeAPY * float64(termDays) / 365.0)
}

// RequestAdvance creates a new working capital advance request.
func (s *PaymentService) RequestAdvance(ctx context.Context, providerID, contractID string, amountCents int64) (*domain.Advance, error) {
	if providerID == "" {
		return nil, fmt.Errorf("request advance: provider_id is required")
	}
	if contractID == "" {
		return nil, fmt.Errorf("request advance: contract_id is required")
	}
	if amountCents <= 0 {
		return nil, fmt.Errorf("request advance: %w", domain.ErrInvalidAmount)
	}

	feeCents := computeAdvanceFeeCents(amountCents, defaultAdvanceTermDays)

	advance := &domain.Advance{
		ID:                 uuid.New().String(),
		ProviderID:         providerID,
		ContractID:         contractID,
		AdvanceAmountCents: amountCents,
		FeeCents:           feeCents,
		RepaidCents:        0,
		Status:             "requested",
	}

	if err := s.repo.CreateAdvance(ctx, advance); err != nil {
		return nil, err
	}

	slog.Info("advance requested",
		"advance_id", advance.ID,
		"provider_id", providerID,
		"contract_id", contractID,
		"amount_cents", amountCents,
		"fee_cents", feeCents,
	)

	return advance, nil
}

// ListAdvances returns paginated advances. If providerID is empty, returns all advances (admin).
func (s *PaymentService) ListAdvances(ctx context.Context, providerID string, statusFilter string, page, pageSize int) ([]*domain.Advance, int, error) {
	return s.repo.ListAdvances(ctx, providerID, statusFilter, page, pageSize)
}

// GetAdvance retrieves a single advance by ID.
func (s *PaymentService) GetAdvance(ctx context.Context, advanceID string) (*domain.Advance, error) {
	if advanceID == "" {
		return nil, fmt.Errorf("get advance: advance_id is required")
	}
	return s.repo.GetAdvance(ctx, advanceID)
}

// ReviewAdvance approves or rejects a working capital advance.
// Only advances in "requested" status can be reviewed.
func (s *PaymentService) ReviewAdvance(ctx context.Context, advanceID, reviewerID, action, reason string) (*domain.Advance, error) {
	if advanceID == "" {
		return nil, fmt.Errorf("review advance: advance_id is required")
	}
	if reviewerID == "" {
		return nil, fmt.Errorf("review advance: reviewer_id is required")
	}
	if action != "approve" && action != "reject" {
		return nil, fmt.Errorf("review advance: action must be 'approve' or 'reject'")
	}

	status := "approved"
	if action == "reject" {
		status = "rejected"
	}

	var rejectionReason *string
	if action == "reject" && reason != "" {
		rejectionReason = &reason
	}

	advance, err := s.repo.UpdateAdvanceReview(ctx, advanceID, status, reviewerID, rejectionReason)
	if err != nil {
		return nil, err
	}

	slog.Info("advance reviewed",
		"advance_id", advanceID,
		"reviewer_id", reviewerID,
		"action", action,
		"status", status,
	)

	return advance, nil
}

// maxCreditCents is the hard cap on any single provider's credit limit ($25,000).
const maxCreditCents = 2500000

// DisburseAdvance transfers approved advance funds to the provider's Stripe account.
func (s *PaymentService) DisburseAdvance(ctx context.Context, advanceID string, adminID string) (*domain.Advance, string, error) {
	if advanceID == "" {
		return nil, "", fmt.Errorf("disburse advance: advance_id is required")
	}
	if adminID == "" {
		return nil, "", fmt.Errorf("disburse advance: admin_id is required")
	}

	// Verify the advance exists and is approved.
	advance, err := s.repo.GetAdvance(ctx, advanceID)
	if err != nil {
		return nil, "", fmt.Errorf("disburse advance: %w", err)
	}
	if advance.Status != "approved" {
		return nil, "", fmt.Errorf("disburse advance: advance is not in approved status (current: %s)", advance.Status)
	}

	// Get provider's Stripe account ID.
	stripeAccountID, err := s.repo.GetStripeAccountID(ctx, advance.ProviderID)
	if err != nil {
		return nil, "", fmt.Errorf("disburse advance get stripe account: %w", err)
	}

	// Transfer from platform balance to provider.
	transferID, err := s.stripe.CreatePlatformTransfer(ctx, advance.AdvanceAmountCents, "usd", stripeAccountID)
	if err != nil {
		return nil, "", fmt.Errorf("disburse advance transfer: %w", err)
	}

	// Update advance record with disbursement info.
	updated, err := s.repo.UpdateAdvanceDisbursement(ctx, advanceID, transferID)
	if err != nil {
		return nil, "", fmt.Errorf("disburse advance update: %w", err)
	}

	slog.Info("advance disbursed",
		"advance_id", advanceID,
		"admin_id", adminID,
		"provider_id", advance.ProviderID,
		"amount_cents", advance.AdvanceAmountCents,
		"stripe_transfer_id", transferID,
	)

	return updated, transferID, nil
}

// ComputeCreditLimit calculates and persists a provider's working capital credit limit.
func (s *PaymentService) ComputeCreditLimit(ctx context.Context, providerID string) (*domain.CreditLimit, error) {
	if providerID == "" {
		return nil, fmt.Errorf("compute credit limit: provider_id is required")
	}

	// Query provider's payment history for completed jobs.
	payments, _, err := s.repo.ListPayments(ctx, providerID, "released", 1, 1000)
	if err != nil {
		return nil, fmt.Errorf("compute credit limit list payments: %w", err)
	}

	jobsCompleted := len(payments)
	var totalEarningsCents int64
	for _, p := range payments {
		totalEarningsCents += p.ProviderPayoutCents
	}

	var avgJobValueCents int64
	if jobsCompleted > 0 {
		avgJobValueCents = totalEarningsCents / int64(jobsCompleted)
	}

	// Estimate average monthly earnings over last 6 months.
	// Use total earnings / 6 as a rough estimate.
	avgMonthlyEarnings := totalEarningsCents / 6
	if avgMonthlyEarnings < 0 {
		avgMonthlyEarnings = 0
	}

	// Max advance = min(50% of avg monthly earnings, $25k cap).
	maxAdvance := avgMonthlyEarnings / 2
	if maxAdvance > maxCreditCents {
		maxAdvance = maxCreditCents
	}

	// Get total outstanding advances.
	activeAdvances, err := s.repo.GetActiveAdvancesForProvider(ctx, providerID)
	if err != nil {
		return nil, fmt.Errorf("compute credit limit get active advances: %w", err)
	}

	var totalOutstanding int64
	for _, adv := range activeAdvances {
		remaining := (adv.AdvanceAmountCents + adv.FeeCents) - adv.RepaidCents
		if remaining > 0 {
			totalOutstanding += remaining
		}
	}

	// Subtract outstanding from max advance for available amount.
	availableAdvance := maxAdvance - totalOutstanding
	if availableAdvance < 0 {
		availableAdvance = 0
	}

	// Simple risk score: higher completion count = lower risk.
	riskScore := math.Max(0, 100.0-float64(jobsCompleted)*5.0)
	if riskScore < 0 {
		riskScore = 0
	}

	limit := &domain.CreditLimit{
		ProviderID:            providerID,
		MaxAdvanceCents:       maxAdvance,
		TotalOutstandingCents: totalOutstanding,
		RiskScore:             riskScore,
		JobsCompleted:         jobsCompleted,
		TotalEarningsCents:    totalEarningsCents,
		AvgJobValueCents:      avgJobValueCents,
	}

	if err := s.repo.UpsertCreditLimit(ctx, limit); err != nil {
		return nil, fmt.Errorf("compute credit limit upsert: %w", err)
	}

	// Re-fetch to get computed timestamps and ID.
	persisted, err := s.repo.GetCreditLimit(ctx, providerID)
	if err != nil {
		return nil, fmt.Errorf("compute credit limit refetch: %w", err)
	}

	// Merge the available advance into the response (it's derived, not stored).
	persisted.MaxAdvanceCents = maxAdvance
	persisted.TotalOutstandingCents = totalOutstanding

	slog.Info("credit limit computed",
		"provider_id", providerID,
		"max_advance_cents", maxAdvance,
		"total_outstanding_cents", totalOutstanding,
		"available_advance_cents", availableAdvance,
		"jobs_completed", jobsCompleted,
	)

	return persisted, nil
}
