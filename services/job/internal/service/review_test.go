package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mocks for ReviewService ---

type mockReviewRepo struct {
	checkEligibilityFn     func(ctx context.Context, contractID, userID string) (*domain.ReviewEligibility, error)
	createReviewFn         func(ctx context.Context, review *domain.Review) (*domain.Review, error)
	getReviewFn            func(ctx context.Context, reviewID string) (*domain.Review, error)
	publishPendingFn       func(ctx context.Context, contractID string) error
	listReviewsForUserFn   func(ctx context.Context, userID string, directionFilter *string, page, pageSize int) ([]*domain.Review, *domain.Pagination, float64, int, error)
	listReviewsByUserFn    func(ctx context.Context, userID string, page, pageSize int) ([]*domain.Review, *domain.Pagination, error)
	createReviewResponseFn func(ctx context.Context, resp *domain.ReviewResponse) (*domain.ReviewResponse, error)
	flagReviewFn           func(ctx context.Context, flag *domain.ReviewFlag) (string, error)
	adminListFlaggedFn     func(ctx context.Context, statusFilter *string, page, pageSize int) ([]domain.FlaggedReviewWithFlag, *domain.Pagination, error)
	adminRemoveFn          func(ctx context.Context, reviewID, reason, adminID string) error
	adminResolveFn         func(ctx context.Context, flagID, adminID string, uphold bool, resolutionNotes string) (string, error)
	recalculateFn          func(ctx context.Context, providerID string) error
	insertAuditFn          func(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any) error
	computeAvgFn           func(ctx context.Context, userID string) (float64, int, error)

	lastCreated *domain.Review
}

func (m *mockReviewRepo) CreateReview(ctx context.Context, review *domain.Review) (*domain.Review, error) {
	m.lastCreated = review
	if m.createReviewFn != nil {
		return m.createReviewFn(ctx, review)
	}
	out := *review
	out.ID = "review-1"
	out.CreatedAt = time.Now().UTC()
	out.UpdatedAt = out.CreatedAt
	out.Status = "pending"
	return &out, nil
}
func (m *mockReviewRepo) GetReview(ctx context.Context, reviewID string) (*domain.Review, error) {
	if m.getReviewFn != nil {
		return m.getReviewFn(ctx, reviewID)
	}
	if m.lastCreated != nil {
		out := *m.lastCreated
		out.ID = reviewID
		if out.ID == "" {
			out.ID = "review-1"
		}
		return &out, nil
	}
	return nil, domain.ErrReviewNotFound
}
func (m *mockReviewRepo) ListReviewsForUser(ctx context.Context, userID string, directionFilter *string, page, pageSize int) ([]*domain.Review, *domain.Pagination, float64, int, error) {
	if m.listReviewsForUserFn != nil {
		return m.listReviewsForUserFn(ctx, userID, directionFilter, page, pageSize)
	}
	return nil, nil, 0, 0, nil
}
func (m *mockReviewRepo) ListReviewsByUser(ctx context.Context, userID string, page, pageSize int) ([]*domain.Review, *domain.Pagination, error) {
	if m.listReviewsByUserFn != nil {
		return m.listReviewsByUserFn(ctx, userID, page, pageSize)
	}
	return nil, nil, nil
}
func (m *mockReviewRepo) CreateReviewResponse(ctx context.Context, resp *domain.ReviewResponse) (*domain.ReviewResponse, error) {
	if m.createReviewResponseFn != nil {
		return m.createReviewResponseFn(ctx, resp)
	}
	return resp, nil
}
func (m *mockReviewRepo) FlagReview(ctx context.Context, flag *domain.ReviewFlag) (string, error) {
	if m.flagReviewFn != nil {
		return m.flagReviewFn(ctx, flag)
	}
	return "flag-1", nil
}
func (m *mockReviewRepo) CheckReviewEligibility(ctx context.Context, contractID, userID string) (*domain.ReviewEligibility, error) {
	if m.checkEligibilityFn != nil {
		return m.checkEligibilityFn(ctx, contractID, userID)
	}
	return &domain.ReviewEligibility{Eligible: true, AlreadyReviewed: false, WindowClosesAt: time.Now().Add(30 * 24 * time.Hour)}, nil
}
func (m *mockReviewRepo) PublishPendingReviews(ctx context.Context, contractID string) error {
	if m.publishPendingFn != nil {
		return m.publishPendingFn(ctx, contractID)
	}
	return nil
}
func (m *mockReviewRepo) ComputeAverageRating(ctx context.Context, userID string) (float64, int, error) {
	if m.computeAvgFn != nil {
		return m.computeAvgFn(ctx, userID)
	}
	return 0, 0, nil
}
func (m *mockReviewRepo) AdminListFlaggedReviews(ctx context.Context, statusFilter *string, page, pageSize int) ([]domain.FlaggedReviewWithFlag, *domain.Pagination, error) {
	if m.adminListFlaggedFn != nil {
		return m.adminListFlaggedFn(ctx, statusFilter, page, pageSize)
	}
	return nil, nil, nil
}
func (m *mockReviewRepo) AdminRemoveReview(ctx context.Context, reviewID, reason, adminID string) error {
	if m.adminRemoveFn != nil {
		return m.adminRemoveFn(ctx, reviewID, reason, adminID)
	}
	return nil
}
func (m *mockReviewRepo) AdminResolveFlag(ctx context.Context, flagID, adminID string, uphold bool, resolutionNotes string) (string, error) {
	if m.adminResolveFn != nil {
		return m.adminResolveFn(ctx, flagID, adminID, uphold, resolutionNotes)
	}
	return "dismissed", nil
}
func (m *mockReviewRepo) RecalculateProviderRating(ctx context.Context, providerID string) error {
	if m.recalculateFn != nil {
		return m.recalculateFn(ctx, providerID)
	}
	return nil
}
func (m *mockReviewRepo) InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any) error {
	if m.insertAuditFn != nil {
		return m.insertAuditFn(ctx, adminID, action, targetType, targetID, details)
	}
	return nil
}

