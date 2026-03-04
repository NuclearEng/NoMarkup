package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// CreateReview inserts a new review with status 'pending'.
func (r *PostgresRepository) CreateReview(ctx context.Context, review *domain.Review) (*domain.Review, error) {
	// Compute review_window_ends_at from contract completed_at + 14 days.
	var completedAt *time.Time
	err := r.pool.QueryRow(ctx,
		`SELECT completed_at FROM contracts WHERE id = $1`, review.ContractID).Scan(&completedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("create review: %w", domain.ErrContractNotFound)
		}
		return nil, fmt.Errorf("create review lookup contract: %w", err)
	}
	if completedAt == nil {
		return nil, fmt.Errorf("create review: contract is not completed")
	}
	windowEndsAt := completedAt.Add(14 * 24 * time.Hour)

	var reviewID string
	var createdAt, updatedAt time.Time
	err = r.pool.QueryRow(ctx, `
		INSERT INTO reviews (
			contract_id, reviewer_id, reviewee_id, direction,
			overall_rating, quality_rating, communication_rating,
			timeliness_rating, value_rating,
			comment, photo_urls, status, is_flagged, review_window_ends_at
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7,
			$8, $9,
			$10, $11, 'pending', false, $12
		)
		RETURNING id, created_at, updated_at`,
		review.ContractID, review.ReviewerID, review.RevieweeID, review.Direction,
		review.OverallRating, review.QualityRating, review.CommunicationRating,
		review.TimelinessRating, review.ValueRating,
		review.Comment, review.PhotoURLs, windowEndsAt,
	).Scan(&reviewID, &createdAt, &updatedAt)
	if err != nil {
		return nil, fmt.Errorf("create review insert: %w", err)
	}

	return r.GetReview(ctx, reviewID)
}

// GetReview retrieves a review with its response (LEFT JOIN).
func (r *PostgresRepository) GetReview(ctx context.Context, reviewID string) (*domain.Review, error) {
	var rev domain.Review
	var qualityRating, communicationRating, timelinessRating, valueRating *int
	var photoURLs []string

	// Review fields + optional response via LEFT JOIN.
	var respID, respReviewID, respResponderID, respComment *string
	var respCreatedAt *time.Time

	err := r.pool.QueryRow(ctx, `
		SELECT r.id, r.contract_id, r.reviewer_id, r.reviewee_id, r.direction,
		       r.overall_rating, r.quality_rating, r.communication_rating,
		       r.timeliness_rating, r.value_rating,
		       r.comment, r.photo_urls, r.status, r.is_flagged,
		       r.review_window_ends_at, r.created_at, r.updated_at,
		       rr.id, rr.review_id, rr.responder_id, rr.comment, rr.created_at
		FROM reviews r
		LEFT JOIN review_responses rr ON rr.review_id = r.id
		WHERE r.id = $1`, reviewID).Scan(
		&rev.ID, &rev.ContractID, &rev.ReviewerID, &rev.RevieweeID, &rev.Direction,
		&rev.OverallRating, &qualityRating, &communicationRating,
		&timelinessRating, &valueRating,
		&rev.Comment, &photoURLs, &rev.Status, &rev.IsFlagged,
		&rev.ReviewWindowEndsAt, &rev.CreatedAt, &rev.UpdatedAt,
		&respID, &respReviewID, &respResponderID, &respComment, &respCreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get review: %w", domain.ErrReviewNotFound)
		}
		return nil, fmt.Errorf("get review: %w", err)
	}

	rev.QualityRating = qualityRating
	rev.CommunicationRating = communicationRating
	rev.TimelinessRating = timelinessRating
	rev.ValueRating = valueRating
	rev.PhotoURLs = photoURLs

	if respID != nil {
		rev.Response = &domain.ReviewResponse{
			ID:          *respID,
			ReviewID:    *respReviewID,
			ResponderID: *respResponderID,
			Comment:     *respComment,
			CreatedAt:   *respCreatedAt,
		}
	}

	return &rev, nil
}

