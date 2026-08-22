package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	underwritingv1 "github.com/nomarkup/nomarkup/proto/underwriting/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// Underwriter sizes a provider's working-capital line via the deterministic
// underwriting engine (Rust). Injected optionally; when absent, credit-limit
// computation fails closed (see ComputeCreditLimit).
type Underwriter interface {
	Underwrite(ctx context.Context, f *underwritingv1.ProviderFeatures) (*underwritingv1.UnderwriteResponse, error)
}

// ProviderTrustSource fetches a provider's trust dimensions from the trust
// engine — an underwriting input the provider cannot self-report.
type ProviderTrustSource interface {
	GetProviderTrust(ctx context.Context, providerID string) (overall, feedback, fraud float64, tier string, err error)
}

// SubscriptionWebhookHandler allows the payment service to delegate subscription
// webhook events to the subscription service without creating a circular dependency.
type SubscriptionWebhookHandler interface {
	HandleSubscriptionWebhook(ctx context.Context, eventType, stripeSubscriptionID string, periodStart, periodEnd *time.Time) error
}

// InstallmentPaymentHandler allows the payment service to delegate installment
// payment events to the installment service.
type InstallmentPaymentHandler interface {
	ConfirmInstallmentPaymentSucceeded(ctx context.Context, planID, installmentID, paymentIntentID string) error
}

// MarketplacePaymentHandler is the surface PaymentService uses to delegate
// goods-marketplace webhook events. The concrete implementation is
// *MarketplaceService.HandleListingPaymentIntentSucceeded.
type MarketplacePaymentHandler interface {
	HandleListingPaymentIntentSucceeded(ctx context.Context, paymentIntentID string) error
}

// RecurringPaymentFailureHandler records FR-16.7 strikes when a
// recurring-instance PaymentIntent fails (webhook path). Increments
// payment_retry_count, schedules next_retry_at when count < 3, and pauses only
// at threshold (>= 3) per FR-18.8. Never cancels the contract. Fail-soft: the
// payment webhook always acks Stripe even if strike/pause fails.
//
// Concrete implementation: payment/internal/client.ContractClient (shared SQL
// for strikes + job service GetRecurringConfig / PauseRecurring at threshold).
type RecurringPaymentFailureHandler interface {
	// PauseOnPaymentFailed records an FR-16.7 strike on the contract's active
	// recurring config and PauseRecurring only when payment_retry_count >= 3.
	// Idempotent for already-paused configs; non-active left alone.
	// contractID / customerID come from the payments row; recurringInstanceID
	// is for logging/correlation only (strikes are per config, not per instance).
	PauseOnPaymentFailed(ctx context.Context, contractID, customerID, recurringInstanceID, paymentID string) error
}

// FeatureFlagChecker dual-gates product flags against fee_config (SEC-GATE-03 /
// R6.2 lead_gen). When nil (unit tests), fee_config alone controls lead-gen.
// Production wires a Postgres-backed checker so fee_config.lead_gen_enabled
// cannot charge while feature_flags.lead_gen is off/missing.
type FeatureFlagChecker interface {
	// IsEnabled returns true only when the flag row exists and enabled=true.
	// Missing row / DB error must return false (fail closed for money).
	IsEnabled(ctx context.Context, key string) bool
}

// PaymentService implements payment business logic.
type PaymentService struct {
	repo            domain.PaymentRepository
	stripe          *StripeService
	subHook         SubscriptionWebhookHandler
	installmentHook InstallmentPaymentHandler
	marketplaceHook MarketplacePaymentHandler
	// recurringFailHook records FR-16.7 strikes (+ FR-18.8 pause at threshold)
	// after payment_intent.payment_failed for payments with recurring_instance_id.
	// Optional: when nil, status still flips to failed and a residual is logged.
	recurringFailHook RecurringPaymentFailureHandler
	webhookValidator  WebhookEventValidator
	underwriter       Underwriter
	trust             ProviderTrustSource
	// customers provisions and records the user's Stripe Customer + saved cards.
	// Optional so existing tests that construct PaymentService directly keep
	// compiling; every path that needs it degrades explicitly and fail-closed
	// when it is nil (see requireCustomers).
	customers *CustomerProvisioner
	// flags dual-gates regulated fee knobs (lead_gen). Optional in tests.
	flags FeatureFlagChecker
	// platformEIN is the IRS payer EIN stamped on generated 1099-NEC forms.
	// Injected from PLATFORM_EIN at construction (overridable via SetPlatformEIN
	// so tests stay t.Parallel and do not use t.Setenv). GenerateTaxForm fails
	// closed when this is empty, the dummy 88-1234567, or not US EIN shape.
	platformEIN string
}

// SetCustomerProvisioner wires Stripe Customer provisioning and payment-method
// persistence. Production wires one built over *repository.PostgresRepository.
func (s *PaymentService) SetCustomerProvisioner(p *CustomerProvisioner) {
	s.customers = p
}

// requireCustomers returns the provisioner or an error.
//
// Fail closed rather than fall back: the historical fallback here was to pass
// the platform user id to Stripe wherever a cus_ id was expected, which is what
// let every payment-method flow appear to work while attaching cards to nothing.
// An explicit error is strictly better than silently saving a card into a void.
func (s *PaymentService) requireCustomers() (*CustomerProvisioner, error) {
	if s.customers == nil {
		return nil, fmt.Errorf("stripe customer provisioner not configured")
	}
	return s.customers, nil
}

// NewPaymentService creates a new payment service.
func NewPaymentService(repo domain.PaymentRepository, stripe *StripeService) *PaymentService {
	return &PaymentService{
		repo:        repo,
		stripe:      stripe,
		platformEIN: strings.TrimSpace(os.Getenv("PLATFORM_EIN")),
	}
}

// SetPlatformEIN injects the IRS payer EIN used on generated 1099-NEC forms.
// Tests should call this instead of t.Setenv so they can stay t.Parallel.
func (s *PaymentService) SetPlatformEIN(ein string) {
	s.platformEIN = strings.TrimSpace(ein)
}

// SetSubscriptionWebhookHandler sets the subscription webhook handler for
// delegating subscription-related Stripe events.
func (s *PaymentService) SetSubscriptionWebhookHandler(h SubscriptionWebhookHandler) {
	s.subHook = h
}

// SetInstallmentPaymentHandler sets the handler for installment payment events.
func (s *PaymentService) SetInstallmentPaymentHandler(h InstallmentPaymentHandler) {
	s.installmentHook = h
}

// SetMarketplaceHandler wires the goods-marketplace webhook delegate.
func (s *PaymentService) SetMarketplaceHandler(h MarketplacePaymentHandler) {
	s.marketplaceHook = h
}

// SetRecurringPaymentFailureHandler wires FR-16.7 3-strike + FR-18.8 pause
// on charge failure. When nil, payment_intent.payment_failed still marks the
// payment failed but does not record strikes (honest residual until job mesh
// + DB are dialable).
func (s *PaymentService) SetRecurringPaymentFailureHandler(h RecurringPaymentFailureHandler) {
	s.recurringFailHook = h
}

// SetUnderwriter wires the deterministic underwriting engine. When set,
// ComputeCreditLimit underwrites through it; when nil, it fails closed.
func (s *PaymentService) SetUnderwriter(u Underwriter) {
	s.underwriter = u
}

// SetTrustSource wires the trust-engine client used to gather underwriting
// inputs.
func (s *PaymentService) SetTrustSource(t ProviderTrustSource) {
	s.trust = t
}

// SetFeatureFlagChecker wires product-flag dual-gating for regulated fees.
func (s *PaymentService) SetFeatureFlagChecker(c FeatureFlagChecker) {
	s.flags = c
}

// CalculateFees computes the fee breakdown for a given amount.
func (s *PaymentService) CalculateFees(ctx context.Context, amountCents int64, categoryID *string) (*domain.PaymentBreakdown, error) {
	if amountCents <= 0 {
		return nil, fmt.Errorf("calculate fees: %w", domain.ErrInvalidAmount)
	}

	var feeConfig *domain.FeeConfig
	var err error

	if categoryID != nil && *categoryID != "" {
		feeConfig, err = s.repo.GetFeeConfig(ctx, *categoryID)
		if err != nil {
			// Fall back to default if category-specific not found.
			feeConfig, err = s.repo.GetDefaultFeeConfig(ctx)
			if err != nil {
				return nil, fmt.Errorf("calculate fees: %w", err)
			}
		}
	} else {
		feeConfig, err = s.repo.GetDefaultFeeConfig(ctx)
		if err != nil {
			return nil, fmt.Errorf("calculate fees: %w", err)
		}
	}

	// Calculate platform fee: max(minFee, min(maxFee, amount * feePercentage)).
	//
	// MONEY: computed in integer basis points (see money.go). The stored rate is
	// a NUMERIC(5,4) column that pgx hands us as a float64; rateToBPS converts it
	// to exact basis points at this read boundary and every cent below is int64.
	// Fractional cents round UP so the platform never under-collects.
	platformBPS := rateToBPS(feeConfig.FeePercentage)
	platformFee := feeFromBPS(amountCents, platformBPS)
	if platformFee < feeConfig.MinFeeCents {
		platformFee = feeConfig.MinFeeCents
	}
	// A cap of 0 cents is meaningless and means "no cap" (see
	// domain.FeeConfig.MaxFeeCents). The repo normalizes 0 -> nil on load; clamp
	// here only on a positive cap so a stray 0 can never zero out the platform fee.
	if feeConfig.MaxFeeCents != nil && *feeConfig.MaxFeeCents > 0 && platformFee > *feeConfig.MaxFeeCents {
		platformFee = *feeConfig.MaxFeeCents
	}

	// Additive admin custom fees: sum of active rate_bps, converted to cents
	// and folded into platform_fee_cents. Combined platform + custom bps is
	// capped at 50% fail-closed (do not mint a payment with an unbounded take).
	customFees, err := s.repo.ListActiveCustomFees(ctx)
	if err != nil {
		return nil, fmt.Errorf("calculate fees: list custom fees: %w", err)
	}
	var customBPS int64
	for _, f := range customFees {
		if f == nil {
			continue
		}
		customBPS += f.RateBPS
	}
	if platformBPS+customBPS > domain.MaxCombinedPlatformCustomBPS {
		return nil, fmt.Errorf("calculate fees: %w", domain.ErrCombinedFeeCapExceeded)
	}
	platformFee += feeFromBPS(amountCents, customBPS)

	// Calculate guarantee fee.
	guaranteeFee := feeFromBPS(amountCents, rateToBPS(feeConfig.GuaranteePercentage))

	// Calculate lead-gen fee: an ADDITIONAL provider-side deduction, clamped the
	// same way as the platform fee. Disabled => zero, leaving payout unchanged.
	// Dual-gate (SEC-GATE-03 / R6.2): fee_config.lead_gen_enabled AND product
	// flag lead_gen must both be on. When a FeatureFlagChecker is wired and the
	// flag is off/missing, force zero fee so admin fee_config drift cannot
	// re-open the regulated rail. Unwired checker (unit tests) keeps fee_config.
	var leadGenFee int64
	var leadGenPercentage float64
	leadGenOn := feeConfig.LeadGenEnabled
	if leadGenOn && s.flags != nil && !s.flags.IsEnabled(ctx, "lead_gen") {
		slog.InfoContext(ctx, "lead_gen fee suppressed: feature flag off or missing",
			"amount_cents", amountCents,
		)
		leadGenOn = false
	}
	if leadGenOn {
		leadGenPercentage = feeConfig.LeadGenPercentage
		leadGenFee = feeFromBPS(amountCents, rateToBPS(feeConfig.LeadGenPercentage))
		if leadGenFee < feeConfig.LeadGenMinFeeCents {
			leadGenFee = feeConfig.LeadGenMinFeeCents
		}
		if feeConfig.LeadGenMaxFeeCents != nil && *feeConfig.LeadGenMaxFeeCents > 0 && leadGenFee > *feeConfig.LeadGenMaxFeeCents {
			leadGenFee = *feeConfig.LeadGenMaxFeeCents
		}
	}

	// Provider payout = amount - platformFee - guaranteeFee - leadGenFee.
	// The customer still pays exactly amountCents (TotalCents); the lead-gen fee
	// only reduces the provider's payout, exactly like the platform fee.
	providerPayout := amountCents - platformFee - guaranteeFee - leadGenFee

	return &domain.PaymentBreakdown{
		SubtotalCents:       amountCents,
		PlatformFeeCents:    platformFee,
		GuaranteeFeeCents:   guaranteeFee,
		TotalCents:          amountCents,
		ProviderPayoutCents: providerPayout,
		FeePercentage:       feeConfig.FeePercentage,
		GuaranteePercentage: feeConfig.GuaranteePercentage,
		LeadGenFeeCents:     leadGenFee,
		LeadGenPercentage:   leadGenPercentage,
	}, nil
}

