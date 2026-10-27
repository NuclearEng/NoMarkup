package service

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
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/pkg/appleauth"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

type fakeAppleTokenLister struct {
	tokens []EncryptedAppleToken
	err    error
	calls  int
}

func (f *fakeAppleTokenLister) ListAppleRefreshTokens(_ context.Context, _ string) ([]EncryptedAppleToken, error) {
	f.calls++
	return f.tokens, f.err
}

// rot13ish "cipher": ciphertext is "enc:"+plaintext.
type fakeDecrypter struct{}

func (fakeDecrypter) DecryptString(s string) (string, error) {
	if !strings.HasPrefix(s, "enc:") {
		return "", errors.New("bad ciphertext")
	}
	return strings.TrimPrefix(s, "enc:"), nil
}

// fakeAppleRevokeServer mimics https://appleid.apple.com/auth/revoke.
type fakeAppleRevokeServer struct {
	mu        sync.Mutex
	revoked   []string
	clientIDs []string
	failFirst int
	calls     int
}

func (f *fakeAppleRevokeServer) handler(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	_ = r.ParseForm()
	if r.URL.Path != "/auth/revoke" || r.Form.Get("client_secret") == "" || r.Form.Get("token_type_hint") != "refresh_token" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_request"}`))
		return
	}
	if f.failFirst > 0 {
		f.failFirst--
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	f.revoked = append(f.revoked, r.Form.Get("token"))
	f.clientIDs = append(f.clientIDs, r.Form.Get("client_id"))
}

func newFakeAppleClient(t *testing.T, fake *fakeAppleRevokeServer) *appleauth.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(fake.handler))
	t.Cleanup(srv.Close)
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	der, err := x509.MarshalPKCS8PrivateKey(k)
	require.NoError(t, err)
	c, err := appleauth.New(appleauth.Config{
		TeamID: "TEAMID1234", KeyID: "KEYID12345", ClientID: "com.example.default",
		PrivateKeyPEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		RevokeURL:     srv.URL + "/auth/revoke", HTTPClient: srv.Client(),
	})
	require.NoError(t, err)
	return c
}

func fastRevoker(l AppleTokenLister, c *appleauth.Client) *AppleRevoker {
	r := NewAppleRevoker(l, fakeDecrypter{}, c)
	r.backoff = time.Millisecond
	return r
}

func TestAppleRevoker_RevokesEachStoredTokenWithRetry(t *testing.T) {
	fake := &fakeAppleRevokeServer{failFirst: 2}
	lister := &fakeAppleTokenLister{tokens: []EncryptedAppleToken{
		{ClientID: "com.example.app", EncryptedSecret: "enc:native-token"},
		{ClientID: "", EncryptedSecret: "enc:web-token"},
	}}
	r := fastRevoker(lister, newFakeAppleClient(t, fake))
	require.NoError(t, r.RevokeUserTokens(context.Background(), "user-1"))
	assert.Equal(t, []string{"native-token", "web-token"}, fake.revoked)
	assert.Equal(t, []string{"com.example.app", "com.example.default"}, fake.clientIDs)
	assert.Equal(t, 4, fake.calls, "two 503s retried, then two successes")
}

func TestAppleRevoker_ReportsUndecryptableAndPersistentFailures(t *testing.T) {
	fake := &fakeAppleRevokeServer{failFirst: 100}
	lister := &fakeAppleTokenLister{tokens: []EncryptedAppleToken{
		{EncryptedSecret: "garbage"},
		{EncryptedSecret: "enc:t1"},
	}}
	r := fastRevoker(lister, newFakeAppleClient(t, fake))
	err := r.RevokeUserTokens(context.Background(), "user-1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "decrypt")
	assert.Contains(t, err.Error(), "503")
	assert.Equal(t, 3, fake.calls, "bounded to 3 attempts")
}

func TestErasure_Finalize_RevokesAppleGrantCapturedBeforeCascade(t *testing.T) {
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	fake := &fakeAppleRevokeServer{}
	lister := &fakeAppleTokenLister{tokens: []EncryptedAppleToken{{ClientID: "com.example.app", EncryptedSecret: "enc:tok-1"}}}

	var listedBeforeCascade bool
	repo.finalizeImpl = func(_ context.Context, _ string) (domain.ErasureCounts, error) {
		listedBeforeCascade = lister.calls == 1
		lister.tokens = nil // cascade deletes oauth_accounts
		return domain.ErasureCounts{"users": 1}, nil
	}
	e := NewErasure(repo, nil, nil, fastRevoker(lister, newFakeAppleClient(t, fake)), nil)
	_, err := e.FinalizeAccountDeletion(ctx, "user-1", true)
	require.NoError(t, err)
	assert.True(t, listedBeforeCascade, "tokens must be read before the cascade deletes them")
	assert.Equal(t, []string{"tok-1"}, fake.revoked)
}

func TestErasure_Finalize_AppleFailuresDoNotBlockDeletion(t *testing.T) {
	ctx := context.Background()

	t.Run("prepare fails", func(t *testing.T) {
		repo := newFakeDeletionRepo()
		repo.requested["user-1"] = time.Now().Add(-2 * domain.DeletionGracePeriod)
		lister := &fakeAppleTokenLister{err: errors.New("db down")}
		e := NewErasure(repo, nil, nil, fastRevoker(lister, newFakeAppleClient(t, &fakeAppleRevokeServer{})), nil)
		out, err := e.FinalizeAccountDeletion(ctx, "user-1", true)
		require.NoError(t, err)
		assert.Equal(t, "user-1", out.UserID)
	})
	t.Run("apple down", func(t *testing.T) {
		repo := newFakeDeletionRepo()
		repo.requested["user-1"] = time.Now().Add(-2 * domain.DeletionGracePeriod)
		lister := &fakeAppleTokenLister{tokens: []EncryptedAppleToken{{EncryptedSecret: "enc:t"}}}
		e := NewErasure(repo, nil, nil, fastRevoker(lister, newFakeAppleClient(t, &fakeAppleRevokeServer{failFirst: 100})), nil)
		out, err := e.FinalizeAccountDeletion(ctx, "user-1", true)
		require.NoError(t, err)
		assert.Equal(t, "user-1", out.UserID)
	})
}