// ListReviewsForUser lists published reviews where the user is the reviewee,
// with optional direction filter, pagination, and returns avg rating + count.
func (r *PostgresRepository) ListReviewsForUser(ctx context.Context, userID string, directionFilter *string, page, pageSize int) ([]*domain.Review, *domain.Pagination, float64, int, error) {
	where := "r.reviewee_id = $1 AND r.status = 'published'"
	args := []interface{}{userID}
	argIdx := 2

	if directionFilter != nil && *directionFilter != "" {
		where += fmt.Sprintf(" AND r.direction = $%d", argIdx)
		args = append(args, *directionFilter)
		argIdx++
	}

	// Count and average.
	var totalCount int
	var avgRating float64
	err := r.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT COUNT(*), COALESCE(AVG(r.overall_rating), 0) FROM reviews r WHERE %s`, where),
		args...).Scan(&totalCount, &avgRating)
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("list reviews for user count: %w", err)
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	totalPages := 0
	if totalCount > 0 {
		totalPages = (totalCount + pageSize - 1) / pageSize
	}
	offset := (page - 1) * pageSize

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, fmt.Sprintf(`
		SELECT r.id, r.contract_id, r.reviewer_id, r.reviewee_id, r.direction,
		       r.overall_rating, r.quality_rating, r.communication_rating,
		       r.timeliness_rating, r.value_rating,
		       r.comment, r.photo_urls, r.status, r.is_flagged,
		       r.review_window_ends_at, r.created_at, r.updated_at,
		       rr.id, rr.review_id, rr.responder_id, rr.comment, rr.created_at
		FROM reviews r
		LEFT JOIN review_responses rr ON rr.review_id = r.id
		WHERE %s
		ORDER BY r.created_at DESC
		LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1), args...)
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("list reviews for user query: %w", err)
	}
	defer rows.Close()

	var reviews []*domain.Review
	for rows.Next() {
		rev, err := scanReviewRow(rows)
		if err != nil {
			return nil, nil, 0, 0, fmt.Errorf("list reviews for user scan: %w", err)
		}
		reviews = append(reviews, rev)
	}

	return reviews, &domain.Pagination{
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasNext:    page < totalPages,
	}, avgRating, totalCount, nil
}

