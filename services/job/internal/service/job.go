package service

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// NotificationSender abstracts sending notifications to users.
// Implemented by the gateway or a gRPC client to the notification service.
type NotificationSender interface {
	SendMatchNotification(ctx context.Context, providerID string, jobID string, jobTitle string, categoryName string, distanceKm float64, matchScorePct int) error
}

// JobService implements job business logic with validation.
type JobService struct {
	repo     domain.JobRepository
	search   *SearchEngine
	matching *MatchingService
	notifier NotificationSender
	// retryQ is optional (ARC-16). When non-nil, Meilisearch failures that
	// exhaust in-process retries are escalated to a Redis-backed durable
	// queue. nil-safe — search still fails soft without Redis.
	retryQ *SearchRetryQueue
}

// NewJobService creates a new job service.
func NewJobService(repo domain.JobRepository, search *SearchEngine) *JobService {
	return &JobService{repo: repo, search: search}
}

// WithSearchRetryQueue attaches the durable Meilisearch retry queue (ARC-16).
// Returns the service for chaining. Safe to call with nil (no-op).
func (s *JobService) WithSearchRetryQueue(q *SearchRetryQueue) *JobService {
	s.retryQ = q
	return s
}

// SetMatchingService wires in the provider matching engine.
// Called separately to avoid circular dependency during initialization.
func (s *JobService) SetMatchingService(matching *MatchingService) {
	s.matching = matching
}

// SetNotifier wires in the notification sender.
func (s *JobService) SetNotifier(notifier NotificationSender) {
	s.notifier = notifier
}

// CreateJob validates input, enforces the 10-draft limit (FR-3.11), and creates a new job.
func (s *JobService) CreateJob(ctx context.Context, input domain.CreateJobInput) (*domain.Job, error) {
	if input.Title == "" {
		return nil, domain.ErrMissingTitle
	}
	if input.Description == "" {
		return nil, domain.ErrMissingDescription
	}
	if input.CategoryID == "" {
		return nil, domain.ErrMissingCategory
	}
	if input.AuctionDurationHours < 0 || input.AuctionDurationHours > 168 {
		return nil, domain.ErrInvalidDuration
	}
	// Validate auction_type against the allowed set before insert so an invalid
	// value (e.g. "open") returns a 400 instead of surfacing the DB CHECK
	// constraint violation as a 500. Empty is allowed — the repository defaults
	// it to "sealed".
	if input.AuctionType != "" {
		if _, ok := domain.ValidAuctionTypes[input.AuctionType]; !ok {
			return nil, domain.ErrInvalidAuctionType
		}
	}
	// Money is positive cents. A negative or zero starting bid (or accepted-offer
	// price) corrupts the reverse auction: the bid handler rejects every positive
	// bid as "exceeds starting bid", leaving a live-looking but un-biddable job.
	if input.StartingBidCents != nil && *input.StartingBidCents <= 0 {
		return nil, domain.ErrInvalidStartingBid
	}
	if input.OfferAcceptedCents != nil && *input.OfferAcceptedCents <= 0 {
		return nil, domain.ErrInvalidStartingBid
	}
	if input.ScheduleType == "" {
		input.ScheduleType = "flexible"
	}

	// FR-3.11: Enforce 10-draft limit.
	if !input.Publish {
		draftCount, err := s.repo.CountDrafts(ctx, input.CustomerID)
		if err != nil {
			return nil, fmt.Errorf("create job count drafts: %w", err)
		}
		if draftCount >= 10 {
			return nil, fmt.Errorf("create job: %w", domain.ErrDraftLimitExceeded)
		}
	}

	job, err := s.repo.CreateJob(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("create job: %w", err)
	}

	if job.Status == "active" && s.search != nil {
		s.indexJobWithRetry(job, "create")
	}

	// Trigger async provider matching for published jobs.
	if job.Status == "active" {
		s.triggerProviderMatching(job)
	}

	slog.Info("job created", "job_id", job.ID, "customer_id", job.CustomerID, "status", job.Status)
	return job, nil
}

