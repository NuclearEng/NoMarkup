package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for payment domain.
var (
	ErrPaymentNotFound       = errors.New("payment not found")
	ErrIdempotencyConflict   = errors.New("idempotency key conflict")
	ErrInvalidAmount         = errors.New("invalid amount")
	ErrInvalidStatus         = errors.New("invalid status transition")
	ErrPaymentAlreadyProcessed = errors.New("payment already processed")
	ErrFeeConfigNotFound     = errors.New("fee config not found")
	ErrStripeAccountNotFound = errors.New("stripe account not found")
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
	Active              bool
	EffectiveFrom       time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
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
	ID           string
	ProviderID   string
	Category     string
	Description  string
	AmountCents  int64
	ReceiptURL   *string
	ExpenseDate  time.Time // DATE stored as time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
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
	CreatedAt          time.Time
	UpdatedAt          time.Time
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
	DataPoints            []RevenueDataPoint
	TotalGMVCents         int64
	TotalRevenueCents     int64
	TotalGuaranteeFundCents int64
	EffectiveTakeRate     float64
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

// Sentinel errors for expenses, advances, and installment plans.
var (
	ErrExpenseNotFound         = errors.New("expense not found")
	ErrAdvanceNotFound         = errors.New("advance not found")
	ErrInstallmentPlanNotFound = errors.New("installment plan not found")
	ErrInvalidInstallmentCount = errors.New("installment count must be 3 or 6")
)

// PaymentRepository defines persistence operations for payments.
type PaymentRepository interface {
	CreatePayment(ctx context.Context, payment *Payment) error
	GetPayment(ctx context.Context, id string) (*Payment, error)
	UpdatePaymentStatus(ctx context.Context, id string, status string) error
	ListPayments(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*Payment, int, error)
	GetFeeConfig(ctx context.Context, categoryID string) (*FeeConfig, error)
	GetDefaultFeeConfig(ctx context.Context) (*FeeConfig, error)
	FindByStripePaymentIntentID(ctx context.Context, paymentIntentID string) (*Payment, error)
	UpdateStripeFields(ctx context.Context, id string, paymentIntentID, chargeID, transferID string) error
	UpdateRefund(ctx context.Context, id string, refundAmountCents int64, refundReason string, refundedAt time.Time, stripeRefundID string, status string) error
	GetStripeAccountID(ctx context.Context, userID string) (string, error)
	SetStripeAccountID(ctx context.Context, userID string, stripeAccountID string) error
	GetStripeCustomerID(ctx context.Context, userID string) (string, error)

	// Admin operations
	AdminListPayments(ctx context.Context, userID string, statusFilter string, startTime, endTime *time.Time, page, pageSize int) ([]*Payment, int, int64, int64, error)
	AdminGetPaymentDetails(ctx context.Context, paymentID string) (*Payment, error)
	UpdateFeeConfig(ctx context.Context, categoryID *string, feePercentage, guaranteePercentage float64, minFeeCents int64, maxFeeCents *int64) (*FeeConfig, error)
	GetRevenueReport(ctx context.Context, startTime, endTime *time.Time, groupBy string) (*RevenueReport, error)

	// Expense operations
	CreateExpense(ctx context.Context, expense *Expense) error
	ListExpenses(ctx context.Context, providerID string, startDate, endDate *time.Time, page, pageSize int) ([]*Expense, int64, int, error)
	DeleteExpense(ctx context.Context, expenseID, providerID string) error

	// Advance operations
	CreateAdvance(ctx context.Context, advance *Advance) error
	ListAdvances(ctx context.Context, providerID string, statusFilter string, page, pageSize int) ([]*Advance, int, error)
	GetAdvance(ctx context.Context, advanceID string) (*Advance, error)
	UpdateAdvanceReview(ctx context.Context, advanceID string, status string, reviewerID string, rejectionReason *string) (*Advance, error)

	// Installment plan operations
	CreateInstallmentPlan(ctx context.Context, plan *InstallmentPlan) error
	GetInstallmentPlan(ctx context.Context, planID string) (*InstallmentPlan, error)
	ListInstallmentPlans(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*InstallmentPlan, int, error)
	CreateScheduledInstallments(ctx context.Context, installments []ScheduledInstallment) error
	GetDueInstallments(ctx context.Context, dueDate time.Time) ([]ScheduledInstallment, error)
	UpdateScheduledInstallmentStatus(ctx context.Context, id string, status string, paymentID *string) error
	UpdateInstallmentPlanStatus(ctx context.Context, planID string, status string) error
	UpdateInstallmentPlanProviderPaid(ctx context.Context, planID string, transferID string) error
	GetScheduledInstallmentsForPlan(ctx context.Context, planID string) ([]ScheduledInstallment, error)
}
