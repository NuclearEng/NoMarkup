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
}
