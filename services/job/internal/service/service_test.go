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

// --- Mock Repository ---

type mockJobRepo struct {
	createJobFn         func(ctx context.Context, input domain.CreateJobInput) (*domain.Job, error)
	updateJobFn         func(ctx context.Context, jobID string, input domain.UpdateJobInput) (*domain.Job, error)
	getJobFn            func(ctx context.Context, jobID string) (*domain.Job, error)
	getJobDetailFn      func(ctx context.Context, jobID string, requestingUserID string) (*domain.Job, error)
	deleteDraftFn       func(ctx context.Context, jobID string) error
	publishJobFn        func(ctx context.Context, jobID string) (*domain.Job, error)
	closeAuctionFn      func(ctx context.Context, jobID string, customerID string) (*domain.Job, error)
	cancelJobFn         func(ctx context.Context, jobID string, customerID string) (*domain.Job, error)
	searchJobsFn        func(ctx context.Context, input domain.SearchJobsInput) ([]*domain.Job, *domain.Pagination, error)
	listCustomerJobsFn  func(ctx context.Context, customerID string, statusFilter *string, propertyID *string, page, pageSize int) ([]*domain.Job, *domain.Pagination, error)
	listDraftsFn        func(ctx context.Context, customerID string) ([]*domain.Job, error)
	listServiceCatsFn   func(ctx context.Context, level *int, parentID *string) ([]domain.ServiceCategory, error)
	getCategoryTreeFn   func(ctx context.Context) ([]domain.ServiceCategory, error)
	lookupMarketRangeFn func(ctx context.Context, serviceTypeID string, zipCode string) (*domain.MarketRange, error)
	adminListJobsFn     func(ctx context.Context, statusFilter *string, categoryID *string, customerID *string, page, pageSize int) ([]*domain.Job, *domain.Pagination, error)
	adminSuspendJobFn   func(ctx context.Context, jobID, reason string) error
	adminRemoveJobFn    func(ctx context.Context, jobID, reason string) error
	insertAuditLogFn    func(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any) error
}

func (m *mockJobRepo) CreateJob(ctx context.Context, input domain.CreateJobInput) (*domain.Job, error) {
	return m.createJobFn(ctx, input)
}
func (m *mockJobRepo) UpdateJob(ctx context.Context, jobID string, input domain.UpdateJobInput) (*domain.Job, error) {
	return m.updateJobFn(ctx, jobID, input)
}
func (m *mockJobRepo) GetJob(ctx context.Context, jobID string) (*domain.Job, error) {
	return m.getJobFn(ctx, jobID)
}
func (m *mockJobRepo) GetJobDetail(ctx context.Context, jobID string, requestingUserID string) (*domain.Job, error) {
	return m.getJobDetailFn(ctx, jobID, requestingUserID)
}
func (m *mockJobRepo) DeleteDraft(ctx context.Context, jobID string) error {
	return m.deleteDraftFn(ctx, jobID)
}
func (m *mockJobRepo) PublishJob(ctx context.Context, jobID string) (*domain.Job, error) {
	return m.publishJobFn(ctx, jobID)
}
func (m *mockJobRepo) CloseAuction(ctx context.Context, jobID string, customerID string) (*domain.Job, error) {
	return m.closeAuctionFn(ctx, jobID, customerID)
}
func (m *mockJobRepo) CancelJob(ctx context.Context, jobID string, customerID string) (*domain.Job, error) {
	return m.cancelJobFn(ctx, jobID, customerID)
}
func (m *mockJobRepo) SearchJobs(ctx context.Context, input domain.SearchJobsInput) ([]*domain.Job, *domain.Pagination, error) {
	return m.searchJobsFn(ctx, input)
}
func (m *mockJobRepo) ListCustomerJobs(ctx context.Context, customerID string, statusFilter *string, propertyID *string, page, pageSize int) ([]*domain.Job, *domain.Pagination, error) {
	return m.listCustomerJobsFn(ctx, customerID, statusFilter, propertyID, page, pageSize)
}
func (m *mockJobRepo) ListDrafts(ctx context.Context, customerID string) ([]*domain.Job, error) {
	return m.listDraftsFn(ctx, customerID)
}
func (m *mockJobRepo) ListServiceCategories(ctx context.Context, level *int, parentID *string) ([]domain.ServiceCategory, error) {
	return m.listServiceCatsFn(ctx, level, parentID)
}
func (m *mockJobRepo) GetCategoryTree(ctx context.Context) ([]domain.ServiceCategory, error) {
	return m.getCategoryTreeFn(ctx)
}
func (m *mockJobRepo) LookupMarketRange(ctx context.Context, serviceTypeID string, zipCode string) (*domain.MarketRange, error) {
	return m.lookupMarketRangeFn(ctx, serviceTypeID, zipCode)
}
func (m *mockJobRepo) AdminListJobs(ctx context.Context, statusFilter *string, categoryID *string, customerID *string, page, pageSize int) ([]*domain.Job, *domain.Pagination, error) {
	if m.adminListJobsFn != nil {
		return m.adminListJobsFn(ctx, statusFilter, categoryID, customerID, page, pageSize)
	}
	return nil, nil, nil
}
func (m *mockJobRepo) AdminSuspendJob(ctx context.Context, jobID, reason string) error {
	if m.adminSuspendJobFn != nil {
		return m.adminSuspendJobFn(ctx, jobID, reason)
	}
	return nil
}
func (m *mockJobRepo) AdminRemoveJob(ctx context.Context, jobID, reason string) error {
	if m.adminRemoveJobFn != nil {
		return m.adminRemoveJobFn(ctx, jobID, reason)
	}
	return nil
}
func (m *mockJobRepo) InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any) error {
	if m.insertAuditLogFn != nil {
		return m.insertAuditLogFn(ctx, adminID, action, targetType, targetID, details)
	}
	return nil
}

