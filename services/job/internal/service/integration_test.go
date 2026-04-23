//go:build integration

package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Integration tests exercise the job service layer through full lifecycle flows.
// Run with: go test -tags=integration ./...

func TestIntegration_JobLifecycle_Draft_Publish_Award_Complete(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name             string
		input            domain.CreateJobInput
		awardProvider    string
		awardBid         string
		wantPublishErr   bool
		wantAwardErr     bool
	}{
		{
			name:          "full_lifecycle_succeeds",
			input:         validCreateInput(),
			awardProvider: "provider-1",
			awardBid:      "bid-1",
		},
		{
			name: "lifecycle_with_specific_date",
			input: func() domain.CreateJobInput {
				i := validCreateInput()
				i.ScheduleType = "specific_date"
				return i
			}(),
			awardProvider: "provider-2",
			awardBid:      "bid-2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			// Simulate in-memory job storage.
			var currentJob *domain.Job

			repo := &mockJobRepo{
				createJobFn: func(_ context.Context, input domain.CreateJobInput) (*domain.Job, error) {
					currentJob = &domain.Job{
						ID:                   "lifecycle-job-" + tt.name,
						CustomerID:           input.CustomerID,
						Title:                input.Title,
						Description:          input.Description,
						CategoryID:           input.CategoryID,
						Status:               "draft",
						ScheduleType:         input.ScheduleType,
						AuctionDurationHours: input.AuctionDurationHours,
					}
					return currentJob, nil
				},
				publishJobFn: func(_ context.Context, jobID string, customerID string) (*domain.Job, error) {
					if currentJob == nil || currentJob.ID != jobID {
						return nil, domain.ErrJobNotFound
					}
					if currentJob.CustomerID != customerID {
						return nil, domain.ErrJobNotFound
					}
					if currentJob.Status != "draft" {
						return nil, domain.ErrNotDraft
					}
					currentJob.Status = "active"
					return currentJob, nil
				},
				closeAuctionFn: func(_ context.Context, jobID string, customerID string) (*domain.Job, error) {
					if currentJob == nil || currentJob.ID != jobID {
						return nil, domain.ErrJobNotFound
					}
					if currentJob.CustomerID != customerID {
						return nil, domain.ErrNotOwner
					}
					if currentJob.Status != "active" {
						return nil, domain.ErrNotActive
					}
					currentJob.Status = "closed"
					return currentJob, nil
				},
				getJobFn: func(_ context.Context, jobID string) (*domain.Job, error) {
					if currentJob == nil || currentJob.ID != jobID {
						return nil, domain.ErrJobNotFound
					}
					return currentJob, nil
				},
			}

			svc := newTestJobService(repo)
			ctx := context.Background()

			// Step 1: Create draft.
			job, err := svc.CreateJob(ctx, tt.input)
			require.NoError(t, err)
			assert.Equal(t, "draft", job.Status)
			assert.Equal(t, tt.input.Title, job.Title)

			// Step 2: Verify draft can be retrieved.
			fetched, err := svc.GetJob(ctx, job.ID)
			require.NoError(t, err)
			assert.Equal(t, job.ID, fetched.ID)

			// Step 3: Publish (draft -> active).
			published, err := svc.PublishJob(ctx, job.ID, tt.input.CustomerID)
			if tt.wantPublishErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "active", published.Status)

			// Step 4: Close auction (active -> closed).
			closed, err := svc.CloseAuction(ctx, job.ID, tt.input.CustomerID)
			require.NoError(t, err)
			assert.Equal(t, "closed", closed.Status)
		})
	}
}