// CreatePayment creates a new payment record and a Stripe PaymentIntent.
func (s *PaymentService) CreatePayment(ctx context.Context, input domain.CreatePaymentInput) (*domain.Payment, string, error) {
	if input.AmountCents <= 0 {
		return nil, "", fmt.Errorf("create payment: %w", domain.ErrInvalidAmount)
	}

	// Reconcile against the contract server-side. The client supplies amount and
	// provider_id, but neither may be trusted (§6: all price calculations are
	// server-side). Without this, a customer could charge any amount against a
	// contract — e.g. $10M on a $700 job, or a near-int64-max value that wraps
	// the fee math — and could direct the payout at an arbitrary provider.
	contract, err := s.repo.GetContractForPayment(ctx, input.ContractID)
	if err != nil {
		return nil, "", fmt.Errorf("create payment: %w", err)
	}
	// The payer must be the contract's customer.
	if input.CustomerID != contract.CustomerID {
		return nil, "", fmt.Errorf("create payment: %w", domain.ErrContractNotOwned)
	}
	// The amount may never exceed the contract total. Partial milestone and
	// installment payments are <= the total, so this bound permits them while
	// rejecting overcharge and overflow inputs.
	if input.AmountCents > contract.AmountCents {
		return nil, "", fmt.Errorf("create payment: amount exceeds contract: %w", domain.ErrInvalidAmount)
	}
	// MON-21: cumulative cap. Per-call amount <= contract still allows under-pay
	// stacks (e.g. $500 × 3 on a $700 job). Sum existing in-flight + funded
	// payments for this contract and reject when paidSoFar + amount would exceed
	// the contract total. Failed / fully refunded / chargeback do not count
	// (they free capacity); partially_refunded still counts its full amount.
	existing, err := s.repo.GetPaymentsForContract(ctx, input.ContractID)
	if err != nil {
		return nil, "", fmt.Errorf("create payment: load contract payments: %w", err)
	}
	var paidSoFar int64
	for _, p := range existing {
		if paymentCountsTowardContractCap(p.Status) {
			paidSoFar += p.AmountCents
		}
	}
	if paidSoFar+input.AmountCents > contract.AmountCents {
		// Soft-replay of the same idempotency / recurring key must still work:
		// the prior insert already counts toward paidSoFar, so a naive cap would
		// reject retries. Only block NEW over-cap creates.
		canSoftReplay := input.IdempotencyKey != "" ||
			(input.RecurringInstanceID != nil && *input.RecurringInstanceID != "")
		if canSoftReplay {
			replay, secret, replayErr := s.softReplayCreatePayment(ctx, input)
			if replayErr == nil {
				return replay, secret, nil
			}
			// No prior row → genuine new create over the cap. Surface other
			// soft-replay failures (ownership, missing PI) as-is.
			if !errors.Is(replayErr, domain.ErrPaymentNotFound) {
				return nil, "", replayErr
			}
		}
		return nil, "", fmt.Errorf(
			"create payment: cumulative payments %d + amount %d exceed contract %d: %w",
			paidSoFar, input.AmountCents, contract.AmountCents, domain.ErrInvalidAmount,
		)
	}
	// Derive the payee from the contract; never trust the client's provider_id.
	input.ProviderID = contract.ProviderID

	// Calculate fees.
	breakdown, err := s.CalculateFees(ctx, input.AmountCents, input.CategoryID)
	if err != nil {
		return nil, "", err
	}

	// Get provider Stripe account for destination charge.
	providerAccountID, err := s.repo.GetStripeAccountID(ctx, input.ProviderID)
	if err != nil {
		return nil, "", fmt.Errorf("create payment: %w", err)
	}

	paymentID := uuid.New().String()
	idempotencyKey := input.IdempotencyKey
	if idempotencyKey == "" {
		idempotencyKey = uuid.New().String()
	}

	payment := &domain.Payment{
		ID:                  paymentID,
		ContractID:          input.ContractID,
		MilestoneID:         input.MilestoneID,
		RecurringInstanceID: input.RecurringInstanceID,
		CustomerID:          input.CustomerID,
		ProviderID:          input.ProviderID,
		AmountCents:         input.AmountCents,
		// Ledger invariant: the persisted split MUST sum to amount_cents so the
		// payments table self-reconciles (no cents created/destroyed). The
		// payments row has no lead_gen_fee_cents column, so the lead-gen slice —
		// which is platform-retained on the Stripe side (folded into totalFee
		// below) — is folded into the stored platform fee here. The real money
		// movement is unchanged (platform keeps platform+guarantee+leadgen either
		// way); this only ensures platform_fee+guarantee_fee+provider_payout ==
		// amount_cents on the persisted record. When lead-gen is disabled
		// LeadGenFeeCents is 0, so this is a no-op.
		PlatformFeeCents:    breakdown.PlatformFeeCents + breakdown.LeadGenFeeCents,
		GuaranteeFeeCents:   breakdown.GuaranteeFeeCents,
		ProviderPayoutCents: breakdown.ProviderPayoutCents,
		IdempotencyKey:      idempotencyKey,
		Status:              "pending",
		InstallmentNumber:   input.InstallmentNumber,
		TotalInstallments:   input.TotalInstallments,
	}

	// Create payment record in DB.
	if err := s.repo.CreatePayment(ctx, payment); err != nil {
		// Dual-PI / retry defense: UNIQUE on idempotency_key or
		// recurring_instance_id means a prior insert already owns this visit
		// (or sticky key). Soft-replay the existing row + real client_secret
		// instead of minting a second PaymentIntent. Fail closed if the
		// existing row has no PI or the secret cannot be re-read.
		if errors.Is(err, domain.ErrIdempotencyConflict) ||
			errors.Is(err, domain.ErrRecurringInstancePaymentExists) {
			return s.softReplayCreatePayment(ctx, input)
		}
		return nil, "", err
	}

	// Create Stripe PaymentIntent. The Stripe application_fee_amount is the
	// amount the platform retains from the destination charge; the remainder is
	// transferred to the provider. The lead-gen fee is an additional platform-
	// retained amount, so it is added here alongside the platform + guarantee
	// fees. This keeps the lead-gen fee with the platform and reduces the
	// provider transfer by the same amount (mirrors breakdown.ProviderPayoutCents).
	totalFee := breakdown.PlatformFeeCents + breakdown.GuaranteeFeeCents + breakdown.LeadGenFeeCents

	// FR-18 visit: best-effort bind the customer's Stripe Customer so one
	// off-session confirm is possible. Lookup never provisions; missing customer
	// → ordinary on-session PI (client_secret residual).
	customerStripeID := ""
	if input.RecurringInstanceID != nil && *input.RecurringInstanceID != "" && s.customers != nil {
		if cus, lookupErr := s.customers.Lookup(ctx, input.CustomerID); lookupErr == nil {
			customerStripeID = cus
		}
	}

	piID, clientSecret, err := s.stripe.CreatePaymentIntent(ctx, input.AmountCents, "usd", providerAccountID, totalFee, idempotencyKey, customerStripeID)
	if err != nil {
		// The payments row was inserted above, before this call. Leaving it in
		// 'pending' with a NULL payment intent is not inert: ProcessPayment
		// skips capture when the PI is empty and CASes straight to 'escrow',
		// and CreateTransfer then omits SourceTransaction and pays the
		// provider out of the PLATFORM balance. Mark it failed so a payment
		// nobody charged can never be walked forward.
		if markErr := s.repo.UpdatePaymentStatus(ctx, paymentID, "failed"); markErr != nil {
			slog.Error("failed to mark payment failed after stripe error; row may be left in pending with no payment intent",
				"payment_id", paymentID,
				"stripe_error", err,
				"mark_error", markErr,
			)
		}
		return nil, "", fmt.Errorf("create payment stripe: %w", err)
	}

	// Update stripe fields in the payment record.
	if err := s.repo.UpdateStripeFields(ctx, paymentID, piID, "", ""); err != nil {
		return nil, "", fmt.Errorf("create payment update stripe: %w", err)
	}

	// Re-fetch the payment to get the latest state.
	payment, err = s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, "", err
	}
	// Defensive: ensure PI id is present for the off-session attempt even if a
	// test repo re-fetch does not echo UpdateStripeFields.
	if payment.StripePaymentIntentID == "" {
		payment.StripePaymentIntentID = piID
	}

	// FR-18 residual: ONE safe off-session attempt for recurring visits when
	// a default payment method exists. Never invent money: success only after
	// confirm (+ capture for manual-capture PIs) and status → escrow. On any
	// skip/fail leave the on-session PI + client_secret for PaymentSheet.
	// FR-16.7 scheduled retries pass attempt-N via IdempotencyKey suffix
	// (recurring-instance-pay:{instance}:attempt-N) so Stripe does not replay
	// a cached decline from attempt-1.
	if input.RecurringInstanceID != nil && *input.RecurringInstanceID != "" {
		attempt := offSessionAttemptFromIdempotencyKey(input.IdempotencyKey)
		if funded := s.tryRecurringVisitOffSession(ctx, payment, input.CustomerID, attempt); funded {
			if updated, gerr := s.repo.GetPayment(ctx, payment.ID); gerr == nil && updated != nil {
				payment = updated
				if payment.StripePaymentIntentID == "" {
					payment.StripePaymentIntentID = piID
				}
			} else {
				payment.Status = "escrow"
			}
			slog.InfoContext(ctx, "FR-18: recurring visit charged off-session; client_secret omitted",
				"payment_id", payment.ID,
				"recurring_instance_id", *input.RecurringInstanceID,
				"pi_id", piID,
				"off_session_attempt", attempt,
			)
			return payment, "", nil
		}
	}

	return payment, clientSecret, nil
}

