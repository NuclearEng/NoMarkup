package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeAppleRefreshReader struct {
	tokens []domain.AppleRefreshToken
	err    error
}

func (f fakeAppleRefreshReader) ListAppleRefreshTokens(context.Context, string) ([]domain.AppleRefreshToken, error) {
	return f.tokens, f.err
}

func TestAppleOAuthRevoker_PostsRefreshToken(t *testing.T) {
	t.Setenv("APPLE_CLIENT_SECRET", "test-apple-secret")

	var got urlValues
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		got.raw = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	revoker := NewAppleOAuthRevoker(fakeAppleRefreshReader{
		tokens: []domain.AppleRefreshToken{{
			ClientID:     "com.nomarkup.app",
			RefreshToken: "apple-refresh-1",
		}},
	})
	revoker.client = srv.Client()
	revoker.revokeURL = srv.URL

	err := revoker.RevokeUserTokens(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Contains(t, got.raw, "token=apple-refresh-1")
	assert.Contains(t, got.raw, "client_id=com.nomarkup.app")
	assert.Contains(t, got.raw, "client_secret=test-apple-secret")
	assert.Contains(t, got.raw, "token_type_hint=refresh_token")
}

func TestAppleOAuthRevoker_NoTokenIsSuccess(t *testing.T) {
	revoker := NewAppleOAuthRevoker(fakeAppleRefreshReader{})
	require.NoError(t, revoker.RevokeUserTokens(context.Background(), "user-1"))
}

func TestAppleOAuthRevoker_MissingSecretFailsClosed(t *testing.T) {
	t.Setenv("APPLE_CLIENT_SECRET", "")
	revoker := NewAppleOAuthRevoker(fakeAppleRefreshReader{
		tokens: []domain.AppleRefreshToken{{ClientID: "com.nomarkup.app", RefreshToken: "rt"}},
	})
	err := revoker.RevokeUserTokens(context.Background(), "user-1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "APPLE_CLIENT_SECRET")
}

type urlValues struct {
	raw string
}
