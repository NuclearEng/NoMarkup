package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"strconv"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// ErrInsufficientCredit is returned when a requested advance exceeds the
// provider's available credit (max_advance minus current outstanding). It is a
// business-rule precondition failure, not bad input — the gRPC layer maps it to
// FailedPrecondition so the gateway surfaces an actionable 422.
var ErrInsufficientCredit = errors.New("requested amount exceeds available credit")

// ── Risk-based advance pricing ──────────────────────────────────────────
// The APR a provider pays = a base ("market") rate + a credit-risk premium
// derived from their business credit score. This auto-adjusts pricing to BOTH
// market conditions (ops moves the base rate) and creditworthiness (per
// borrower, recomputed every request). The same functions price the charge
// here and the quote shown in the gateway credit-limit response — keep the
// two formulas in sync (gateway/internal/handler/working_capital.go).

// baseAdvanceRateBps is the lender's base rate in basis points. Adjustable via
// ADVANCE_BASE_RATE_BPS so the rate can track market/funding-cost changes
// without a code change. Defaults to 300 bps (3.00%).
func baseAdvanceRateBps() int {
	if v := os.Getenv("ADVANCE_BASE_RATE_BPS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return 300
}

const (
	advanceRateFloorBps   = 300  // never price below the base/floor (3%)
	advanceRateCeilingBps = 1500 // hard cap (15%)
	minLendingScore       = 35   // below this (grade F) advances are declined
)

// businessCreditScore returns a 0-100 creditworthiness score from internal
// signals: repayment history (strongest), completed-job volume, and earnings.
// onTimeRate nil means "no advance history yet" → a neutral baseline.
func businessCreditScore(onTimeRate *float64, jobsCompleted int, totalEarningsCents int64) int {
	// Thin-file (no advance history) starts eligible-but-high-rate (lands at
	// grade D), so new providers can borrow small and build history. Proven
	// on-time repayment scores higher; defaulters score lower (→ declined).
	repayment := 35.0
	if onTimeRate != nil {
		repayment = *onTimeRate * 50.0
	}
	vol := float64(jobsCompleted)
	if vol > 20 {
		vol = 20
	}
	volume := vol / 20.0 * 30.0
	earnings := 0.0
	switch {
	case totalEarningsCents >= 1_000_000:
		earnings = 20
	case totalEarningsCents >= 250_000:
		earnings = 12
	case totalEarningsCents >= 50_000:
		earnings = 6
	}
	score := int(math.Round(repayment + volume + earnings))
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return score
}

// creditGrade maps a 0-100 score to a letter grade.
func creditGrade(score int) string {
	switch {
	case score >= 80:
		return "A"
	case score >= 65:
		return "B"
	case score >= 50:
		return "C"
	case score >= minLendingScore:
		return "D"
	default:
		return "F"
	}
}

// riskPremiumBps is the credit-risk markup added to the base rate, by grade.
func riskPremiumBps(grade string) int {
	switch grade {
	case "A":
		return 0
	case "B":
		return 200
	case "C":
		return 500
	case "D":
		return 900
	default:
		return 1200
	}
}

// dynamicAPRBps = clamp(baseRate + riskPremium, floor, ceiling).
func dynamicAPRBps(score int) int {
	apr := baseAdvanceRateBps() + riskPremiumBps(creditGrade(score))
	if apr < advanceRateFloorBps {
		apr = advanceRateFloorBps
	}
	if apr > advanceRateCeilingBps {
		apr = advanceRateCeilingBps
	}
	return apr
}

// computeAdvanceFeeCentsAPR prices a fee at an explicit APR (bps), prorated by
// term, rounded to the nearest cent.
func computeAdvanceFeeCentsAPR(amountCents int64, aprBps, termDays int) int64 {
	if termDays <= 0 {
		termDays = defaultAdvanceTermDays
	}
	return int64(math.Round(float64(amountCents) * float64(aprBps) / 10000.0 * float64(termDays) / 365.0))
}

// onTimeRateFromAdvances derives the share of resolved advances repaid on time.
// Returns nil when the provider has no resolved (repaid/defaulted) advances.
func onTimeRateFromAdvances(advances []*domain.Advance) *float64 {
	var resolved, onTime int
	for _, a := range advances {
		switch a.Status {
		case "repaid":
			resolved++
			onTime++
		case "defaulted":
			resolved++
		}
	}
	if resolved == 0 {
		return nil
	}
	r := float64(onTime) / float64(resolved)
	return &r
}

// providerCreditScore computes a provider's live business credit score from
// their released payments (volume/earnings) and advance repayment history.
func (s *PaymentService) providerCreditScore(ctx context.Context, providerID string) (int, error) {
	payments, _, err := s.repo.ListPayments(ctx, providerID, "released", 1, 1000)
	if err != nil {
		return 0, fmt.Errorf("credit score: list payments: %w", err)
	}
	var earnings int64
	for _, p := range payments {
		earnings += p.ProviderPayoutCents
	}
	advances, _, err := s.repo.ListAdvances(ctx, providerID, "", 1, 1000)
	if err != nil {
		return 0, fmt.Errorf("credit score: list advances: %w", err)
	}
	return businessCreditScore(onTimeRateFromAdvances(advances), len(payments), earnings), nil
}

// advanceFeeAPR is the annual percentage rate charged on working capital
// advances (3% APR). Simple interest, prorated over the expected term (not
// compounded):
//   fee = amount × APR × (termDays / 365)
const advanceFeeAPR = 0.03

// defaultAdvanceTermDays is the assumed time-to-repayment when the contract
// itself doesn't expose a maturity date. 30 days matches typical short-term
// advance products in the industry.
const defaultAdvanceTermDays = 30

// computeAdvanceFeeCents returns the prorated fee for an advance held for
// termDays at advanceFeeAPR. Rounds to the nearest cent so the charged fee
// matches the estimate shown to the provider (and never under-charges).
func computeAdvanceFeeCents(amountCents int64, termDays int) int64 {
	if termDays <= 0 {
		termDays = defaultAdvanceTermDays
	}
	return int64(math.Round(float64(amountCents) * advanceFeeAPR * float64(termDays) / 365.0))
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

	// Risk-based pricing: APR = base rate + credit-risk premium, by the
	// provider's live business credit score. Decline below the floor.
	score, err := s.providerCreditScore(ctx, providerID)
	if err != nil {
		return nil, fmt.Errorf("request advance: %w", err)
	}
	grade := creditGrade(score)
	if score < minLendingScore {
		// Routine "you don't qualify" outcome — wrap the sentinel so the gRPC
		// layer maps it to 422 (FailedPrecondition), not a 500. The score/grade
		// detail stays in the server log; the client gets the sentinel message.
		return nil, fmt.Errorf("request advance declined: credit score %d (grade %s): %w", score, grade, domain.ErrAdvanceDeclined)
	}

	// Over-lending guard: enforce the provider's available credit BEFORE booking
	// the advance. Available = max_advance - currently-outstanding, computed by
	// the same authoritative logic the credit-limit endpoint surfaces. A request
	// above the available line is a validation error (→ 400/422 at the gateway),
	// never a silent over-extension. Integer cents throughout.
	limit, err := s.ComputeCreditLimit(ctx, providerID)
	if err != nil {
		return nil, fmt.Errorf("request advance: %w", err)
	}
	available := limit.MaxAdvanceCents - limit.TotalOutstandingCents
	if available < 0 {
		available = 0
	}
	if amountCents > available {
		return nil, fmt.Errorf("request advance: %w: requested %d cents exceeds available credit of %d cents (max %d, outstanding %d)",
			ErrInsufficientCredit, amountCents, available, limit.MaxAdvanceCents, limit.TotalOutstandingCents)
	}

	aprBps := dynamicAPRBps(score)
	// Total fee = prorated APR interest + flat origination/service fee. Both
	// are disclosed to the provider as separate line items; FeeCents stores the
	// total so repayment/outstanding math stays in one place.
	interestCents := computeAdvanceFeeCentsAPR(amountCents, aprBps, defaultAdvanceTermDays)
	serviceFeeCents := domain.AdvanceServiceFeeCents(amountCents)
	feeCents := interestCents + serviceFeeCents

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
		"interest_cents", interestCents,
		"service_fee_cents", serviceFeeCents,
		"credit_score", score,
		"credit_grade", grade,
		"apr_bps", aprBps,
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

	// Repayment history → on-time rate, a key input to the business credit
	// score surfaced on the credit-limit response (and used for pricing).
	allAdvances, _, err := s.repo.ListAdvances(ctx, providerID, "", 1, 1000)
	if err != nil {
		return nil, fmt.Errorf("compute credit limit list advances: %w", err)
	}
	onTimeRate := onTimeRateFromAdvances(allAdvances)

	limit := &domain.CreditLimit{
		ProviderID:            providerID,
		MaxAdvanceCents:       maxAdvance,
		TotalOutstandingCents: totalOutstanding,
		RiskScore:             riskScore,
		JobsCompleted:         jobsCompleted,
		TotalEarningsCents:    totalEarningsCents,
		AvgJobValueCents:      avgJobValueCents,
		OnTimeRate:            onTimeRate,
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