// Minimal ContractRepository stub — only GetContract is exercised by CreateReview.
type mockContractRepoForReview struct {
	getContractFn func(ctx context.Context, contractID string) (*domain.Contract, error)
}

func (m *mockContractRepoForReview) GetContract(ctx context.Context, contractID string) (*domain.Contract, error) {
	if m.getContractFn != nil {
		return m.getContractFn(ctx, contractID)
	}
	return &domain.Contract{
		ID:         contractID,
		CustomerID: "customer-1",
		ProviderID: "provider-1",
		Status:     "completed",
	}, nil
}

// Unused ContractRepository methods — satisfy the interface.
func (m *mockContractRepoForReview) CreateContract(context.Context, *domain.Contract, []domain.MilestoneInput) (*domain.Contract, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) AcceptContract(context.Context, string, string, bool) (*domain.Contract, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) StartWork(context.Context, string) (*domain.Contract, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) ListContracts(context.Context, string, *string, int, int) ([]*domain.Contract, *domain.Pagination, error) {
	return nil, nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) SubmitMilestone(context.Context, string) (*domain.Milestone, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) ApproveMilestone(context.Context, string) (*domain.Milestone, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) RequestRevision(context.Context, string, string) (*domain.Milestone, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) MarkComplete(context.Context, string) (*domain.Contract, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) GetMilestone(context.Context, string) (*domain.Milestone, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) UpdateJobStatus(context.Context, string, string) error {
	return errors.New("not implemented")
}
func (m *mockContractRepoForReview) CancelContract(context.Context, string, string, string) (*domain.Contract, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) ApproveCompletion(context.Context, string) (*domain.Contract, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) GetContractsAwaitingApproval(context.Context, time.Duration) ([]domain.Contract, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) UpdateJobCompleted(context.Context, string) error {
	return errors.New("not implemented")
}
func (m *mockContractRepoForReview) CreateChangeOrder(context.Context, *domain.ChangeOrder) (*domain.ChangeOrder, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) GetChangeOrder(context.Context, string) (*domain.ChangeOrder, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) AcceptChangeOrder(context.Context, string) (*domain.ChangeOrder, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) RejectChangeOrder(context.Context, string) (*domain.ChangeOrder, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) CreateDispute(context.Context, *domain.Dispute) (*domain.Dispute, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) GetDispute(context.Context, string) (*domain.Dispute, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) ListDisputes(context.Context, *string, *string, *string, *bool, int, int) ([]*domain.Dispute, *domain.Pagination, error) {
	return nil, nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) ResolveDispute(context.Context, string, string, string, string, int64, string) (*domain.Dispute, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) InsertAuditLog(context.Context, string, string, string, string, map[string]any) error {
	return errors.New("not implemented")
}
func (m *mockContractRepoForReview) UpdateContractStatus(context.Context, string, string) error {
	return errors.New("not implemented")
}
func (m *mockContractRepoForReview) GetRecurringConfigByContract(context.Context, string) (*domain.RecurringConfig, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) GetRecurringConfigByID(context.Context, string) (*domain.RecurringConfig, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) CreateRecurringConfig(context.Context, *domain.RecurringConfig) (*domain.RecurringConfig, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) UpdateRecurringConfig(context.Context, *domain.RecurringConfig) (*domain.RecurringConfig, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) ListRecurringInstances(context.Context, string, int, int) ([]*domain.RecurringInstance, *domain.Pagination, error) {
	return nil, nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) GetRecurringInstance(context.Context, string) (*domain.RecurringInstance, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) CreateRecurringInstance(context.Context, *domain.RecurringInstance) (*domain.RecurringInstance, error) {
	return nil, errors.New("not implemented")
}
func (m *mockContractRepoForReview) UpdateRecurringInstance(context.Context, *domain.RecurringInstance) (*domain.RecurringInstance, error) {
	return nil, errors.New("not implemented")
}

