package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// MaxReviewPhotos is the product limit for review photos (matches
// reviews_photo_urls_len CHECK / properties.photo_urls).
const MaxReviewPhotos = 5

// ReviewService implements review business logic.
type ReviewService struct {
	reviewRepo   domain.ReviewRepository
	contractRepo domain.ContractRepository
}

// NewReviewService creates a new review service.
func NewReviewService(reviewRepo domain.ReviewRepository, contractRepo domain.ContractRepository) *ReviewService {
	return &ReviewService{
		reviewRepo:   reviewRepo,
		contractRepo: contractRepo,
	}
}

// CreateReviewInput holds optional category ratings for CreateReview (FR-6.2).
// Customer→provider uses Quality/Communication/Timeliness/Value.
// Provider→customer uses PaymentPromptness/ScopeAccuracy/Access.
// All category ratings are optional; when present they must be 1–5.
type CreateReviewInput struct {
	ContractID              string
	ReviewerID              string
	OverallRating           int
	QualityRating           *int
	CommunicationRating     *int
	TimelinessRating        *int
	ValueRating             *int
	PaymentPromptnessRating *int
	ScopeAccuracyRating     *int
	AccessRating            *int
	Comment                 string
	PhotoURLs               []string
}

// CreateReview creates a review after validating eligibility and input.
func (s *ReviewService) CreateReview(ctx context.Context, in CreateReviewInput) (*domain.Review, error) {
	// Check eligibility.
	elig, err := s.reviewRepo.CheckReviewEligibility(ctx, in.ContractID, in.ReviewerID)
	if err != nil {
		return nil, fmt.Errorf("create review: %w", err)
	}
	if elig.AlreadyReviewed {
		return nil, fmt.Errorf("create review: %w", domain.ErrAlreadyReviewed)
	}
	if !elig.Eligible {
		// Distinguish closed window so clients show an actionable message.
		if !elig.WindowClosesAt.IsZero() && time.Now().After(elig.WindowClosesAt) {
			return nil, fmt.Errorf("create review: %w", domain.ErrReviewWindowClosed)
		}
		return nil, fmt.Errorf("create review: %w", domain.ErrNotEligible)
	}

	// Validate overall rating.
	if in.OverallRating < 1 || in.OverallRating > 5 {
		return nil, fmt.Errorf("create review: overall rating must be between 1 and 5")
	}

	// Validate optional category ratings (1–5 when present).
	for _, r := range []*int{
		in.QualityRating, in.CommunicationRating, in.TimelinessRating, in.ValueRating,
		in.PaymentPromptnessRating, in.ScopeAccuracyRating, in.AccessRating,
	} {
		if r != nil && (*r < 1 || *r > 5) {
			return nil, fmt.Errorf("create review: all ratings must be between 1 and 5")
		}
	}

	// Validate comment length.
	if len(in.Comment) < 50 {
		return nil, fmt.Errorf("create review: comment must be at least 50 characters")
	}

	// Determine direction and reviewee.
	contract, err := s.contractRepo.GetContract(ctx, in.ContractID)
	if err != nil {
		return nil, fmt.Errorf("create review: %w", err)
	}

	// Persisted column is reviewer_role: "customer" or "provider".
	var role, direction, revieweeID string
	if in.ReviewerID == contract.CustomerID {
		role = "customer"
		direction = "customer_to_provider"
		revieweeID = contract.ProviderID
	} else if in.ReviewerID == contract.ProviderID {
		role = "provider"
		direction = "provider_to_customer"
		revieweeID = contract.CustomerID
	} else {
		return nil, fmt.Errorf("create review: %w", domain.ErrNotEligible)
	}

	photoURLs, err := normalizeReviewPhotoURLs(in.PhotoURLs)
	if err != nil {
		return nil, fmt.Errorf("create review: %w", err)
	}

	// Persist persona-appropriate category ratings only. Cross-direction dims
	// are ignored so a mis-wired client cannot pollute the wrong columns.
	review := &domain.Review{
		ContractID:    in.ContractID,
		ReviewerID:    in.ReviewerID,
		RevieweeID:    revieweeID,
		ReviewerRole:  role,
		OverallRating: in.OverallRating,
		ReviewText:    in.Comment,
		PhotoURLs:     photoURLs,
	}
	if role == "customer" {
		review.QualityRating = in.QualityRating
		review.CommunicationRating = in.CommunicationRating
		review.TimelinessRating = in.TimelinessRating
		review.ValueRating = in.ValueRating
	} else {
		review.PaymentPromptnessRating = in.PaymentPromptnessRating
		review.ScopeAccuracyRating = in.ScopeAccuracyRating
		review.AccessRating = in.AccessRating
	}

	created, err := s.reviewRepo.CreateReview(ctx, review)
	if err != nil {
		return nil, fmt.Errorf("create review: %w", err)
	}

	// Check if both parties have reviewed and publish if so.
	if err := s.reviewRepo.PublishPendingReviews(ctx, in.ContractID); err != nil {
		slog.Warn("failed to publish pending reviews", "contract_id", in.ContractID, "error", err)
	}

	// Re-fetch to get potentially updated status.
	created, err = s.reviewRepo.GetReview(ctx, created.ID)
	if err != nil {
		slog.Warn("failed to re-fetch review after publish check", "review_id", created.ID, "error", err)
	}

	slog.Info("review created",
		"review_id", created.ID,
		"contract_id", in.ContractID,
		"reviewer_id", in.ReviewerID,
		"direction", direction,
	)

	return created, nil
}