// ListReviewsByUser lists published reviews where the user is the reviewer.
func (r *PostgresRepository) ListReviewsByUser(ctx context.Context, userID string, page, pageSize int) ([]*domain.Review, *domain.Pagination, error) {
	var totalCount int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM reviews WHERE reviewer_id = $1 AND status = 'published'`, userID).Scan(&totalCount)
	if err != nil {
		return nil, nil, fmt.Errorf("list reviews by user count: %w", err)
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	totalPages := 0
	if totalCount > 0 {
		totalPages = (totalCount + pageSize - 1) / pageSize
	}
	offset := (page - 1) * pageSize

	rows, err := r.pool.Query(ctx, `
		SELECT r.id, r.contract_id, r.reviewer_id, r.reviewee_id, r.direction,
		       r.overall_rating, r.quality_rating, r.communication_rating,
		       r.timeliness_rating, r.value_rating,
		       r.comment, r.photo_urls, r.status, r.is_flagged,
		       r.review_window_ends_at, r.created_at, r.updated_at,
		       rr.id, rr.review_id, rr.responder_id, rr.comment, rr.created_at
		FROM reviews r
		LEFT JOIN review_responses rr ON rr.review_id = r.id
		WHERE r.reviewer_id = $1 AND r.status = 'published'
		ORDER BY r.created_at DESC
		LIMIT $2 OFFSET $3`, userID, pageSize, offset)
	if err != nil {
		return nil, nil, fmt.Errorf("list reviews by user query: %w", err)
	}
	defer rows.Close()

	var reviews []*domain.Review
	for rows.Next() {
		rev, err := scanReviewRow(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("list reviews by user scan: %w", err)
		}
		reviews = append(reviews, rev)
	}

	return reviews, &domain.Pagination{
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasNext:    page < totalPages,
	}, nil
}

// CreateReviewResponse inserts a response to a review, ensuring one response per review.
func (r *PostgresRepository) CreateReviewResponse(ctx context.Context, resp *domain.ReviewResponse) (*domain.ReviewResponse, error) {
	// Verify review exists.
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM reviews WHERE id = $1)`, resp.ReviewID).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("create review response check review: %w", err)
	}
	if !exists {
		return nil, fmt.Errorf("create review response: %w", domain.ErrReviewNotFound)
	}

	// Check if already responded.
	var alreadyResponded bool
	err = r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM review_responses WHERE review_id = $1)`, resp.ReviewID).Scan(&alreadyResponded)
	if err != nil {
		return nil, fmt.Errorf("create review response check existing: %w", err)
	}
	if alreadyResponded {
		return nil, fmt.Errorf("create review response: %w", domain.ErrAlreadyResponded)
	}

	var id string
	var createdAt time.Time
	err = r.pool.QueryRow(ctx, `
		INSERT INTO review_responses (review_id, responder_id, comment)
		VALUES ($1, $2, $3)
		RETURNING id, created_at`,
		resp.ReviewID, resp.ResponderID, resp.Comment,
	).Scan(&id, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("create review response insert: %w", err)
	}

	return &domain.ReviewResponse{
		ID:          id,
		ReviewID:    resp.ReviewID,
		ResponderID: resp.ResponderID,
		Comment:     resp.Comment,
		CreatedAt:   createdAt,
	}, nil
}

// FlagReview inserts a review flag and updates the review's is_flagged field.
func (r *PostgresRepository) FlagReview(ctx context.Context, flag *domain.ReviewFlag) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("flag review begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Verify review exists.
	var exists bool
	err = tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM reviews WHERE id = $1)`, flag.ReviewID).Scan(&exists)
	if err != nil {
		return "", fmt.Errorf("flag review check review: %w", err)
	}
	if !exists {
		return "", fmt.Errorf("flag review: %w", domain.ErrReviewNotFound)
	}

	var flagID string
	err = tx.QueryRow(ctx, `
		INSERT INTO review_flags (review_id, flagged_by, reason, details, status)
		VALUES ($1, $2, $3, $4, 'pending')
		RETURNING id`,
		flag.ReviewID, flag.FlaggedBy, flag.Reason, flag.Details,
	).Scan(&flagID)
	if err != nil {
		return "", fmt.Errorf("flag review insert: %w", err)
	}

	_, err = tx.Exec(ctx, `
		UPDATE reviews SET is_flagged = true, updated_at = now()
		WHERE id = $1`, flag.ReviewID)
	if err != nil {
		return "", fmt.Errorf("flag review update review: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("flag review commit: %w", err)
	}

	return flagID, nil
}

// CheckReviewEligibility checks whether a user can review a contract.
func (r *PostgresRepository) CheckReviewEligibility(ctx context.Context, contractID, userID string) (*domain.ReviewEligibility, error) {
	// Get contract details.
	var customerID, providerID, status string
	var completedAt *time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT customer_id, provider_id, status, completed_at
		FROM contracts WHERE id = $1`, contractID).
		Scan(&customerID, &providerID, &status, &completedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("check eligibility: %w", domain.ErrContractNotFound)
		}
		return nil, fmt.Errorf("check eligibility lookup contract: %w", err)
	}

	// User must be party to the contract.
	if userID != customerID && userID != providerID {
		return &domain.ReviewEligibility{Eligible: false}, nil
	}

	// Contract must be completed.
	if status != "completed" || completedAt == nil {
		return &domain.ReviewEligibility{Eligible: false}, nil
	}

	windowCloses := completedAt.Add(14 * 24 * time.Hour)

	// Check if already reviewed.
	var alreadyReviewed bool
	err = r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM reviews WHERE contract_id = $1 AND reviewer_id = $2)`,
		contractID, userID).Scan(&alreadyReviewed)
	if err != nil {
		return nil, fmt.Errorf("check eligibility check existing: %w", err)
	}

	if alreadyReviewed {
		return &domain.ReviewEligibility{
			Eligible:        false,
			AlreadyReviewed: true,
			WindowClosesAt:  windowCloses,
		}, nil
	}

	// Check window.
	if time.Now().After(windowCloses) {
		return &domain.ReviewEligibility{
			Eligible:       false,
			WindowClosesAt: windowCloses,
		}, nil
	}

	return &domain.ReviewEligibility{
		Eligible:       true,
		WindowClosesAt: windowCloses,
	}, nil
}

