package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// JobService implements job business logic with validation.
type JobService struct {
	repo   domain.JobRepository
	search *SearchEngine
}

// NewJobService creates a new job service.
func NewJobService(repo domain.JobRepository, search *SearchEngine) *JobService {
	return &JobService{repo: repo, search: search}
}

// CreateJob validates input and creates a new job.
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
	if input.ScheduleType == "" {
		input.ScheduleType = "flexible"
	}

	job, err := s.repo.CreateJob(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("create job: %w", err)
	}

	if job.Status == "active" && s.search != nil {
		if indexErr := s.search.IndexJob(ctx, job); indexErr != nil {
			slog.Warn("failed to index job in search", "job_id", job.ID, "error", indexErr)
		}
	}

	slog.Info("job created", "job_id", job.ID, "customer_id", job.CustomerID, "status", job.Status)
	return job, nil
}

// UpdateJob validates and updates a draft job.
func (s *JobService) UpdateJob(ctx context.Context, jobID string, input domain.UpdateJobInput) (*domain.Job, error) {
	job, err := s.repo.UpdateJob(ctx, jobID, input)
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

// DeleteDraft soft-deletes a draft job.
func (s *JobService) DeleteDraft(ctx context.Context, jobID string) error {
	if err := s.repo.DeleteDraft(ctx, jobID); err != nil {
		return fmt.Errorf("delete draft: %w", err)
	}
	if s.search != nil {
		if removeErr := s.search.RemoveJob(ctx, jobID); removeErr != nil {
			slog.Warn("failed to remove job from search", "job_id", jobID, "error", removeErr)
		}
	}
	return nil
}

// PublishJob transitions a draft job to active.
func (s *JobService) PublishJob(ctx context.Context, jobID string) (*domain.Job, error) {
	job, err := s.repo.PublishJob(ctx, jobID)
	if err != nil {
		return nil, fmt.Errorf("publish job: %w", err)
	}
	if s.search != nil {
		if indexErr := s.search.IndexJob(ctx, job); indexErr != nil {
			slog.Warn("failed to index published job in search", "job_id", job.ID, "error", indexErr)
		}
	}
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
		if removeErr := s.search.RemoveJob(ctx, jobID); removeErr != nil {
			slog.Warn("failed to remove closed job from search", "job_id", jobID, "error", removeErr)
		}
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
		if removeErr := s.search.RemoveJob(ctx, jobID); removeErr != nil {
			slog.Warn("failed to remove cancelled job from search", "job_id", jobID, "error", removeErr)
		}
	}
	slog.Info("job cancelled", "job_id", job.ID)
	return job, nil
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