// paymentCountsTowardContractCap reports whether a payment status commits
// (or still holds) funds against the contract total for MON-21 cumulative cap.
// Counts: pending, processing, escrow, released, completed, partially_refunded.
// Does not count: failed, refunded (full), chargeback, disputed, unknown.
func paymentCountsTowardContractCap(status string) bool {
	switch status {
	case "pending", "processing", "escrow", "released", "completed", "partially_refunded":
		return true
	default:
		return false
	}
}

// offSessionAttemptFromIdempotencyKey parses trailing ":attempt-N" from a
// sticky CreatePayment key (FR-16.7). Missing / invalid → attempt 1 (day-0).
func offSessionAttemptFromIdempotencyKey(key string) int {
	const marker = ":attempt-"
	i := strings.LastIndex(key, marker)
	if i < 0 {
		return 1
	}
	n, err := strconv.Atoi(key[i+len(marker):])
	if err != nil || n < 1 {
		return 1
	}
	return n
}

// tryRecurringVisitOffSession performs a single merchant-initiated charge
// against the customer's default saved card for a visit PaymentIntent.
//
// Fail-soft contract (never invent money):
//   - Returns true ONLY when Stripe confirmed funds and local status reached escrow.
//   - Returns false on missing instrument, SCA, decline, capture failure, or
//     provisioner unwired — caller keeps the on-session client_secret residual.
//   - Does not mark the payment failed (visit stays payable on-session).
//   - Attempt-scoped Stripe idempotency (attempt-N). FR-16.7 scheduled retries
//     pass N>1 so a prior decline is not cached forever under attempt-1.
func (s *PaymentService) tryRecurringVisitOffSession(ctx context.Context, payment *domain.Payment, customerID string, attempt int) bool {
	if payment == nil || payment.StripePaymentIntentID == "" || customerID == "" {
		return false
	}
	if attempt < 1 {
		attempt = 1
	}
	if s.customers == nil {
		slog.InfoContext(ctx, "FR-18: off-session skip — customer provisioner unwired",
			"payment_id", payment.ID,
		)
		return false
	}

	stripeCustomerID, err := s.customers.Lookup(ctx, customerID)
	if err != nil || stripeCustomerID == "" {
		slog.InfoContext(ctx, "FR-18: off-session skip — no stripe customer on file",
			"payment_id", payment.ID,
			"customer_id", customerID,
			"error", err,
		)
		return false
	}

	paymentMethodID, err := s.customers.DefaultPaymentMethod(ctx, customerID)
	if err != nil || paymentMethodID == "" {
		slog.InfoContext(ctx, "FR-18: off-session skip — no default payment method",
			"payment_id", payment.ID,
			"customer_id", customerID,
			"error", err,
		)
		return false
	}

	// Attempt-scoped key: FR-16.7 scheduled retry uses attempt-N so Stripe does
	// not replay a cached decline from attempt-1.
	idemKey := fmt.Sprintf("recurring-visit-offsession:%s:attempt-%d", payment.ID, attempt)
	status, confirmErr := s.stripe.ConfirmOffSessionPaymentIntent(ctx, payment.StripePaymentIntentID, paymentMethodID, idemKey)
	if confirmErr != nil {
		outcome, _ := classifyChargeError(confirmErr)
		slog.WarnContext(ctx, "FR-18: off-session confirm failed; on-session PI residual kept",
			"payment_id", payment.ID,
			"pi_id", payment.StripePaymentIntentID,
			"outcome", string(outcome),
			"error", confirmErr,
		)
		return false
	}

	// Services PI uses manual capture → requires_capture after confirm.
	// DevStore / auto-capture paths may report succeeded. Anything else is residual.
	switch status {
	case "requires_capture", "succeeded":
		// proceed
	default:
		outcome := classifyChargeStatus(status)
		slog.WarnContext(ctx, "FR-18: off-session confirm non-success status; on-session residual",
			"payment_id", payment.ID,
			"pi_id", payment.StripePaymentIntentID,
			"status", status,
			"outcome", string(outcome),
		)
		return false
	}

	// Capture authorized funds onto the platform balance (manual capture).
	// When Stripe already auto-captured (status=succeeded), Capture is still
	// invoked with a deterministic key — real Stripe is idempotent / no-ops a
	// second capture via error we treat as residual only if we cannot proceed.
	if status == "requires_capture" {
		captureKey := "capture:" + payment.ID
		if capErr := s.stripe.CapturePaymentIntent(ctx, payment.StripePaymentIntentID, captureKey); capErr != nil {
			// Confirmed hold may exist but we never mark escrow without capture
			// success (would release unfunded escrow later). Leave pending for
			// on-session ProcessPayment / ops.
			slog.ErrorContext(ctx, "FR-18: off-session confirmed but capture failed; on-session residual",
				"payment_id", payment.ID,
				"pi_id", payment.StripePaymentIntentID,
				"error", capErr,
			)
			return false
		}
	} else if status == "succeeded" {
		// DevStore and any auto-captured path: still record capture under the
		// same ProcessPayment key so retries collapse cleanly.
		captureKey := "capture:" + payment.ID
		if capErr := s.stripe.CapturePaymentIntent(ctx, payment.StripePaymentIntentID, captureKey); capErr != nil {
			// Funds already captured at Stripe; proceed to escrow — capture
			// idempotency error on an already-captured PI is not a money miss.
			slog.InfoContext(ctx, "FR-18: capture after succeeded confirm returned error (treating as already captured)",
				"payment_id", payment.ID,
				"error", capErr,
			)
		}
	}

	// CAS pending → processing → escrow (same shape as ProcessPayment).
	if err := s.repo.ClaimPaymentStatus(ctx, payment.ID, "pending", "processing"); err != nil {
		// Concurrent ProcessPayment may have won — re-read and accept funded states.
		if current, gerr := s.repo.GetPayment(ctx, payment.ID); gerr == nil && current != nil {
			switch current.Status {
			case "processing", "escrow", "released", "completed":
				slog.InfoContext(ctx, "FR-18: off-session funds moved; status already advanced by concurrent path",
					"payment_id", payment.ID,
					"status", current.Status,
				)
				// Money path is active or done — omit client_secret so the client
				// does not open PaymentSheet against an already-claimed PI.
				payment.Status = current.Status
				return true
			}
		}
		slog.WarnContext(ctx, "FR-18: off-session claim processing failed after capture; on-session residual",
			"payment_id", payment.ID,
			"error", err,
		)
		return false
	}
	if err := s.repo.ClaimPaymentStatus(ctx, payment.ID, "processing", "escrow"); err != nil {
		// Capture already succeeded — best-effort status write (ProcessPayment pattern).
		if markErr := s.repo.UpdatePaymentStatus(ctx, payment.ID, "escrow"); markErr != nil {
			slog.ErrorContext(ctx, "FR-18: off-session captured but failed to mark escrow; reconciling",
				"payment_id", payment.ID,
				"claim_error", err,
				"mark_error", markErr,
			)
			// Money moved; report funded so caller omits client_secret (soft-replay
			// of a later CreatePayment will re-read status).
			payment.Status = "escrow"
			return true
		}
	}
	payment.Status = "escrow"
	return true
}

// softReplayCreatePayment returns an existing payment + real client_secret when
// INSERT hit a unique constraint (idempotency_key or recurring_instance_id).
//
// Security: never invent secrets. If the row has no Stripe PaymentIntent, or
// Stripe/dev-store cannot re-read a client_secret for a still-confirmable
// status, fail closed. Already-captured statuses return the payment with an
// empty secret (caller does not need PaymentSheet).
func (s *PaymentService) softReplayCreatePayment(ctx context.Context, input domain.CreatePaymentInput) (*domain.Payment, string, error) {
	existing, err := s.loadPaymentForSoftReplay(ctx, input)
	if err != nil {
		return nil, "", fmt.Errorf("create payment soft-replay: %w", err)
	}

	// Ownership: only the original customer may soft-replay (same gate as create).
	if existing.CustomerID != input.CustomerID {
		return nil, "", fmt.Errorf("create payment soft-replay: %w", domain.ErrContractNotOwned)
	}
	// Contract must still match — refuse cross-contract replay if a row were
	// somehow mis-linked (defense in depth; unique is per instance, not contract).
	if existing.ContractID != input.ContractID {
		return nil, "", fmt.Errorf("create payment soft-replay: contract mismatch: %w", domain.ErrInvalidStatus)
	}

	switch existing.Status {
	case "pending", "processing":
		// Confirmable path: need a real PI + re-readable client_secret.
		if existing.StripePaymentIntentID == "" {
			slog.WarnContext(ctx, "create payment soft-replay: existing payment has no PI (fail closed)",
				"payment_id", existing.ID,
				"status", existing.Status,
			)
			return nil, "", fmt.Errorf("create payment soft-replay: %w", domain.ErrPaymentIntentMissing)
		}
		// FR-16.7: scheduled retry with attempt-N re-enters off-session on a
		// still-pending visit PI (new Stripe confirm key; never invent money).
		attempt := offSessionAttemptFromIdempotencyKey(input.IdempotencyKey)
		if attempt > 1 && existing.Status == "pending" &&
			input.RecurringInstanceID != nil && *input.RecurringInstanceID != "" {
			if funded := s.tryRecurringVisitOffSession(ctx, existing, input.CustomerID, attempt); funded {
				if updated, gerr := s.repo.GetPayment(ctx, existing.ID); gerr == nil && updated != nil {
					existing = updated
				} else {
					existing.Status = "escrow"
				}
				slog.InfoContext(ctx, "FR-16.7: soft-replay re-off-session funded visit",
					"payment_id", existing.ID,
					"off_session_attempt", attempt,
				)
				return existing, "", nil
			}
		}
		secret, secErr := s.stripe.GetPaymentIntentClientSecret(ctx, existing.StripePaymentIntentID)
		if secErr != nil || secret == "" {
			slog.WarnContext(ctx, "create payment soft-replay: could not re-read client_secret (fail closed)",
				"payment_id", existing.ID,
				"pi_id", existing.StripePaymentIntentID,
				"error", secErr,
			)
			// Fail closed — never invent a secret or hand back an empty one as success.
			return nil, "", fmt.Errorf("create payment soft-replay: client_secret unavailable: %w", domain.ErrPaymentIntentMissing)
		}
		slog.InfoContext(ctx, "create payment soft-replay: reusing existing payment intent",
			"payment_id", existing.ID,
			"status", existing.Status,
			"pi_id", existing.StripePaymentIntentID,
		)
		return existing, secret, nil

	case "escrow", "released", "completed":
		// Already held/paid — return the payment without a confirmable secret.
		// Callers (PaymentSheet) must not treat empty secret as a new PI.
		slog.InfoContext(ctx, "create payment soft-replay: payment already past confirm",
			"payment_id", existing.ID,
			"status", existing.Status,
		)
		return existing, "", nil

	case "failed":
		// FR-16.7: one payment row per recurring_instance (migration 111). A
		// prior Stripe setup failure left status=failed; remint a new PI on
		// the same row using the attempt-scoped IdempotencyKey. Never invent
		// money — only succeeds after a real Stripe PI is created.
		if input.RecurringInstanceID != nil && *input.RecurringInstanceID != "" {
			return s.remintFailedRecurringVisitPayment(ctx, existing, input)
		}
		return nil, "", fmt.Errorf("create payment soft-replay: status %q not reusable: %w", existing.Status, domain.ErrInvalidStatus)

	default:
		// refunded / disputed / etc. — not soft-replayable into a new charge.
		return nil, "", fmt.Errorf("create payment soft-replay: status %q not reusable: %w", existing.Status, domain.ErrInvalidStatus)
	}
}

