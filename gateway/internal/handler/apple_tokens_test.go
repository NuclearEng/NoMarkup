package handler

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/pkg/appleauth"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

type savedAppleToken struct{ userID, sub, clientID, token string }

type fakeAppleSaver struct {
	saved []savedAppleToken
	err   error
}

func (f *fakeAppleSaver) SaveAppleRefreshToken(_ context.Context, userID, sub, clientID, token string) error {
	f.saved = append(f.saved, savedAppleToken{userID, sub, clientID, token})
	return f.err
}

// fakeAppleTokenServer mimics https://appleid.apple.com/auth/token.
func fakeAppleTokenServer(t *testing.T, wantClientID string) (*httptest.Server, *int) {
	t.Helper()
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_ = r.ParseForm()
		if r.URL.Path != "/auth/token" || r.Form.Get("code") != "apple-code-1" ||
			r.Form.Get("client_id") != wantClientID || r.Form.Get("client_secret") == "" ||
			r.Form.Get("redirect_uri") != "" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"a","refresh_token":"apple-refresh-xyz","id_token":"i"}`))
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func testAppleClient(t *testing.T, srv *httptest.Server) *appleauth.Client {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	der, err := x509.MarshalPKCS8PrivateKey(k)
	require.NoError(t, err)
	c, err := appleauth.New(appleauth.Config{
		TeamID: "TEAMID1234", KeyID: "KEYID12345",
		PrivateKeyPEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		ClientID:      testAppleClientID, TokenURL: srv.URL + "/auth/token", HTTPClient: srv.Client(),
	})
	require.NoError(t, err)
	return c
}

func newAppleSignInHandler() *OAuthHandler {
	mock := &appleOAuthMockUserClient{
		findOrCreateByOAuthFn: func(_ context.Context, _ *userv1.FindOrCreateByOAuthRequest) (*userv1.FindOrCreateByOAuthResponse, error) {
			return &userv1.FindOrCreateByOAuthResponse{UserId: "user-1", AccessToken: "access-token", RefreshToken: "refresh-token"}, nil
		},
	}
	return NewOAuthHandler(mock, false, "test-session-secret")
}

func TestNativeAppleSignIn_StoresAppleRefreshTokenFromAuthorizationCode(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", testAppleClientID)
	t.Setenv("APPLE_NATIVE_CLIENT_ID", "")
	key := setupFakeAppleJWKS(t)
	srv, calls := fakeAppleTokenServer(t, testAppleClientID)
	saver := &fakeAppleSaver{}
	h := newAppleSignInHandler().WithAppleTokenCapture(testAppleClient(t, srv), saver)

	rec := postNativeAppleSignIn(t, h, map[string]string{
		"identity_token":     mintAppleIDToken(t, key, sha256Hex("n-1")),
		"nonce":              "n-1",
		"authorization_code": "apple-code-1",
	})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, 1, *calls)
	require.Len(t, saver.saved, 1)
	assert.Equal(t, savedAppleToken{"user-1", "apple-sub-0001", testAppleClientID, "apple-refresh-xyz"}, saver.saved[0])
	assert.NotContains(t, rec.Body.String(), "apple-refresh-xyz", "Apple refresh token must never reach the client")
}

func TestNativeAppleSignIn_CaptureFailuresNeverBlockSignIn(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", testAppleClientID)
	key := setupFakeAppleJWKS(t)

	t.Run("apple rejects code", func(t *testing.T) {
		srv, _ := fakeAppleTokenServer(t, testAppleClientID)
		saver := &fakeAppleSaver{}
		h := newAppleSignInHandler().WithAppleTokenCapture(testAppleClient(t, srv), saver)
		rec := postNativeAppleSignIn(t, h, map[string]string{
			"identity_token": mintAppleIDToken(t, key, sha256Hex("n")), "nonce": "n", "authorization_code": "wrong",
		})
		require.Equal(t, http.StatusOK, rec.Code)
		assert.Empty(t, saver.saved)
	})
	t.Run("store fails", func(t *testing.T) {
		srv, _ := fakeAppleTokenServer(t, testAppleClientID)
		saver := &fakeAppleSaver{err: errors.New("db down")}
		h := newAppleSignInHandler().WithAppleTokenCapture(testAppleClient(t, srv), saver)
		rec := postNativeAppleSignIn(t, h, map[string]string{
			"identity_token": mintAppleIDToken(t, key, sha256Hex("n")), "nonce": "n", "authorization_code": "apple-code-1",
		})
		require.Equal(t, http.StatusOK, rec.Code)
	})
	t.Run("no code / capture disabled", func(t *testing.T) {
		srv, calls := fakeAppleTokenServer(t, testAppleClientID)
		saver := &fakeAppleSaver{}
		h := newAppleSignInHandler().WithAppleTokenCapture(testAppleClient(t, srv), saver)
		rec := postNativeAppleSignIn(t, h, map[string]string{
			"identity_token": mintAppleIDToken(t, key, sha256Hex("n")), "nonce": "n",
		})
		require.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, 0, *calls)
		rec = postNativeAppleSignIn(t, newAppleSignInHandler(), map[string]string{
			"identity_token": mintAppleIDToken(t, key, sha256Hex("n")), "nonce": "n", "authorization_code": "apple-code-1",
		})
		require.Equal(t, http.StatusOK, rec.Code)
	})
}

type recordingExecer struct {
	sql  string
	args []any
	rows int64
}

func (r *recordingExecer) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	r.sql, r.args = sql, args
	return pgconn.NewCommandTag("UPDATE " + map[bool]string{true: "1", false: "0"}[r.rows > 0]), nil
}

type prefixCipher struct{}

func (prefixCipher) EncryptString(s string) (string, error) {
	return "enc:" + strings.Repeat("*", len(s)), nil
}

func TestPGAppleTokenStore_EncryptsBeforeWrite(t *testing.T) {
	db := &recordingExecer{rows: 1}
	store := &PGAppleTokenStore{DB: db, Cipher: prefixCipher{}}
	require.NoError(t, store.SaveAppleRefreshToken(context.Background(), "u1", "sub1", "cid", "plain-token"))
	assert.Contains(t, db.sql, "apple_refresh_token_enc")
	assert.Contains(t, db.sql, "provider = 'apple'")
	for _, a := range db.args {
		assert.NotEqual(t, "plain-token", a, "plaintext token must not be sent to SQL")
	}
	assert.Equal(t, "enc:***********", db.args[0])

	missing := &PGAppleTokenStore{DB: &recordingExecer{rows: 0}, Cipher: prefixCipher{}}
	assert.ErrorIs(t, missing.SaveAppleRefreshToken(context.Background(), "u1", "sub1", "cid", "t"), ErrAppleAccountNotLinked)
}