func validComment() string {
	return strings.Repeat("x", 50)
}

func intPtr(v int) *int { return &v }

func TestCreateReview_CustomerPersistsCustomerDims(t *testing.T) {
	t.Parallel()
	repo := &mockReviewRepo{}
	contracts := &mockContractRepoForReview{}
	svc := NewReviewService(repo, contracts)

	q, c, ti, v := 5, 4, 3, 2
	created, err := svc.CreateReview(context.Background(), CreateReviewInput{
		ContractID:          "contract-1",
		ReviewerID:          "customer-1",
		OverallRating:       5,
		QualityRating:       &q,
		CommunicationRating: &c,
		TimelinessRating:    &ti,
		ValueRating:         &v,
		// Provider dims must be ignored for customer role.
		PaymentPromptnessRating: intPtr(1),
		ScopeAccuracyRating:     intPtr(1),
		AccessRating:            intPtr(1),
		Comment:                 validComment(),
	})
	require.NoError(t, err)
	require.NotNil(t, created)
	require.NotNil(t, repo.lastCreated)

	assert.Equal(t, "customer", repo.lastCreated.ReviewerRole)
	assert.Equal(t, "provider-1", repo.lastCreated.RevieweeID)
	require.NotNil(t, repo.lastCreated.QualityRating)
	assert.Equal(t, 5, *repo.lastCreated.QualityRating)
	require.NotNil(t, repo.lastCreated.CommunicationRating)
	assert.Equal(t, 4, *repo.lastCreated.CommunicationRating)
	require.NotNil(t, repo.lastCreated.TimelinessRating)
	assert.Equal(t, 3, *repo.lastCreated.TimelinessRating)
	require.NotNil(t, repo.lastCreated.ValueRating)
	assert.Equal(t, 2, *repo.lastCreated.ValueRating)
	assert.Nil(t, repo.lastCreated.PaymentPromptnessRating)
	assert.Nil(t, repo.lastCreated.ScopeAccuracyRating)
	assert.Nil(t, repo.lastCreated.AccessRating)
}

