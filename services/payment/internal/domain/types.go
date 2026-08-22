package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for payment domain.
var (
	ErrPaymentNotFound     = errors.New("payment not found")
	ErrWebhookSignature    = errors.New("webhook signature verification failed")
	ErrIdempotencyConflict = errors.New("idempotency key conflict")
	// ErrRecurringInstancePaymentExists is returned when INSERT violates
	// uq_payments_recurring_instance (migration 111). CreatePayment soft-replays
	// the existing row + real client_secret rather than minting a second PI.
	ErrRecurringInstancePaymentExists = errors.New("payment already exists for recurring instance")
	// ErrPaymentIntentMissing is returned when soft-replay finds a payment row
	// without a Stripe PaymentIntent. Fail closed — never invent client_secret.
	ErrPaymentIntentMissing    = errors.New("payment has no stripe payment intent")
	ErrInvalidAmount           = errors.New("invalid amount")
	ErrInvalidStatus           = errors.New("invalid status transition")
	ErrPaymentAlreadyProcessed = errors.New("payment already processed")
	ErrFeeConfigNotFound       = errors.New("fee config not found")
	ErrCustomFeeNotFound       = errors.New("custom fee not found")
	// ErrCombinedFeeCapExceeded is returned when platform fee bps plus the
	// sum of active custom fee bps would exceed MaxCombinedPlatformCustomBPS
	// (50%). Fail-closed: do not create the payment or persist the fee.
	ErrCombinedFeeCapExceeded = errors.New("combined platform and custom fees exceed 50%")
	// ErrNotAuthorizedActor is returned when the caller is a party to the
	// payment but not the RIGHT party for this operation — e.g. a provider
	// trying to release their own escrow, or a customer trying to refund a
	// payment that has already been paid out. The gateway's party check
	// admits both parties, so this distinction has to be made here.
	ErrNotAuthorizedActor    = errors.New("actor not authorized for this operation")
	ErrStripeAccountNotFound = errors.New("stripe account not found")
	// ErrTransfersNotReady — connected account cannot receive platform transfers yet
	// (Accounts v2 stripe_transfers inactive / onboarding incomplete).
	ErrTransfersNotReady           = errors.New("connected account not ready for transfers")
	ErrPlatformBankAccountNotFound = errors.New("platform bank account not found")
	// ErrTipAlreadyRecorded is returned when contracts.tip_amount_cents is already non-zero.
	ErrTipAlreadyRecorded = errors.New("tip already recorded")
	// ErrContractNotCompleted is returned when a tip is attempted on a non-completed contract.
	ErrContractNotCompleted = errors.New("contract is not completed")
	// ErrInstantPayoutInsufficientBalance — claim under advisory lock found net
	// cleared balance below the requested amount (MON-10).
	ErrInstantPayoutInsufficientBalance = errors.New("instant payout exceeds available cleared balance")
	// ErrInstantPayoutDailyCap — rolling 24h instant-payout cap would be breached.
	ErrInstantPayoutDailyCap = errors.New("instant payout daily cap exceeded")
)

