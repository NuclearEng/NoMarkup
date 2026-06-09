package handler

// Regression guard for the logout-auth fix (commit 3ce9c60).
//
// BUG: POST /auth/logout sat behind the JWT auth middleware, so a client whose
// 15-min access token had already expired (the COMMON logout moment) got 401 and
// the request never reached the handler — its 7-day refresh token was never
// revoked and kept minting sessions (violates CLAUDE.md §6: logout invalidates
// the session, not just the client cache). The fix moves /logout to the PUBLIC
// auth group (it authenticates off the refresh-token cookie, reading no JWT
// claims).
//
// This test mirrors the router wiring decision: a protected route is registered
// behind authMW.Handler (and must 401 without a live token), while /logout is
// registered public (and must reach its handler + revoke + 204 even with NO or
// an EXPIRED access token). If a future change re-gated /logout behind the auth
// middleware, the expired/no-token cases below would flip from 204 to 401.

import (
	"context"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// logoutMockUserClient records whether the server-side Logout (refresh-token
// revoke) was actually invoked.
type logoutMockUserClient struct {
	userv1.UserServiceClient // embed; unused methods panic if hit
	revokedToken             string
	called                   bool
}

func (m *logoutMockUserClient) Logout(_ context.Context, in *userv1.LogoutRequest, _ ...grpc.CallOption) (*userv1.LogoutResponse, error) {
	m.called = true
	m.revokedToken = in.GetRefreshToken()
	return &userv1.LogoutResponse{}, nil
}

// signExpiredAccessToken mints an RS256 token whose exp is already in the past
// — exactly the state a client is in at the typical logout moment.
func signExpiredAccessToken(t *testing.T, key *rsa.PrivateKey, subject string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":   testJWTIssuer,
		"aud":   testJWTAudience,
		"sub":   subject,
		"email": subject + "@example.com",
		"roles": []string{"customer"},
		"iat":   time.Now().Add(-30 * time.Minute).Unix(),
		"exp":   time.Now().Add(-15 * time.Minute).Unix(), // already expired
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := tok.SignedString(key)
	require.NoError(t, err)
	return signed
}

// buildLogoutRouter mirrors the auth-group wiring: /logout is PUBLIC, while a
// representative protected route sits behind authMW.Handler.
func buildLogoutRouter(authMW *middleware.AuthMiddleware, h *AuthHandler) *chi.Mux {
	r := chi.NewRouter()
	r.Route("/api/v1/auth", func(ar chi.Router) {
		// Public, like /refresh — authenticates off the refresh cookie.
		ar.Post("/logout", h.Logout)
		// A protected route to prove the middleware is genuinely active here.
		ar.With(authMW.Handler).Post("/verify-phone", h.VerifyPhone)
	})
	return r
}

func TestLogout_PublicWithoutAccessToken_RevokesAnd204(t *testing.T) {
	t.Parallel()
	key := newTestKeyPair(t)
	authMW := middleware.NewAuthMiddleware(&key.PublicKey, nil)
	mock := &logoutMockUserClient{}
	h := NewAuthHandler(mock, false)
	r := buildLogoutRouter(authMW, h)

	// No Authorization header at all, but a refresh cookie to revoke.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: refreshTokenCookieName, Value: "rt-live-7day"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNoContent, rec.Code, "logout must succeed without a live access token (body=%s)", rec.Body.String())
	assert.True(t, mock.called, "server-side refresh-token revoke must have been invoked")
	assert.Equal(t, "rt-live-7day", mock.revokedToken, "the refresh token from the cookie must be revoked")
}

func TestLogout_PublicWithExpiredAccessToken_RevokesAnd204(t *testing.T) {
	t.Parallel()
	key := newTestKeyPair(t)
	authMW := middleware.NewAuthMiddleware(&key.PublicKey, nil)
	mock := &logoutMockUserClient{}
	h := NewAuthHandler(mock, false)
	r := buildLogoutRouter(authMW, h)

	expired := signExpiredAccessToken(t, key, "user-logging-out")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+expired)
	req.AddCookie(&http.Cookie{Name: refreshTokenCookieName, Value: "rt-live-7day"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// The key regression: an expired token must NOT block logout (was 401).
	require.Equal(t, http.StatusNoContent, rec.Code, "expired access token must not block logout (body=%s)", rec.Body.String())
	assert.True(t, mock.called, "refresh token must still be revoked with an expired access token")
}

// TestProtectedRouteStill401WithoutToken proves the middleware in this test setup
// genuinely rejects unauthenticated requests — so the /logout 204s above are
// because /logout is PUBLIC, not because the middleware is inert.
func TestProtectedRouteStill401WithoutToken(t *testing.T) {
	t.Parallel()
	key := newTestKeyPair(t)
	authMW := middleware.NewAuthMiddleware(&key.PublicKey, nil)
	h := NewAuthHandler(&logoutMockUserClient{}, false)
	r := buildLogoutRouter(authMW, h)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/verify-phone", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code, "a protected route must 401 without a token (proves middleware is active)")
}
