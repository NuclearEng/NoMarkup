package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for the review domain.
var (
	ErrReviewNotFound       = errors.New("review not found")
	ErrNotEligible          = errors.New("not eligible to review")
	ErrAlreadyReviewed      = errors.New("already reviewed this contract")
	ErrReviewWindowClosed   = errors.New("review window has closed")
	ErrNotReviewee          = errors.New("only the reviewee can respond")
	ErrAlreadyResponded     = errors.New("already responded to this review")
	ErrFlagNotFound         = errors.New("flag not found")
	ErrFlagAlreadyResolved  = errors.New("flag already resolved")
	ErrReviewAlreadyRemoved = errors.New("review already removed")
	// ErrInvalidReviewPhotos — not http(s), or more than MaxReviewPhotos (5).
	ErrInvalidReviewPhotos = errors.New("invalid review photos")
)

// Review represents a review left by one party for another after a contract.
//
// Persisted columns (see migrations) — note the schema uses reviewer_role and
// review_text rather than the older direction/comment naming, has no separate
// is_flagged column (flag state is derived from status='flagged' + flagged_at),
// photo_urls is TEXT[] (0–5 http(s) CDN URLs; migration 127), and the window
// column is named review_window_ends (no _at suffix).
//
// Category ratings are direction-specific (FR-6.2):
//   - Customer → provider: QualityRating, CommunicationRating, TimelinessRating, ValueRating
//   - Provider → customer: PaymentPromptnessRating, ScopeAccuracyRating, AccessRating
type Review struct {
	ID                  string
	ContractID          string
	JobID               string
	ReviewerID          string
	RevieweeID          string
	ReviewerRole        string // customer or provider — replaces legacy "direction"
	OverallRating       int
	QualityRating       *int // customer->provider only
	CommunicationRating *int
	TimelinessRating    *int
	ValueRating         *int // customer->provider only
	// Provider → customer category ratings (FR-6.2)
	PaymentPromptnessRating *int
	ScopeAccuracyRating     *int
	AccessRating            *int // property access
	ReviewText              string
	PhotoURLs               []string // public CDN URLs, 0–5
	Status                  string   // pending, published, flagged, removed
	FlaggedAt               *time.Time
	FlagReason              string
	ReviewWindowEnds        time.Time
	CreatedAt               time.Time
	UpdatedAt               time.Time

	// Populated via JOIN
	Response *ReviewResponse
}

// IsFlagged returns true when the review has been flagged for moderation.
// Derived from status, since the schema has no boolean is_flagged column.
func (r *Review) IsFlagged() bool {
	return r.Status == "flagged" || r.FlaggedAt != nil
}

// Direction returns the legacy direction string derived from ReviewerRole.
// Kept so the gRPC layer can map to the existing ReviewDirection enum.
func (r *Review) Direction() string {
	switch r.ReviewerRole {
	case "customer":
		return "customer_to_provider"
	case "provider":
		return "provider_to_customer"
	default:
		return ""
	}
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