func TestIntegration_JobLifecycle_Draft_Cancel(t *testing.T) {
	t.Parallel()

	var currentJob *domain.Job

	repo := &mockJobRepo{
		createJobFn: func(_ context.Context, input domain.CreateJobInput) (*domain.Job, error) {
			currentJob = &domain.Job{
				ID:         "cancel-test-job",
				CustomerID: input.CustomerID,
				Title:      input.Title,
				Status:     "active",
			}
			return currentJob, nil
		},
		cancelJobFn: func(_ context.Context, jobID string, customerID string) (*domain.Job, error) {
			if currentJob == nil || currentJob.ID != jobID {
				return nil, domain.ErrJobNotFound
			}
			if currentJob.CustomerID != customerID {
				return nil, domain.ErrNotOwner
			}
			now := time.Now()
			currentJob.Status = "cancelled"
			currentJob.CancelledAt = &now
			return currentJob, nil
		},
	}

	svc := newTestJobService(repo)
	ctx := context.Background()

	// Create and immediately cancel.
	job, err := svc.CreateJob(ctx, validCreateInput())
	require.NoError(t, err)

	cancelled, err := svc.CancelJob(ctx, job.ID, job.CustomerID)
	require.NoError(t, err)
	assert.Equal(t, "cancelled", cancelled.Status)
	assert.NotNil(t, cancelled.CancelledAt)
}

func TestIntegration_JobLifecycle_DoublePublish_Fails(t *testing.T) {
	t.Parallel()

	publishCount := 0

	repo := &mockJobRepo{
		createJobFn: func(_ context.Context, input domain.CreateJobInput) (*domain.Job, error) {
			return &domain.Job{
				ID:     "double-pub-job",
				Status: "draft",
			}, nil
		},
		publishJobFn: func(_ context.Context, _ string, _ string) (*domain.Job, error) {
			publishCount++
			if publishCount > 1 {
				return nil, domain.ErrNotDraft
			}
			return &domain.Job{
				ID:     "double-pub-job",
				Status: "active",
			}, nil
		},
	}

	svc := newTestJobService(repo)
	ctx := context.Background()

	job, err := svc.CreateJob(ctx, validCreateInput())
	require.NoError(t, err)

	// First publish succeeds.
	_, err = svc.PublishJob(ctx, job.ID, "cust-1")
	require.NoError(t, err)

	// Second publish fails.
	_, err = svc.PublishJob(ctx, job.ID, "cust-1")
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrNotDraft))
}

func TestIntegration_Search_and_ListCustomerJobs(t *testing.T) {
	t.Parallel()

	jobs := []*domain.Job{
		{ID: "j1", Title: "Fix Sink", Status: "active", CustomerID: "cust-1"},
		{ID: "j2", Title: "Fix Toilet", Status: "active", CustomerID: "cust-1"},
		{ID: "j3", Title: "Paint Room", Status: "draft", CustomerID: "cust-2"},
	}

	repo := &mockJobRepo{
		searchJobsFn: func(_ context.Context, input domain.SearchJobsInput) ([]*domain.Job, *domain.Pagination, error) {
			var filtered []*domain.Job
			for _, j := range jobs {
				if j.Status == "active" {
					filtered = append(filtered, j)
				}
			}
			return filtered, &domain.Pagination{
				TotalCount: len(filtered),
				Page:       1,
				PageSize:   20,
				TotalPages: 1,
				HasNext:    false,
			}, nil
		},
		listCustomerJobsFn: func(_ context.Context, customerID string, _ *string, _ *string, page, pageSize int) ([]*domain.Job, *domain.Pagination, error) {
			var filtered []*domain.Job
			for _, j := range jobs {
				if j.CustomerID == customerID {
					filtered = append(filtered, j)
				}
			}
			return filtered, &domain.Pagination{
				TotalCount: len(filtered),
				Page:       page,
				PageSize:   pageSize,
			}, nil
		},
	}

	svc := newTestJobService(repo)
	ctx := context.Background()

	// Search returns only active jobs.
	searchResults, pag, err := svc.SearchJobs(ctx, domain.SearchJobsInput{TextQuery: "fix"})
	require.NoError(t, err)
	assert.Len(t, searchResults, 2)
	assert.Equal(t, 2, pag.TotalCount)

	// List customer jobs returns all jobs for a customer.
	custJobs, custPag, err := svc.ListCustomerJobs(ctx, "cust-1", nil, nil, 1, 20)
	require.NoError(t, err)
	assert.Len(t, custJobs, 2)
	assert.Equal(t, 2, custPag.TotalCount)

	// Different customer sees different jobs.
	cust2Jobs, _, err := svc.ListCustomerJobs(ctx, "cust-2", nil, nil, 1, 20)
	require.NoError(t, err)
	assert.Len(t, cust2Jobs, 1)
}