// --- helpers ---

func newTestJobService(repo *mockJobRepo) *JobService {
	return NewJobService(repo, nil) // no search engine for unit tests
}

func validCreateInput() domain.CreateJobInput {
	return domain.CreateJobInput{
		CustomerID:           "cust-1",
		Title:                "Fix Kitchen Sink",
		Description:          "The kitchen sink has a slow drain",
		CategoryID:           "cat-plumbing",
		AuctionDurationHours: 24,
		ScheduleType:         "flexible",
	}
}

// --- CreateJob tests ---

func TestJobService_CreateJob(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   domain.CreateJobInput
		repoFn  func(ctx context.Context, input domain.CreateJobInput) (*domain.Job, error)
		wantErr error
	}{
		{
			name:  "successful_creation",
			input: validCreateInput(),
			repoFn: func(_ context.Context, input domain.CreateJobInput) (*domain.Job, error) {
				return &domain.Job{
					ID:         "job-1",
					CustomerID: input.CustomerID,
					Title:      input.Title,
					Status:     "draft",
				}, nil
			},
		},
		{
			name: "missing_title_returns_error",
			input: func() domain.CreateJobInput {
				i := validCreateInput()
				i.Title = ""
				return i
			}(),
			wantErr: domain.ErrMissingTitle,
		},
		{
			name: "missing_description_returns_error",
			input: func() domain.CreateJobInput {
				i := validCreateInput()
				i.Description = ""
				return i
			}(),
			wantErr: domain.ErrMissingDescription,
		},
		{
			name: "missing_category_returns_error",
			input: func() domain.CreateJobInput {
				i := validCreateInput()
				i.CategoryID = ""
				return i
			}(),
			wantErr: domain.ErrMissingCategory,
		},
		{
			name: "duration_too_long_returns_error",
			input: func() domain.CreateJobInput {
				i := validCreateInput()
				i.AuctionDurationHours = 200
				return i
			}(),
			wantErr: domain.ErrInvalidDuration,
		},
		{
			name: "negative_duration_returns_error",
			input: func() domain.CreateJobInput {
				i := validCreateInput()
				i.AuctionDurationHours = -1
				return i
			}(),
			wantErr: domain.ErrInvalidDuration,
		},
		{
			name: "zero_duration_is_valid",
			input: func() domain.CreateJobInput {
				i := validCreateInput()
				i.AuctionDurationHours = 0
				return i
			}(),
			repoFn: func(_ context.Context, input domain.CreateJobInput) (*domain.Job, error) {
				return &domain.Job{ID: "job-2", Status: "draft"}, nil
			},
		},
		{
			name: "max_duration_168_is_valid",
			input: func() domain.CreateJobInput {
				i := validCreateInput()
				i.AuctionDurationHours = 168
				return i
			}(),
			repoFn: func(_ context.Context, _ domain.CreateJobInput) (*domain.Job, error) {
				return &domain.Job{ID: "job-3", Status: "draft"}, nil
			},
		},
		{
			name: "empty_schedule_type_defaults_to_flexible",
			input: func() domain.CreateJobInput {
				i := validCreateInput()
				i.ScheduleType = ""
				return i
			}(),
			repoFn: func(_ context.Context, input domain.CreateJobInput) (*domain.Job, error) {
				assert.Equal(t, "flexible", input.ScheduleType)
				return &domain.Job{ID: "job-4", Status: "draft", ScheduleType: "flexible"}, nil
			},
		},
		{
			name:  "repo_error_propagates",
			input: validCreateInput(),
			repoFn: func(_ context.Context, _ domain.CreateJobInput) (*domain.Job, error) {
				return nil, errors.New("database connection lost")
			},
			wantErr: errors.New("database connection lost"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockJobRepo{createJobFn: tt.repoFn}
			svc := newTestJobService(repo)

			job, err := svc.CreateJob(context.Background(), tt.input)

			if tt.wantErr != nil {
				require.Error(t, err)
				// Check for sentinel errors.
				var sentinel *domain.Job
				_ = sentinel
				if errors.Is(tt.wantErr, domain.ErrMissingTitle) ||
					errors.Is(tt.wantErr, domain.ErrMissingDescription) ||
					errors.Is(tt.wantErr, domain.ErrMissingCategory) ||
					errors.Is(tt.wantErr, domain.ErrInvalidDuration) {
					assert.True(t, errors.Is(err, tt.wantErr), "expected %v, got %v", tt.wantErr, err)
				}
				return
			}

			require.NoError(t, err)
			require.NotNil(t, job)
			assert.NotEmpty(t, job.ID)
		})
	}
}