// remintFailedRecurringVisitPayment replaces a failed visit payment's Stripe PI
// (same payments.id / recurring_instance_id) and optionally re-attempts off-session.
// Fail-soft: on Stripe error the row stays failed (or is re-marked failed).
func (s *PaymentService) remintFailedRecurringVisitPayment(
	ctx context.Context,
	existing *domain.Payment,
	input domain.CreatePaymentInput,
) (*domain.Payment, string, error) {
	if existing == nil {
		return nil, "", fmt.Errorf("remint failed recurring visit: %w", domain.ErrPaymentNotFound)
	}
	// Amount must still be valid vs contract (defense in depth).
	if input.AmountCents <= 0 {
		input.AmountCents = existing.AmountCents
	}
	if input.AmountCents <= 0 {
		return nil, "", fmt.Errorf("remint failed recurring visit: %w", domain.ErrInvalidAmount)
	}

	providerAccountID, err := s.repo.GetStripeAccountID(ctx, existing.ProviderID)
	if err != nil {
		return nil, "", fmt.Errorf("remint failed recurring visit: %w", err)
	}
	breakdown, err := s.CalculateFees(ctx, input.AmountCents, input.CategoryID)
	if err != nil {
		return nil, "", fmt.Errorf("remint failed recurring visit: %w", err)
	}
	totalFee := breakdown.PlatformFeeCents + breakdown.GuaranteeFeeCents + breakdown.LeadGenFeeCents

	idempotencyKey := input.IdempotencyKey
	if idempotencyKey == "" {
		idempotencyKey = fmt.Sprintf("recurring-instance-pay:%s:remint-%s", derefStr(input.RecurringInstanceID), uuid.New().String())
	}

	customerStripeID := ""
	if s.customers != nil {
		if cus, lookupErr := s.customers.Lookup(ctx, input.CustomerID); lookupErr == nil {
			customerStripeID = cus
		}
	}

	piID, clientSecret, err := s.stripe.CreatePaymentIntent(ctx, input.AmountCents, "usd", providerAccountID, totalFee, idempotencyKey, customerStripeID)
	if err != nil {
		slog.WarnContext(ctx, "FR-16.7: remint CreatePaymentIntent failed; payment stays failed",
			"payment_id", existing.ID,
			"error", err,
		)
		return nil, "", fmt.Errorf("remint failed recurring visit stripe: %w", err)
	}

	// Reactivate row: pending + new PI. Claim only from failed so concurrent remints
	// do not clobber a concurrent capture path.
	if claimErr := s.repo.ClaimPaymentStatus(ctx, existing.ID, "failed", "pending"); claimErr != nil {
		// Concurrent success may have moved status — soft-reload.
		if current, gerr := s.repo.GetPayment(ctx, existing.ID); gerr == nil && current != nil {
			switch current.Status {
			case "escrow", "released", "completed", "processing", "pending":
				slog.InfoContext(ctx, "FR-16.7: remint claim lost; returning current payment",
					"payment_id", existing.ID,
					"status", current.Status,
				)
				if current.Status == "pending" || current.Status == "processing" {
					if current.StripePaymentIntentID != "" {
						if secret, secErr := s.stripe.GetPaymentIntentClientSecret(ctx, current.StripePaymentIntentID); secErr == nil {
							return current, secret, nil
						}
					}
				}
				return current, "", nil
			}
		}
		return nil, "", fmt.Errorf("remint failed recurring visit claim: %w", claimErr)
	}
	if err := s.repo.UpdateStripeFields(ctx, existing.ID, piID, "", ""); err != nil {
		_ = s.repo.UpdatePaymentStatus(ctx, existing.ID, "failed")
		return nil, "", fmt.Errorf("remint failed recurring visit update stripe: %w", err)
	}

	payment, err := s.repo.GetPayment(ctx, existing.ID)
	if err != nil {
		return nil, "", err
	}
	if payment.StripePaymentIntentID == "" {
		payment.StripePaymentIntentID = piID
	}

	attempt := offSessionAttemptFromIdempotencyKey(idempotencyKey)
	if funded := s.tryRecurringVisitOffSession(ctx, payment, input.CustomerID, attempt); funded {
		if updated, gerr := s.repo.GetPayment(ctx, payment.ID); gerr == nil && updated != nil {
			payment = updated
		} else {
			payment.Status = "escrow"
		}
		slog.InfoContext(ctx, "FR-16.7: reminted visit charged off-session",
			"payment_id", payment.ID,
			"pi_id", piID,
			"off_session_attempt", attempt,
		)
		return payment, "", nil
	}

	slog.InfoContext(ctx, "FR-16.7: reminted visit PI; on-session residual",
		"payment_id", payment.ID,
		"pi_id", piID,
		"off_session_attempt", attempt,
	)
	return payment, clientSecret, nil
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// loadPaymentForSoftReplay prefers recurring_instance_id (dual-key race between
// gateway approve and customer POST /payments) then falls back to idempotency_key.
func (s *PaymentService) loadPaymentForSoftReplay(ctx context.Context, input domain.CreatePaymentInput) (*domain.Payment, error) {
	if input.RecurringInstanceID != nil && *input.RecurringInstanceID != "" {
		p, err := s.repo.GetPaymentByRecurringInstanceID(ctx, *input.RecurringInstanceID)
		if err == nil {
			return p, nil
		}
		if !errors.Is(err, domain.ErrPaymentNotFound) {
			return nil, err
		}
	}
	if input.IdempotencyKey != "" {
		p, err := s.repo.GetPaymentByIdempotencyKey(ctx, input.IdempotencyKey)
		if err == nil {
			return p, nil
		}
		if !errors.Is(err, domain.ErrPaymentNotFound) {
			return nil, err
		}
	}
	return nil, domain.ErrPaymentNotFound
}

// ProcessPayment confirms/captures a PaymentIntent and updates status.
//
// Concurrency (MON-14): CAS pending→processing so only one caller captures;
// Stripe capture carries a deterministic idempotency key so a retry after a
// crash cannot double-capture.
func (s *PaymentService) ProcessPayment(ctx context.Context, paymentID string, paymentMethodID string) (*domain.Payment, error) {
	payment, err := s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, err
	}

	if payment.Status != "pending" {
		return nil, fmt.Errorf("process payment: %w", domain.ErrPaymentAlreadyProcessed)
	}

	// CAS claim: pending → processing. A concurrent ProcessPayment loses here.
	if err := s.repo.ClaimPaymentStatus(ctx, paymentID, "pending", "processing"); err != nil {
		return nil, fmt.Errorf("process payment: %w", domain.ErrPaymentAlreadyProcessed)
	}

	// Capture the payment intent with a deterministic key.
	//
	// An empty PI means no money was ever authorized — CreatePayment failed at
	// the Stripe call and left this row behind. Refuse rather than skipping
	// the capture: falling through would CAS the row to 'escrow' and make an
	// uncharged payment releasable, paying the provider from platform funds.
	// Dev mode is the one legitimate no-PI case.
	if payment.StripePaymentIntentID == "" {
		if !s.stripe.IsDevMode() {
			slog.Error("refusing to process payment with no stripe payment intent",
				"payment_id", paymentID,
			)
			_ = s.repo.ClaimPaymentStatus(ctx, paymentID, "processing", "failed")
			return nil, fmt.Errorf("process payment: %w", domain.ErrInvalidStatus)
		}
	} else {
		captureKey := "capture:" + paymentID
		if err := s.stripe.CapturePaymentIntent(ctx, payment.StripePaymentIntentID, captureKey); err != nil {
			// Mark as failed if capture fails (CAS processing→failed).
			_ = s.repo.ClaimPaymentStatus(ctx, paymentID, "processing", "failed")
			return nil, fmt.Errorf("process payment capture: %w", err)
		}
	}

	// CAS processing → escrow on success.
	if err := s.repo.ClaimPaymentStatus(ctx, paymentID, "processing", "escrow"); err != nil {
		// Capture already succeeded; try best-effort status write.
		_ = s.repo.UpdatePaymentStatus(ctx, paymentID, "escrow")
		return nil, fmt.Errorf("process payment escrow claim: %w", err)
	}

	return s.repo.GetPayment(ctx, paymentID)
}

// advanceRepaymentRateBps is the share of provider payout withheld for advance
// repayment, in integer basis points (2000 bps = 20%). MONEY: kept in bps, not
// as a float rate, so the withholding is computed entirely in int64 cents.
const advanceRepaymentRateBps int64 = 2000

// ReleaseEscrow creates a Stripe transfer to the provider and updates status.
// If the provider has active advances, a portion of the payout is withheld for repayment.
//
// Concurrency (MON-03): CAS-claim status escrow→released BEFORE the transfer so
// only one concurrent release wins. Transfer uses deterministic key
// "escrow-release:<paymentID>" so a crash/retry never double-pays at Stripe.
// On transfer failure the claim is reverted to escrow.
// ReleaseActor identifies who is asking for an escrow action. The gateway's
// RequirePartyAccess admits EITHER party to a payment, so it cannot tell a
// customer approving completion apart from a provider paying themselves. That
// distinction is made here, where the payment row is already loaded.
//
// System is set only by trusted in-process callers (the auto-release cron)
// that act with no human actor.
type ReleaseActor struct {
	UserID  string
	IsAdmin bool
	System  bool
}

// authorizeRelease reports whether actor may release this payment's escrow.
//
// Releasing escrow moves money to the provider. The provider is therefore the
// one party who must NOT be able to trigger it: a self-release pays them for
// work the customer never confirmed, and there is no compensating check
// downstream (ReleaseEscrow's only other gate is status=='escrow', and
// contract approval never calls this at all).
func authorizeRelease(payment *domain.Payment, actor ReleaseActor) error {
	if actor.System || actor.IsAdmin {
		return nil
	}
	if actor.UserID == "" {
		// A caller-initiated release with no actor cannot be authorized. Fail
		// closed rather than assuming a trusted caller.
		return fmt.Errorf("release escrow: %w", domain.ErrNotAuthorizedActor)
	}
	if actor.UserID == payment.CustomerID {
		return nil
	}
	return fmt.Errorf("release escrow: %w", domain.ErrNotAuthorizedActor)
}

