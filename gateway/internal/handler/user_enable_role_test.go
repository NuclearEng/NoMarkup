package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const enableRoleUserID = "11111111-1111-4111-8111-111111111111"

func (m *mockUserClient) EnableRole(ctx context.Context, req *userv1.EnableRoleRequest, _ ...grpc.CallOption) (*userv1.EnableRoleResponse, error) {
	if m.enableRoleFn == nil {
		panic("EnableRole not stubbed")
	}
	return m.enableRoleFn(ctx, req)
}

func newEnableRoleHTTPRequest(t *testing.T, role, client string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/me/roles", strings.NewReader(`{"role":"`+role+`"}`))
	req.Header.Set("Content-Type", "application/json")
	if client != "" {
		req.Header.Set("X-NoMarkup-Client", client)
	}
	req.Header.Set("User-Agent", "NoMarkupTest/1")
	claims := &middleware.Claims{
		UserID: enableRoleUserID,
		Email:  "customer@example.com",
		Roles:  []string{"customer"},
	}
	return req.WithContext(context.WithValue(req.Context(), middleware.ClaimsContextKey, claims))
}

func TestEnableRole_returnsUserAndAccessToken_setsRefreshCookie(t *testing.T) {
	t.Parallel()

	expires := time.Date(2026, 10, 2, 1, 15, 0, 0, time.UTC)
	client := &mockUserClient{
		enableRoleFn: func(_ context.Context, req *userv1.EnableRoleRequest) (*userv1.EnableRoleResponse, error) {
			assert.Equal(t, enableRoleUserID, req.GetUserId())
			assert.Equal(t, commonv1.UserRole_USER_ROLE_PROVIDER, req.GetRole())
			assert.Equal(t, "NoMarkupTest/1", req.GetDeviceInfo())
			return &userv1.EnableRoleResponse{
				User: &userv1.User{
					Id:            enableRoleUserID,
					Email:         "customer@example.com",
					DisplayName:   "Casey",
					EmailVerified: true,
					Roles: []commonv1.UserRole{
						commonv1.UserRole_USER_ROLE_CUSTOMER,
						commonv1.UserRole_USER_ROLE_PROVIDER,
					},
					Status:    commonv1.UserStatus_USER_STATUS_ACTIVE,
					CreatedAt: timestamppb.New(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)),
				},
				AccessToken:          "access-with-provider",
				RefreshToken:         "refresh-new",
				AccessTokenExpiresAt: timestamppb.New(expires),
			}, nil
		},
	}
	h := NewUserHandler(client, nil).WithSessionIssuer(NewAuthHandler(client, true, "test-session-secret"))

	rec := httptest.NewRecorder()
	h.EnableRole(rec, newEnableRoleHTTPRequest(t, "provider", ""))

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, enableRoleUserID, body["id"])
	assert.Equal(t, "customer@example.com", body["email"])
	assert.Equal(t, "access-with-provider", body["access_token"])
	assert.Equal(t, "2026-10-02T01:15:00Z", body["access_token_expires_at"])
	_, hasRefresh := body["refresh_token"]
	assert.False(t, hasRefresh, "browsers must not receive the refresh token in JSON")
	roles, ok := body["roles"].([]any)
	require.True(t, ok)
	assert.Contains(t, roles, "provider")
	assert.Contains(t, roles, "customer")

	res := rec.Result()
	defer res.Body.Close()
	var refresh *http.Cookie
	var session *http.Cookie
	for _, c := range res.Cookies() {
		switch c.Name {
		case refreshTokenCookieName:
			refresh = c
		case sessionFlagCookieName:
			session = c
		}
	}
	require.NotNil(t, refresh)
	assert.Equal(t, "refresh-new", refresh.Value)
	assert.Equal(t, "/api/v1/auth", refresh.Path)
	assert.True(t, refresh.HttpOnly)
	assert.True(t, refresh.Secure)
	assert.Equal(t, http.SameSiteLaxMode, refresh.SameSite)
	assert.Equal(t, 7*24*60*60, refresh.MaxAge)
	require.NotNil(t, session)
	assert.Equal(t, "/", session.Path)
	assert.False(t, session.HttpOnly)
}

func TestEnableRole_iosRefreshTokenInBody(t *testing.T) {
	t.Parallel()

	client := &mockUserClient{
		enableRoleFn: func(_ context.Context, _ *userv1.EnableRoleRequest) (*userv1.EnableRoleResponse, error) {
			return &userv1.EnableRoleResponse{
				User: &userv1.User{
					Id:     enableRoleUserID,
					Email:  "customer@example.com",
					Roles:  []commonv1.UserRole{commonv1.UserRole_USER_ROLE_PROVIDER},
					Status: commonv1.UserStatus_USER_STATUS_ACTIVE,
				},
				AccessToken:  "access-ios",
				RefreshToken: "refresh-ios",
			}, nil
		},
	}
	h := NewUserHandler(client, nil).WithSessionIssuer(NewAuthHandler(client, true, "test-session-secret"))

	rec := httptest.NewRecorder()
	h.EnableRole(rec, newEnableRoleHTTPRequest(t, "provider", "ios"))

	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "access-ios", body["access_token"])
	assert.Equal(t, "refresh-ios", body["refresh_token"])
	assert.Equal(t, enableRoleUserID, body["id"])
}

func TestEnableRole_adminCannotBeSelfAssigned(t *testing.T) {
	t.Parallel()

	client := &mockUserClient{
		enableRoleFn: func(_ context.Context, _ *userv1.EnableRoleRequest) (*userv1.EnableRoleResponse, error) {
			t.Fatal("admin grant must not reach the user service")
			return nil, nil
		},
	}
	h := NewUserHandler(client, nil).WithSessionIssuer(NewAuthHandler(client, true, "test-session-secret"))

	rec := httptest.NewRecorder()
	h.EnableRole(rec, newEnableRoleHTTPRequest(t, "admin", "ios"))

	require.Equal(t, http.StatusForbidden, rec.Code)
	assert.NotContains(t, rec.Body.String(), "refresh_token")
	for _, c := range rec.Result().Cookies() {
		assert.NotEqual(t, refreshTokenCookieName, c.Name)
	}
}
