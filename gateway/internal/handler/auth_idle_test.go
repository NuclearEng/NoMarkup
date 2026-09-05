package handler

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"crypto/rsa"

	"github.com/golang-jwt/jwt/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// These constants mirror the gateway's default JWT iss/aud (middleware/auth.go)
// so a token we sign here validates through AuthMiddleware.ValidateToken.
const (
	testJWTIssuer   = "https://auth.nomarkup.com"
	testJWTAudience = "nomarkup-api"
)

// refreshMockUserClient is a minimal UserServiceClient whose RefreshToken returns
// a preconfigured access token (so the gateway decodes a known userID/roles).
type refreshMockUserClient struct {
	userv1.UserServiceClient // embed; unused methods panic if hit
	accessToken              string
	refreshToken             string
}

func (m *refreshMockUserClient) RefreshToken(_ context.Context, _ *userv1.RefreshTokenRequest, _ ...grpc.CallOption) (*userv1.RefreshTokenResponse, error) {
	return &userv1.RefreshTokenResponse{
		AccessToken:          m.accessToken,
		RefreshToken:         m.refreshToken,
		AccessTokenExpiresAt: timestamppb.New(time.Now().Add(15 * time.Minute)),
	}, nil
}

func newTestKeyPair(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	return key
}

// signAccessToken mints an RS256 access token carrying the given subject/roles
// with the gateway's expected iss/aud so AuthMiddleware accepts it.
func signAccessToken(t *testing.T, key *rsa.PrivateKey, subject string, roles []string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":   testJWTIssuer,
		"aud":   testJWTAudience,
		"sub":   subject,
		"email": subject + "@example.com",
		"roles": roles,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(15 * time.Minute).Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := tok.SignedString(key)
	require.NoError(t, err)
	return signed
}

func idleHandlerTestCache(t *testing.T) *cache.Client {
	t.Helper()
	c := cache.New("redis://localhost:6379")
	if c == nil {
		t.Skip("Redis unavailable, skipping refresh idle-check integration test")
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func idleKey(userID string) string { return cache.Key("sess", "idle", userID) }

// doRefresh runs the Refresh handler with the refresh_token supplied via cookie
// and returns the recorder.
func doRefresh(h *AuthHandler) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: refreshTokenCookieName, Value: "rt-old"})
	rec := httptest.NewRecorder()
	h.Refresh(rec, req)
	return rec
}

// TestRefresh_IdleKeyPresent_Allows verifies an active session (idle key present)
// refreshes normally: 200 + a new access token + a reset idle key.
func TestRefresh_IdleKeyPresent_Allows(t *testing.T) {
	c := idleHandlerTestCache(t)
	ctx := context.Background()

	key := newTestKeyPair(t)
	userID := "user-active-" + t.Name()
	access := signAccessToken(t, key, userID, []string{"customer"})

	// Seed the idle key (simulates a recently-active session).
	require.NoError(t, c.Redis().Set(ctx, idleKey(userID), "1", 60*time.Minute).Err())
	t.Cleanup(func() { c.Redis().Del(ctx, idleKey(userID)) })

	authMW := middleware.NewAuthMiddleware(&key.PublicKey, c)
	h := NewAuthHandler(&refreshMockUserClient{accessToken: access, refreshToken: "rt-new"}, false, "test-session-secret").
		WithIdleSession(authMW)

	rec := doRefresh(h)

	require.Equal(t, http.StatusOK, rec.Code)
	var body authResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, access, body.AccessToken, "active session should receive the new access token")

	// Idle key still present (reset), session continues.
	n, err := c.Redis().Exists(ctx, idleKey(userID)).Result()
	require.NoError(t, err)
	assert.Equal(t, int64(1), n)
}

// TestRefresh_IdleKeyAbsent_Rejects verifies a session idle past its role window
// (idle key expired/absent) is rejected with 401 and gets no new access token.
func TestRefresh_IdleKeyAbsent_Rejects(t *testing.T) {
	c := idleHandlerTestCache(t)
	ctx := context.Background()

	key := newTestKeyPair(t)
	userID := "user-idle-" + t.Name()
	access := signAccessToken(t, key, userID, []string{"admin"})

	// Ensure NO idle key exists (simulates idle-past-timeout).
	c.Redis().Del(ctx, idleKey(userID))

	authMW := middleware.NewAuthMiddleware(&key.PublicKey, c)
	h := NewAuthHandler(&refreshMockUserClient{accessToken: access, refreshToken: "rt-new"}, false, "test-session-secret").
		WithIdleSession(authMW)

	rec := doRefresh(h)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "timed out due to inactivity")

	// No access token must be returned, and no idle key created.
	assert.NotContains(t, rec.Body.String(), access)
	n, err := c.Redis().Exists(ctx, idleKey(userID)).Result()
	require.NoError(t, err)
	assert.Equal(t, int64(0), n, "rejected refresh must not seed an idle key")
}

// TestRefresh_NoIdleWiring_FailsOpen verifies that without idle wiring (no
// authMW / cache), Refresh proceeds normally — the idle timeout never blocks a
// refresh when the cache layer is absent (fail open).
func TestRefresh_NoIdleWiring_FailsOpen(t *testing.T) {
	t.Parallel()

	key := newTestKeyPair(t)
	access := signAccessToken(t, key, "user-x", []string{"customer"})

	// No WithIdleSession call -> authMW nil -> enforcement skipped.
	h := NewAuthHandler(&refreshMockUserClient{accessToken: access, refreshToken: "rt-new"}, false, "test-session-secret")

	rec := doRefresh(h)

	require.Equal(t, http.StatusOK, rec.Code)
	var body authResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, access, body.AccessToken)
}