func (s *PaymentService) ReleaseEscrow(ctx context.Context, paymentID string, reason string, actor ReleaseActor) (*domain.Payment, error) {
	payment, err := s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, err
	}

	if err := authorizeRelease(payment, actor); err != nil {
		slog.Warn("escrow release refused",
			"payment_id", paymentID,
			"actor_user_id", actor.UserID,
			"provider_id", payment.ProviderID,
			"customer_id", payment.CustomerID,
		)
		return nil, err
	}

	// Idempotent re-entry: already released with a transfer recorded.
	if payment.Status == "released" && payment.StripeTransferID != "" {
		return payment, nil
	}

	// Resume incomplete release (claimed released but transfer never stamped).
	resume := payment.Status == "released" && payment.StripeTransferID == ""
	if !resume {
		if payment.Status != "escrow" {
			return nil, fmt.Errorf("release escrow: %w", domain.ErrInvalidStatus)
		}
		// CAS claim: escrow → released. Loser of a concurrent race fails here.
		if err := s.repo.ClaimPaymentStatus(ctx, paymentID, "escrow", "released"); err != nil {
			// Another release may have won — if so, return the released payment.
			if cur, gerr := s.repo.GetPayment(ctx, paymentID); gerr == nil && cur.Status == "released" {
				return cur, nil
			}
			return nil, fmt.Errorf("release escrow: %w", domain.ErrInvalidStatus)
		}
	}

	// Get provider Stripe account.
	providerAccountID, err := s.repo.GetStripeAccountID(ctx, payment.ProviderID)
	if err != nil {
		_ = s.repo.ClaimPaymentStatus(ctx, paymentID, "released", "escrow")
		return nil, fmt.Errorf("release escrow: %w", err)
	}

	// Check for active advances to calculate repayment deductions.
	activeAdvances, err := s.repo.GetActiveAdvancesForProvider(ctx, payment.ProviderID)
	if err != nil {
		slog.Error("release escrow: failed to get active advances, proceeding without repayment",
			"payment_id", paymentID,
			"provider_id", payment.ProviderID,
			"error", err,
		)
		activeAdvances = nil
	}

	// Calculate total repayment: 20% of provider payout, capped at total remaining balance.
	//
	// MONEY (MON-03 follow-up): totalRepayment is accumulated from what the
	// repository ACTUALLY applied — the difference between the advance's
	// repaid_cents before and after the call — not from the deduction this loop
	// asked for. The two diverge on the resume path above: when a prior release
	// already deducted from this advance for this payment, UpdateAdvanceRepayment
	// is a no-op (its INSERT hits the unique index from migration 076) and
	// returns the advance unchanged, so appliedDelta is 0. Trusting `deduction`
	// there would double-count a withholding that only happened once, understate
	// the transfer, and misreport the release in the logs and metrics. The
	// database is the authority on what was credited; this loop just reads it
	// back.
	var totalRepayment int64
	if len(activeAdvances) > 0 {
		repaymentPool := feeFromBPS(payment.ProviderPayoutCents, advanceRepaymentRateBps)

		// Deduct from oldest advances first.
		for _, advance := range activeAdvances {
			if repaymentPool <= 0 {
				break
			}

			remaining := (advance.AdvanceAmountCents + advance.FeeCents) - advance.RepaidCents
			if remaining <= 0 {
				continue
			}

			deduction := repaymentPool
			if deduction > remaining {
				deduction = remaining
			}

			updated, err := s.repo.UpdateAdvanceRepayment(ctx, advance.ID, paymentID, deduction)
			if err != nil {
				slog.Error("release escrow: failed to record advance repayment",
					"payment_id", paymentID,
					"advance_id", advance.ID,
					"deduction_cents", deduction,
					"error", err,
				)
				// Continue processing — don't fail the escrow release for a repayment error.
				continue
			}

			appliedDelta := updated.RepaidCents - advance.RepaidCents
			if appliedDelta <= 0 {
				// Already recorded by an earlier release of this same payment
				// (the crash-then-retry path). Nothing was withheld this time,
				// so nothing may be subtracted from the transfer.
				slog.Info("advance repayment already recorded for this payment, skipping",
					"payment_id", paymentID,
					"advance_id", advance.ID,
					"requested_deduction_cents", deduction,
					"advance_repaid_cents", updated.RepaidCents,
				)
				continue
			}

			slog.Info("advance repayment deducted",
				"payment_id", paymentID,
				"advance_id", advance.ID,
				"deduction_cents", appliedDelta,
				"advance_remaining_after",
				(updated.AdvanceAmountCents+updated.FeeCents)-updated.RepaidCents,
			)

			totalRepayment += appliedDelta
			repaymentPool -= appliedDelta
		}
	}

	// Transfer reduced amount to provider.
	transferAmount := payment.ProviderPayoutCents - totalRepayment
	if transferAmount < 0 {
		transferAmount = 0
	}

	// Deterministic Stripe idempotency key — concurrent/retried releases
	// return the SAME transfer rather than double-paying.
	transferKey := "escrow-release:" + paymentID
	transferID, err := s.stripe.CreateTransfer(ctx, transferAmount, "usd", providerAccountID, payment.StripePaymentIntentID, transferKey)
	if err != nil {
		// Revert claim so a later retry can re-attempt.
		_ = s.repo.ClaimPaymentStatus(ctx, paymentID, "released", "escrow")
		return nil, fmt.Errorf("release escrow transfer: %w", err)
	}

	if totalRepayment > 0 {
		slog.Info("escrow released with advance repayment",
			"payment_id", paymentID,
			"provider_id", payment.ProviderID,
			"original_payout_cents", payment.ProviderPayoutCents,
			"repayment_cents", totalRepayment,
			"transfer_cents", transferAmount,
		)
	}

	// Stamp transfer ID (status already released via CAS claim).
	if err := s.repo.UpdateStripeFields(ctx, paymentID, "", "", transferID); err != nil {
		return nil, err
	}

	return s.repo.GetPayment(ctx, paymentID)
}

// CreateRefund issues a Stripe refund and updates the payment record.
//
// Concurrency (MON-13): remaining balance is re-checked against the CAS'd
// prior refund total so concurrent refunds cannot over-refund. Stripe key
// includes payment id + target cumulative amount so retries are safe.
func (s *PaymentService) CreateRefund(ctx context.Context, paymentID string, amountCents int64, reason string, actor ReleaseActor) (*domain.Payment, error) {
	payment, err := s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, err
	}

	if payment.Status != "escrow" && payment.Status != "released" && payment.Status != "completed" &&
		payment.Status != "partially_refunded" {
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidStatus)
	}

	// Actor authority. Payouts are separate charge + transfer: once a payment
	// is released or completed, the provider already holds their transfer, so
	// a refund at that point pulls from the PLATFORM balance and the platform
	// eats the difference. That is a dispute-resolution decision, not
	// something either party may trigger unilaterally.
	//
	// While the payment is still in escrow no transfer has happened, so a
	// party-initiated refund is just returning held funds — allowed.
	if !actor.System && !actor.IsAdmin {
		switch payment.Status {
		case "released", "completed", "partially_refunded":
			slog.Warn("post-payout refund refused for non-admin actor",
				"payment_id", paymentID,
				"actor_user_id", actor.UserID,
				"status", payment.Status,
			)
			return nil, fmt.Errorf("create refund: %w", domain.ErrNotAuthorizedActor)
		}
		if actor.UserID == "" {
			return nil, fmt.Errorf("create refund: %w", domain.ErrNotAuthorizedActor)
		}
	}

	// Server-side amount authority: the refund amount is supplied by the caller
	// (gateway forwards a client-controlled amount_cents, and the refund route is
	// reachable by the payment's customer/provider, not just admins). It MUST be
	// bounded here or a party could trigger an arbitrary Stripe refund exceeding
	// what was ever escrowed. A negative amount is also rejected outright.
	if amountCents < 0 {
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidAmount)
	}

	// Determine refund amount: 0 means full refund of the remaining (un-refunded)
	// balance, never more than the held amount.
	alreadyRefunded := payment.RefundAmountCents
	remaining := payment.AmountCents - alreadyRefunded
	if remaining <= 0 {
		// Nothing left to refund — the payment is already fully refunded.
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidAmount)
	}

	refundAmount := amountCents
	if refundAmount == 0 {
		refundAmount = remaining
	}

	// Cap at the remaining balance: this single refund plus all prior refunds can
	// never exceed payment.AmountCents. This is the escrow invariant that keeps a
	// payment from refunding more than was captured.
	if refundAmount > remaining {
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidAmount)
	}

	// The cumulative refunded total persisted on the payment.
	totalRefunded := alreadyRefunded + refundAmount

	// Deterministic Stripe key: payment + target cumulative so concurrent
	// attempts at the same cumulative total dedupe; distinct amounts get
	// distinct keys.
	refundKey := fmt.Sprintf("refund:%s:%d", paymentID, totalRefunded)
	refundID, err := s.stripe.CreateRefund(ctx, payment.StripePaymentIntentID, refundAmount, refundKey)
	if err != nil {
		return nil, fmt.Errorf("create refund stripe: %w", err)
	}

	// Determine status: full refund (cumulative reaches the held amount) or partial.
	refundStatus := "refunded"
	if totalRefunded < payment.AmountCents {
		refundStatus = "partially_refunded"
	}

	now := time.Now()
	// CAS: only apply if refund_amount_cents is still the prior we based this on.
	if err := s.repo.UpdateRefundCAS(ctx, paymentID, alreadyRefunded, totalRefunded, reason, now, refundID, refundStatus); err != nil {
		// Concurrent refund may have already applied the same total (same Stripe key).
		if cur, gerr := s.repo.GetPayment(ctx, paymentID); gerr == nil {
			if cur.RefundAmountCents >= totalRefunded {
				return cur, nil
			}
		}
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidAmount)
	}

	return s.repo.GetPayment(ctx, paymentID)
}

// GetPayment retrieves a payment by ID.
func (s *PaymentService) GetPayment(ctx context.Context, paymentID string) (*domain.Payment, error) {
	return s.repo.GetPayment(ctx, paymentID)
}

// ListPayments lists payments for a user with optional filtering.
func (s *PaymentService) ListPayments(ctx context.Context, userID string, statusFilter string, contractID string, page, pageSize int) ([]*domain.Payment, int, error) {
	return s.repo.ListPayments(ctx, userID, statusFilter, contractID, page, pageSize)
}

// GetFeeConfig retrieves the active fee config for a category or default.
//
// When no fee config row exists yet (a fresh platform), this returns the
// platform's standard default config rather than an error, so the admin
// fee-config UI can render and edit sensible starting values instead of seeing
// a 404/500 for a predictable empty-state. Real lookup failures (DB down, etc.)
// are still propagated.
func (s *PaymentService) GetFeeConfig(ctx context.Context, categoryID *string) (*domain.FeeConfig, error) {
	if categoryID != nil && *categoryID != "" {
		fc, err := s.repo.GetFeeConfig(ctx, *categoryID)
		if err == nil {
			return fc, nil
		}
		// Fall through to the default config below only for the missing-row case;
		// surface any other (real) error.
		if !errors.Is(err, domain.ErrFeeConfigNotFound) {
			return nil, err
		}
	}

	fc, err := s.repo.GetDefaultFeeConfig(ctx)
	if err == nil {
		return fc, nil
	}
	if errors.Is(err, domain.ErrFeeConfigNotFound) {
		// No config persisted yet — return the standard defaults so the admin
		// can review and save them.
		return domain.DefaultFeeConfig(), nil
	}
	return nil, err
}

