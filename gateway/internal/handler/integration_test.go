//go:build integration

package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Integration tests exercise the full HTTP request -> handler -> mock gRPC response flow.
// Run with: go test -tags=integration ./...

func TestIntegration_FullRegistrationFlow(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		body       string
		mockFn     func(ctx context.Context, req *userv1.RegisterRequest) (*userv1.RegisterResponse, error)
		wantStatus int
		wantUserID string
	}{
		{
			name: "customer_registration_returns_tokens",
			body: `{"email":"customer@test.com","password":"SecurePass123!","display_name":"Test Customer","roles":["customer"]}`,
			mockFn: func(_ context.Context, req *userv1.RegisterRequest) (*userv1.RegisterResponse, error) {
				assert.Equal(t, "customer@test.com", req.GetEmail())
				assert.Equal(t, "Test Customer", req.GetDisplayName())
				return &userv1.RegisterResponse{
					UserId:               "user-cust-1",
					AccessToken:          "access-jwt-token",
					AccessTokenExpiresAt: timestamppb.Now(),
					RefreshToken:         "refresh-token-abc",
				}, nil
			},
			wantStatus: http.StatusCreated,
			wantUserID: "user-cust-1",
		},
		{
			name: "provider_registration_returns_tokens",
			body: `{"email":"provider@test.com","password":"ProviderPass456!","display_name":"Test Provider","roles":["provider"]}`,
			mockFn: func(_ context.Context, req *userv1.RegisterRequest) (*userv1.RegisterResponse, error) {
				return &userv1.RegisterResponse{
					UserId:               "user-prov-1",
					AccessToken:          "access-jwt-token-prov",
					AccessTokenExpiresAt: timestamppb.Now(),
					RefreshToken:         "refresh-token-prov",
				}, nil
			},
			wantStatus: http.StatusCreated,
			wantUserID: "user-prov-1",
		},
		{
			name:       "malformed_json_returns_400",
			body:       `{invalid`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "duplicate_email_returns_409",
			body: `{"email":"taken@test.com","password":"Pass123!","display_name":"Dup","roles":["customer"]}`,
			mockFn: func(_ context.Context, _ *userv1.RegisterRequest) (*userv1.RegisterResponse, error) {
				return nil, status.Error(codes.AlreadyExists, "email already taken")
			},
			wantStatus: http.StatusConflict,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			client := &mockUserClient{registerFn: tt.mockFn}
			h := NewAuthHandler(client, false)

			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewBufferString(tt.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()

			h.Register(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)

			if tt.wantUserID != "" {
				result := decodeJSONResponse(t, rec)
				assert.Equal(t, tt.wantUserID, result["user_id"])
				// Should also contain token fields.
				assert.NotEmpty(t, result["access_token"])
			}
		})
	}
}

func TestIntegration_LoginThenVerifyEmail(t *testing.T) {
	t.Parallel()

	// Step 1: Login.
	loginClient := &mockUserClient{
		loginFn: func(_ context.Context, req *userv1.LoginRequest) (*userv1.LoginResponse, error) {
			return &userv1.LoginResponse{
				UserId:               "user-login-verify",
				AccessToken:          "access-token",
				AccessTokenExpiresAt: timestamppb.Now(),
				RefreshToken:         "refresh-token",
				MfaRequired:         false,
			}, nil
		},
		verifyEmailFn: func(_ context.Context, req *userv1.VerifyEmailRequest) (*userv1.VerifyEmailResponse, error) {
			return &userv1.VerifyEmailResponse{Verified: true}, nil
		},
	}

	h := NewAuthHandler(loginClient, false)

	// Login request.
	loginBody := `{"email":"verify@test.com","password":"Pass123!"}`
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()

	h.Login(loginRec, loginReq)
	assert.Equal(t, http.StatusOK, loginRec.Code)

	loginResult := decodeJSONResponse(t, loginRec)
	assert.Equal(t, "user-login-verify", loginResult["user_id"])

	// Step 2: Verify email.
	verifyBody := `{"token":"valid-verification-token"}`
	verifyReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/verify-email", bytes.NewBufferString(verifyBody))
	verifyReq.Header.Set("Content-Type", "application/json")
	verifyRec := httptest.NewRecorder()

	h.VerifyEmail(verifyRec, verifyReq)
	assert.Equal(t, http.StatusOK, verifyRec.Code)
}