// UpdateJob validates and updates a draft job. customerID is the authenticated
// caller; the repository enforces that the caller owns the job.
func (s *JobService) UpdateJob(ctx context.Context, jobID string, customerID string, input domain.UpdateJobInput) (*domain.Job, error) {
	if customerID == "" {
		return nil, fmt.Errorf("update job: %w", domain.ErrNotOwner)
	}
	if input.StartingBidCents != nil && *input.StartingBidCents <= 0 {
		return nil, fmt.Errorf("update job: %w", domain.ErrInvalidStartingBid)
	}
	if input.OfferAcceptedCents != nil && *input.OfferAcceptedCents <= 0 {
		return nil, fmt.Errorf("update job: %w", domain.ErrInvalidStartingBid)
	}
	job, err := s.repo.UpdateJob(ctx, jobID, customerID, input)
	if err != nil {
		return nil, fmt.Errorf("update job: %w", err)
	}
	return job, nil
}

// GetJob retrieves a job by ID.
func (s *JobService) GetJob(ctx context.Context, jobID string) (*domain.Job, error) {
	job, err := s.repo.GetJob(ctx, jobID)
	if err != nil {
		return nil, fmt.Errorf("get job: %w", err)
	}
	return job, nil
}

// GetJobDetail retrieves a full job detail with address visibility.
func (s *JobService) GetJobDetail(ctx context.Context, jobID string, requestingUserID string) (*domain.Job, error) {
	job, err := s.repo.GetJobDetail(ctx, jobID, requestingUserID)
	if err != nil {
		return nil, fmt.Errorf("get job detail: %w", err)
	}
	return job, nil
}

// DeleteDraft soft-deletes a draft job. customerID is the authenticated caller;
// the repository enforces that the caller owns the job.
func (s *JobService) DeleteDraft(ctx context.Context, jobID string, customerID string) error {
	if customerID == "" {
		return fmt.Errorf("delete draft: %w", domain.ErrNotOwner)
	}
	if err := s.repo.DeleteDraft(ctx, jobID, customerID); err != nil {
		return fmt.Errorf("delete draft: %w", err)
	}
	if s.search != nil {
		s.removeJobFromSearchWithRetry(jobID, "deleted draft may remain in search results")
	}
	return nil
}

// PublishJob transitions a draft job to active. customerID is the authenticated
// caller; the repository enforces that the caller owns the job.
func (s *JobService) PublishJob(ctx context.Context, jobID string, customerID string) (*domain.Job, error) {
	if customerID == "" {
		return nil, fmt.Errorf("publish job: %w", domain.ErrNotOwner)
	}
	job, err := s.repo.PublishJob(ctx, jobID, customerID)
	if err != nil {
		return nil, fmt.Errorf("publish job: %w", err)
	}
	if s.search != nil {
		s.indexJobWithRetry(job, "publish")
	}

	// Trigger async provider matching for the newly published job.
	s.triggerProviderMatching(job)

	slog.Info("job published", "job_id", job.ID)
	return job, nil
}

// CloseAuction manually closes an active auction.
func (s *JobService) CloseAuction(ctx context.Context, jobID string, customerID string) (*domain.Job, error) {
	job, err := s.repo.CloseAuction(ctx, jobID, customerID)
	if err != nil {
		return nil, fmt.Errorf("close auction: %w", err)
	}
	if s.search != nil {
		s.removeJobFromSearchWithRetry(jobID, "closed job may remain in search results")
	}
	slog.Info("auction closed", "job_id", job.ID, "status", job.Status)
	return job, nil
}

// CancelJob cancels a job.
func (s *JobService) CancelJob(ctx context.Context, jobID string, customerID string) (*domain.Job, error) {
	job, err := s.repo.CancelJob(ctx, jobID, customerID)
	if err != nil {
		return nil, fmt.Errorf("cancel job: %w", err)
	}
	if s.search != nil {
		s.removeJobFromSearchWithRetry(jobID, "cancelled job may remain in search results")
	}
	slog.Info("job cancelled", "job_id", job.ID)
	return job, nil
}

// GetJobsOnMap returns lightweight map pins for active jobs within a geographic area.
func (s *JobService) GetJobsOnMap(ctx context.Context, input domain.GetJobsOnMapInput) ([]domain.JobMapPin, error) {
	pins, err := s.repo.GetJobsOnMap(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("get jobs on map: %w", err)
	}
	return pins, nil
}

// SearchJobs performs a filtered search of active jobs.
func (s *JobService) SearchJobs(ctx context.Context, input domain.SearchJobsInput) ([]*domain.Job, *domain.Pagination, error) {
	jobs, pagination, err := s.repo.SearchJobs(ctx, input)
	if err != nil {
		return nil, nil, fmt.Errorf("search jobs: %w", err)
	}
	return jobs, pagination, nil
}

