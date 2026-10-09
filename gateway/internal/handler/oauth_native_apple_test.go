package handler

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	keyfunc "github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

// IOS-SEC.1 (server half): the native SIWA exchange must REQUIRE a raw nonce
// and compare SHA256hex(raw) against the id_token claim. These tests stand up
// a local JWKS (via the appleKeyfuncProvider seam — no network) and mint
// Apple-shaped RS256 id_tokens so the full verification path runs.

const testAppleClientID = "com.nomarkup.app.test"

// appleOAuthMockUserClient stubs only FindOrCreateByOAuth.
type appleOAuthMockUserClient struct {
	userv1.UserServiceClient // embed; unused methods panic if hit
	findOrCreateByOAuthFn    func(ctx context.Context, req *userv1.FindOrCreateByOAuthRequest) (*userv1.FindOrCreateByOAuthResponse, error)
}

func (m *appleOAuthMockUserClient) FindOrCreateByOAuth(ctx context.Context, req *userv1.FindOrCreateByOAuthRequest, _ ...grpc.CallOption) (*userv1.FindOrCreateByOAuthResponse, error) {
	return m.findOrCreateByOAuthFn(ctx, req)
}

// setupFakeAppleJWKS generates an RSA key, installs a keyfunc for it via the
// appleKeyfuncProvider seam, and restores the real provider on cleanup.
func setupFakeAppleJWKS(t *testing.T) *rsa.PrivateKey {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	n := base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.PublicKey.E)).Bytes())
	jwksJSON := fmt.Sprintf(
		`{"keys":[{"kty":"RSA","kid":"test-kid","use":"sig","alg":"RS256","n":%q,"e":%q}]}`,
		n, e,
	)

	kf, err := keyfunc.NewJWKSetJSON(json.RawMessage(jwksJSON))
	require.NoError(t, err)

	orig := appleKeyfuncProvider
	appleKeyfuncProvider = func(context.Context) (keyfunc.Keyfunc, error) { return kf, nil }
	t.Cleanup(func() { appleKeyfuncProvider = orig })

	return key
}

// mintAppleIDToken signs an Apple-shaped id_token. nonceClaim == "" omits the
// claim entirely (Apple's behavior when the authorization request had none).
func mintAppleIDToken(t *testing.T, key *rsa.PrivateKey, nonceClaim string) string {
	t.Helper()

	claims := jwt.MapClaims{
		"iss":   appleIDTokenIssuer,
		"aud":   testAppleClientID,
		"sub":   "apple-sub-0001",
		"email": "siwa-tester@example.com",
		"iat":   time.Now().Add(-time.Minute).Unix(),
		"exp":   time.Now().Add(time.Hour).Unix(),
	}
	if nonceClaim != "" {
		claims["nonce"] = nonceClaim
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = "test-kid"
	signed, err := token.SignedString(key)
	require.NoError(t, err)
	return signed
}

func postNativeAppleSignIn(t *testing.T, h *OAuthHandler, payload map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/apple/native", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.NativeAppleSignIn(rec, req)
	return rec
}

func TestNativeAppleSignIn_NonceBinding(t *testing.T) {
	// t.Setenv cannot combine with t.Parallel.
	t.Setenv("APPLE_CLIENT_ID", testAppleClientID)

	key := setupFakeAppleJWKS(t)
	const rawNonce = "raw-nonce-123456"
	hashedNonce := sha256Hex(rawNonce)

	tests := []struct {
		name string
		// tokenNonce is the nonce claim embedded in the minted id_token
		// ("" = no claim). Apple embeds the HASH the client put on the
		// authorization request.
		tokenNonce string
		// reqNonce is what the client sends to the gateway ("" = absent).
		reqNonce   string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "raw nonce matching hashed claim passes",
			tokenNonce: hashedNonce,
			reqNonce:   rawNonce,
			wantStatus: http.StatusOK,
		},
		{
			name:       "absent nonce is a 400 on the native exchange",
			tokenNonce: hashedNonce,
			reqNonce:   "",
			wantStatus: http.StatusBadRequest,
			wantBody:   "nonce is required",
		},
		{
			name: "client sending the hash (old tautology) is rejected",
			// Pre-fix clients sent the hash; the server must re-hash and
			// mismatch — sha256(hash) != hash. This is the audit's exact
			// tautology scenario and MUST be a 401 now.
			tokenNonce: hashedNonce,
			reqNonce:   hashedNonce,
			wantStatus: http.StatusUnauthorized,
			wantBody:   "invalid apple identity token",
		},
		{
			name:       "wrong raw nonce is rejected",
			tokenNonce: hashedNonce,
			reqNonce:   "a-different-nonce",
			wantStatus: http.StatusUnauthorized,
			wantBody:   "invalid apple identity token",
		},
		{
			name:       "token without nonce claim cannot satisfy a required nonce",
			tokenNonce: "",
			reqNonce:   rawNonce,
			wantStatus: http.StatusUnauthorized,
			wantBody:   "invalid apple identity token",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mock := &appleOAuthMockUserClient{
				findOrCreateByOAuthFn: func(_ context.Context, req *userv1.FindOrCreateByOAuthRequest) (*userv1.FindOrCreateByOAuthResponse, error) {
					assert.Equal(t, "apple", req.GetProvider())
					assert.Equal(t, "apple-sub-0001", req.GetProviderId())
					return &userv1.FindOrCreateByOAuthResponse{
						UserId:       "user-1",
						AccessToken:  "access-token",
						RefreshToken: "refresh-token",
					}, nil
				},
			}
			h := NewOAuthHandler(mock, false, "test-session-secret")

			rec := postNativeAppleSignIn(t, h, map[string]string{
				"identity_token": mintAppleIDToken(t, key, tc.tokenNonce),
				"nonce":          tc.reqNonce,
			})

			require.Equal(t, tc.wantStatus, rec.Code, "body=%s", rec.Body.String())
			if tc.wantBody != "" {
				assert.Contains(t, rec.Body.String(), tc.wantBody)
			}
			if tc.wantStatus == http.StatusOK {
				assert.Contains(t, rec.Body.String(), "access-token")
			}
		})
	}
}

// TestNativeAppleSignIn_MissingIdentityToken keeps the pre-existing contract:
// identity_token is validated before the nonce.
func TestNativeAppleSignIn_MissingIdentityToken(t *testing.T) {
	t.Parallel()
	h := NewOAuthHandler(nil, false, "test-session-secret")
	rec := postNativeAppleSignIn(t, h, map[string]string{"identity_token": "", "nonce": "raw"})
	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "identity_token is required")
}