// PublishPendingReviews checks if both reviews exist for a contract or the window has expired,
// and if so, publishes all pending reviews for that contract.
func (r *PostgresRepository) PublishPendingReviews(ctx context.Context, contractID string) error {
	// Count pending reviews for this contract.
	var pendingCount int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM reviews WHERE contract_id = $1 AND status = 'pending'`,
		contractID).Scan(&pendingCount)
	if err != nil {
		return fmt.Errorf("publish pending reviews count: %w", err)
	}

	if pendingCount == 0 {
		return nil
	}

	// Check if both reviews exist (pending or published).
	var totalCount int
	err = r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM reviews WHERE contract_id = $1`,
		contractID).Scan(&totalCount)
	if err != nil {
		return fmt.Errorf("publish pending reviews total count: %w", err)
	}

	shouldPublish := false

	if totalCount >= 2 {
		// Both parties have reviewed.
		shouldPublish = true
	} else {
		// Check if the window has expired.
		var completedAt *time.Time
		err = r.pool.QueryRow(ctx,
			`SELECT completed_at FROM contracts WHERE id = $1`, contractID).Scan(&completedAt)
		if err != nil {
			return fmt.Errorf("publish pending reviews lookup contract: %w", err)
		}
		if completedAt != nil {
			windowCloses := completedAt.Add(14 * 24 * time.Hour)
			if time.Now().After(windowCloses) {
				shouldPublish = true
			}
		}
	}

	if shouldPublish {
		_, err = r.pool.Exec(ctx, `
			UPDATE reviews SET status = 'published', updated_at = now()
			WHERE contract_id = $1 AND status = 'pending'`, contractID)
		if err != nil {
			return fmt.Errorf("publish pending reviews update: %w", err)
		}
	}

	return nil
}

