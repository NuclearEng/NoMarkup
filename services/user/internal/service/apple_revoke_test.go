package service

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
	t.Setenv("APPLE_TEAM_ID", "")
	t.Setenv("APPLE_KEY_ID", "")
	t.Setenv("APPLE_PRIVATE_KEY", "")
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

func TestAppleOAuthRevoker_RetriesTransientFailure(t *testing.T) {
	t.Setenv("APPLE_CLIENT_SECRET", "test-apple-secret")

	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	revoker := NewAppleOAuthRevoker(fakeAppleRefreshReader{
		tokens: []domain.AppleRefreshToken{{ClientID: "com.nomarkup.app", RefreshToken: "rt"}},
	})
	revoker.client = srv.Client()
	revoker.revokeURL = srv.URL
	revoker.backoff = time.Millisecond

	require.NoError(t, revoker.RevokeUserTokens(context.Background(), "user-1"))
	assert.Equal(t, 3, calls)
}

func TestAppleOAuthRevoker_DoesNotRetryClientError(t *testing.T) {
	t.Setenv("APPLE_CLIENT_SECRET", "test-apple-secret")

	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusBadRequest)
	}))
	t.Cleanup(srv.Close)

	revoker := NewAppleOAuthRevoker(fakeAppleRefreshReader{
		tokens: []domain.AppleRefreshToken{{ClientID: "com.nomarkup.app", RefreshToken: "rt"}},
	})
	revoker.client = srv.Client()
	revoker.revokeURL = srv.URL
	revoker.backoff = time.Millisecond

	err := revoker.RevokeUserTokens(context.Background(), "user-1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status 400")
	assert.Equal(t, 1, calls)
}

// With no static APPLE_CLIENT_SECRET the secret is minted from the .p8 key
// for the STORED client id (web Services ID and native bundle id differ).
func TestAppleOAuthRevoker_MintsSecretPerClientID(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	der, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)
	t.Setenv("APPLE_CLIENT_SECRET", "")
	t.Setenv("APPLE_TEAM_ID", "TEAM123456")
	t.Setenv("APPLE_KEY_ID", "KEY1234567")
	t.Setenv("APPLE_PRIVATE_KEY", string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})))

	var subs []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseForm())
		parts := strings.Split(r.PostForm.Get("client_secret"), ".")
		require.Len(t, parts, 3)
		raw, dErr := base64.RawURLEncoding.DecodeString(parts[1])
		require.NoError(t, dErr)
		var claims map[string]any
		require.NoError(t, json.Unmarshal(raw, &claims))
		assert.Equal(t, r.PostForm.Get("client_id"), claims["sub"])
		assert.Equal(t, "TEAM123456", claims["iss"])
		subs = append(subs, r.PostForm.Get("client_id"))
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	revoker := NewAppleOAuthRevoker(fakeAppleRefreshReader{
		tokens: []domain.AppleRefreshToken{
			{ClientID: "com.nomarkup.web", RefreshToken: "rt-web"},
			{ClientID: "com.nomarkup.app", RefreshToken: "rt-native"},
		},
	})
	revoker.client = srv.Client()
	revoker.revokeURL = srv.URL

	require.NoError(t, revoker.RevokeUserTokens(context.Background(), "user-1"))
	assert.Equal(t, []string{"com.nomarkup.web", "com.nomarkup.app"}, subs)
}