func TestCreateReview_ProviderPersistsProviderDims(t *testing.T) {
	t.Parallel()
	repo := &mockReviewRepo{}
	contracts := &mockContractRepoForReview{}
	svc := NewReviewService(repo, contracts)

	pp, sa, ar := 5, 4, 3
	created, err := svc.CreateReview(context.Background(), CreateReviewInput{
		ContractID:              "contract-1",
		ReviewerID:              "provider-1",
		OverallRating:           4,
		PaymentPromptnessRating: &pp,
		ScopeAccuracyRating:     &sa,
		AccessRating:            &ar,
		// Customer dims must be ignored for provider role.
		QualityRating: intPtr(1),
		ValueRating:   intPtr(1),
		Comment:       validComment(),
	})
	require.NoError(t, err)
	require.NotNil(t, created)
	require.NotNil(t, repo.lastCreated)

	assert.Equal(t, "provider", repo.lastCreated.ReviewerRole)
	assert.Equal(t, "customer-1", repo.lastCreated.RevieweeID)
	require.NotNil(t, repo.lastCreated.PaymentPromptnessRating)
	assert.Equal(t, 5, *repo.lastCreated.PaymentPromptnessRating)
	require.NotNil(t, repo.lastCreated.ScopeAccuracyRating)
	assert.Equal(t, 4, *repo.lastCreated.ScopeAccuracyRating)
	require.NotNil(t, repo.lastCreated.AccessRating)
	assert.Equal(t, 3, *repo.lastCreated.AccessRating)
	assert.Nil(t, repo.lastCreated.QualityRating)
	assert.Nil(t, repo.lastCreated.CommunicationRating)
	assert.Nil(t, repo.lastCreated.TimelinessRating)
	assert.Nil(t, repo.lastCreated.ValueRating)
}

func TestCreateReview_Validation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		in      CreateReviewInput
		wantMsg string
	}{
		{
			name: "overall too low",
			in: CreateReviewInput{
				ContractID: "c1", ReviewerID: "customer-1",
				OverallRating: 0, Comment: validComment(),
			},
			wantMsg: "overall rating must be between 1 and 5",
		},
		{
			name: "overall too high",
			in: CreateReviewInput{
				ContractID: "c1", ReviewerID: "customer-1",
				OverallRating: 6, Comment: validComment(),
			},
			wantMsg: "overall rating must be between 1 and 5",
		},
		{
			name: "quality out of range",
			in: CreateReviewInput{
				ContractID: "c1", ReviewerID: "customer-1",
				OverallRating: 5, QualityRating: intPtr(0), Comment: validComment(),
			},
			wantMsg: "all ratings must be between 1 and 5",
		},
		{
			name: "payment promptness out of range",
			in: CreateReviewInput{
				ContractID: "c1", ReviewerID: "provider-1",
				OverallRating: 5, PaymentPromptnessRating: intPtr(9), Comment: validComment(),
			},
			wantMsg: "all ratings must be between 1 and 5",
		},
		{
			name: "access out of range",
			in: CreateReviewInput{
				ContractID: "c1", ReviewerID: "provider-1",
				OverallRating: 5, AccessRating: intPtr(-1), Comment: validComment(),
			},
			wantMsg: "all ratings must be between 1 and 5",
		},
		{
			name: "comment too short",
			in: CreateReviewInput{
				ContractID: "c1", ReviewerID: "customer-1",
				OverallRating: 5, Comment: "too short",
			},
			wantMsg: "comment must be at least 50 characters",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			svc := NewReviewService(&mockReviewRepo{}, &mockContractRepoForReview{})
			_, err := svc.CreateReview(context.Background(), tt.in)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantMsg)
		})
	}
}