// --- Lifecycle transition tests ---

func TestJobService_PublishJob(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, jobID string) (*domain.Job, error)
		wantErr bool
	}{
		{
			name: "draft_to_active_succeeds",
			repoFn: func(_ context.Context, jobID string) (*domain.Job, error) {
				return &domain.Job{
					ID:     jobID,
					Status: "active",
				}, nil
			},
		},
		{
			name: "not_draft_returns_error",
			repoFn: func(_ context.Context, _ string) (*domain.Job, error) {
				return nil, domain.ErrNotDraft
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockJobRepo{publishJobFn: tt.repoFn}
			svc := newTestJobService(repo)

			job, err := svc.PublishJob(context.Background(), "job-1")

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, "active", job.Status)
		})
	}
}

func TestJobService_CloseAuction(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, jobID string, customerID string) (*domain.Job, error)
		wantErr bool
	}{
		{
			name: "active_to_closed_succeeds",
			repoFn: func(_ context.Context, jobID string, _ string) (*domain.Job, error) {
				return &domain.Job{ID: jobID, Status: "closed"}, nil
			},
		},
		{
			name: "not_active_returns_error",
			repoFn: func(_ context.Context, _ string, _ string) (*domain.Job, error) {
				return nil, domain.ErrNotActive
			},
			wantErr: true,
		},
		{
			name: "not_owner_returns_error",
			repoFn: func(_ context.Context, _ string, _ string) (*domain.Job, error) {
				return nil, domain.ErrNotOwner
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockJobRepo{closeAuctionFn: tt.repoFn}
			svc := newTestJobService(repo)

			job, err := svc.CloseAuction(context.Background(), "job-1", "cust-1")

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, "closed", job.Status)
		})
	}
}