// ComputeAverageRating computes the average overall rating and count for a user.
func (r *PostgresRepository) ComputeAverageRating(ctx context.Context, userID string) (float64, int, error) {
	var avg float64
	var count int
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(overall_rating), 0), COUNT(*)
		FROM reviews
		WHERE reviewee_id = $1 AND status = 'published'`, userID).Scan(&avg, &count)
	if err != nil {
		return 0, 0, fmt.Errorf("compute average rating: %w", err)
	}
	return avg, count, nil
}

// AdminListFlaggedReviews lists review flags with their associated reviews, with optional status filter.
func (r *PostgresRepository) AdminListFlaggedReviews(ctx context.Context, statusFilter *string, page, pageSize int) ([]domain.FlaggedReviewWithFlag, *domain.Pagination, error) {
	where := "1=1"
	args := []interface{}{}
	argIdx := 1

	if statusFilter != nil && *statusFilter != "" {
		where = fmt.Sprintf("rf.status = $%d", argIdx)
		args = append(args, *statusFilter)
		argIdx++
	}

	var totalCount int
	err := r.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT COUNT(*) FROM review_flags rf WHERE %s`, where), args...).Scan(&totalCount)
	if err != nil {
		return nil, nil, fmt.Errorf("admin list flagged reviews count: %w", err)
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	totalPages := 0
	if totalCount > 0 {
		totalPages = (totalCount + pageSize - 1) / pageSize
	}
	offset := (page - 1) * pageSize

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, fmt.Sprintf(`
		SELECT rf.id, rf.review_id, rf.flagged_by, rf.reason, rf.details, rf.status,
		       rf.resolved_by, rf.resolution_notes, rf.created_at, rf.resolved_at,
		       rev.id, rev.contract_id, rev.reviewer_id, rev.reviewee_id, rev.direction,
		       rev.overall_rating, rev.quality_rating, rev.communication_rating,
		       rev.timeliness_rating, rev.value_rating,
		       rev.comment, rev.photo_urls, rev.status, rev.is_flagged,
		       rev.review_window_ends_at, rev.created_at, rev.updated_at
		FROM review_flags rf
		JOIN reviews rev ON rev.id = rf.review_id
		WHERE %s
		ORDER BY rf.created_at DESC
		LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1), args...)
	if err != nil {
		return nil, nil, fmt.Errorf("admin list flagged reviews query: %w", err)
	}
	defer rows.Close()

	var results []domain.FlaggedReviewWithFlag
	for rows.Next() {
		var flag domain.ReviewFlag
		var rev domain.Review
		var qualityRating, communicationRating, timelinessRating, valueRating *int
		var photoURLs []string

		err := rows.Scan(
			&flag.ID, &flag.ReviewID, &flag.FlaggedBy, &flag.Reason, &flag.Details, &flag.Status,
			&flag.ResolvedBy, &flag.ResolutionNotes, &flag.FlaggedAt, &flag.ResolvedAt,
			&rev.ID, &rev.ContractID, &rev.ReviewerID, &rev.RevieweeID, &rev.Direction,
			&rev.OverallRating, &qualityRating, &communicationRating,
			&timelinessRating, &valueRating,
			&rev.Comment, &photoURLs, &rev.Status, &rev.IsFlagged,
			&rev.ReviewWindowEndsAt, &rev.CreatedAt, &rev.UpdatedAt,
		)
		if err != nil {
			return nil, nil, fmt.Errorf("admin list flagged reviews scan: %w", err)
		}

		rev.QualityRating = qualityRating
		rev.CommunicationRating = communicationRating
		rev.TimelinessRating = timelinessRating
		rev.ValueRating = valueRating
		rev.PhotoURLs = photoURLs

		results = append(results, domain.FlaggedReviewWithFlag{
			Flag:   flag,
			Review: rev,
		})
	}

	return results, &domain.Pagination{
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasNext:    page < totalPages,
	}, nil
}

// AdminRemoveReview sets a review's status to 'removed' and records the admin action.
func (r *PostgresRepository) AdminRemoveReview(ctx context.Context, reviewID, reason, adminID string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE reviews SET status = 'removed', updated_at = now()
		 WHERE id = $1 AND status != 'removed'`,
		reviewID)
	if err != nil {
		return fmt.Errorf("admin remove review: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		_ = r.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM reviews WHERE id = $1)`, reviewID).Scan(&exists)
		if !exists {
			return fmt.Errorf("admin remove review: %w", domain.ErrReviewNotFound)
		}
		return fmt.Errorf("admin remove review: %w", domain.ErrReviewAlreadyRemoved)
	}
	return nil
}

// AdminResolveFlag resolves a review flag. If upheld, the associated review is removed.
// Returns the resulting flag status string.
func (r *PostgresRepository) AdminResolveFlag(ctx context.Context, flagID, adminID string, uphold bool, resolutionNotes string) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("admin resolve flag begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get the flag and verify it's pending.
	var reviewID, currentStatus string
	err = tx.QueryRow(ctx,
		`SELECT review_id, status FROM review_flags WHERE id = $1`, flagID).
		Scan(&reviewID, &currentStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("admin resolve flag: %w", domain.ErrFlagNotFound)
		}
		return "", fmt.Errorf("admin resolve flag lookup: %w", err)
	}
	if currentStatus != "pending" {
		return "", fmt.Errorf("admin resolve flag: %w", domain.ErrFlagAlreadyResolved)
	}

	newStatus := "dismissed"
	if uphold {
		newStatus = "upheld"
	}

	// Update the flag.
	_, err = tx.Exec(ctx,
		`UPDATE review_flags SET status = $1, resolved_by = $2, resolution_notes = $3, resolved_at = now()
		 WHERE id = $4`,
		newStatus, adminID, resolutionNotes, flagID)
	if err != nil {
		return "", fmt.Errorf("admin resolve flag update: %w", err)
	}

	// If upheld, remove the review and recalculate the reviewee's rating.
	if uphold {
		// Get the reviewee before removing.
		var revieweeID string
		err = tx.QueryRow(ctx,
			`SELECT reviewee_id FROM reviews WHERE id = $1`, reviewID).Scan(&revieweeID)
		if err != nil {
			return "", fmt.Errorf("admin resolve flag get reviewee: %w", err)
		}

		_, err = tx.Exec(ctx,
			`UPDATE reviews SET status = 'removed', updated_at = now()
			 WHERE id = $1 AND status != 'removed'`,
			reviewID)
		if err != nil {
			return "", fmt.Errorf("admin resolve flag remove review: %w", err)
		}

		// Recalculate the reviewee's average rating within the transaction.
		var avgRating float64
		var count int
		err = tx.QueryRow(ctx, `
			SELECT COALESCE(AVG(overall_rating), 0), COUNT(*)
			FROM reviews
			WHERE reviewee_id = $1 AND status = 'published'`, revieweeID).Scan(&avgRating, &count)
		if err != nil {
			return "", fmt.Errorf("admin resolve flag recalculate rating: %w", err)
		}

		_, err = tx.Exec(ctx, `
			UPDATE users SET average_rating = $1, total_reviews = $2, updated_at = now()
			WHERE id = $3`, avgRating, count, revieweeID)
		if err != nil {
			return "", fmt.Errorf("admin resolve flag update user rating: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("admin resolve flag commit: %w", err)
	}

	return newStatus, nil
}

// RecalculateProviderRating recomputes the average rating for a provider
// based on their remaining published reviews.
func (r *PostgresRepository) RecalculateProviderRating(ctx context.Context, providerID string) error {
	var avgRating float64
	var count int
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(overall_rating), 0), COUNT(*)
		FROM reviews
		WHERE reviewee_id = $1 AND status = 'published'`, providerID).Scan(&avgRating, &count)
	if err != nil {
		return fmt.Errorf("recalculate provider rating query: %w", err)
	}

	_, err = r.pool.Exec(ctx, `
		UPDATE users SET average_rating = $1, total_reviews = $2, updated_at = now()
		WHERE id = $3`,
		avgRating, count, providerID)
	if err != nil {
		return fmt.Errorf("recalculate provider rating update: %w", err)
	}

	return nil
}

// scanReviewRow scans a review row including optional LEFT JOIN review_responses columns.
func scanReviewRow(rows pgx.Rows) (*domain.Review, error) {
	var rev domain.Review
	var qualityRating, communicationRating, timelinessRating, valueRating *int
	var photoURLs []string
	var respID, respReviewID, respResponderID, respComment *string
	var respCreatedAt *time.Time

	err := rows.Scan(
		&rev.ID, &rev.ContractID, &rev.ReviewerID, &rev.RevieweeID, &rev.Direction,
		&rev.OverallRating, &qualityRating, &communicationRating,
		&timelinessRating, &valueRating,
		&rev.Comment, &photoURLs, &rev.Status, &rev.IsFlagged,
		&rev.ReviewWindowEndsAt, &rev.CreatedAt, &rev.UpdatedAt,
		&respID, &respReviewID, &respResponderID, &respComment, &respCreatedAt,
	)
	if err != nil {
		return nil, err
	}

	rev.QualityRating = qualityRating
	rev.CommunicationRating = communicationRating
	rev.TimelinessRating = timelinessRating
	rev.ValueRating = valueRating
	rev.PhotoURLs = photoURLs

	if respID != nil {
		rev.Response = &domain.ReviewResponse{
			ID:          *respID,
			ReviewID:    *respReviewID,
			ResponderID: *respResponderID,
			Comment:     *respComment,
			CreatedAt:   *respCreatedAt,
		}
	}

	return &rev, nil
}
