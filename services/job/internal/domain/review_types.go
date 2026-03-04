package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for the review domain.
var (
	ErrReviewNotFound     = errors.New("review not found")
	ErrNotEligible        = errors.New("not eligible to review")
	ErrAlreadyReviewed    = errors.New("already reviewed this contract")
	ErrReviewWindowClosed = errors.New("review window has closed")
	ErrNotReviewee        = errors.New("only the reviewee can respond")
	ErrAlreadyResponded   = errors.New("already responded to this review")
	ErrFlagNotFound       = errors.New("flag not found")
	ErrFlagAlreadyResolved = errors.New("flag already resolved")
	ErrReviewAlreadyRemoved = errors.New("review already removed")
)

// Review represents a review left by one party for another after a contract.
type Review struct {
	ID                  string
	ContractID          string
	ReviewerID          string
	RevieweeID          string
	Direction           string // customer_to_provider, provider_to_customer
	OverallRating       int
	QualityRating       *int // customer->provider only
	CommunicationRating *int
	TimelinessRating    *int
	ValueRating         *int // customer->provider only
	Comment             string
	PhotoURLs           []string
	Status              string // pending, published, flagged, removed
	IsFlagged           bool
	ReviewWindowEndsAt  time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time

	// Populated via JOIN
	Response *ReviewResponse
}

// ReviewResponse represents a response to a review by the reviewee.
type ReviewResponse struct {
	ID          string
	ReviewID    string
	ResponderID string
	Comment     string
	CreatedAt   time.Time
}

// ReviewFlag represents a flag on a review.
type ReviewFlag struct {
	ID              string
	ReviewID        string
	FlaggedBy       string
	Reason          string // inappropriate, fake, harassment, spam, irrelevant
	Details         string
	Status          string // pending, upheld, dismissed
	ResolvedBy      *string
	ResolutionNotes string
	FlaggedAt       time.Time
	ResolvedAt      *time.Time
}

// ReviewEligibility holds the result of checking whether a user can review a contract.
type ReviewEligibility struct {
	Eligible        bool
	AlreadyReviewed bool
	WindowClosesAt  time.Time
}

// FlaggedReviewWithFlag represents a review flag together with its associated review.
type FlaggedReviewWithFlag struct {
	Flag   ReviewFlag
	Review Review
}

// ReviewRepository defines persistence operations for reviews.
type ReviewRepository interface {
	CreateReview(ctx context.Context, review *Review) (*Review, error)
	GetReview(ctx context.Context, reviewID string) (*Review, error)
	ListReviewsForUser(ctx context.Context, userID string, directionFilter *string, page, pageSize int) ([]*Review, *Pagination, float64, int, error)
	ListReviewsByUser(ctx context.Context, userID string, page, pageSize int) ([]*Review, *Pagination, error)
	CreateReviewResponse(ctx context.Context, resp *ReviewResponse) (*ReviewResponse, error)
	FlagReview(ctx context.Context, flag *ReviewFlag) (string, error)
	CheckReviewEligibility(ctx context.Context, contractID, userID string) (*ReviewEligibility, error)
	PublishPendingReviews(ctx context.Context, contractID string) error
	ComputeAverageRating(ctx context.Context, userID string) (float64, int, error)

	// Admin operations
	AdminListFlaggedReviews(ctx context.Context, statusFilter *string, page, pageSize int) ([]FlaggedReviewWithFlag, *Pagination, error)
	AdminRemoveReview(ctx context.Context, reviewID, reason, adminID string) error
	AdminResolveFlag(ctx context.Context, flagID, adminID string, uphold bool, resolutionNotes string) (string, error)
	RecalculateProviderRating(ctx context.Context, providerID string) error
	InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any) error
}
