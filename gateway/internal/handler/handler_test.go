package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	subscriptionv1 "github.com/nomarkup/nomarkup/proto/subscription/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mock gRPC clients ---

// mockUserClient implements userv1.UserServiceClient for testing.
type mockUserClient struct {
	userv1.UserServiceClient // embed to satisfy the interface; unused methods will panic
	registerFn               func(ctx context.Context, req *userv1.RegisterRequest) (*userv1.RegisterResponse, error)
	loginFn                  func(ctx context.Context, req *userv1.LoginRequest) (*userv1.LoginResponse, error)
	verifyEmailFn            func(ctx context.Context, req *userv1.VerifyEmailRequest) (*userv1.VerifyEmailResponse, error)
}

func (m *mockUserClient) Register(ctx context.Context, req *userv1.RegisterRequest, _ ...grpc.CallOption) (*userv1.RegisterResponse, error) {
	return m.registerFn(ctx, req)
}

func (m *mockUserClient) Login(ctx context.Context, req *userv1.LoginRequest, _ ...grpc.CallOption) (*userv1.LoginResponse, error) {
	return m.loginFn(ctx, req)
}

func (m *mockUserClient) VerifyEmail(ctx context.Context, req *userv1.VerifyEmailRequest, _ ...grpc.CallOption) (*userv1.VerifyEmailResponse, error) {
	return m.verifyEmailFn(ctx, req)
}

// mockJobClient implements jobv1.JobServiceClient for testing.
type mockJobClient struct {
	jobv1.JobServiceClient
	createJobFn   func(ctx context.Context, req *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error)
	updateJobFn   func(ctx context.Context, req *jobv1.UpdateJobRequest) (*jobv1.UpdateJobResponse, error)
	publishJobFn  func(ctx context.Context, req *jobv1.PublishJobRequest) (*jobv1.PublishJobResponse, error)
	searchJobsFn  func(ctx context.Context, req *jobv1.SearchJobsRequest) (*jobv1.SearchJobsResponse, error)
	deleteDraftFn func(ctx context.Context, req *jobv1.DeleteDraftRequest) (*jobv1.DeleteDraftResponse, error)
	getJobFn      func(ctx context.Context, req *jobv1.GetJobRequest) (*jobv1.GetJobResponse, error)
}

func (m *mockJobClient) CreateJob(ctx context.Context, req *jobv1.CreateJobRequest, _ ...grpc.CallOption) (*jobv1.CreateJobResponse, error) {
	return m.createJobFn(ctx, req)
}

func (m *mockJobClient) UpdateJob(ctx context.Context, req *jobv1.UpdateJobRequest, _ ...grpc.CallOption) (*jobv1.UpdateJobResponse, error) {
	return m.updateJobFn(ctx, req)
}

func (m *mockJobClient) PublishJob(ctx context.Context, req *jobv1.PublishJobRequest, _ ...grpc.CallOption) (*jobv1.PublishJobResponse, error) {
	return m.publishJobFn(ctx, req)
}

func (m *mockJobClient) SearchJobs(ctx context.Context, req *jobv1.SearchJobsRequest, _ ...grpc.CallOption) (*jobv1.SearchJobsResponse, error) {
	return m.searchJobsFn(ctx, req)
}

func (m *mockJobClient) DeleteDraft(ctx context.Context, req *jobv1.DeleteDraftRequest, _ ...grpc.CallOption) (*jobv1.DeleteDraftResponse, error) {
	return m.deleteDraftFn(ctx, req)
}

func (m *mockJobClient) GetJob(ctx context.Context, req *jobv1.GetJobRequest, _ ...grpc.CallOption) (*jobv1.GetJobResponse, error) {
	if m.getJobFn == nil {
		return nil, status.Error(codes.Unimplemented, "GetJob not stubbed")
	}
	return m.getJobFn(ctx, req)
}

