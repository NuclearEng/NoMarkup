package domain

import (
	"context"
	"time"
)

// Payment represents a platform payment.
type Payment struct {
	ID                  string
	ContractID          string
	MilestoneID         string
	CustomerID          string
	ProviderID          string
	AmountCents         int64
	PlatformFeeCents    int64
	GuaranteeFeeCents   int64
	ProviderPayoutCents int64
	Status              string
	FailureReason       string
	EscrowAt            time.Time
	ReleasedAt          time.Time
	CompletedAt         time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// PaymentRepository defines persistence operations for payments.
type PaymentRepository interface {
	FindByID(ctx context.Context, id string) (*Payment, error)
	Create(ctx context.Context, payment *Payment) error
	UpdateStatus(ctx context.Context, id string, status string) error
	ListByUser(ctx context.Context, userID string, page, pageSize int) ([]*Payment, int, error)
}