func TestCreateReview_AlreadyReviewed(t *testing.T) {
	t.Parallel()
	repo := &mockReviewRepo{
		checkEligibilityFn: func(ctx context.Context, contractID, userID string) (*domain.ReviewEligibility, error) {
			return &domain.ReviewEligibility{Eligible: false, AlreadyReviewed: true}, nil
		},
	}
	svc := NewReviewService(repo, &mockContractRepoForReview{})
	_, err := svc.CreateReview(context.Background(), CreateReviewInput{
		ContractID: "c1", ReviewerID: "customer-1", OverallRating: 5, Comment: validComment(),
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrAlreadyReviewed)
}

func TestCreateReview_NotParty(t *testing.T) {
	t.Parallel()
	svc := NewReviewService(&mockReviewRepo{}, &mockContractRepoForReview{})
	_, err := svc.CreateReview(context.Background(), CreateReviewInput{
		ContractID: "c1", ReviewerID: "stranger", OverallRating: 5, Comment: validComment(),
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrNotEligible)
}

func TestCreateReview_PersistsPhotoURLs(t *testing.T) {
	t.Parallel()
	repo := &mockReviewRepo{}
	svc := NewReviewService(repo, &mockContractRepoForReview{})

	urls := []string{
		"https://cdn.example.com/reviews/a.jpg",
		" http://cdn.example.com/reviews/b.jpg ",
		"",
		"https://cdn.example.com/reviews/a.jpg", // duplicate
	}
	created, err := svc.CreateReview(context.Background(), CreateReviewInput{
		ContractID:    "c1",
		ReviewerID:    "customer-1",
		OverallRating: 5,
		Comment:       validComment(),
		PhotoURLs:     urls,
	})
	require.NoError(t, err)
	require.NotNil(t, created)
	require.NotNil(t, repo.lastCreated)
	assert.Equal(t, []string{
		"https://cdn.example.com/reviews/a.jpg",
		"http://cdn.example.com/reviews/b.jpg",
	}, repo.lastCreated.PhotoURLs)
	assert.Equal(t, repo.lastCreated.PhotoURLs, created.PhotoURLs)
}

func TestCreateReview_PhotoURLsDroppedOnFloorRegression(t *testing.T) {
	t.Parallel()
	repo := &mockReviewRepo{}
	svc := NewReviewService(repo, &mockContractRepoForReview{})

	_, err := svc.CreateReview(context.Background(), CreateReviewInput{
		ContractID:    "c1",
		ReviewerID:    "customer-1",
		OverallRating: 5,
		Comment:       validComment(),
		PhotoURLs:     []string{"https://cdn.example.com/reviews/keep.jpg"},
	})
	require.NoError(t, err)
	require.NotNil(t, repo.lastCreated)
	require.Len(t, repo.lastCreated.PhotoURLs, 1, "photo_urls must be persisted, not dropped on the floor")
	assert.Equal(t, "https://cdn.example.com/reviews/keep.jpg", repo.lastCreated.PhotoURLs[0])
}

func TestCreateReview_RejectsNonHTTPPhotoURLs(t *testing.T) {
	t.Parallel()
	repo := &mockReviewRepo{}
	svc := NewReviewService(repo, &mockContractRepoForReview{})

	_, err := svc.CreateReview(context.Background(), CreateReviewInput{
		ContractID:    "c1",
		ReviewerID:    "customer-1",
		OverallRating: 5,
		Comment:       validComment(),
		PhotoURLs:     []string{"ftp://files.example.com/a.jpg"},
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrInvalidReviewPhotos)
	assert.Nil(t, repo.lastCreated)
}

func TestCreateReview_RejectsTooManyPhotoURLs(t *testing.T) {
	t.Parallel()
	repo := &mockReviewRepo{}
	svc := NewReviewService(repo, &mockContractRepoForReview{})

	tooMany := make([]string, MaxReviewPhotos+1)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("https://cdn.example.com/reviews/%d.jpg", i)
	}
	_, err := svc.CreateReview(context.Background(), CreateReviewInput{
		ContractID:    "c1",
		ReviewerID:    "customer-1",
		OverallRating: 5,
		Comment:       validComment(),
		PhotoURLs:     tooMany,
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrInvalidReviewPhotos)
	assert.Nil(t, repo.lastCreated)
}

func TestCreateReview_OptionalCategoryRatingsOmitted(t *testing.T) {
	t.Parallel()
	repo := &mockReviewRepo{}
	svc := NewReviewService(repo, &mockContractRepoForReview{})
	_, err := svc.CreateReview(context.Background(), CreateReviewInput{
		ContractID: "c1", ReviewerID: "provider-1", OverallRating: 5, Comment: validComment(),
	})
	require.NoError(t, err)
	require.NotNil(t, repo.lastCreated)
	assert.Nil(t, repo.lastCreated.PaymentPromptnessRating)
	assert.Nil(t, repo.lastCreated.ScopeAccuracyRating)
	assert.Nil(t, repo.lastCreated.AccessRating)
	assert.Nil(t, repo.lastCreated.QualityRating)
}