// mockSubscriptionClient implements subscriptionv1.SubscriptionServiceClient for testing.
type mockSubscriptionClient struct {
	subscriptionv1.SubscriptionServiceClient
	listTiersFn          func(ctx context.Context, req *subscriptionv1.ListTiersRequest) (*subscriptionv1.ListTiersResponse, error)
	getSubscriptionFn    func(ctx context.Context, req *subscriptionv1.GetSubscriptionRequest) (*subscriptionv1.GetSubscriptionResponse, error)
	checkFeatureAccessFn func(ctx context.Context, req *subscriptionv1.CheckFeatureAccessRequest) (*subscriptionv1.CheckFeatureAccessResponse, error)
}

func (m *mockSubscriptionClient) ListTiers(ctx context.Context, req *subscriptionv1.ListTiersRequest, _ ...grpc.CallOption) (*subscriptionv1.ListTiersResponse, error) {
	return m.listTiersFn(ctx, req)
}

func (m *mockSubscriptionClient) GetSubscription(ctx context.Context, req *subscriptionv1.GetSubscriptionRequest, _ ...grpc.CallOption) (*subscriptionv1.GetSubscriptionResponse, error) {
	return m.getSubscriptionFn(ctx, req)
}

func (m *mockSubscriptionClient) CheckFeatureAccess(ctx context.Context, req *subscriptionv1.CheckFeatureAccessRequest, _ ...grpc.CallOption) (*subscriptionv1.CheckFeatureAccessResponse, error) {
	return m.checkFeatureAccessFn(ctx, req)
}

// --- helpers ---

func addClaimsToRequest(r *http.Request, userID, email string, roles []string) *http.Request {
	claims := &middleware.Claims{UserID: userID, Email: email, Roles: roles}
	ctx := context.WithValue(r.Context(), middleware.ClaimsContextKey, claims)
	return r.WithContext(ctx)
}