func TestJobService_CancelJob(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, jobID string, customerID string) (*domain.Job, error)
		wantErr bool
	}{
		{
			name: "successful_cancel",
			repoFn: func(_ context.Context, jobID string, _ string) (*domain.Job, error) {
				now := time.Now()
				return &domain.Job{ID: jobID, Status: "cancelled", CancelledAt: &now}, nil
			},
		},
		{
			name: "not_owner_returns_error",
			repoFn: func(_ context.Context, _ string, _ string) (*domain.Job, error) {
				return nil, domain.ErrNotOwner
			},
			wantErr: true,
		},
		{
			name: "invalid_status_returns_error",
			repoFn: func(_ context.Context, _ string, _ string) (*domain.Job, error) {
				return nil, domain.ErrInvalidStatus
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockJobRepo{cancelJobFn: tt.repoFn}
			svc := newTestJobService(repo)

			job, err := svc.CancelJob(context.Background(), "job-1", "cust-1")

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, "cancelled", job.Status)
			assert.NotNil(t, job.CancelledAt)
		})
	}
}

func TestJobService_DeleteDraft(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, jobID string) error
		wantErr bool
	}{
		{
			name:   "successful_delete",
			repoFn: func(_ context.Context, _ string) error { return nil },
		},
		{
			name: "not_draft_returns_error",
			repoFn: func(_ context.Context, _ string) error {
				return domain.ErrNotDraft
			},
			wantErr: true,
		},
		{
			name: "not_found_returns_error",
			repoFn: func(_ context.Context, _ string) error {
				return domain.ErrJobNotFound
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockJobRepo{deleteDraftFn: tt.repoFn}
			svc := newTestJobService(repo)

			err := svc.DeleteDraft(context.Background(), "job-1")

			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// --- Job lifecycle full flow test ---

func TestJobService_Lifecycle_draft_to_active_to_closed(t *testing.T) {
	t.Parallel()

	// Simulate a job going through the full lifecycle.
	repo := &mockJobRepo{
		createJobFn: func(_ context.Context, input domain.CreateJobInput) (*domain.Job, error) {
			return &domain.Job{
				ID:         "lifecycle-job",
				CustomerID: input.CustomerID,
				Title:      input.Title,
				Status:     "draft",
			}, nil
		},
		publishJobFn: func(_ context.Context, jobID string) (*domain.Job, error) {
			return &domain.Job{ID: jobID, Status: "active"}, nil
		},
		closeAuctionFn: func(_ context.Context, jobID string, _ string) (*domain.Job, error) {
			return &domain.Job{ID: jobID, Status: "closed"}, nil
		},
	}
	svc := newTestJobService(repo)
	ctx := context.Background()

	// Step 1: Create draft.
	job, err := svc.CreateJob(ctx, validCreateInput())
	require.NoError(t, err)
	assert.Equal(t, "draft", job.Status)

	// Step 2: Publish (draft -> active).
	job, err = svc.PublishJob(ctx, job.ID)
	require.NoError(t, err)
	assert.Equal(t, "active", job.Status)

	// Step 3: Close auction (active -> closed).
	job, err = svc.CloseAuction(ctx, job.ID, "cust-1")
	require.NoError(t, err)
	assert.Equal(t, "closed", job.Status)
}

// --- UpdateJob tests ---

func TestJobService_UpdateJob(t *testing.T) {
	t.Parallel()

	newTitle := "Updated Title"
	repo := &mockJobRepo{
		updateJobFn: func(_ context.Context, jobID string, input domain.UpdateJobInput) (*domain.Job, error) {
			return &domain.Job{
				ID:    jobID,
				Title: *input.Title,
			}, nil
		},
	}
	svc := newTestJobService(repo)

	job, err := svc.UpdateJob(context.Background(), "job-1", domain.UpdateJobInput{
		Title: &newTitle,
	})

	require.NoError(t, err)
	assert.Equal(t, "Updated Title", job.Title)
}

func TestJobService_UpdateJob_repo_error(t *testing.T) {
	t.Parallel()

	newTitle := "Updated"
	repo := &mockJobRepo{
		updateJobFn: func(_ context.Context, _ string, _ domain.UpdateJobInput) (*domain.Job, error) {
			return nil, domain.ErrNotDraft
		},
	}
	svc := newTestJobService(repo)

	_, err := svc.UpdateJob(context.Background(), "job-1", domain.UpdateJobInput{
		Title: &newTitle,
	})

	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrNotDraft))
}

// --- SearchJobs tests ---

func TestJobService_SearchJobs(t *testing.T) {
	t.Parallel()

	repo := &mockJobRepo{
		searchJobsFn: func(_ context.Context, input domain.SearchJobsInput) ([]*domain.Job, *domain.Pagination, error) {
			return []*domain.Job{
				{ID: "j1", Title: "Fix Sink"},
				{ID: "j2", Title: "Fix Toilet"},
			}, &domain.Pagination{
				TotalCount: 2,
				Page:       1,
				PageSize:   20,
				TotalPages: 1,
				HasNext:    false,
			}, nil
		},
	}
	svc := newTestJobService(repo)

	jobs, pag, err := svc.SearchJobs(context.Background(), domain.SearchJobsInput{
		TextQuery: "fix",
		Page:      1,
		PageSize:  20,
	})

	require.NoError(t, err)
	assert.Len(t, jobs, 2)
	assert.Equal(t, 2, pag.TotalCount)
	assert.False(t, pag.HasNext)
}

func TestJobService_SearchJobs_error(t *testing.T) {
	t.Parallel()

	repo := &mockJobRepo{
		searchJobsFn: func(_ context.Context, _ domain.SearchJobsInput) ([]*domain.Job, *domain.Pagination, error) {
			return nil, nil, errors.New("search engine down")
		},
	}
	svc := newTestJobService(repo)

	_, _, err := svc.SearchJobs(context.Background(), domain.SearchJobsInput{})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "search engine down")
}