// normalizeReviewPhotoURLs trims, drops empties, dedupes, enforces max 5, and
// rejects non-http(s) URLs. Empty input is valid (no photos).
func normalizeReviewPhotoURLs(in []string) ([]string, error) {
	if len(in) == 0 {
		return []string{}, nil
	}
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, u := range in {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		if !strings.HasPrefix(u, "https://") && !strings.HasPrefix(u, "http://") {
			return nil, fmt.Errorf("%w: photo_urls must be http(s) CDN URLs", domain.ErrInvalidReviewPhotos)
		}
		if _, ok := seen[u]; ok {
			continue
		}
		seen[u] = struct{}{}
		out = append(out, u)
		if len(out) > MaxReviewPhotos {
			return nil, fmt.Errorf("%w: at most %d review photos", domain.ErrInvalidReviewPhotos, MaxReviewPhotos)
		}
	}
	return out, nil
}

// GetReview retrieves a review by ID.
func (s *ReviewService) GetReview(ctx context.Context, reviewID string) (*domain.Review, error) {
	review, err := s.reviewRepo.GetReview(ctx, reviewID)
	if err != nil {
		return nil, fmt.Errorf("get review: %w", err)
	}
	return review, nil
}

// ListReviewsForUser lists reviews received by a user.
func (s *ReviewService) ListReviewsForUser(ctx context.Context, userID string, directionFilter *string, page, pageSize int) ([]*domain.Review, *domain.Pagination, float64, int, error) {
	reviews, pagination, avgRating, totalReviews, err := s.reviewRepo.ListReviewsForUser(ctx, userID, directionFilter, page, pageSize)
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("list reviews for user: %w", err)
	}
	return reviews, pagination, avgRating, totalReviews, nil
}

// ListReviewsByUser lists reviews written by a user.
func (s *ReviewService) ListReviewsByUser(ctx context.Context, userID string, page, pageSize int) ([]*domain.Review, *domain.Pagination, error) {
	reviews, pagination, err := s.reviewRepo.ListReviewsByUser(ctx, userID, page, pageSize)
	if err != nil {
		return nil, nil, fmt.Errorf("list reviews by user: %w", err)
	}
	return reviews, pagination, nil
}

// RespondToReview adds a response to a review, validating the responder is the reviewee.
func (s *ReviewService) RespondToReview(ctx context.Context, reviewID, responderID, comment string) (*domain.ReviewResponse, error) {
	review, err := s.reviewRepo.GetReview(ctx, reviewID)
	if err != nil {
		return nil, fmt.Errorf("respond to review: %w", err)
	}

	if review.RevieweeID != responderID {
		return nil, fmt.Errorf("respond to review: %w", domain.ErrNotReviewee)
	}

	resp := &domain.ReviewResponse{
		ReviewID:    reviewID,
		ResponderID: responderID,
		Comment:     comment,
	}

	created, err := s.reviewRepo.CreateReviewResponse(ctx, resp)
	if err != nil {
		return nil, fmt.Errorf("respond to review: %w", err)
	}

	slog.Info("review response created",
		"review_id", reviewID,
		"responder_id", responderID,
	)

	return created, nil
}