// ListCustomerJobs lists jobs for a customer.
func (s *JobService) ListCustomerJobs(ctx context.Context, customerID string, statusFilter *string, propertyID *string, page, pageSize int) ([]*domain.Job, *domain.Pagination, error) {
	jobs, pagination, err := s.repo.ListCustomerJobs(ctx, customerID, statusFilter, propertyID, page, pageSize)
	if err != nil {
		return nil, nil, fmt.Errorf("list customer jobs: %w", err)
	}
	return jobs, pagination, nil
}

// ListDrafts lists draft jobs for a customer.
func (s *JobService) ListDrafts(ctx context.Context, customerID string) ([]*domain.Job, error) {
	drafts, err := s.repo.ListDrafts(ctx, customerID)
	if err != nil {
		return nil, fmt.Errorf("list drafts: %w", err)
	}
	return drafts, nil
}

// ListServiceCategories lists service categories.
func (s *JobService) ListServiceCategories(ctx context.Context, level *int, parentID *string) ([]domain.ServiceCategory, error) {
	cats, err := s.repo.ListServiceCategories(ctx, level, parentID)
	if err != nil {
		return nil, fmt.Errorf("list service categories: %w", err)
	}
	return cats, nil
}

// GetCategoryTree returns all categories for building a tree.
func (s *JobService) GetCategoryTree(ctx context.Context) ([]domain.ServiceCategory, error) {
	cats, err := s.repo.GetCategoryTree(ctx)
	if err != nil {
		return nil, fmt.Errorf("get category tree: %w", err)
	}
	return cats, nil
}

// RepostJob creates a new job from a closed/expired original (FR-3.10).
func (s *JobService) RepostJob(ctx context.Context, jobID, customerID string, updates *domain.UpdateJobInput) (*domain.Job, error) {
	original, err := s.repo.GetJob(ctx, jobID)
	if err != nil {
		return nil, fmt.Errorf("repost job: %w", err)
	}

	if original.CustomerID != customerID {
		return nil, fmt.Errorf("repost job: %w", domain.ErrNotOwner)
	}

	if original.Status != "closed" && original.Status != "closed_zero_bids" && original.Status != "expired" && original.Status != "cancelled" {
		return nil, fmt.Errorf("repost job: %w", domain.ErrNotRepostable)
	}

	// Build create input from the original job, applying any updates.
	input := domain.CreateJobInput{
		CustomerID:           original.CustomerID,
		PropertyID:           original.PropertyID,
		Title:                original.Title,
		Description:          original.Description,
		CategoryID:           original.CategoryID,
		SubcategoryID:        original.SubcategoryID,
		ServiceTypeID:        original.ServiceTypeID,
		ScheduleType:         original.ScheduleType,
		ScheduledDate:        original.ScheduledDate,
		ScheduleRangeStart:   original.ScheduleRangeStart,
		ScheduleRangeEnd:     original.ScheduleRangeEnd,
		IsRecurring:          original.IsRecurring,
		RecurrenceFrequency:  original.RecurrenceFrequency,
		StartingBidCents:     original.StartingBidCents,
		OfferAcceptedCents:   original.OfferAcceptedCents,
		AuctionDurationHours: original.AuctionDurationHours,
		MinProviderRating:    original.MinProviderRating,
		Publish:              true,
	}

	// Apply optional updates (customer may tweak scope / starting bid / duration on repost).
	if updates != nil {
		if updates.Title != nil {
			input.Title = *updates.Title
		}
		if updates.Description != nil {
			input.Description = *updates.Description
		}
		if updates.CategoryID != nil {
			input.CategoryID = *updates.CategoryID
		}
		if updates.StartingBidCents != nil {
			input.StartingBidCents = updates.StartingBidCents
		}
		if updates.OfferAcceptedCents != nil {
			input.OfferAcceptedCents = updates.OfferAcceptedCents
		}
		if updates.AuctionDurationHours != nil {
			input.AuctionDurationHours = *updates.AuctionDurationHours
		}
	}

	newJob, err := s.repo.RepostJob(ctx, jobID, input)
	if err != nil {
		return nil, fmt.Errorf("repost job: %w", err)
	}

	// Increment the original job's repost count.
	if err := s.repo.IncrementRepostCount(ctx, jobID); err != nil {
		slog.Warn("failed to increment repost count", "job_id", jobID, "error", err)
	}

	if s.search != nil {
		s.indexJobWithRetry(newJob, "repost")
	}

	// Trigger async provider matching for the reposted job.
	s.triggerProviderMatching(newJob)

	slog.Info("job reposted",
		"original_job_id", jobID,
		"new_job_id", newJob.ID,
		"customer_id", customerID,
	)
	return newJob, nil
}