// --- ListCustomerJobs tests ---

func TestJobService_ListCustomerJobs(t *testing.T) {
	t.Parallel()

	repo := &mockJobRepo{
		listCustomerJobsFn: func(_ context.Context, customerID string, statusFilter *string, _ *string, page, pageSize int) ([]*domain.Job, *domain.Pagination, error) {
			assert.Equal(t, "cust-1", customerID)
			return []*domain.Job{
				{ID: "j1", Status: "active"},
			}, &domain.Pagination{TotalCount: 1, Page: page, PageSize: pageSize}, nil
		},
	}
	svc := newTestJobService(repo)

	jobs, pag, err := svc.ListCustomerJobs(context.Background(), "cust-1", nil, nil, 1, 20)

	require.NoError(t, err)
	assert.Len(t, jobs, 1)
	assert.Equal(t, 1, pag.TotalCount)
}

// --- ListDrafts tests ---

func TestJobService_ListDrafts(t *testing.T) {
	t.Parallel()

	repo := &mockJobRepo{
		listDraftsFn: func(_ context.Context, customerID string) ([]*domain.Job, error) {
			assert.Equal(t, "cust-1", customerID)
			return []*domain.Job{
				{ID: "draft-1", Status: "draft"},
				{ID: "draft-2", Status: "draft"},
			}, nil
		},
	}
	svc := newTestJobService(repo)

	drafts, err := svc.ListDrafts(context.Background(), "cust-1")

	require.NoError(t, err)
	assert.Len(t, drafts, 2)
}

// --- GetJob tests ---

func TestJobService_GetJob(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, jobID string) (*domain.Job, error)
		wantErr bool
	}{
		{
			name: "found",
			repoFn: func(_ context.Context, jobID string) (*domain.Job, error) {
				return &domain.Job{ID: jobID, Title: "Test"}, nil
			},
		},
		{
			name: "not_found",
			repoFn: func(_ context.Context, _ string) (*domain.Job, error) {
				return nil, domain.ErrJobNotFound
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockJobRepo{getJobFn: tt.repoFn}
			svc := newTestJobService(repo)

			job, err := svc.GetJob(context.Background(), "job-1")

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, "job-1", job.ID)
		})
	}
}

// --- ListServiceCategories tests ---

func TestJobService_ListServiceCategories(t *testing.T) {
	t.Parallel()

	repo := &mockJobRepo{
		listServiceCatsFn: func(_ context.Context, _ *int, _ *string) ([]domain.ServiceCategory, error) {
			return []domain.ServiceCategory{
				{ID: "cat-1", Name: "Plumbing"},
				{ID: "cat-2", Name: "Electrical"},
			}, nil
		},
	}
	svc := newTestJobService(repo)

	cats, err := svc.ListServiceCategories(context.Background(), nil, nil)

	require.NoError(t, err)
	assert.Len(t, cats, 2)
}