func TestIntegration_AuthenticatedJobCreation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		body       string
		hasClaims  bool
		mockFn     func(ctx context.Context, req *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error)
		wantStatus int
	}{
		{
			name:      "authenticated_user_creates_job",
			body:      `{"title":"Fix Leaking Pipe","description":"Kitchen pipe is leaking under the sink","category_id":"cat-plumbing","auction_duration_hours":48}`,
			hasClaims: true,
			mockFn: func(_ context.Context, req *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error) {
				assert.Equal(t, "user-authenticated", req.GetCustomerId())
				assert.Equal(t, "Fix Leaking Pipe", req.GetTitle())
				assert.Equal(t, int32(48), req.GetAuctionDurationHours())
				return &jobv1.CreateJobResponse{
					Job: &jobv1.Job{
						Id:         "job-created-1",
						CustomerId: "user-authenticated",
						Title:      req.GetTitle(),
						Status:     jobv1.JobStatus_JOB_STATUS_DRAFT,
					},
				}, nil
			},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "unauthenticated_user_gets_401",
			body:       `{"title":"Should Fail","description":"No auth","category_id":"cat-1"}`,
			hasClaims:  false,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:      "validation_failure_returns_400",
			body:      `{"title":"","description":"","category_id":""}`,
			hasClaims: true,
			mockFn: func(_ context.Context, _ *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error) {
				return nil, status.Error(codes.InvalidArgument, "title is required")
			},
			wantStatus: http.StatusBadRequest,
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
				req = addClaimsToRequest(req, "user-authenticated", "auth@test.com", []string{"customer"})
			}
			rec := httptest.NewRecorder()

			h.Create(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)

			if tt.wantStatus == http.StatusCreated {
				result := decodeJSONResponse(t, rec)
				assert.Equal(t, "job-created-1", result["id"])
			}
		})
	}
}

func TestIntegration_SearchJobsEndpoint(t *testing.T) {
	t.Parallel()

	client := &mockJobClient{
		searchJobsFn: func(_ context.Context, req *jobv1.SearchJobsRequest) (*jobv1.SearchJobsResponse, error) {
			return &jobv1.SearchJobsResponse{
				Jobs: []*jobv1.Job{
					{Id: "j1", Title: "Fix Sink", Status: jobv1.JobStatus_JOB_STATUS_ACTIVE},
				},
			}, nil
		},
	}
	h := NewJobHandler(client, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs?q=fix", nil)
	rec := httptest.NewRecorder()

	h.Search(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	result := decodeJSONResponse(t, rec)
	jobs, ok := result["jobs"].([]interface{})
	require.True(t, ok)
	assert.Len(t, jobs, 1)
}

func TestIntegration_GRPCErrorMapping_Consistency(t *testing.T) {
	t.Parallel()

	// Verify that all gRPC error codes map to appropriate HTTP status codes
	// across multiple handler calls.
	errorMappings := []struct {
		grpcCode   codes.Code
		wantHTTP   int
	}{
		{codes.NotFound, http.StatusNotFound},
		{codes.PermissionDenied, http.StatusForbidden},
		{codes.InvalidArgument, http.StatusBadRequest},
		{codes.AlreadyExists, http.StatusConflict},
		{codes.Unauthenticated, http.StatusUnauthorized},
		{codes.Internal, http.StatusInternalServerError},
	}

	for _, em := range errorMappings {
		t.Run(em.grpcCode.String(), func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			grpcErr := status.Error(em.grpcCode, "test error")
			writeGRPCError(rec, grpcErr)

			assert.Equal(t, em.wantHTTP, rec.Code)

			var result map[string]string
			err := json.NewDecoder(rec.Body).Decode(&result)
			require.NoError(t, err)
			assert.NotEmpty(t, result["error"])
		})
	}
}