// Payment represents a platform payment.
type Payment struct {
	ID                    string
	ContractID            string
	MilestoneID           *string
	RecurringInstanceID   *string
	CustomerID            string
	ProviderID            string
	AmountCents           int64
	PlatformFeeCents      int64
	GuaranteeFeeCents     int64
	ProviderPayoutCents   int64
	StripePaymentIntentID string
	StripeChargeID        string
	StripeTransferID      string
	StripeRefundID        string
	IdempotencyKey        string
	Status                string // pending, processing, escrow, released, completed, failed, refunded, partially_refunded, disputed, chargeback
	FailureReason         string
	RefundAmountCents     int64
	RefundReason          string
	RefundedAt            *time.Time
	InstallmentNumber     *int
	TotalInstallments     *int
	RetryCount            int
	NextRetryAt           *time.Time
	EscrowAt              *time.Time
	ReleasedAt            *time.Time
	CompletedAt           *time.Time
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// FeeConfig holds fee configuration for a category or the default.
type FeeConfig struct {
	ID                  string
	CategoryID          *string
	FeePercentage       float64 // e.g. 0.05 = 5%
	GuaranteePercentage float64 // e.g. 0.02 = 2%
	MinFeeCents         int64
	MaxFeeCents         *int64 // nil = no cap
	// Lead-gen fee: an additive, provider-side "qualified lead" fee charged on
	// top of the platform take rate. Disabled by default (LeadGenEnabled=false)
	// so existing pricing is unchanged.
	LeadGenEnabled     bool
	LeadGenPercentage  float64 // e.g. 0.10 = 10%
	LeadGenMinFeeCents int64
	LeadGenMaxFeeCents *int64 // nil = no cap
	Active             bool
	EffectiveFrom      time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// DefaultFeeConfig returns the platform's standard fee configuration used when
// no fee config row has been persisted yet (e.g. a fresh platform). These match
// the documented platform defaults: a 5% platform take rate and a 2% guarantee
// fund contribution, with the additive lead-gen fee disabled. Returning these
// instead of an error lets the admin fee-config form render with sensible
// starting values that the admin can review and persist, rather than surfacing
// a "not configured" error for a predictable empty-state.
func DefaultFeeConfig() *FeeConfig {
	// Fair-but-sustainable take rate. 8% platform + 2% guarantee = 10% seller-side,
	// below eBay (~13%), Etsy (~11%), and far below TaskRabbit/Thumbtack (15-30%).
	// The buyer pays no markup (fees come out of the seller payout) — true to the
	// NoMarkup brand. Lead-gen stays an opt-in extra (off by default).
	return &FeeConfig{
		FeePercentage:       0.08, // 8% platform commission
		GuaranteePercentage: 0.02, // 2% buyer-protection guarantee
		MinFeeCents:         0,
		MaxFeeCents:         nil,
		LeadGenEnabled:      false, // opt-in: admin toggles on to charge for qualified leads
		LeadGenPercentage:   0.10,  // 10% qualified-lead referral fee (applies only when enabled)
		LeadGenMinFeeCents:  0,
		LeadGenMaxFeeCents:  nil,
		Active:              true,
	}
}

// MaxCombinedPlatformCustomBPS is the fail-closed ceiling on
// platform_fee_config.fee_percentage (as bps) plus the sum of active
// custom fee rate_bps. 5000 = 50%. Guarantee and lead-gen are out of
// this cap — they are separate deductions.
const MaxCombinedPlatformCustomBPS int64 = 5000

// MaxCustomFeeBPS is the per-fee ceiling matching the DB CHECK (10000 = 100%).
const MaxCustomFeeBPS int64 = 10000

// MaxCustomFeeNameLen is the maximum stored name length (migration 128).
const MaxCustomFeeNameLen = 100

// CustomFee is an admin-named additive platform fee stored as integer
// basis points (500 = 5%). Active, non-deleted rows are summed into
// CalculateFees platform_fee_cents.
type CustomFee struct {
	ID        string
	Name      string
	RateBPS   int64
	Active    bool
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt *time.Time
}

// PaymentBreakdown holds the fee breakdown for a payment.
type PaymentBreakdown struct {
	SubtotalCents       int64
	PlatformFeeCents    int64
	GuaranteeFeeCents   int64
	TotalCents          int64
	ProviderPayoutCents int64
	FeePercentage       float64
	GuaranteePercentage float64
	LeadGenFeeCents     int64
	LeadGenPercentage   float64
}

// PlatformBankAccount records the platform's own payout bank account, modeled
// as a Stripe External Account on the PLATFORM Stripe account. Raw account and
// routing numbers are NEVER stored — only the Stripe reference and the
// non-sensitive metadata Stripe returns.
type PlatformBankAccount struct {
	ID                      string
	StripeExternalAccountID string
	BankName                *string
	AccountHolderName       *string
	AccountHolderType       string // individual | company
	Last4                   string
	RoutingLast4            *string
	Currency                string
	Country                 string
	Status                  string // new | validated | verification_failed | errored
	IsDefault               bool
	SetByAdminID            *string
	DeletedAt               *time.Time
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

// PaymentMethod represents a customer's saved payment method.
type PaymentMethod struct {
	ID        string
	Type      string // card, apple_pay, google_pay
	LastFour  string
	Brand     string
	ExpMonth  int32
	ExpYear   int32
	IsDefault bool
}

// StripeAccountStatus represents the status of a Stripe Connect account.
type StripeAccountStatus struct {
	AccountID        string
	ChargesEnabled   bool
	PayoutsEnabled   bool
	DetailsSubmitted bool
	Requirements     []string
	// TransfersReady is true when the account can receive separate-charges
	// transfers (v2 recipient stripe_transfers active, or legacy transfers cap).
	TransfersReady bool
	// StripeTransfersStatus is the raw capability status (active/pending/inactive/unrequested).
	StripeTransfersStatus string
	// Dashboard is the Connect dashboard type when known (express/full/none).
	Dashboard string
	// AccountsAPI is "v2" or "v1" when we can infer how the account was created.
	AccountsAPI string
}

// CreatePaymentInput contains the data needed to create a new payment.
type CreatePaymentInput struct {
	ContractID          string
	MilestoneID         *string
	RecurringInstanceID *string
	CustomerID          string
	ProviderID          string
	AmountCents         int64
	IdempotencyKey      string
	CategoryID          *string // for fee lookup
	InstallmentNumber   *int
	TotalInstallments   *int
}

// Expense represents a provider expense record.
type Expense struct {
	ID          string
	ProviderID  string
	Category    string
	Description string
	AmountCents int64
	ReceiptURL  *string
	ExpenseDate time.Time // DATE stored as time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Advance represents a working capital advance.
type Advance struct {
	ID                 string
	ProviderID         string
	ContractID         string
	AdvanceAmountCents int64
	FeeCents           int64
	RepaidCents        int64
	Status             string // requested, approved, disbursed, repaying, repaid, defaulted, rejected
	ReviewedBy         *string
	ReviewedAt         *time.Time
	RejectionReason    *string
	DisbursedAt        *time.Time
	RepaidAt           *time.Time
	StripeTransferID   string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// CreditLimit represents a provider's working capital credit limit.
type CreditLimit struct {
	ID                    string
	ProviderID            string
	MaxAdvanceCents       int64
	TotalOutstandingCents int64
	RiskScore             float64
	LastComputedAt        time.Time
	JobsCompleted         int
	TotalEarningsCents    int64
	AvgJobValueCents      int64
	OnTimeRate            *float64
	// Underwriting decision fields — persisted output of the Rust underwriting
	// engine (nomarkup.underwriting.v1). These are set by the service layer from
	// the engine's decision and stored alongside the computed features so the
	// most recent decision is auditable and re-displayable without re-running the
	// engine. Zero values are the safe "no decision yet" defaults.
	Approved              bool    // engine approved this provider for an advance
	Tier                  string  // risk/eligibility tier label (e.g. "bronze", "silver")
	AvailableAdvanceCents int64   // advance amount the engine made available (cents)
	FeeBps                int32   // origination fee in basis points
	FactorRate            float64 // repayment factor rate (e.g. 1.1200)
	HoldbackPct           int32   // percent of future payouts held back for repayment
	BindingCap            string  // which input bound the available amount (audit/explainability)
	DecisionHash          string  // hash of the engine's input+output for reproducibility/audit
	ModelVersion          string  // version of the underwriting engine/model that produced the decision
	// Transient (not persisted) — the explainable decision detail, recomputed on
	// each ComputeCreditLimit call for display. BindingGate is the decisive reason
	// when not approved; Reasons are the signed per-feature contributions.
	BindingGate string                 `json:"-"`
	Reasons     []CreditDecisionReason `json:"-"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// CreditDecisionReason is one signed, explainable contribution to an
// underwriting decision (ECOA/Reg-B adverse-action transparency).
type CreditDecisionReason struct {
	Code         string
	Label        string
	Contribution float64
}

// AdvanceRepayment represents a single repayment deduction against an advance.
type AdvanceRepayment struct {
	ID          string
	AdvanceID   string
	PaymentID   string
	AmountCents int64
	CreatedAt   time.Time
}

// RevenueDataPoint holds revenue data for a single time period.
type RevenueDataPoint struct {
	PeriodStart      time.Time
	GMVCents         int64
	RevenueCents     int64
	TransactionCount int32
}

// RevenueReport holds aggregated revenue data.
type RevenueReport struct {
	DataPoints              []RevenueDataPoint
	TotalGMVCents           int64
	TotalRevenueCents       int64
	TotalGuaranteeFundCents int64
	EffectiveTakeRate       float64
}

// InstallmentPlan represents a BNPL installment plan.
type InstallmentPlan struct {
	ID                       string
	ContractID               string
	CustomerID               string
	ProviderID               string
	TotalAmountCents         int64
	BNPLFeeCents             int64
	TotalWithFeeCents        int64
	InstallmentCount         int
	PerInstallmentCents      int64
	FeeRate                  float64
	Status                   string // active, completed, defaulted, cancelled
	ProviderPaidAt           *time.Time
	StripeProviderTransferID string
	Installments             []ScheduledInstallment
	CreatedAt                time.Time
	UpdatedAt                time.Time
}

// ScheduledInstallment represents a single scheduled payment in a BNPL plan.
type ScheduledInstallment struct {
	ID                string
	PlanID            string
	InstallmentNumber int
	AmountCents       int64
	DueDate           time.Time
	PaymentID         *string
	Status            string // scheduled, processing, paid, failed, retrying
	Attempts          int
	LastAttemptAt     *time.Time
	PaidAt            *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// CreateInstallmentPlanInput holds the data needed to create a BNPL plan.
type CreateInstallmentPlanInput struct {
	ContractID       string
	CustomerID       string
	ProviderID       string
	TotalAmountCents int64
	InstallmentCount int // 3 or 6
	PaymentMethodID  string
	IdempotencyKey   string
}

// Sentinel errors.
var (
	ErrExpenseNotFound         = errors.New("expense not found")
	ErrAdvanceNotFound         = errors.New("advance not found")
	ErrAdvanceNotApproved      = errors.New("advance is not in approved status")
	ErrAdvanceDeclined         = errors.New("credit score is below the minimum to qualify for an advance")
	ErrInstallmentPlanNotFound = errors.New("installment plan not found")
	ErrInstallmentPlanExists   = errors.New("an active installment plan already exists for this contract")
	ErrInvalidInstallmentCount = errors.New("installment count must be 3 or 6")
	ErrTaxFormNotFound         = errors.New("tax form not found")
	ErrContractNotFound        = errors.New("contract not found")
	ErrBelow1099Threshold      = errors.New("earnings are below the $600 IRS 1099-NEC reporting threshold for this tax year")
	// ErrPlatformEINNotConfigured is returned when GenerateTaxForm would stamp
	// a missing, whitespace, placeholder (88-1234567), or non-US-shape EIN onto
	// a 1099-NEC. Fail closed — never persist a form with an unusable payer EIN.
	ErrPlatformEINNotConfigured = errors.New("platform EIN is not configured")
)

// Threshold1099NECCents is the IRS minimum nonemployee-compensation total
// (in integer cents) at or above which a payer must issue a 1099-NEC for a
// tax year. Below this, no 1099-NEC is required or valid, so generation is
// gated server-side (the UI shows a "Below Threshold" badge, but the gate must
// be enforced at the boundary, not just in the client).
const Threshold1099NECCents int64 = 60000 // $600.00

// TaxForm represents a 1099-NEC or 1099-K tax form record.
type TaxForm struct {
	ID                      string
	ProviderID              string
	TaxYear                 int
	FormType                string
	ProviderLegalName       string
	ProviderTaxIDLast4      *string
	ProviderAddress         string
	TotalCompensationCents  int64
	FederalTaxWithheldCents int64
	StateTaxWithheldCents   int64
	PlatformEIN             string
	PlatformName            string
	PDFURL                  *string
	Status                  string // draft, generated, delivered, corrected, filed
	DeliveredAt             *time.Time
	FiledAt                 *time.Time
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

// ContractDetail holds the contract + related info needed for invoice generation.
type ContractDetail struct {
	ID             string
	ContractNumber string
	JobTitle       string
	CustomerName   string
	ProviderName   string
	AmountCents    int64
	PaymentTiming  string
	Status         string
	AcceptedAt     *time.Time
	CompletedAt    *time.Time
	CreatedAt      time.Time
}

// ContractForPayment holds the minimal contract fields needed to reconcile a
// payment server-side: the parties (to authorize the payer and derive the
// payee) and the contract amount (to bound the charge). Never trust the client
// for these — see PaymentService.CreatePayment.
type ContractForPayment struct {
	ID             string
	CustomerID     string
	ProviderID     string
	AmountCents    int64
	Status         string
	TipAmountCents int64 // 0 = not yet tipped
}

// MilestoneDetail holds milestone info for invoice line items.
type MilestoneDetail struct {
	ID          string
	Description string
	AmountCents int64
	SortOrder   int
	Status      string
	ApprovedAt  *time.Time
}

// PaymentRepository defines persistence operations for payments.
type PaymentRepository interface {
	CreatePayment(ctx context.Context, payment *Payment) error
	GetPayment(ctx context.Context, id string) (*Payment, error)
	// GetPaymentByRecurringInstanceID loads the single payment linked to a
	// recurring visit (uq_payments_recurring_instance). Soft-replay + gateway
	// dual-PI defense use this — never invent a second PI for the same visit.
	GetPaymentByRecurringInstanceID(ctx context.Context, recurringInstanceID string) (*Payment, error)
	// GetPaymentByIdempotencyKey loads by payments.idempotency_key UNIQUE.
	// Soft-replay on ErrIdempotencyConflict re-reads client_secret.
	GetPaymentByIdempotencyKey(ctx context.Context, idempotencyKey string) (*Payment, error)
	UpdatePaymentStatus(ctx context.Context, id string, status string) error
	// ClaimPaymentStatus atomically transitions status from fromStatus to toStatus.
	// Returns ErrInvalidStatus when the row is not currently in fromStatus (lost CAS race).
	// Used by ProcessPayment (pending→processing) and ReleaseEscrow (escrow→released).
	ClaimPaymentStatus(ctx context.Context, id, fromStatus, toStatus string) error
	ListPayments(ctx context.Context, userID string, statusFilter string, contractID string, page, pageSize int) ([]*Payment, int, error)
	GetFeeConfig(ctx context.Context, categoryID string) (*FeeConfig, error)
	GetDefaultFeeConfig(ctx context.Context) (*FeeConfig, error)
	FindByStripePaymentIntentID(ctx context.Context, paymentIntentID string) (*Payment, error)
	UpdateStripeFields(ctx context.Context, id string, paymentIntentID, chargeID, transferID string) error
	UpdateRefund(ctx context.Context, id string, refundAmountCents int64, refundReason string, refundedAt time.Time, stripeRefundID string, status string) error
	// UpdateRefundCAS persists a refund only when refund_amount_cents still equals
	// expectedPrior. Returns ErrInvalidAmount on CAS failure (concurrent refund).
	UpdateRefundCAS(ctx context.Context, id string, expectedPrior, newTotal int64, refundReason string, refundedAt time.Time, stripeRefundID, status string) error
	// WithProviderAdvisoryLock runs fn under pg_advisory_xact_lock(hashtext(providerID))
	// so concurrent RequestAdvance credit checks serialize per provider.
	WithProviderAdvisoryLock(ctx context.Context, providerID string, fn func(ctx context.Context) error) error
	GetStripeAccountID(ctx context.Context, userID string) (string, error)
	SetStripeAccountID(ctx context.Context, userID string, stripeAccountID string) error
	// GetContractForPayment loads the parties + amount of a non-deleted contract
	// so payment/installment flows can reconcile client input server-side.
	GetContractForPayment(ctx context.Context, contractID string) (*ContractForPayment, error)
	// SetContractTipIfZero CAS-sets contracts.tip_amount_cents only when still 0.
	// Returns true when this call won the race and recorded the tip.
	SetContractTipIfZero(ctx context.Context, contractID string, tipAmountCents int64) (bool, error)
	// SetStripeOnboardingComplete flips the provider_profiles.stripe_onboarding_complete
	// flag for the user owning the given Stripe Connect account ID. Wired off
	// the account.updated webhook so the local DB stays in sync with Stripe.
	SetStripeOnboardingComplete(ctx context.Context, stripeAccountID string, complete bool) error
	GetStripeCustomerID(ctx context.Context, userID string) (string, error)

	// Admin operations
	AdminListPayments(ctx context.Context, userID string, statusFilter string, startTime, endTime *time.Time, page, pageSize int) ([]*Payment, int, int64, int64, error)
	AdminGetPaymentDetails(ctx context.Context, paymentID string) (*Payment, error)
	UpdateFeeConfig(ctx context.Context, categoryID *string, feePercentage, guaranteePercentage float64, minFeeCents int64, maxFeeCents *int64, leadGenEnabled bool, leadGenPercentage float64, leadGenMinFeeCents int64, leadGenMaxFeeCents *int64) (*FeeConfig, error)
	ListCustomFees(ctx context.Context) ([]*CustomFee, error)
	ListActiveCustomFees(ctx context.Context) ([]*CustomFee, error)
	GetCustomFee(ctx context.Context, id string) (*CustomFee, error)
	CreateCustomFee(ctx context.Context, fee *CustomFee) error
	UpdateCustomFee(ctx context.Context, fee *CustomFee) error
	DeactivateCustomFee(ctx context.Context, id string) error
	GetRevenueReport(ctx context.Context, startTime, endTime *time.Time, groupBy string) (*RevenueReport, error)

	// Platform bank account operations
	GetDefaultPlatformBankAccount(ctx context.Context) (*PlatformBankAccount, error)
	InsertPlatformBankAccount(ctx context.Context, acct *PlatformBankAccount) error
	SoftDeletePlatformBankAccount(ctx context.Context, id string) error

	// Expense operations
	CreateExpense(ctx context.Context, expense *Expense) error
	ListExpenses(ctx context.Context, providerID string, startDate, endDate *time.Time, page, pageSize int) ([]*Expense, int64, int, error)
	DeleteExpense(ctx context.Context, expenseID, providerID string) error

	// Advance operations
	CreateAdvance(ctx context.Context, advance *Advance) error
	ListAdvances(ctx context.Context, providerID string, statusFilter string, page, pageSize int) ([]*Advance, int, error)
	GetAdvance(ctx context.Context, advanceID string) (*Advance, error)
	UpdateAdvanceReview(ctx context.Context, advanceID string, status string, reviewerID string, rejectionReason *string) (*Advance, error)
	UpdateAdvanceDisbursement(ctx context.Context, advanceID string, stripeTransferID string) (*Advance, error)
	UpdateAdvanceRepayment(ctx context.Context, advanceID string, paymentID string, amountCents int64) (*Advance, error)
	GetActiveAdvancesForProvider(ctx context.Context, providerID string) ([]*Advance, error)
	GetCreditLimit(ctx context.Context, providerID string) (*CreditLimit, error)
	UpsertCreditLimit(ctx context.Context, limit *CreditLimit) error

	// Underwriting feature queries — un-forgeable, windowed inputs to the Rust
	// underwriting engine. asOf anchors every window for deterministic, auditable
	// feature vectors (NOT time.Now). See repository/underwriting_features.go.
	GetUnderwritingEarnings(ctx context.Context, providerID string, asOf time.Time) (t30, t90, t365 int64, activeMonths int, err error)
	GetProviderDisputeRate90d(ctx context.Context, providerID string, asOf time.Time) (rate float64, err error)

	// Installment plan operations
	CreateInstallmentPlan(ctx context.Context, plan *InstallmentPlan) error
	GetInstallmentPlan(ctx context.Context, planID string) (*InstallmentPlan, error)
	HasActiveInstallmentPlanForContract(ctx context.Context, contractID string) (bool, error)
	ListInstallmentPlans(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*InstallmentPlan, int, error)
	CreateScheduledInstallments(ctx context.Context, installments []ScheduledInstallment) error
	GetDueInstallments(ctx context.Context, dueDate time.Time) ([]ScheduledInstallment, error)
	UpdateScheduledInstallmentStatus(ctx context.Context, id string, status string, paymentID *string) error
	UpdateInstallmentPlanStatus(ctx context.Context, planID string, status string) error
	UpdateInstallmentPlanProviderPaid(ctx context.Context, planID string, transferID string) error
	GetScheduledInstallmentsForPlan(ctx context.Context, planID string) ([]ScheduledInstallment, error)

	// Tax form operations
	CreateTaxForm(ctx context.Context, tf *TaxForm) error
	GetTaxForm(ctx context.Context, providerID string, taxYear int) (*TaxForm, error)
	ListTaxForms(ctx context.Context, providerID string) ([]*TaxForm, error)
	GetProviderEarningsForYear(ctx context.Context, providerID string, taxYear int) (int64, error)
	UpdateTaxFormStatus(ctx context.Context, id string, status string, pdfURL *string) error

	// Invoice operations
	GetContractDetail(ctx context.Context, contractID string) (*ContractDetail, error)
	GetMilestonesForContract(ctx context.Context, contractID string) ([]*MilestoneDetail, error)
	GetPaymentsForContract(ctx context.Context, contractID string) ([]*Payment, error)
	GetProviderProfile(ctx context.Context, providerID string) (businessName, serviceAddress string, err error)

	// Stripe webhook event dedup. RecordStripeEventStart inserts a new row for
	// the given event.id; it returns alreadyProcessed=true ONLY when the row
	// already exists AND processed_at IS NOT NULL (fully handled). A row with
	// processed_at NULL (prior attempt failed) returns false so Stripe retries
	// reprocess. MarkStripeEventProcessed stamps processed_at after success.
	RecordStripeEventStart(ctx context.Context, eventID, eventType string) (alreadyProcessed bool, err error)
	MarkStripeEventProcessed(ctx context.Context, eventID string) error

	// Instant payout ledger (instant_payouts table). Claim inserts a pending row
	// under the per-provider advisory lock; Complete stamps the Stripe payout id.
	SumInstantPayoutsLast24h(ctx context.Context, providerID string) (int64, error)
	SumAllInstantPayouts(ctx context.Context, providerID string) (int64, error)
	// SumEligibleInstantPayoutCents is the provider's released+completed payout
	// balance available for instant withdrawal (gross before prior payouts).
	SumEligibleInstantPayoutCents(ctx context.Context, providerID string) (int64, error)
	LookupInstantPayoutByKey(ctx context.Context, providerID, idempotencyKey string) (*InstantPayout, bool, error)
	// ClaimInstantPayout inserts a pending ledger row under advisory lock after
	// re-checking daily cap and available balance. Returns the claimed row.
	ClaimInstantPayout(ctx context.Context, providerID string, amountCents, feeCents, netCents int64, idempotencyKey string) (*InstantPayout, error)
	CompleteInstantPayout(ctx context.Context, payoutID, stripePayoutID string) error
	FailInstantPayout(ctx context.Context, payoutID string) error
}

// InstantPayout is a row in the instant_payouts ledger.
type InstantPayout struct {
	ID             string
	ProviderID     string
	AmountCents    int64
	FeeCents       int64
	NetCents       int64
	StripePayoutID string
	IdempotencyKey string
	Status         string // pending, completed, failed
	CreatedAt      time.Time
}