// AwardJob awards a job to a provider.
func (s *JobService) AwardJob(ctx context.Context, jobID, customerID, providerID, bidID string) (*domain.Job, error) {
	job, err := s.repo.AwardJob(ctx, jobID, customerID, providerID, bidID)
	if err != nil {
		return nil, fmt.Errorf("award job: %w", err)
	}

	if s.search != nil {
		s.removeJobFromSearchWithRetry(jobID, "awarded job may remain in search results")
	}

	slog.Info("job awarded",
		"job_id", jobID,
		"customer_id", customerID,
		"provider_id", providerID,
		"bid_id", bidID,
	)
	return job, nil
}

// MarkReviewed transitions a completed job to the reviewed state.
func (s *JobService) MarkReviewed(ctx context.Context, jobID string) (*domain.Job, error) {
	job, err := s.repo.MarkReviewed(ctx, jobID)
	if err != nil {
		return nil, fmt.Errorf("mark reviewed: %w", err)
	}

	slog.Info("job marked reviewed", "job_id", jobID)
	return job, nil
}

// AdminListJobs lists jobs for admin with optional filters.
func (s *JobService) AdminListJobs(ctx context.Context, statusFilter *string, categoryID *string, customerID *string, page, pageSize int) ([]*domain.Job, *domain.Pagination, error) {
	jobs, pagination, err := s.repo.AdminListJobs(ctx, statusFilter, categoryID, customerID, page, pageSize)
	if err != nil {
		return nil, nil, fmt.Errorf("admin list jobs: %w", err)
	}
	return jobs, pagination, nil
}

// AdminSuspendJob suspends a job and records an audit log entry.
func (s *JobService) AdminSuspendJob(ctx context.Context, jobID, reason, adminID string) error {
	if err := s.repo.AdminSuspendJob(ctx, jobID, reason); err != nil {
		return fmt.Errorf("admin suspend job: %w", err)
	}

	if s.search != nil {
		s.removeJobFromSearchWithRetry(jobID, "suspended job may remain in search results")
	}

	if err := s.repo.InsertAuditLog(ctx, adminID, "suspend_job", "job", jobID, map[string]any{
		"reason": reason,
	}); err != nil {
		slog.Error("failed to insert audit log for job suspension", "job_id", jobID, "admin_id", adminID, "error", err)
	}

	slog.Info("job suspended by admin", "job_id", jobID, "admin_id", adminID, "reason", reason)
	return nil
}

// AdminRemoveJob removes a job (sets status to cancelled) and records an audit log entry.
func (s *JobService) AdminRemoveJob(ctx context.Context, jobID, reason, adminID string) error {
	if err := s.repo.AdminRemoveJob(ctx, jobID, reason); err != nil {
		return fmt.Errorf("admin remove job: %w", err)
	}

	if s.search != nil {
		s.removeJobFromSearchWithRetry(jobID, "removed job may remain in search results")
	}

	if err := s.repo.InsertAuditLog(ctx, adminID, "remove_job", "job", jobID, map[string]any{
		"reason": reason,
	}); err != nil {
		slog.Error("failed to insert audit log for job removal", "job_id", jobID, "admin_id", adminID, "error", err)
	}

	slog.Info("job removed by admin", "job_id", jobID, "admin_id", adminID, "reason", reason)
	return nil
}

// indexJobWithRetry attempts to index a job in Meilisearch with up to 3 retries
// using exponential backoff (1s, 2s, 4s). Runs in a goroutine so it does not
// block the response to the caller. On exhaustion, escalates to the durable
// Redis retry queue (ARC-16) when wired; otherwise dead-letters with metric.
func (s *JobService) indexJobWithRetry(job *domain.Job, operation string) {
	jobID := job.ID

	go func() {
		const maxAttempts = 3

		ctx := context.Background()

		for attempt := 1; attempt <= maxAttempts; attempt++ {
			err := s.search.IndexJob(ctx, job)
			if err == nil {
				if attempt > 1 {
					slog.Info("search index succeeded after retry",
						"job_id", jobID,
						"operation", operation,
						"attempt", attempt,
					)
				}
				return
			}

			if attempt == maxAttempts {
				slog.Error("SEARCH INDEX FAILED — escalating to durable retry (in-process retries exhausted)",
					"job_id", jobID,
					"operation", operation,
					"attempts", maxAttempts,
					"error", err,
				)
				escalateToDurableQueue(s.retryQ, SearchRetryTask{
					Index:     searchRetryIndexJobs,
					Op:        searchRetryOpIndex,
					EntityID:  jobID,
					Operation: operation,
				})
				return
			}

			backoff := time.Duration(1<<(attempt-1)) * time.Second // 1s, 2s
			slog.Warn("search index failed, retrying",
				"job_id", jobID,
				"operation", operation,
				"attempt", attempt,
				"next_retry_in", backoff,
				"error", err,
			)
			time.Sleep(backoff)
		}
	}()
}