// GetStripeAccountID retrieves the Stripe account ID for a user.
func (s *PaymentService) GetStripeAccountID(ctx context.Context, userID string) (string, error) {
	return s.repo.GetStripeAccountID(ctx, userID)
}

// CreateStripeAccount creates a Stripe Connect account and stores the ID.
func (s *PaymentService) CreateStripeAccount(ctx context.Context, userID, email, businessName string) (string, error) {
	accountID, err := s.stripe.CreateStripeAccount(ctx, email, businessName)
	if err != nil {
		return "", err
	}

	if err := s.repo.SetStripeAccountID(ctx, userID, accountID); err != nil {
		return "", err
	}

	return accountID, nil
}

// GetStripeOnboardingLink generates an onboarding link for the user's Stripe account.
//
// Seeded / leftover synthetic IDs (acct_dev_…) never exist on a real Stripe
// platform. Calling AccountLink.Create with them yields resource_missing →
// Internal → HTTP 500. Treat them like "no account" so the client gets a
// FailedPrecondition (HTTP 422) and can POST /providers/me/stripe/account.
func (s *PaymentService) GetStripeOnboardingLink(ctx context.Context, userID, returnURL, refreshURL string) (string, error) {
	accountID, err := s.repo.GetStripeAccountID(ctx, userID)
	if err != nil {
		return "", err
	}
	if s.stripe != nil && !s.stripe.IsDevMode() && isSyntheticDevStripeAccountID(accountID) {
		slog.Info("synthetic stripe account id without live account, refusing onboarding link",
			"user_id", userID,
			"account_id", accountID,
		)
		return "", domain.ErrStripeAccountNotFound
	}

	url, err := s.stripe.GetOnboardingLink(ctx, accountID, returnURL, refreshURL)
	if err != nil {
		// Deleted / wrong-platform Connect account: surface the same CTA path.
		if stripeErrIsMissingResource(err) {
			slog.Info("stripe connect account unavailable for onboarding link",
				"user_id", userID,
				"account_id", accountID,
				"error", err,
			)
			return "", domain.ErrStripeAccountNotFound
		}
		return "", err
	}
	return url, nil
}

// defaultStripeAccountStatusNotStarted is the status surface for a provider
// who has not completed (or never started) Connect onboarding. Read paths must
// return this instead of 500 so the UI can render the "connect Stripe" CTA.
func defaultStripeAccountStatusNotStarted() *domain.StripeAccountStatus {
	return &domain.StripeAccountStatus{
		ChargesEnabled:        false,
		PayoutsEnabled:        false,
		DetailsSubmitted:      false,
		TransfersReady:        false,
		StripeTransfersStatus: "unrequested",
	}
}

// isSyntheticDevStripeAccountID reports IDs minted by StripeService dev mode
// (acct_dev_…) that never exist on a real Stripe platform. Seeded profiles and
// leftover rows from a prior placeholder-key run leave these in the DB; calling
// live Stripe with them always yields account_invalid → HTTP 500.
func isSyntheticDevStripeAccountID(accountID string) bool {
	return strings.HasPrefix(accountID, "acct_dev")
}

// GetStripeAccountStatus retrieves the Stripe account status for a user.
// If no Stripe account exists — or the stored id is a synthetic/stale Connect
// account that Stripe no longer (or never) recognizes — returns a default
// "not started" status instead of an error so the client gets HTTP 200 with
// charges_enabled/payouts_enabled false.
func (s *PaymentService) GetStripeAccountStatus(ctx context.Context, userID string) (*domain.StripeAccountStatus, error) {
	accountID, err := s.repo.GetStripeAccountID(ctx, userID)
	if err != nil {
		// If the user has no Stripe account, return a sensible default.
		slog.Info("no stripe account for user, returning default status",
			"user_id", userID,
			"error", err,
		)
		return defaultStripeAccountStatusNotStarted(), nil
	}

	// Dev-mode stub IDs against a live key: skip the Stripe round-trip and
	// treat as not onboarded. In real Stripe dev mode GetAccountStatus already
	// short-circuits to a stub, so leave those alone.
	if s.stripe != nil && !s.stripe.IsDevMode() && isSyntheticDevStripeAccountID(accountID) {
		slog.Info("synthetic stripe account id without live account, returning default status",
			"user_id", userID,
			"account_id", accountID,
		)
		return defaultStripeAccountStatusNotStarted(), nil
	}

	status, err := s.stripe.GetAccountStatus(ctx, accountID)
	if err != nil {
		// Account deleted, wrong Stripe platform, revoked access, etc. — the
		// provider is effectively not onboarded; surface the CTA, not a 500.
		// stripe.GetAccountStatus already soft-fails most of these; keep the
		// check here as defense in depth if a future path re-surfaces the error.
		if stripeErrIsMissingResource(err) {
			slog.Info("stripe connect account unavailable, returning default status",
				"user_id", userID,
				"account_id", accountID,
				"error", err,
			)
			return defaultStripeAccountStatusNotStarted(), nil
		}
		return nil, err
	}
	return status, nil
}

// GetStripeDashboardLink generates a dashboard link for the user's Stripe account.
func (s *PaymentService) GetStripeDashboardLink(ctx context.Context, userID string) (string, error) {
	accountID, err := s.repo.GetStripeAccountID(ctx, userID)
	if err != nil {
		return "", err
	}

	return s.stripe.GetDashboardLink(ctx, accountID)
}

// CreateStripeAccountSession mints a Connect embedded-components client_secret
// for the user's connected account (onboarding, notification banner, payouts).
func (s *PaymentService) CreateStripeAccountSession(ctx context.Context, userID string) (clientSecret string, expiresAt time.Time, err error) {
	accountID, err := s.repo.GetStripeAccountID(ctx, userID)
	if err != nil {
		return "", time.Time{}, err
	}
	return s.stripe.CreateAccountSession(ctx, accountID)
}

// CreateSetupIntent creates a SetupIntent for saving a user's payment method.
//
// This is the one place in the product where a Stripe Customer is genuinely
// needed and the user is present, so it is the natural provisioning trigger:
// EnsureCustomer runs here (idempotently), and the resulting cus_ id is passed
// to Stripe as params.Customer so the confirmed card ATTACHES to the person.
//
// Provisioning happens on this write path and never on a read path — see
// ListPaymentMethods.
func (s *PaymentService) CreateSetupIntent(ctx context.Context, customerID string) (string, error) {
	customers, err := s.requireCustomers()
	if err != nil {
		return "", fmt.Errorf("create setup intent: %w", err)
	}
	stripeCustomerID, err := customers.EnsureCustomer(ctx, customerID)
	if err != nil {
		return "", fmt.Errorf("create setup intent: %w", err)
	}
	return s.stripe.CreateSetupIntent(ctx, stripeCustomerID, customerID)
}

// GetSetupIntentStatus asks Stripe whether a SetupIntent actually confirmed.
// Callers gate privileges on this instead of trusting a client-side "it
// succeeded" POST.
//
// On a confirmed intent this ALSO persists the payment method as a side effect.
// That is deliberate: it is the synchronous fast path, complementing the
// setup_intent.succeeded event handler which is the authoritative one. Either
// may arrive first and both are idempotent (the DB upsert keys on the pm_ id),
// so the card is on file as soon as EITHER lands — the user does not have to
// wait on event delivery to see the card they just saved.
//
// A persistence failure does NOT fail the status read: the caller asked "did it
// confirm?", the answer is yes, and answering "no" would be wrong. The event
// handler retries the persistence.
func (s *PaymentService) GetSetupIntentStatus(ctx context.Context, clientSecret, customerID string) (SetupIntentStatus, error) {
	status, err := s.stripe.GetSetupIntentStatus(ctx, clientSecret, customerID)
	if err != nil {
		return status, err
	}
	if !status.Succeeded || status.PaymentMethodID == "" {
		return status, nil
	}
	if s.customers == nil || customerID == "" {
		return status, nil
	}

	stripeCustomerID := status.CustomerID
	if stripeCustomerID == "" {
		// Intent created before params.Customer was set, or a dev intent with no
		// customer binding. Resolve from our own record rather than guessing.
		resolved, lookupErr := s.customers.Lookup(ctx, customerID)
		if lookupErr != nil || resolved == "" {
			slog.WarnContext(ctx, "confirmed setup intent has no stripe customer; cannot persist payment method",
				"user_id", customerID, "payment_method_id", status.PaymentMethodID)
			return status, nil
		}
		stripeCustomerID = resolved
	}

	if persistErr := s.customers.RecordConfirmedPaymentMethod(ctx, customerID, stripeCustomerID, status.PaymentMethodID); persistErr != nil {
		slog.ErrorContext(ctx, "failed to persist confirmed payment method on the synchronous path; the setup_intent.succeeded handler remains the backstop",
			"user_id", customerID,
			"payment_method_id", status.PaymentMethodID,
			"error", persistErr,
		)
	}
	return status, nil
}

