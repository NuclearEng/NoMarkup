package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

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

// CreateReview creates a review after validating eligibility and input.
func (s *ReviewService) CreateReview(ctx context.Context, contractID, reviewerID string, overallRating int, qualityRating, communicationRating, timelinessRating, valueRating *int, comment string, photoURLs []string) (*domain.Review, error) {
	// Check eligibility.
	elig, err := s.reviewRepo.CheckReviewEligibility(ctx, contractID, reviewerID)
	if err != nil {
		return nil, fmt.Errorf("create review: %w", err)
	}
	if elig.AlreadyReviewed {
		return nil, fmt.Errorf("create review: %w", domain.ErrAlreadyReviewed)
	}
	if !elig.Eligible {
		return nil, fmt.Errorf("create review: %w", domain.ErrNotEligible)
	}

	// Validate overall rating.
	if overallRating < 1 || overallRating > 5 {
		return nil, fmt.Errorf("create review: overall rating must be between 1 and 5")
	}

	// Validate optional ratings.
	for _, r := range []*int{qualityRating, communicationRating, timelinessRating, valueRating} {
		if r != nil && (*r < 1 || *r > 5) {
			return nil, fmt.Errorf("create review: all ratings must be between 1 and 5")
		}
	}

	// Validate comment length.
	if len(comment) < 50 {
		return nil, fmt.Errorf("create review: comment must be at least 50 characters")
	}

	// Determine direction and reviewee.
	contract, err := s.contractRepo.GetContract(ctx, contractID)
	if err != nil {
		return nil, fmt.Errorf("create review: %w", err)
	}

	var direction, revieweeID string
	if reviewerID == contract.CustomerID {
		direction = "customer_to_provider"
		revieweeID = contract.ProviderID
	} else if reviewerID == contract.ProviderID {
		direction = "provider_to_customer"
		revieweeID = contract.CustomerID
	} else {
		return nil, fmt.Errorf("create review: %w", domain.ErrNotEligible)
	}

	review := &domain.Review{
		ContractID:          contractID,
		ReviewerID:          reviewerID,
		RevieweeID:          revieweeID,
		Direction:           direction,
		OverallRating:       overallRating,
		QualityRating:       qualityRating,
		CommunicationRating: communicationRating,
		TimelinessRating:    timelinessRating,
		ValueRating:         valueRating,
		Comment:             comment,
		PhotoURLs:           photoURLs,
	}

	created, err := s.reviewRepo.CreateReview(ctx, review)
	if err != nil {
		return nil, fmt.Errorf("create review: %w", err)
	}

	// Check if both parties have reviewed and publish if so.
	if err := s.reviewRepo.PublishPendingReviews(ctx, contractID); err != nil {
		slog.Warn("failed to publish pending reviews", "contract_id", contractID, "error", err)
	}

	// Re-fetch to get potentially updated status.
	created, err = s.reviewRepo.GetReview(ctx, created.ID)
	if err != nil {
		slog.Warn("failed to re-fetch review after publish check", "review_id", created.ID, "error", err)
	}

	slog.Info("review created",
		"review_id", created.ID,
		"contract_id", contractID,
		"reviewer_id", reviewerID,
		"direction", direction,
	)

	return created, nil
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