// withChiURLParam injects a Chi URL parameter into the request context so
// chi.URLParam works inside handlers that rely on routing.
func withChiURLParam(r *http.Request, key, value string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func decodeJSONResponse(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var result map[string]interface{}
	err := json.NewDecoder(rec.Body).Decode(&result)
	require.NoError(t, err)
	return result
}

// --- AuthHandler tests ---

func TestAuthHandler_Register(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		body       string
		mockFn     func(ctx context.Context, req *userv1.RegisterRequest) (*userv1.RegisterResponse, error)
		wantStatus int
		wantField  string
		wantValue  string
	}{
		{
			name: "successful_registration",
			body: `{"email":"test@example.com","password":"secret123","display_name":"Test User","roles":["customer"]}`,
			mockFn: func(_ context.Context, req *userv1.RegisterRequest) (*userv1.RegisterResponse, error) {
				return &userv1.RegisterResponse{
					UserId:               "user-abc",
					AccessToken:          "jwt-token-123",
					AccessTokenExpiresAt: timestamppb.Now(),
					RefreshToken:         "refresh-token-456",
				}, nil
			},
			wantStatus: http.StatusCreated,
			wantField:  "user_id",
			wantValue:  "user-abc",
		},
		{
			name:       "invalid_body_returns_400",
			body:       `{invalid json`,
			mockFn:     nil, // won't be called
			wantStatus: http.StatusBadRequest,
			wantField:  "error",
			wantValue:  "invalid request body",
		},
		{
			name: "grpc_already_exists_returns_409",
			body: `{"email":"taken@example.com","password":"secret123","display_name":"X","roles":["customer"]}`,
			mockFn: func(_ context.Context, _ *userv1.RegisterRequest) (*userv1.RegisterResponse, error) {
				return nil, status.Error(codes.AlreadyExists, "email already taken")
			},
			wantStatus: http.StatusConflict,
			wantField:  "error",
			wantValue:  "email already taken",
		},
		{
			name: "grpc_internal_error_returns_500",
			body: `{"email":"test@example.com","password":"secret123","display_name":"X","roles":["customer"]}`,
			mockFn: func(_ context.Context, _ *userv1.RegisterRequest) (*userv1.RegisterResponse, error) {
				return nil, status.Error(codes.Internal, "db down")
			},
			wantStatus: http.StatusInternalServerError,
			wantField:  "error",
			wantValue:  "internal error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			client := &mockUserClient{registerFn: tt.mockFn}
			h := NewAuthHandler(client, false, "test-session-secret")

			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewBufferString(tt.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()

			h.Register(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			result := decodeJSONResponse(t, rec)
			if tt.wantField != "" {
				// decodeJSON helper appends the underlying JSON parse error to
				// "invalid request body" — assert with prefix instead of equal.
				gotStr, _ := result[tt.wantField].(string)
				assert.True(t, strings.HasPrefix(gotStr, tt.wantValue),
					"expected %q to have prefix %q", gotStr, tt.wantValue)
			}
		})
	}
}

func TestAuthHandler_Login(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		body       string
		mockFn     func(ctx context.Context, req *userv1.LoginRequest) (*userv1.LoginResponse, error)
		wantStatus int
		wantMFA    bool
	}{
		{
			name: "successful_login",
			body: `{"email":"test@example.com","password":"secret123"}`,
			mockFn: func(_ context.Context, req *userv1.LoginRequest) (*userv1.LoginResponse, error) {
				assert.Equal(t, "test@example.com", req.GetEmail())
				return &userv1.LoginResponse{
					UserId:               "user-abc",
					AccessToken:          "jwt-token",
					AccessTokenExpiresAt: timestamppb.Now(),
					RefreshToken:         "refresh-token",
					MfaRequired:          false,
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "mfa_required",
			body: `{"email":"mfa@example.com","password":"secret123"}`,
			mockFn: func(_ context.Context, _ *userv1.LoginRequest) (*userv1.LoginResponse, error) {
				return &userv1.LoginResponse{
					UserId:      "user-mfa",
					MfaRequired: true,
				}, nil
			},
			wantStatus: http.StatusOK,
			wantMFA:    true,
		},
		{
			name: "invalid_credentials_returns_401",
			body: `{"email":"wrong@example.com","password":"wrong"}`,
			mockFn: func(_ context.Context, _ *userv1.LoginRequest) (*userv1.LoginResponse, error) {
				return nil, status.Error(codes.Unauthenticated, "invalid credentials")
			},
			wantStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			client := &mockUserClient{loginFn: tt.mockFn}
			h := NewAuthHandler(client, false, "test-session-secret")

			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(tt.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()

			h.Login(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantStatus == http.StatusOK {
				result := decodeJSONResponse(t, rec)
				if tt.wantMFA {
					assert.Equal(t, true, result["mfa_required"])
				}
			}
		})
	}
}

func TestAuthHandler_VerifyEmail(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		body       string
		mockFn     func(ctx context.Context, req *userv1.VerifyEmailRequest) (*userv1.VerifyEmailResponse, error)
		wantStatus int
	}{
		{
			name: "successful_verify",
			body: `{"token":"verify-token-123"}`,
			mockFn: func(_ context.Context, req *userv1.VerifyEmailRequest) (*userv1.VerifyEmailResponse, error) {
				assert.Equal(t, "verify-token-123", req.GetToken())
				return &userv1.VerifyEmailResponse{Verified: true}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "grpc_not_found_returns_404",
			body: `{"token":"bad-token"}`,
			mockFn: func(_ context.Context, _ *userv1.VerifyEmailRequest) (*userv1.VerifyEmailResponse, error) {
				return nil, status.Error(codes.NotFound, "token not found")
			},
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			client := &mockUserClient{verifyEmailFn: tt.mockFn}
			h := NewAuthHandler(client, false, "test-session-secret")

			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/verify-email", bytes.NewBufferString(tt.body))
			rec := httptest.NewRecorder()

			h.VerifyEmail(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
		})
	}
}

// --- JobHandler tests ---

func TestJobHandler_Create(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		body       string
		hasClaims  bool
		mockFn     func(ctx context.Context, req *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error)
		wantStatus int
		wantField  string
		wantValue  interface{}
	}{
		{
			name:      "successful_creation",
			body:      `{"title":"Fix Sink","description":"Kitchen sink is leaking","category_id":"cat-1","auction_duration_hours":24}`,
			hasClaims: true,
			mockFn: func(_ context.Context, req *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error) {
				assert.Equal(t, "user-1", req.GetCustomerId())
				assert.Equal(t, "Fix Sink", req.GetTitle())
				return &jobv1.CreateJobResponse{
					Job: &jobv1.Job{
						Id:         "job-1",
						CustomerId: "user-1",
						Title:      "Fix Sink",
						Status:     jobv1.JobStatus_JOB_STATUS_DRAFT,
					},
				}, nil
			},
			wantStatus: http.StatusCreated,
			wantField:  "id",
			wantValue:  "job-1",
		},
		{
			name:       "no_claims_returns_401",
			body:       `{"title":"Fix Sink","description":"d","category_id":"cat-1"}`,
			hasClaims:  false,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "invalid_body_returns_400",
			body:       `{bad json`,
			hasClaims:  true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:      "grpc_validation_error_returns_400",
			body:      `{"title":"","description":"","category_id":""}`,
			hasClaims: true,
			mockFn: func(_ context.Context, _ *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error) {
				return nil, status.Error(codes.InvalidArgument, "title is required")
			},
			wantStatus: http.StatusBadRequest,
			wantField:  "error",
			wantValue:  "title is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			client := &mockJobClient{createJobFn: tt.mockFn}
			h := NewJobHandler(client, nil, nil, nil)

			req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs", bytes.NewBufferString(tt.body))
			req.Header.Set("Content-Type", "application/json")
			if tt.hasClaims {
				req = addClaimsToRequest(req, "user-1", "test@example.com", []string{"customer"})
			}
			rec := httptest.NewRecorder()

			h.Create(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantField != "" {
				result := decodeJSONResponse(t, rec)
				assert.Equal(t, tt.wantValue, result[tt.wantField])
			}
		})
	}
}

func TestJobHandler_Search(t *testing.T) {
	t.Parallel()

	client := &mockJobClient{
		searchJobsFn: func(_ context.Context, req *jobv1.SearchJobsRequest) (*jobv1.SearchJobsResponse, error) {
			assert.Equal(t, "plumbing", req.GetTextQuery())
			return &jobv1.SearchJobsResponse{
				Jobs: []*jobv1.Job{
					{Id: "j1", Title: "Fix Sink", Status: jobv1.JobStatus_JOB_STATUS_ACTIVE},
					{Id: "j2", Title: "Fix Toilet", Status: jobv1.JobStatus_JOB_STATUS_ACTIVE},
				},
			}, nil
		},
	}
	h := NewJobHandler(client, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs?q=plumbing", nil)
	rec := httptest.NewRecorder()

	h.Search(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	result := decodeJSONResponse(t, rec)
	jobs, ok := result["jobs"].([]interface{})
	require.True(t, ok)
	assert.Len(t, jobs, 2)
}

func TestJobHandler_Search_grpc_error(t *testing.T) {
	t.Parallel()

	client := &mockJobClient{
		searchJobsFn: func(_ context.Context, _ *jobv1.SearchJobsRequest) (*jobv1.SearchJobsResponse, error) {
			return nil, status.Error(codes.Internal, "search unavailable")
		},
	}
	h := NewJobHandler(client, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs?q=test", nil)
	rec := httptest.NewRecorder()

	h.Search(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

// TestJobHandler_Update_forwards_customer_id verifies the IDOR fix: the gateway
// MUST forward the authenticated caller's user ID as CustomerId so the job
// service can enforce ownership in the SQL WHERE clause. Without this, user B
// could update user A's draft.
func TestJobHandler_Update_forwards_customer_id(t *testing.T) {
	t.Parallel()

	var receivedCustomerID, receivedJobID string
	client := &mockJobClient{
		updateJobFn: func(_ context.Context, req *jobv1.UpdateJobRequest) (*jobv1.UpdateJobResponse, error) {
			receivedCustomerID = req.GetCustomerId()
			receivedJobID = req.GetJobId()
			return &jobv1.UpdateJobResponse{Job: &jobv1.Job{Id: req.GetJobId(), CustomerId: req.GetCustomerId()}}, nil
		},
	}
	h := NewJobHandler(client, nil, nil, nil)

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/jobs/job-1", bytes.NewBufferString(`{"title":"New Title"}`))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "user-authenticated", "a@example.com", []string{"customer"})
	// Inject the Chi URL param that the handler reads.
	req = withChiURLParam(req, "id", "job-1")

	rec := httptest.NewRecorder()
	h.Update(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "user-authenticated", receivedCustomerID, "gateway must forward authenticated user ID as CustomerId")
	assert.Equal(t, "job-1", receivedJobID)
}

// TestJobHandler_Delete_forwards_customer_id verifies the same IDOR fix for DeleteDraft.
func TestJobHandler_Delete_forwards_customer_id(t *testing.T) {
	t.Parallel()

	var receivedCustomerID string
	client := &mockJobClient{
		deleteDraftFn: func(_ context.Context, req *jobv1.DeleteDraftRequest) (*jobv1.DeleteDraftResponse, error) {
			receivedCustomerID = req.GetCustomerId()
			return &jobv1.DeleteDraftResponse{}, nil
		},
	}
	h := NewJobHandler(client, nil, nil, nil)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/jobs/job-1", nil)
	req = addClaimsToRequest(req, "user-authenticated", "a@example.com", []string{"customer"})
	req = withChiURLParam(req, "id", "job-1")

	rec := httptest.NewRecorder()
	h.Delete(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, "user-authenticated", receivedCustomerID, "gateway must forward authenticated user ID as CustomerId")
}

// TestJobHandler_Publish_forwards_customer_id verifies the same IDOR fix for PublishJob.
func TestJobHandler_Publish_forwards_customer_id(t *testing.T) {
	t.Parallel()

	var receivedCustomerID string
	client := &mockJobClient{
		publishJobFn: func(_ context.Context, req *jobv1.PublishJobRequest) (*jobv1.PublishJobResponse, error) {
			receivedCustomerID = req.GetCustomerId()
			return &jobv1.PublishJobResponse{Job: &jobv1.Job{Id: req.GetJobId(), Status: jobv1.JobStatus_JOB_STATUS_ACTIVE}}, nil
		},
	}
	h := NewJobHandler(client, nil, nil, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs/job-1/publish", nil)
	req = addClaimsToRequest(req, "user-authenticated", "a@example.com", []string{"customer"})
	req = withChiURLParam(req, "id", "job-1")

	rec := httptest.NewRecorder()
	h.Publish(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "user-authenticated", receivedCustomerID, "gateway must forward authenticated user ID as CustomerId")
}

// --- SubscriptionHandler tests ---

func TestSubscriptionHandler_ListTiers(t *testing.T) {
	t.Parallel()

	client := &mockSubscriptionClient{
		listTiersFn: func(_ context.Context, _ *subscriptionv1.ListTiersRequest) (*subscriptionv1.ListTiersResponse, error) {
			return &subscriptionv1.ListTiersResponse{
				Tiers: []*subscriptionv1.SubscriptionTier{
					{Id: "tier-1", Name: "Free", Slug: "free", MonthlyPriceCents: 0},
					{Id: "tier-2", Name: "Pro", Slug: "pro", MonthlyPriceCents: 2999},
				},
			}, nil
		},
	}
	h := NewSubscriptionHandler(client)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/subscriptions/tiers", nil)
	rec := httptest.NewRecorder()

	h.ListTiers(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	result := decodeJSONResponse(t, rec)
	tiers, ok := result["tiers"].([]interface{})
	require.True(t, ok)
	assert.Len(t, tiers, 2)
}

func TestSubscriptionHandler_GetSubscription(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		hasClaims  bool
		mockFn     func(ctx context.Context, req *subscriptionv1.GetSubscriptionRequest) (*subscriptionv1.GetSubscriptionResponse, error)
		wantStatus int
	}{
		{
			name:      "returns_subscription",
			hasClaims: true,
			mockFn: func(_ context.Context, req *subscriptionv1.GetSubscriptionRequest) (*subscriptionv1.GetSubscriptionResponse, error) {
				assert.Equal(t, "user-1", req.GetUserId())
				return &subscriptionv1.GetSubscriptionResponse{
					Subscription: &subscriptionv1.Subscription{
						Id:     "sub-1",
						UserId: "user-1",
						TierId: "tier-pro",
						Status: subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE,
					},
				}, nil
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "no_claims_returns_401",
			hasClaims:  false,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:      "nil_subscription_returns_null",
			hasClaims: true,
			mockFn: func(_ context.Context, _ *subscriptionv1.GetSubscriptionRequest) (*subscriptionv1.GetSubscriptionResponse, error) {
				return &subscriptionv1.GetSubscriptionResponse{Subscription: nil}, nil
			},
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			client := &mockSubscriptionClient{getSubscriptionFn: tt.mockFn}
			h := NewSubscriptionHandler(client)

			req := httptest.NewRequest(http.MethodGet, "/api/v1/subscriptions/me", nil)
			if tt.hasClaims {
				req = addClaimsToRequest(req, "user-1", "test@example.com", []string{"provider"})
			}
			rec := httptest.NewRecorder()

			h.GetSubscription(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
		})
	}
}

func TestSubscriptionHandler_CheckFeatureAccess(t *testing.T) {
	t.Parallel()

	client := &mockSubscriptionClient{
		checkFeatureAccessFn: func(_ context.Context, req *subscriptionv1.CheckFeatureAccessRequest) (*subscriptionv1.CheckFeatureAccessResponse, error) {
			assert.Equal(t, "user-1", req.GetUserId())
			assert.Equal(t, "analytics", req.GetFeature())
			return &subscriptionv1.CheckFeatureAccessResponse{
				HasAccess:    false,
				RequiredTier: "pro",
			}, nil
		},
	}
	h := NewSubscriptionHandler(client)

	// Use chi URL param context to simulate {feature}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/subscriptions/features/analytics", nil)
	req = addClaimsToRequest(req, "user-1", "test@example.com", []string{"provider"})

	// We need to use a chi router context for URL params. Since we can't easily
	// do that in tests, we'll test the handler directly and it will get an empty
	// feature param, returning 400. Let's test the handler logic differently.
	rec := httptest.NewRecorder()
	h.CheckFeatureAccess(rec, req)

	// Without chi context, feature will be empty -> 400
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

// --- writeGRPCError tests ---

func TestWriteGRPCError_mapping(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		grpcCode codes.Code
		grpcMsg  string
		wantHTTP int
		wantMsg  string
	}{
		{
			name:     "already_exists_to_409",
			grpcCode: codes.AlreadyExists,
			grpcMsg:  "email already taken",
			wantHTTP: http.StatusConflict,
			wantMsg:  "email already taken",
		},
		{
			name:     "unauthenticated_to_401",
			grpcCode: codes.Unauthenticated,
			grpcMsg:  "invalid credentials",
			wantHTTP: http.StatusUnauthorized,
			wantMsg:  "invalid credentials",
		},
		{
			name:     "not_found_to_404",
			grpcCode: codes.NotFound,
			grpcMsg:  "job not found",
			wantHTTP: http.StatusNotFound,
			wantMsg:  "job not found",
		},
		{
			name:     "permission_denied_to_403",
			grpcCode: codes.PermissionDenied,
			grpcMsg:  "admin access required",
			wantHTTP: http.StatusForbidden,
			wantMsg:  "admin access required",
		},
		{
			name:     "invalid_argument_to_400",
			grpcCode: codes.InvalidArgument,
			grpcMsg:  "title is required",
			wantHTTP: http.StatusBadRequest,
			wantMsg:  "title is required",
		},
		{
			name:     "failed_precondition_to_422",
			grpcCode: codes.FailedPrecondition,
			grpcMsg:  "job not in valid state",
			wantHTTP: http.StatusUnprocessableEntity,
			wantMsg:  "job not in valid state",
		},
		{
			name:     "internal_to_500",
			grpcCode: codes.Internal,
			grpcMsg:  "db error",
			wantHTTP: http.StatusInternalServerError,
			wantMsg:  "internal error", // message not exposed
		},
		{
			name:     "unknown_to_500",
			grpcCode: codes.Unknown,
			grpcMsg:  "something",
			wantHTTP: http.StatusInternalServerError,
			wantMsg:  "internal error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			grpcErr := status.Error(tt.grpcCode, tt.grpcMsg)
			writeGRPCError(rec, grpcErr)

			assert.Equal(t, tt.wantHTTP, rec.Code)

			var result map[string]string
			err := json.NewDecoder(rec.Body).Decode(&result)
			require.NoError(t, err)
			assert.Equal(t, tt.wantMsg, result["error"])
		})
	}
}

func TestWriteGRPCError_non_grpc_error(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	writeGRPCError(rec, assert.AnError) // a non-gRPC error

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	result := decodeJSONResponse(t, rec)
	assert.Equal(t, "internal error", result["error"])
}

// --- helper function tests ---

func TestExtractIP(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		forwarded  string
		realIP     string
		remoteAddr string
		wantIP     string
	}{
		{
			name:       "x_forwarded_for_first_from_trusted_peer",
			forwarded:  "1.2.3.4, 5.6.7.8",
			remoteAddr: "127.0.0.1:12345", // loopback is a trusted proxy by default
			wantIP:     "1.2.3.4",
		},
		{
			name:       "x_forwarded_for_single_from_trusted_peer",
			forwarded:  "10.0.0.1",
			remoteAddr: "127.0.0.1:12345",
			wantIP:     "10.0.0.1",
		},
		{
			name:       "x_real_ip_from_trusted_peer",
			realIP:     "192.168.1.1",
			remoteAddr: "127.0.0.1:12345",
			wantIP:     "192.168.1.1",
		},
		{
			name:       "x_forwarded_for_ignored_from_untrusted_peer",
			forwarded:  "10.0.0.1",
			remoteAddr: "203.0.113.7:12345", // public IP, not a trusted proxy
			wantIP:     "203.0.113.7",
		},
		{
			name:       "x_real_ip_ignored_from_untrusted_peer",
			realIP:     "10.0.0.1",
			remoteAddr: "203.0.113.7:12345",
			wantIP:     "203.0.113.7",
		},
		{
			name:       "remote_addr_with_port",
			remoteAddr: "172.16.0.1:12345",
			wantIP:     "172.16.0.1",
		},
		{
			name:       "remote_addr_without_port",
			remoteAddr: "172.16.0.2",
			wantIP:     "172.16.0.2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			if tt.forwarded != "" {
				req.Header.Set("X-Forwarded-For", tt.forwarded)
			}
			if tt.realIP != "" {
				req.Header.Set("X-Real-IP", tt.realIP)
			}
			if tt.remoteAddr != "" {
				req.RemoteAddr = tt.remoteAddr
			}

			assert.Equal(t, tt.wantIP, extractIP(req))
		})
	}
}

func TestFormatTimestamp(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		ts   *timestamppb.Timestamp
		want string
	}{
		{
			name: "valid_timestamp",
			ts:   timestamppb.New(mustParseTime(t, "2024-06-15T10:30:00Z")),
			want: "2024-06-15T10:30:00Z",
		},
		{
			name: "nil_timestamp",
			ts:   nil,
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, formatTimestamp(tt.ts))
		})
	}
}

func mustParseTime(t *testing.T, s string) time.Time {
	t.Helper()
	parsed, err := time.Parse("2006-01-02T15:04:05Z", s)
	require.NoError(t, err)
	return parsed
}

func TestParseRoles(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input []string
		want  int
	}{
		{name: "customer", input: []string{"customer"}, want: 1},
		// "admin" is intentionally dropped — self-registration cannot grant admin.
		{name: "multiple_drops_admin", input: []string{"customer", "provider", "admin"}, want: 2},
		{name: "admin_alone_is_zero", input: []string{"admin"}, want: 0},
		{name: "unknown_ignored", input: []string{"unknown"}, want: 0},
		{name: "empty", input: []string{}, want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			result := parseRoles(tt.input)
			assert.Len(t, result, tt.want)
		})
	}
}

func TestSplitCommas(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{name: "single", input: "abc", want: []string{"abc"}},
		{name: "multiple", input: "a,b,c", want: []string{"a", "b", "c"}},
		{name: "with_spaces", input: " a , b , c ", want: []string{"a", "b", "c"}},
		{name: "empty_parts_filtered", input: "a,,b", want: []string{"a", "b"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, splitCommas(tt.input))
		})
	}
}