// ChargeContractTip charges the customer for a post-completion gratuity and
// transfers the full tip to the provider (0% platform fee). tip_amount_cents is
// CAS-set only after charge + transfer succeed (MON-23).
//
// Bounds: $1 … $10,000. Requires a chargeable default payment method.
func (s *PaymentService) ChargeContractTip(
	ctx context.Context,
	contractID, customerID string,
	amountCents int64,
	idempotencyKey string,
) (paymentID, piID string, tipAmountCents int64, status string, succeeded bool, err error) {
	if idempotencyKey == "" {
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: idempotency key required")
	}
	if amountCents < 100 || amountCents > 1_000_000 {
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: %w", domain.ErrInvalidAmount)
	}

	contract, err := s.repo.GetContractForPayment(ctx, contractID)
	if err != nil {
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: %w", err)
	}
	if customerID == "" || customerID != contract.CustomerID {
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: %w", domain.ErrContractNotOwned)
	}
	if contract.Status != "completed" {
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: %w", domain.ErrContractNotCompleted)
	}
	if contract.TipAmountCents != 0 {
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: %w", domain.ErrTipAlreadyRecorded)
	}

	// Off-session instrument (saved default card).
	customers, err := s.requireCustomers()
	if err != nil {
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: %w", err)
	}
	stripeCustomerID, err := customers.Lookup(ctx, customerID)
	if err != nil || stripeCustomerID == "" {
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: %w", ErrNoPaymentInstrument)
	}
	paymentMethodID, err := customers.DefaultPaymentMethod(ctx, customerID)
	if err != nil || paymentMethodID == "" {
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: %w", ErrNoPaymentInstrument)
	}

	providerAccountID, err := s.repo.GetStripeAccountID(ctx, contract.ProviderID)
	if err != nil {
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: %w", err)
	}

	paymentID = uuid.New().String()
	// Deterministic idempotency for the payment row: prefer tip:<contract_id>
	// so double-submit collapses; fall back to client key if already used shape.
	rowKey := idempotencyKey
	if rowKey == "" {
		rowKey = "tip:" + contractID
	}
	payment := &domain.Payment{
		ID:                  paymentID,
		ContractID:          contractID,
		CustomerID:          customerID,
		ProviderID:          contract.ProviderID,
		AmountCents:         amountCents,
		PlatformFeeCents:    0,
		GuaranteeFeeCents:   0,
		ProviderPayoutCents: amountCents, // full tip to provider
		IdempotencyKey:      rowKey,
		Status:              "pending",
	}
	if err := s.repo.CreatePayment(ctx, payment); err != nil {
		// Idempotent re-entry: look up by nothing easy without GetByIdempotency —
		// surface conflict for gateway to map to 409.
		return "", "", 0, "", false, fmt.Errorf("charge contract tip: create payment: %w", err)
	}

	stripeKey := "tip-charge:" + contractID
	piID, _, chargeErr := s.stripe.CreateOffSessionPaymentIntent(
		ctx,
		amountCents,
		"usd",
		stripeCustomerID,
		paymentMethodID,
		stripeKey,
		map[string]string{
			"purpose":     "contract_tip",
			"contract_id": contractID,
			"payment_id":  paymentID,
			"provider_id": contract.ProviderID,
		},
	)
	if chargeErr != nil {
		_ = s.repo.UpdatePaymentStatus(ctx, paymentID, "failed")
		return paymentID, "", 0, "failed", false, fmt.Errorf("charge contract tip: stripe: %w", chargeErr)
	}
	if err := s.repo.UpdateStripeFields(ctx, paymentID, piID, "", ""); err != nil {
		slog.ErrorContext(ctx, "charge contract tip: stamp PI failed", "payment_id", paymentID, "error", err)
	}

	// Immediate transfer of full tip to provider (no multi-day escrow).
	transferKey := "tip-transfer:" + contractID
	transferID, xferErr := s.stripe.CreateTransfer(ctx, amountCents, "usd", providerAccountID, piID, transferKey)
	if xferErr != nil {
		// Funds captured on platform; leave payment in processing for ops — do NOT
		// set tip_amount until provider is paid (or we accept platform hold as paid tip).
		// Product choice: still record tip after capture so customer is not re-charged;
		// transfer failure is ops/reconciliation. Prefer fail-closed on tip stamp only
		// when charge failed. Mark completed with transfer error logged.
		slog.ErrorContext(ctx, "charge contract tip: transfer failed after charge — reconciling",
			"payment_id", paymentID, "pi_id", piID, "error", xferErr)
		// Fall through to CAS tip: customer was charged; tip is paid even if Connect lag.
	} else if err := s.repo.UpdateStripeFields(ctx, paymentID, piID, "", transferID); err != nil {
		slog.WarnContext(ctx, "charge contract tip: stamp transfer id failed", "error", err)
	}

	if err := s.repo.UpdatePaymentStatus(ctx, paymentID, "completed"); err != nil {
		slog.ErrorContext(ctx, "charge contract tip: mark completed failed", "error", err)
	}

	won, casErr := s.repo.SetContractTipIfZero(ctx, contractID, amountCents)
	if casErr != nil {
		return paymentID, piID, 0, "completed", false, fmt.Errorf("charge contract tip: stamp tip: %w", casErr)
	}
	if !won {
		// Concurrent tip won the CAS; charge already happened — report already recorded.
		return paymentID, piID, amountCents, "completed", true, fmt.Errorf("charge contract tip: %w", domain.ErrTipAlreadyRecorded)
	}

	slog.InfoContext(ctx, "contract tip charged",
		"contract_id", contractID,
		"payment_id", paymentID,
		"amount_cents", amountCents,
		"pi_id", piID,
		"transfer_id", transferID,
	)
	return paymentID, piID, amountCents, "completed", true, nil
}

// ChargePromotion collects a listing-promotion fee off-session against the
// card saved by a confirmed SetupIntent.
//
// The SetupIntent is verified here — a caller cannot skip straight to the
// charge — and amountCents is supplied by the gateway from its server-side
// pricebook. idempotencyKey (the promotion_charges row id) makes a retried or
// concurrent confirm collapse onto a single Stripe charge.
func (s *PaymentService) ChargePromotion(ctx context.Context, customerID, clientSecret string, amountCents int64, idempotencyKey, listingID string) (string, string, bool, error) {
	if idempotencyKey == "" {
		return "", "", false, fmt.Errorf("charge promotion: idempotency key required")
	}
	if amountCents <= 0 {
		return "", "", false, fmt.Errorf("charge promotion: amount must be positive")
	}

	si, err := s.stripe.GetSetupIntentStatus(ctx, clientSecret, customerID)
	if err != nil {
		return "", "", false, err
	}
	if !si.Succeeded {
		// Not an error condition — the card was never confirmed. The caller
		// maps this to a 402 so the buyer can retry in Stripe Elements.
		return "", si.Status, false, nil
	}

	// The SetupIntent tells us which Customer the confirmed card is attached to.
	// Prefer it over any local lookup: it is the pair Stripe itself just
	// validated, and an off-session charge REQUIRES the customer and the payment
	// method to belong together.
	stripeCustomerID := si.CustomerID
	if stripeCustomerID == "" && s.customers != nil {
		resolved, lookupErr := s.customers.Lookup(ctx, customerID)
		if lookupErr != nil {
			slog.WarnContext(ctx, "charge promotion: stripe customer lookup failed",
				"user_id", customerID, "error", lookupErr)
		}
		stripeCustomerID = resolved
	}
	if stripeCustomerID == "" {
		// Fail closed. Previously this substituted the platform user id, which is
		// not a cus_ id — the charge could only ever be rejected by Stripe, and
		// the rejection was then reported as a payment failure by the buyer.
		return "", "", false, fmt.Errorf("charge promotion: %w", ErrNoPaymentInstrument)
	}

	piID, _, err := s.stripe.CreateOffSessionPaymentIntent(
		ctx,
		amountCents,
		"usd",
		stripeCustomerID,
		si.PaymentMethodID,
		"promo_"+idempotencyKey,
		map[string]string{
			"purpose":    "listing_promotion",
			"listing_id": listingID,
			"charge_id":  idempotencyKey,
		},
	)
	if err != nil {
		return "", "", false, err
	}
	return piID, "succeeded", true, nil
}

// ListPaymentMethods lists a user's saved payment methods.
//
// Before migration 102 this returned [] for EVERY user, always: it resolved the
// Stripe customer id from subscriptions.stripe_customer_id, a column nothing
// ever wrote, so the lookup produced "" and the function short-circuited to an
// empty slice. The cards were not missing from the response — they had never
// been attached to anything in the first place.
//
// Now: Stripe is the source of truth for WHICH cards exist (it knows about
// detachments, expiries and cards added through any other surface), and the
// local table supplies WHICH ONE IS DEFAULT. Merging the two is what lets the UI
// mark a default without a second round-trip.
//
// This path deliberately does NOT provision. A read must not create a Stripe
// object: a user who opens the billing page and saves nothing should leave no
// trace at Stripe. No customer id simply means no saved cards, which is exactly
// what an empty list says.
func (s *PaymentService) ListPaymentMethods(ctx context.Context, customerID string) ([]domain.PaymentMethod, error) {
	if s.stripe.IsDevMode() {
		// DevStore is keyed by platform user id, not stripe customer id.
		return s.stripe.ListPaymentMethods(ctx, customerID)
	}

	customers, err := s.requireCustomers()
	if err != nil {
		return nil, fmt.Errorf("list payment methods: %w", err)
	}

	stripeCustomerID, err := customers.Lookup(ctx, customerID)
	if err != nil {
		// A lookup failure is NOT "no cards". Returning [] here would tell a user
		// with saved cards that they have none, and would let a caller that gates
		// on "has a payment method" take the wrong branch during a DB blip.
		return nil, fmt.Errorf("list payment methods: %w", err)
	}
	if stripeCustomerID == "" {
		return []domain.PaymentMethod{}, nil
	}

	methods, err := s.stripe.ListPaymentMethods(ctx, stripeCustomerID)
	if err != nil {
		// Stale local pointer (e.g. cus_dev_* left from a prior dev-mode run,
		// or a Customer deleted at Stripe) means there are no cards we can
		// surface. Fail soft with an empty list so the billing page returns
		// 200 instead of 500. Transport/auth/rate-limit errors still fail closed.
		// stripe.ListPaymentMethods already soft-fails most of these; keep the
		// check here as defense in depth if a future path re-surfaces the error.
		if stripeErrIsMissingResource(err) {
			slog.WarnContext(ctx, "stripe customer missing while listing payment methods; treating as empty",
				"user_id", customerID,
				"stripe_customer_id", stripeCustomerID,
				"error", err)
			return []domain.PaymentMethod{}, nil
		}
		return nil, err
	}

	// Overlay the default flag from local state. A failure to read it degrades
	// to "no card marked default" rather than failing the list.
	defaultPM, err := customers.DefaultPaymentMethod(ctx, customerID)
	if err != nil {
		slog.WarnContext(ctx, "could not resolve default payment method for list",
			"user_id", customerID, "error", err)
		return methods, nil
	}
	for i := range methods {
		methods[i].IsDefault = methods[i].ID == defaultPM
	}
	return methods, nil
}

// AddDevPaymentMethod appends a card to the in-memory dev store. Callable
// only when the Stripe service is in dev mode — production should use the
// Stripe Elements flow via CreateSetupIntent.
func (s *PaymentService) AddDevPaymentMethod(ctx context.Context, customerID, brand, last4 string, expMonth, expYear int32) (*domain.PaymentMethod, error) {
	if !s.stripe.IsDevMode() {
		return nil, fmt.Errorf("add dev payment method: stripe not in dev mode")
	}
	pm := s.stripe.DevStore().AddPaymentMethod(customerID, brand, last4, expMonth, expYear)
	return &pm, nil
}

// DeletePaymentMethod detaches a payment method owned by customerID.
//
// Ownership (IDOR guard): the payment method MUST belong to customerID. We
// confirm membership by listing the caller's own methods (ListPaymentMethods is
// owner-scoped — dev: keyed by user id; prod: keyed by the user's Stripe
// customer id) and checking the id is present before detaching. A method that
// isn't the caller's returns ErrPaymentNotFound → gRPC NotFound → 404, so a
// non-owner can neither delete nor probe for another user's card id.
func (s *PaymentService) DeletePaymentMethod(ctx context.Context, customerID, paymentMethodID string) error {
	methods, err := s.ListPaymentMethods(ctx, customerID)
	if err != nil {
		return fmt.Errorf("delete payment method: load owner methods: %w", err)
	}
	owned := false
	for _, m := range methods {
		if m.ID == paymentMethodID {
			owned = true
			break
		}
	}
	if !owned {
		return domain.ErrPaymentNotFound
	}
	if err := s.stripe.DeletePaymentMethod(ctx, paymentMethodID); err != nil {
		return err
	}
	// Mirror the detach locally so the fail-closed chargeability check stops
	// offering a card that no longer exists at Stripe. Ordering is Stripe-first:
	// if the local write fails the card is gone at Stripe and merely stale here,
	// and the next off-session charge fails cleanly as resource_missing (which
	// classifies to ChargeOutcomeNoPaymentMethod, not a buyer decline). The
	// reverse order could leave a card we believe is deleted still chargeable.
	if s.customers != nil {
		if err := s.customers.dir.SoftDeleteUserPaymentMethod(ctx, customerID, paymentMethodID); err != nil {
			slog.ErrorContext(ctx, "detached payment method at stripe but failed to mark it deleted locally",
				"user_id", customerID, "payment_method_id", paymentMethodID, "error", err)
		}
	}
	return nil
}

