package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"os"
	"strconv"
	"time"

	"github.com/google/uuid"
	underwritingv1 "github.com/nomarkup/nomarkup/proto/underwriting/v1"
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
//
//	fee = amount × APR × (termDays / 365)
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
		// Predictable state-machine conflict (already disbursed, still pending
		// review, rejected, …) — typed sentinel so the gRPC layer maps it to a
		// clean 422, never a 500. Covers the SEQUENTIAL repeat-disburse case; the
		// concurrent case is caught by the guarded UPDATE below.
		return nil, "", fmt.Errorf("disburse advance: not approved (current status: %s): %w", advance.Status, domain.ErrAdvanceNotApproved)
	}

	// Get provider's Stripe account ID.
	stripeAccountID, err := s.repo.GetStripeAccountID(ctx, advance.ProviderID)
	if err != nil {
		return nil, "", fmt.Errorf("disburse advance get stripe account: %w", err)
	}

	// Transfer from platform balance to provider.
	//
	// DOUBLE-PAYOUT GUARD: the status check above is a non-locking read, so two
	// concurrent disbursements for the same advance can both reach this point. We
	// pass a DETERMINISTIC idempotency key ("advance-disburse:<id>") so Stripe (and
	// the dev store) dedupe the racing/retried transfer to a SINGLE money movement
	// — the loser gets back the same transfer id rather than firing a second payout.
	// The DB-side single-disbursement invariant is enforced by the guarded UPDATE
	// below (WHERE status='approved').
	idempotencyKey := "advance-disburse:" + advanceID
	transferID, err := s.stripe.CreatePlatformTransfer(ctx, advance.AdvanceAmountCents, "usd", stripeAccountID, idempotencyKey)
	if err != nil {
		return nil, "", fmt.Errorf("disburse advance transfer: %w", err)
	}

	// Update advance record with disbursement info. The guarded UPDATE
	// (WHERE status='approved') yields ErrAdvanceNotFound if a concurrent
	// disbursement already claimed it; surface a typed "not approved" sentinel so
	// the gRPC layer maps the loser to a clean 422 (FailedPrecondition) instead of
	// a 500. No second payout happened — the transfer above was deduped by key.
	updated, err := s.repo.UpdateAdvanceDisbursement(ctx, advanceID, transferID)
	if err != nil {
		if errors.Is(err, domain.ErrAdvanceNotFound) {
			return nil, "", fmt.Errorf("disburse advance: advance is no longer in approved status (already disbursed): %w", domain.ErrAdvanceNotApproved)
		}
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

// ComputeCreditLimit underwrites and persists a provider's working-capital
// credit limit via the deterministic underwriting engine (nomarkup.underwriting.v1).
//
// All underwriting inputs are gathered server-side from un-forgeable, escrow-
// SETTLED data (released earnings windows, repayment record, dispute rate, the
// trust graph) — the provider self-reports none of them. The engine is a pure,
// deterministic function with hard invariants and a tamper-evidence hash; this
// method only gathers features and persists the decision.
//
// Fail-closed: if the engine or trust source is unavailable, we surface a
// no-offer decision (never a borrower-facing 500) and log for the operator.
func (s *PaymentService) ComputeCreditLimit(ctx context.Context, providerID string) (*domain.CreditLimit, error) {
	if providerID == "" {
		return nil, fmt.Errorf("compute credit limit: provider_id is required")
	}

	// Lifetime settled earnings (display) + outstanding exposure + repayment
	// record — all from our own ledgers.
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

	activeAdvances, err := s.repo.GetActiveAdvancesForProvider(ctx, providerID)
	if err != nil {
		return nil, fmt.Errorf("compute credit limit get active advances: %w", err)
	}
	var totalOutstanding int64
	for _, adv := range activeAdvances {
		if remaining := (adv.AdvanceAmountCents + adv.FeeCents) - adv.RepaidCents; remaining > 0 {
			totalOutstanding += remaining
		}
	}

	allAdvances, _, err := s.repo.ListAdvances(ctx, providerID, "", 1, 1000)
	if err != nil {
		return nil, fmt.Errorf("compute credit limit list advances: %w", err)
	}
	onTimeRate := onTimeRateFromAdvances(allAdvances)
	onTimeVal := 0.5 // neutral prior; the engine re-applies it for thin-file
	if onTimeRate != nil {
		onTimeVal = *onTimeRate
	}

	// The display/feature fields common to every return path below.
	base := &domain.CreditLimit{
		ProviderID:            providerID,
		TotalOutstandingCents: totalOutstanding,
		JobsCompleted:         jobsCompleted,
		TotalEarningsCents:    totalEarningsCents,
		AvgJobValueCents:      avgJobValueCents,
		OnTimeRate:            onTimeRate,
	}

	// Fail closed when the engine/trust client isn't wired (config error).
	if s.underwriter == nil || s.trust == nil {
		slog.Error("underwriting unavailable: engine/trust client not wired", "provider_id", providerID)
		return s.persistCreditLimit(ctx, failClosed(base, "Underwriting is temporarily unavailable. Please try again shortly."))
	}

	asOf := time.Now().UTC()

	// Un-forgeable settled-earnings windows + activity + dispute rate.
	t30, t90, t365, activeMonths, err := s.repo.GetUnderwritingEarnings(ctx, providerID, asOf)
	if err != nil {
		return nil, fmt.Errorf("compute credit limit earnings: %w", err)
	}
	disputeRate, err := s.repo.GetProviderDisputeRate90d(ctx, providerID, asOf)
	if err != nil {
		return nil, fmt.Errorf("compute credit limit dispute rate: %w", err)
	}

	// Trust dimensions from the trust engine (fail closed on error).
	trustOverall, trustFeedback, trustFraud, trustTier, err := s.trust.GetProviderTrust(ctx, providerID)
	if err != nil {
		slog.Error("underwriting: trust fetch failed; failing closed", "provider_id", providerID, "error", err)
		return s.persistCreditLimit(ctx, failClosed(base, "Could not verify your trust signals. Please try again shortly."))
	}

	// Account-tenure proxy derived from settled active months (un-gameable),
	// pending a dedicated account-age source; 6+ active months clears the
	// <180-day new-account penalty.
	tenureDays := int32(activeMonths) * 30

	features := &underwritingv1.ProviderFeatures{
		ProviderId:                 providerID,
		TrustOverall:               trustOverall,
		TrustFeedback:              trustFeedback,
		TrustFraud:                 trustFraud,
		TrustTier:                  trustTier,
		Trailing_30DEarningsCents:  t30,
		Trailing_90DEarningsCents:  t90,
		Trailing_365DEarningsCents: t365,
		CompletedJobs_90D:          0, // not used by the model; 90d count not gathered
		ActiveMonths:               int32(activeMonths),
		OnTimeRepaymentRate:        onTimeVal,
		PriorAdvancesCount:         int32(len(allAdvances)),
		DisputeRate_90D:            disputeRate,
		AccountTenureDays:          tenureDays,
		OutstandingAdvanceCents:    totalOutstanding,
		AsOfUnix:                   asOf.Unix(),
	}

	decision, err := s.underwriter.Underwrite(ctx, features)
	if err != nil {
		slog.Error("underwriting: engine call failed; failing closed", "provider_id", providerID, "error", err)
		return s.persistCreditLimit(ctx, failClosed(base, "Underwriting is temporarily unavailable. Please try again shortly."))
	}

	limit := base
	limit.MaxAdvanceCents = decision.GetMaxCreditCents()
	limit.RiskScore = decision.GetRiskScore()
	limit.Approved = decision.GetApproved()
	limit.Tier = underwritingTierString(decision.GetTier())
	limit.AvailableAdvanceCents = decision.GetAvailableCreditCents()
	limit.FeeBps = decision.GetFeeBps()
	limit.FactorRate = decision.GetFactorRate()
	limit.HoldbackPct = decision.GetHoldbackPct()
	limit.BindingCap = decision.GetBindingCap()
	limit.DecisionHash = decision.GetDecisionHash()
	limit.ModelVersion = decision.GetModelVersion()
	limit.BindingGate = decision.GetBindingGate()
	limit.Reasons = protoReasonsToDomain(decision.GetReasons())

	slog.Info("credit limit underwritten",
		"provider_id", providerID,
		"approved", limit.Approved,
		"tier", limit.Tier,
		"max_advance_cents", limit.MaxAdvanceCents,
		"risk_score", limit.RiskScore,
		"model_version", limit.ModelVersion,
		"decision_hash", limit.DecisionHash,
	)

	return s.persistCreditLimit(ctx, limit)
}

// failClosed marks a credit limit as a no-offer decision with a borrower-safe
// reason (used when underwriting inputs can't be gathered).
func failClosed(l *domain.CreditLimit, msg string) *domain.CreditLimit {
	l.Approved = false
	l.Tier = "ineligible"
	l.MaxAdvanceCents = 0
	l.AvailableAdvanceCents = 0
	l.BindingGate = "UNAVAILABLE: " + msg
	return l
}

// persistCreditLimit upserts the decision, re-fetches the persisted row (for ID
// + timestamps), and overlays the transient explainability fields that aren't
// stored.
func (s *PaymentService) persistCreditLimit(ctx context.Context, limit *domain.CreditLimit) (*domain.CreditLimit, error) {
	if err := s.repo.UpsertCreditLimit(ctx, limit); err != nil {
		return nil, fmt.Errorf("compute credit limit upsert: %w", err)
	}
	persisted, err := s.repo.GetCreditLimit(ctx, limit.ProviderID)
	if err != nil {
		return nil, fmt.Errorf("compute credit limit refetch: %w", err)
	}
	if persisted == nil {
		// Refetch returned nothing (shouldn't happen after a successful upsert);
		// fall back to the just-computed value rather than crash.
		persisted = limit
	}
	// The refetch supplies the DB-assigned ID + timestamps; the just-computed
	// decision is authoritative for every other field (and the explainability
	// fields aren't persisted at all). Overlay them so the returned value always
	// reflects this run's decision regardless of read lag.
	persisted.MaxAdvanceCents = limit.MaxAdvanceCents
	persisted.TotalOutstandingCents = limit.TotalOutstandingCents
	persisted.AvailableAdvanceCents = limit.AvailableAdvanceCents
	persisted.RiskScore = limit.RiskScore
	persisted.JobsCompleted = limit.JobsCompleted
	persisted.TotalEarningsCents = limit.TotalEarningsCents
	persisted.AvgJobValueCents = limit.AvgJobValueCents
	persisted.OnTimeRate = limit.OnTimeRate
	persisted.Approved = limit.Approved
	persisted.Tier = limit.Tier
	persisted.FeeBps = limit.FeeBps
	persisted.FactorRate = limit.FactorRate
	persisted.HoldbackPct = limit.HoldbackPct
	persisted.BindingCap = limit.BindingCap
	persisted.DecisionHash = limit.DecisionHash
	persisted.ModelVersion = limit.ModelVersion
	persisted.BindingGate = limit.BindingGate
	persisted.Reasons = limit.Reasons
	return persisted, nil
}

// underwritingTierString maps the engine's tier enum to a lowercase label.
func underwritingTierString(t underwritingv1.UnderwritingTier) string {
	switch t {
	case underwritingv1.UnderwritingTier_UNDERWRITING_TIER_STARTER:
		return "starter"
	case underwritingv1.UnderwritingTier_UNDERWRITING_TIER_STANDARD:
		return "standard"
	case underwritingv1.UnderwritingTier_UNDERWRITING_TIER_PREMIUM:
		return "premium"
	case underwritingv1.UnderwritingTier_UNDERWRITING_TIER_ELITE:
		return "elite"
	default:
		return "ineligible"
	}
}

func protoReasonsToDomain(rs []*underwritingv1.DecisionReason) []domain.CreditDecisionReason {
	out := make([]domain.CreditDecisionReason, 0, len(rs))
	for _, r := range rs {
		out = append(out, domain.CreditDecisionReason{
			Code:         r.GetCode(),
			Label:        r.GetLabel(),
			Contribution: r.GetContribution(),
		})
	}
	return out
}
