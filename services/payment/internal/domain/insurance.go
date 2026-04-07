package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for insurance domain.
var (
	ErrInsuranceProductNotFound = errors.New("insurance product not found")
	ErrInsurancePolicyNotFound  = errors.New("insurance policy not found")
	ErrInsuranceClaimNotFound   = errors.New("insurance claim not found")
	ErrPolicyNotActive          = errors.New("insurance policy is not active")
	ErrPolicyExpired            = errors.New("insurance policy has expired")
	ErrClaimExceedsCoverage     = errors.New("claim amount exceeds coverage")
	ErrClaimNotReviewable       = errors.New("claim is not in reviewable state")
)

// InsuranceProduct represents a type of insurance available on the platform.
type InsuranceProduct struct {
	ID                  string
	Name                string
	Slug                string
	Description         string
	CoverageType        string // property_damage, workmanship_warranty, completion_guarantee, liability
	BaseRateBPS         int    // basis points (e.g. 150 = 1.5%)
	MinPremiumCents     int64
	MaxCoverageCents    *int64
	CoverageDurationDays int
	DeductibleCents     int64
	TermsMarkdown       string
	Active              bool
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// InsurancePolicy represents a per-contract insurance policy.
type InsurancePolicy struct {
	ID                    string
	PolicyNumber          string
	ProductID             string
	ContractID            string
	CustomerID            string
	ProviderID            string
	CoverageAmountCents   int64
	PremiumCents          int64
	DeductibleCents       int64
	StripePaymentIntentID string
	EffectiveDate         time.Time // DATE
	ExpirationDate        time.Time // DATE
	Status                string    // pending_payment, active, expired, claimed, cancelled, void
	PaidAt                *time.Time
	CancelledAt           *time.Time
	CancellationReason    string
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// InsuranceClaim represents a filed insurance claim against a policy.
type InsuranceClaim struct {
	ID                  string
	ClaimNumber         string
	PolicyID            string
	ClaimantID          string
	ClaimType           string // property_damage, workmanship_defect, incomplete_work, liability_incident
	Description         string
	EvidenceURLs        []string
	ClaimedAmountCents  int64
	AssessedAmountCents *int64
	AssessorNotes       string
	ApprovedAmountCents *int64
	PayoutCents         *int64
	StripeTransferID    string
	Status              string // filed, under_review, approved, denied, paid_out, appealed, closed
	DenialReason        string
	ReviewedBy          *string
	ReviewedAt          *time.Time
	PaidAt              *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// InsuranceQuote holds the calculated premium for an insurance product.
type InsuranceQuote struct {
	ProductID           string
	ProductName         string
	CoverageType        string
	PremiumCents        int64
	CoverageAmountCents int64
	DeductibleCents     int64
	CoverageDurationDays int
	EffectiveDate       time.Time
	ExpirationDate      time.Time
}

// PurchaseInsuranceInput holds the data needed to purchase an insurance policy.
type PurchaseInsuranceInput struct {
	ContractID string
	ProductID  string
	CustomerID string
	ProviderID string
	ContractAmountCents int64
}

// FileInsuranceClaimInput holds the data needed to file an insurance claim.
type FileInsuranceClaimInput struct {
	PolicyID       string
	ClaimantID     string
	ClaimType      string
	Description    string
	EvidenceURLs   []string
	ClaimedAmountCents int64
}

// ReviewInsuranceClaimInput holds the data needed to review a claim.
type ReviewInsuranceClaimInput struct {
	ClaimID            string
	ReviewerID         string
	Approved           bool
	ApprovedAmountCents int64
	AssessorNotes      string
	DenialReason       string
}

// InsuranceRepository defines persistence operations for insurance.
type InsuranceRepository interface {
	// Products
	ListInsuranceProducts(ctx context.Context, activeOnly bool) ([]*InsuranceProduct, error)
	GetInsuranceProduct(ctx context.Context, id string) (*InsuranceProduct, error)
	GetInsuranceProductBySlug(ctx context.Context, slug string) (*InsuranceProduct, error)

	// Policies
	CreateInsurancePolicy(ctx context.Context, policy *InsurancePolicy) error
	GetInsurancePolicy(ctx context.Context, id string) (*InsurancePolicy, error)
	ListInsurancePolicies(ctx context.Context, userID string, page, pageSize int) ([]*InsurancePolicy, int, error)
	UpdateInsurancePolicyStatus(ctx context.Context, id string, status string) error
	UpdateInsurancePolicyPaid(ctx context.Context, id string, stripePaymentIntentID string) error
	FindPolicyByStripePaymentIntentID(ctx context.Context, paymentIntentID string) (*InsurancePolicy, error)

	// Claims
	CreateInsuranceClaim(ctx context.Context, claim *InsuranceClaim) error
	GetInsuranceClaim(ctx context.Context, id string) (*InsuranceClaim, error)
	AdminListInsuranceClaims(ctx context.Context, statusFilter string, page, pageSize int) ([]*InsuranceClaim, int, error)
	UpdateInsuranceClaimReview(ctx context.Context, id string, status string, approvedAmountCents *int64, assessorNotes string, denialReason string, reviewerID string) error
	UpdateInsuranceClaimPayout(ctx context.Context, id string, payoutCents int64, stripeTransferID string) error

	// Sequences
	NextPolicyNumber(ctx context.Context) (string, error)
	NextClaimNumber(ctx context.Context) (string, error)
}