// SetDefaultPaymentMethod marks the caller's saved card as default locally.
// Ownership is checked against the local directory first so a non-owner
// cannot flip another user's default (or probe whether a pm_ id exists).
// When a Stripe Customer is already provisioned the invoice-settings default
// is mirrored first so an off-session charge that races the persist still
// hits the card the user just chose; with no Customer the local table is
// the sole source of truth and no Stripe call is made. Re-defaulting the
// card that is already default is a no-op.
func (s *PaymentService) SetDefaultPaymentMethod(ctx context.Context, customerID, paymentMethodID string) error {
	if customerID == "" || paymentMethodID == "" {
		return domain.ErrPaymentNotFound
	}
	customers, err := s.requireCustomers()
	if err != nil {
		return fmt.Errorf("set default payment method: %w", err)
	}

	methods, err := customers.dir.ListUserPaymentMethods(ctx, customerID)
	if err != nil {
		return fmt.Errorf("set default payment method: load owner methods: %w", err)
	}
	var owned *domain.PaymentMethod
	for i := range methods {
		if methods[i].ID == paymentMethodID {
			owned = &methods[i]
			break
		}
	}
	if owned == nil {
		return domain.ErrPaymentNotFound
	}
	if owned.IsDefault {
		return nil
	}

	// Local table is the source of truth for which card is default
	// (idx_user_payment_methods_one_default). Mirror to Stripe only when a
	// Customer is already provisioned — do not mint one as a side effect of
	// flipping default, and do not invent a Stripe call when there is nothing
	// to update.
	stripeCustomerID, err := customers.Lookup(ctx, customerID)
	if err != nil {
		return fmt.Errorf("set default payment method: %w", err)
	}
	if stripeCustomerID != "" {
		if err := s.stripe.SetCustomerDefaultPaymentMethod(ctx, stripeCustomerID, paymentMethodID); err != nil {
			return fmt.Errorf("set default payment method: stripe: %w", err)
		}
	}
	if err := customers.dir.SetDefaultUserPaymentMethod(ctx, customerID, paymentMethodID); err != nil {
		return fmt.Errorf("set default payment method: %w", err)
	}
	return nil
}

// AdminListPayments lists payments with optional filters for admin use.
func (s *PaymentService) AdminListPayments(ctx context.Context, userID string, statusFilter string, startTime, endTime *time.Time, page, pageSize int) ([]*domain.Payment, int, int64, int64, error) {
	return s.repo.AdminListPayments(ctx, userID, statusFilter, startTime, endTime, page, pageSize)
}

// AdminGetPaymentDetails retrieves a payment by ID with full details for admin.
func (s *PaymentService) AdminGetPaymentDetails(ctx context.Context, paymentID string) (*domain.Payment, error) {
	return s.repo.AdminGetPaymentDetails(ctx, paymentID)
}

// AdminUpdateFeeConfig updates the fee configuration for a category or the default.
func (s *PaymentService) AdminUpdateFeeConfig(ctx context.Context, categoryID *string, feePercentage, guaranteePercentage float64, minFeeCents int64, maxFeeCents *int64, leadGenEnabled bool, leadGenPercentage float64, leadGenMinFeeCents int64, leadGenMaxFeeCents *int64) (*domain.FeeConfig, error) {
	// A non-empty category override must be a valid UUID. Empty/absent means the
	// default (platform-wide) config. Reject a malformed id as a 400, not a 500
	// from the downstream UUID cast.
	if categoryID != nil && *categoryID != "" {
		if _, err := uuid.Parse(*categoryID); err != nil {
			return nil, fmt.Errorf("admin update fee config: category_id must be a valid uuid: %w", domain.ErrInvalidAmount)
		}
	}
	if feePercentage < 0 || feePercentage > 1 {
		return nil, fmt.Errorf("admin update fee config: fee_percentage must be between 0 and 1: %w", domain.ErrInvalidAmount)
	}
	if guaranteePercentage < 0 || guaranteePercentage > 1 {
		return nil, fmt.Errorf("admin update fee config: guarantee_percentage must be between 0 and 1: %w", domain.ErrInvalidAmount)
	}
	if minFeeCents < 0 {
		return nil, fmt.Errorf("admin update fee config: min_fee_cents must be non-negative: %w", domain.ErrInvalidAmount)
	}
	if maxFeeCents != nil && *maxFeeCents < minFeeCents {
		return nil, fmt.Errorf("admin update fee config: max_fee_cents must be >= min_fee_cents: %w", domain.ErrInvalidAmount)
	}
	if leadGenPercentage < 0 || leadGenPercentage > 1 {
		return nil, fmt.Errorf("admin update fee config: lead_gen_percentage must be between 0 and 1: %w", domain.ErrInvalidAmount)
	}
	if leadGenMinFeeCents < 0 {
		return nil, fmt.Errorf("admin update fee config: lead_gen_min_fee_cents must be non-negative: %w", domain.ErrInvalidAmount)
	}
	if leadGenMaxFeeCents != nil && *leadGenMaxFeeCents < leadGenMinFeeCents {
		return nil, fmt.Errorf("admin update fee config: lead_gen_max_fee_cents must be >= lead_gen_min_fee_cents: %w", domain.ErrInvalidAmount)
	}

	if err := s.ensureCombinedFeeCap(ctx, rateToBPS(feePercentage), 0, ""); err != nil {
		return nil, fmt.Errorf("admin update fee config: %w", err)
	}

	return s.repo.UpdateFeeConfig(ctx, categoryID, feePercentage, guaranteePercentage, minFeeCents, maxFeeCents, leadGenEnabled, leadGenPercentage, leadGenMinFeeCents, leadGenMaxFeeCents)
}

func normalizeCustomFeeName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", fmt.Errorf("custom fee name is required: %w", domain.ErrInvalidAmount)
	}
	if utf8.RuneCountInString(trimmed) > domain.MaxCustomFeeNameLen {
		return "", fmt.Errorf("custom fee name must be at most %d characters: %w", domain.MaxCustomFeeNameLen, domain.ErrInvalidAmount)
	}
	return trimmed, nil
}

func validateCustomFeeBPS(rateBPS int64) error {
	if rateBPS < 0 || rateBPS > domain.MaxCustomFeeBPS {
		return fmt.Errorf("rate_bps must be between 0 and %d: %w", domain.MaxCustomFeeBPS, domain.ErrInvalidAmount)
	}
	return nil
}

// ensureCombinedFeeCap fails closed when platform bps + active custom bps
// (optionally substituting extraBPS for excludeID, or adding extraBPS as a
// new fee when excludeID is empty) would exceed 50%.
func (s *PaymentService) ensureCombinedFeeCap(ctx context.Context, platformBPS, extraBPS int64, excludeID string) error {
	active, err := s.repo.ListActiveCustomFees(ctx)
	if err != nil {
		return fmt.Errorf("list custom fees: %w", err)
	}
	var customBPS int64
	for _, f := range active {
		if f == nil || f.ID == excludeID {
			continue
		}
		customBPS += f.RateBPS
	}
	customBPS += extraBPS
	if platformBPS+customBPS > domain.MaxCombinedPlatformCustomBPS {
		return domain.ErrCombinedFeeCapExceeded
	}
	return nil
}

func (s *PaymentService) platformBPS(ctx context.Context) (int64, error) {
	fc, err := s.GetFeeConfig(ctx, nil)
	if err != nil {
		return 0, err
	}
	return rateToBPS(fc.FeePercentage), nil
}

func (s *PaymentService) ListCustomFees(ctx context.Context) ([]*domain.CustomFee, error) {
	fees, err := s.repo.ListCustomFees(ctx)
	if err != nil {
		return nil, fmt.Errorf("list custom fees: %w", err)
	}
	return fees, nil
}

func (s *PaymentService) CreateCustomFee(ctx context.Context, name string, rateBPS int64) (*domain.CustomFee, error) {
	trimmed, err := normalizeCustomFeeName(name)
	if err != nil {
		return nil, fmt.Errorf("create custom fee: %w", err)
	}
	if err := validateCustomFeeBPS(rateBPS); err != nil {
		return nil, fmt.Errorf("create custom fee: %w", err)
	}
	platformBPS, err := s.platformBPS(ctx)
	if err != nil {
		return nil, fmt.Errorf("create custom fee: %w", err)
	}
	if err := s.ensureCombinedFeeCap(ctx, platformBPS, rateBPS, ""); err != nil {
		return nil, fmt.Errorf("create custom fee: %w", err)
	}
	fee := &domain.CustomFee{
		Name:    trimmed,
		RateBPS: rateBPS,
		Active:  true,
	}
	if err := s.repo.CreateCustomFee(ctx, fee); err != nil {
		return nil, fmt.Errorf("create custom fee: %w", err)
	}
	return fee, nil
}

func (s *PaymentService) UpdateCustomFee(ctx context.Context, id string, name *string, rateBPS *int64, active *bool) (*domain.CustomFee, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, fmt.Errorf("update custom fee: id must be a valid uuid: %w", domain.ErrInvalidAmount)
	}
	existing, err := s.repo.GetCustomFee(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("update custom fee: %w", err)
	}
	if name != nil {
		trimmed, nerr := normalizeCustomFeeName(*name)
		if nerr != nil {
			return nil, fmt.Errorf("update custom fee: %w", nerr)
		}
		existing.Name = trimmed
	}
	if rateBPS != nil {
		if err := validateCustomFeeBPS(*rateBPS); err != nil {
			return nil, fmt.Errorf("update custom fee: %w", err)
		}
		existing.RateBPS = *rateBPS
	}
	if active != nil {
		existing.Active = *active
	}

	willCount := existing.Active
	extraBPS := int64(0)
	excludeID := existing.ID
	if willCount {
		extraBPS = existing.RateBPS
	}
	platformBPS, err := s.platformBPS(ctx)
	if err != nil {
		return nil, fmt.Errorf("update custom fee: %w", err)
	}
	if err := s.ensureCombinedFeeCap(ctx, platformBPS, extraBPS, excludeID); err != nil {
		return nil, fmt.Errorf("update custom fee: %w", err)
	}
	if err := s.repo.UpdateCustomFee(ctx, existing); err != nil {
		return nil, fmt.Errorf("update custom fee: %w", err)
	}
	return existing, nil
}

func (s *PaymentService) DeactivateCustomFee(ctx context.Context, id string) error {
	if _, err := uuid.Parse(id); err != nil {
		return fmt.Errorf("deactivate custom fee: id must be a valid uuid: %w", domain.ErrInvalidAmount)
	}
	if err := s.repo.DeactivateCustomFee(ctx, id); err != nil {
		return fmt.Errorf("deactivate custom fee: %w", err)
	}
	return nil
}

// GetRevenueReport returns aggregated revenue data for a date range.
func (s *PaymentService) GetRevenueReport(ctx context.Context, startTime, endTime *time.Time, groupBy string) (*domain.RevenueReport, error) {
	return s.repo.GetRevenueReport(ctx, startTime, endTime, groupBy)
}