// FlagReview flags a review for moderation.
func (s *ReviewService) FlagReview(ctx context.Context, reviewID, flaggedBy, reason, details string) (string, error) {
	flag := &domain.ReviewFlag{
		ReviewID:  reviewID,
		FlaggedBy: flaggedBy,
		Reason:    reason,
		Details:   details,
	}

	flagID, err := s.reviewRepo.FlagReview(ctx, flag)
	if err != nil {
		return "", fmt.Errorf("flag review: %w", err)
	}

	slog.Info("review flagged",
		"review_id", reviewID,
		"flagged_by", flaggedBy,
		"reason", reason,
	)

	return flagID, nil
}

// GetReviewEligibility checks whether a user can review a contract.
func (s *ReviewService) GetReviewEligibility(ctx context.Context, contractID, userID string) (*domain.ReviewEligibility, error) {
	elig, err := s.reviewRepo.CheckReviewEligibility(ctx, contractID, userID)
	if err != nil {
		return nil, fmt.Errorf("get review eligibility: %w", err)
	}
	return elig, nil
}

// AdminListFlaggedReviews lists flagged reviews for admin moderation.
func (s *ReviewService) AdminListFlaggedReviews(ctx context.Context, statusFilter *string, page, pageSize int) ([]domain.FlaggedReviewWithFlag, *domain.Pagination, error) {
	flagged, pagination, err := s.reviewRepo.AdminListFlaggedReviews(ctx, statusFilter, page, pageSize)
	if err != nil {
		return nil, nil, fmt.Errorf("admin list flagged reviews: %w", err)
	}
	return flagged, pagination, nil
}

// AdminRemoveReview removes a review by admin and recalculates the provider's rating.
func (s *ReviewService) AdminRemoveReview(ctx context.Context, reviewID, reason, adminID string) error {
	// Get the review to find the reviewee for rating recalculation.
	review, err := s.reviewRepo.GetReview(ctx, reviewID)
	if err != nil {
		return fmt.Errorf("admin remove review: %w", err)
	}

	if err := s.reviewRepo.AdminRemoveReview(ctx, reviewID, reason, adminID); err != nil {
		return fmt.Errorf("admin remove review: %w", err)
	}

	// Recalculate the reviewee's average rating.
	if err := s.reviewRepo.RecalculateProviderRating(ctx, review.RevieweeID); err != nil {
		slog.Warn("failed to recalculate provider rating after review removal",
			"review_id", reviewID,
			"reviewee_id", review.RevieweeID,
			"error", err,
		)
	}

	if err := s.reviewRepo.InsertAuditLog(ctx, adminID, "remove_review", "review", reviewID, map[string]any{
		"reason":      reason,
		"reviewee_id": review.RevieweeID,
	}); err != nil {
		slog.Error("failed to insert audit log for review removal",
			"review_id", reviewID,
			"admin_id", adminID,
			"error", err,
		)
	}

	slog.Info("review removed by admin",
		"review_id", reviewID,
		"admin_id", adminID,
		"reason", reason,
	)
	return nil
}

// AdminResolveFlag resolves a review flag. If upheld, the review is removed
// and the provider's rating is recalculated.
func (s *ReviewService) AdminResolveFlag(ctx context.Context, flagID, adminID string, uphold bool, resolutionNotes string) (string, error) {
	resultStatus, err := s.reviewRepo.AdminResolveFlag(ctx, flagID, adminID, uphold, resolutionNotes)
	if err != nil {
		return "", fmt.Errorf("admin resolve flag: %w", err)
	}

	if err := s.reviewRepo.InsertAuditLog(ctx, adminID, "resolve_flag", "review_flag", flagID, map[string]any{
		"uphold":           uphold,
		"resolution_notes": resolutionNotes,
		"result_status":    resultStatus,
	}); err != nil {
		slog.Error("failed to insert audit log for flag resolution",
			"flag_id", flagID,
			"admin_id", adminID,
			"error", err,
		)
	}

	slog.Info("review flag resolved by admin",
		"flag_id", flagID,
		"admin_id", adminID,
		"uphold", uphold,
		"result_status", resultStatus,
	)
	return resultStatus, nil
}