// removeJobFromSearchWithRetry attempts to delete a job from the Meilisearch
// index with up to 3 retries (exponential backoff 1s, 2s, 4s). Runs in a
// goroutine. On exhaustion, escalates to the durable Redis retry queue
// (ARC-16) when wired; otherwise dead-letters with metric + ERROR log.
func (s *JobService) removeJobFromSearchWithRetry(jobID, operation string) {
	go func() {
		const maxAttempts = 3

		ctx := context.Background()

		for attempt := 1; attempt <= maxAttempts; attempt++ {
			err := s.search.RemoveJob(ctx, jobID)
			if err == nil {
				if attempt > 1 {
					slog.Info("search remove succeeded after retry",
						"job_id", jobID,
						"operation", operation,
						"attempt", attempt,
					)
				}
				return
			}

			if attempt == maxAttempts {
				slog.Error("SEARCH REMOVAL FAILED — escalating to durable retry (in-process retries exhausted)",
					"job_id", jobID,
					"operation", operation,
					"attempts", maxAttempts,
					"error", err,
				)
				escalateToDurableQueue(s.retryQ, SearchRetryTask{
					Index:     searchRetryIndexJobs,
					Op:        searchRetryOpRemove,
					EntityID:  jobID,
					Operation: operation,
				})
				return
			}

			backoff := time.Duration(1<<(attempt-1)) * time.Second
			slog.Warn("search remove failed, retrying",
				"job_id", jobID,
				"operation", operation,
				"attempt", attempt,
				"next_retry_in", backoff,
				"error", err,
			)
			time.Sleep(backoff)
		}
	}()
}

// triggerProviderMatching starts an asynchronous goroutine that finds matching
// providers for a job and sends each a notification. Errors are logged but do
// not fail the parent operation — matching is best-effort.
func (s *JobService) triggerProviderMatching(job *domain.Job) {
	if s.matching == nil {
		return
	}

	// Capture values for the goroutine. We intentionally use context.Background()
	// because the parent HTTP/gRPC request context may be cancelled before the
	// async matching completes.
	jobID := job.ID
	categoryID := job.CategoryID
	jobTitle := job.Title
	categoryName := ""
	if job.Category != nil {
		categoryName = job.Category.Name
	}

	go func() {
		ctx := context.Background()

		matches, err := s.matching.FindMatchingProviders(ctx, jobID, categoryID, 0, 0, defaultMaxProviders)
		if err != nil {
			slog.Error("provider matching failed",
				"job_id", jobID,
				"error", err,
			)
			return
		}

		if len(matches) == 0 {
			slog.Info("no matching providers found", "job_id", jobID)
			return
		}

		for _, m := range matches {
			s.notifyProviderOfMatch(ctx, m, jobID, jobTitle, categoryName)
		}

		slog.Info("provider match notifications sent",
			"job_id", jobID,
			"providers_notified", len(matches),
		)
	}()
}

// notifyProviderOfMatch sends a match notification to a single provider.
func (s *JobService) notifyProviderOfMatch(ctx context.Context, match domain.MatchedProvider, jobID, jobTitle, categoryName string) {
	if s.notifier == nil {
		slog.Warn("notification sender not configured — skipping match notification",
			"provider_id", match.ProviderID,
			"job_id", jobID,
		)
		return
	}

	matchScorePct := int(math.Round(match.MatchScore * 100))

	if err := s.notifier.SendMatchNotification(
		ctx,
		match.ProviderID,
		jobID,
		jobTitle,
		categoryName,
		match.DistanceKm,
		matchScorePct,
	); err != nil {
		slog.Error("failed to send match notification",
			"provider_id", match.ProviderID,
			"job_id", jobID,
			"error", err,
		)
	}
}
