package handler

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/fxamacker/cbor/v2"
	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

// IOS-SEC.2 (server half) tests: full options→verify round trips for
// registration and assertion using a software ES256 authenticator, plus
// flag-gating, auth requirements, enumeration resistance, challenge
// single-use, and sign-count regression rejection.

const (
	testPasskeyRPID   = "no-markup.com"
	testPasskeyOrigin = "https://no-markup.com"
	testPasskeyUserID = "6b1c9c2e-8f4a-4a5e-9b3d-2f1a0c9d8e7f"
	testPasskeyEmail  = "passkey-tester@example.com"
)

// --- fakes ---

type passkeyMockUserClient struct {
	userv1.UserServiceClient // embed; unused methods panic if hit
	findOrCreateByOAuthFn    func(ctx context.Context, req *userv1.FindOrCreateByOAuthRequest) (*userv1.FindOrCreateByOAuthResponse, error)
}

func (m *passkeyMockUserClient) FindOrCreateByOAuth(ctx context.Context, req *userv1.FindOrCreateByOAuthRequest, _ ...grpc.CallOption) (*userv1.FindOrCreateByOAuthResponse, error) {
	return m.findOrCreateByOAuthFn(ctx, req)
}

// fakePasskeyStore is an in-memory passkeyStore.
type fakePasskeyStore struct {
	mu           sync.Mutex
	users        map[string]*passkeyUserRow // by id
	usersByEmail map[string]string          // email → id
	creds        map[string]passkeyCredentialRow
	credOwner    map[string]string // credential id → user id
}

func newFakePasskeyStore() *fakePasskeyStore {
	return &fakePasskeyStore{
		users:        map[string]*passkeyUserRow{},
		usersByEmail: map[string]string{},
		creds:        map[string]passkeyCredentialRow{},
		credOwner:    map[string]string{},
	}
}

func (s *fakePasskeyStore) addUser(row *passkeyUserRow) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[row.ID] = row
	s.usersByEmail[row.Email] = row.ID
}

func (s *fakePasskeyStore) UserByID(_ context.Context, userID string) (*passkeyUserRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if u, ok := s.users[userID]; ok {
		return u, nil
	}
	return nil, errPasskeyUserNotFound
}

func (s *fakePasskeyStore) UserByEmail(_ context.Context, email string) (*passkeyUserRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id, ok := s.usersByEmail[email]; ok {
		return s.users[id], nil
	}
	return nil, errPasskeyUserNotFound
}

func (s *fakePasskeyStore) UserCredentials(_ context.Context, userID string) ([]passkeyCredentialRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []passkeyCredentialRow
	for key, c := range s.creds {
		if s.credOwner[key] == userID {
			out = append(out, c)
		}
	}
	return out, nil
}

func (s *fakePasskeyStore) UserIDByCredentialID(_ context.Context, credentialID []byte) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if owner, ok := s.credOwner[string(credentialID)]; ok {
		return owner, nil
	}
	return "", errPasskeyCredentialNotFound
}

func (s *fakePasskeyStore) InsertCredential(_ context.Context, userID string, row passkeyCredentialRow) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := string(row.CredentialID)
	if _, exists := s.creds[key]; exists {
		return errPasskeyCredentialExists
	}
	s.creds[key] = row
	s.credOwner[key] = userID
	return nil
}

func (s *fakePasskeyStore) UpdateCredentialOnLogin(_ context.Context, credentialID []byte, signCount int64, flags int16) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := string(credentialID)
	row, ok := s.creds[key]
	if !ok {
		return errPasskeyCredentialNotFound
	}
	row.SignCount = signCount
	row.Flags = flags
	s.creds[key] = row
	return nil
}

func (s *fakePasskeyStore) signCount(credentialID []byte) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.creds[string(credentialID)].SignCount
}

// newTestPasskeyHandler builds a handler with in-memory stores (same-package
// field injection; the pgx/redis implementations are exercised in the live
// stack, the ceremony/protocol logic is what these tests pin down).
func newTestPasskeyHandler(t *testing.T, store passkeyStore, uc userv1.UserServiceClient) *PasskeyHandler {
	t.Helper()
	wa, err := webauthn.New(&webauthn.Config{
		RPID:          testPasskeyRPID,
		RPDisplayName: passkeyRPName,
		RPOrigins:     []string{testPasskeyOrigin},
		Timeouts: webauthn.TimeoutsConfig{
			Login:        webauthn.TimeoutConfig{Enforce: true, Timeout: passkeyCeremonyTTL, TimeoutUVD: passkeyCeremonyTTL},
			Registration: webauthn.TimeoutConfig{Enforce: true, Timeout: passkeyCeremonyTTL, TimeoutUVD: passkeyCeremonyTTL},
		},
	})
	require.NoError(t, err)
	return &PasskeyHandler{
		store:      store,
		sessions:   newMemoryPasskeySessionStore(),
		userClient: uc,
		auth:       NewAuthHandler(uc, false, "test-session-secret"),
		webAuthn:   wa,
	}
}

// --- software authenticator (ES256, attestation "none") ---

type testAuthenticator struct {
	key          *ecdsa.PrivateKey
	credentialID []byte
	rpIDHash     [32]byte
	userHandle   []byte
	counter      uint32
}

func newTestAuthenticator(t *testing.T, userID string) *testAuthenticator {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	credID := make([]byte, 16)
	_, err = rand.Read(credID)
	require.NoError(t, err)
	return &testAuthenticator{
		key:          key,
		credentialID: credID,
		rpIDHash:     sha256.Sum256([]byte(testPasskeyRPID)),
		userHandle:   []byte(userID),
	}
}

// coseKey encodes the public key as a COSE_Key (EC2, P-256, ES256).
func (a *testAuthenticator) coseKey(t *testing.T) []byte {
	t.Helper()
	x := a.key.PublicKey.X.FillBytes(make([]byte, 32))
	y := a.key.PublicKey.Y.FillBytes(make([]byte, 32))
	key, err := cbor.Marshal(map[int]any{
		1:  2,  // kty: EC2
		3:  -7, // alg: ES256
		-1: 1,  // crv: P-256
		-2: x,
		-3: y,
	})
	require.NoError(t, err)
	return key
}

// registrationResponse builds a standard WebAuthn registration credential
// JSON body for the given options challenge.
func (a *testAuthenticator) registrationResponse(t *testing.T, challenge string) []byte {
	t.Helper()

	clientData := fmt.Sprintf(`{"type":"webauthn.create","challenge":%q,"origin":%q}`, challenge, testPasskeyOrigin)

	var authData bytes.Buffer
	authData.Write(a.rpIDHash[:])
	authData.WriteByte(0x45) // UP | UV | AT
	require.NoError(t, binary.Write(&authData, binary.BigEndian, a.counter))
	authData.Write(make([]byte, 16)) // zero AAGUID
	require.NoError(t, binary.Write(&authData, binary.BigEndian, uint16(len(a.credentialID))))
	authData.Write(a.credentialID)
	authData.Write(a.coseKey(t))

	attObj, err := cbor.Marshal(map[string]any{
		"fmt":      "none",
		"attStmt":  map[string]any{},
		"authData": authData.Bytes(),
	})
	require.NoError(t, err)

	body, err := json.Marshal(map[string]any{
		"id":    base64.RawURLEncoding.EncodeToString(a.credentialID),
		"rawId": base64.RawURLEncoding.EncodeToString(a.credentialID),
		"type":  "public-key",
		"response": map[string]any{
			"clientDataJSON":    base64.RawURLEncoding.EncodeToString([]byte(clientData)),
			"attestationObject": base64.RawURLEncoding.EncodeToString(attObj),
			"transports":        []string{"internal"},
		},
	})
	require.NoError(t, err)
	return body
}

// assertionResponse signs a standard WebAuthn assertion for the given
// challenge with the authenticator's current counter value.
func (a *testAuthenticator) assertionResponse(t *testing.T, challenge string) []byte {
	t.Helper()

	clientData := fmt.Sprintf(`{"type":"webauthn.get","challenge":%q,"origin":%q}`, challenge, testPasskeyOrigin)

	var authData bytes.Buffer
	authData.Write(a.rpIDHash[:])
	authData.WriteByte(0x05) // UP | UV
	require.NoError(t, binary.Write(&authData, binary.BigEndian, a.counter))

	clientDataHash := sha256.Sum256([]byte(clientData))
	sigInput := append(authData.Bytes(), clientDataHash[:]...)
	digest := sha256.Sum256(sigInput)
	sig, err := ecdsa.SignASN1(rand.Reader, a.key, digest[:])
	require.NoError(t, err)

	body, err := json.Marshal(map[string]any{
		"id":    base64.RawURLEncoding.EncodeToString(a.credentialID),
		"rawId": base64.RawURLEncoding.EncodeToString(a.credentialID),
		"type":  "public-key",
		"response": map[string]any{
			"clientDataJSON":    base64.RawURLEncoding.EncodeToString([]byte(clientData)),
			"authenticatorData": base64.RawURLEncoding.EncodeToString(authData.Bytes()),
			"signature":         base64.RawURLEncoding.EncodeToString(sig),
			"userHandle":        base64.RawURLEncoding.EncodeToString(a.userHandle),
		},
	})
	require.NoError(t, err)
	return body
}

// --- request helpers ---

func passkeyPost(path string, body []byte) *http.Request {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

// optionsChallenge extracts publicKey.challenge (and allowCredentials) from
// an options response body.
type parsedOptions struct {
	PublicKey struct {
		Challenge        string `json:"challenge"`
		AllowCredentials []struct {
			ID string `json:"id"`
		} `json:"allowCredentials"`
		Rp struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"rp"`
		PubKeyCredParams []struct {
			Alg  int    `json:"alg"`
			Type string `json:"type"`
		} `json:"pubKeyCredParams"`
	} `json:"publicKey"`
}

func decodeOptions(t *testing.T, rec *httptest.ResponseRecorder) parsedOptions {
	t.Helper()
	var out parsedOptions
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), "body=%s", rec.Body.String())
	require.NotEmpty(t, out.PublicKey.Challenge, "options must carry a challenge: %s", rec.Body.String())
	return out
}

func seedPasskeyUser(store *fakePasskeyStore) *passkeyUserRow {
	row := &passkeyUserRow{ID: testPasskeyUserID, Email: testPasskeyEmail, DisplayName: "Passkey Tester"}
	store.addUser(row)
	return row
}

// registerPasskey runs the full options→verify registration round trip and
// fails the test on any deviation.
func registerPasskey(t *testing.T, h *PasskeyHandler, auth *testAuthenticator, userID string) {
	t.Helper()

	req := addClaimsToRequest(passkeyPost("/api/v1/auth/passkeys/register/options", nil), userID, testPasskeyEmail, []string{"customer"})
	rec := httptest.NewRecorder()
	h.RegisterOptions(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, "register options: %s", rec.Body.String())
	opts := decodeOptions(t, rec)

	req = addClaimsToRequest(passkeyPost("/api/v1/auth/passkeys/register/verify", auth.registrationResponse(t, opts.PublicKey.Challenge)), userID, testPasskeyEmail, []string{"customer"})
	rec = httptest.NewRecorder()
	h.RegisterVerify(rec, req)
	require.Equal(t, http.StatusNoContent, rec.Code, "register verify: %s", rec.Body.String())
}

// --- tests ---

func TestPasskeyRegistrationRoundTrip(t *testing.T) {
	t.Parallel()
	store := newFakePasskeyStore()
	user := seedPasskeyUser(store)
	h := newTestPasskeyHandler(t, store, nil)
	auth := newTestAuthenticator(t, user.ID)

	// Options: correct RP identity, ES256 offered, challenge present.
	req := addClaimsToRequest(passkeyPost("/api/v1/auth/passkeys/register/options", nil), user.ID, user.Email, []string{"customer"})
	rec := httptest.NewRecorder()
	h.RegisterOptions(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	opts := decodeOptions(t, rec)
	assert.Equal(t, testPasskeyRPID, opts.PublicKey.Rp.ID)
	assert.Equal(t, passkeyRPName, opts.PublicKey.Rp.Name)
	require.NotEmpty(t, opts.PublicKey.PubKeyCredParams)
	assert.Equal(t, -7, opts.PublicKey.PubKeyCredParams[0].Alg, "ES256 must be offered")

	// Verify: 204 and the credential is persisted with transports.
	req = addClaimsToRequest(passkeyPost("/api/v1/auth/passkeys/register/verify", auth.registrationResponse(t, opts.PublicKey.Challenge)), user.ID, user.Email, []string{"customer"})
	rec = httptest.NewRecorder()
	h.RegisterVerify(rec, req)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())

	creds, err := store.UserCredentials(context.Background(), user.ID)
	require.NoError(t, err)
	require.Len(t, creds, 1)
	assert.Equal(t, auth.credentialID, creds[0].CredentialID)
	assert.NotEmpty(t, creds[0].PublicKey)
	assert.Equal(t, []string{"internal"}, creds[0].Transports)
}

func TestPasskeyRegisterVerify_NoCeremonyInProgress(t *testing.T) {
	t.Parallel()
	store := newFakePasskeyStore()
	user := seedPasskeyUser(store)
	h := newTestPasskeyHandler(t, store, nil)
	auth := newTestAuthenticator(t, user.ID)

	// Verify without ever requesting options → 400 (no state to verify against).
	body := auth.registrationResponse(t, base64.RawURLEncoding.EncodeToString([]byte("bogus-challenge-value")))
	req := addClaimsToRequest(passkeyPost("/api/v1/auth/passkeys/register/verify", body), user.ID, user.Email, []string{"customer"})
	rec := httptest.NewRecorder()
	h.RegisterVerify(rec, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "no passkey registration in progress")
}

func TestPasskeyRegisterEndpoints_RequireAuth(t *testing.T) {
	t.Parallel()
	h := newTestPasskeyHandler(t, newFakePasskeyStore(), nil)

	rec := httptest.NewRecorder()
	h.RegisterOptions(rec, passkeyPost("/api/v1/auth/passkeys/register/options", nil))
	require.Equal(t, http.StatusUnauthorized, rec.Code)

	rec = httptest.NewRecorder()
	h.RegisterVerify(rec, passkeyPost("/api/v1/auth/passkeys/register/verify", []byte(`{}`)))
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestPasskeyAssertionRoundTrip_EmailScoped(t *testing.T) {
	t.Parallel()
	store := newFakePasskeyStore()
	user := seedPasskeyUser(store)

	var mintedFor string
	mock := &passkeyMockUserClient{
		findOrCreateByOAuthFn: func(_ context.Context, req *userv1.FindOrCreateByOAuthRequest) (*userv1.FindOrCreateByOAuthResponse, error) {
			mintedFor = req.GetProviderId()
			assert.Equal(t, "passkey", req.GetProvider())
			assert.Equal(t, user.Email, req.GetEmail())
			return &userv1.FindOrCreateByOAuthResponse{
				UserId:       user.ID,
				AccessToken:  "passkey-access-token",
				RefreshToken: "passkey-refresh-token",
			}, nil
		},
	}
	h := newTestPasskeyHandler(t, store, mock)
	auth := newTestAuthenticator(t, user.ID)
	registerPasskey(t, h, auth, user.ID)

	// Options scoped by email → allowCredentials carries the registered id.
	rec := httptest.NewRecorder()
	h.AssertOptions(rec, passkeyPost("/api/v1/auth/passkeys/assert/options", []byte(fmt.Sprintf(`{"email":%q}`, user.Email))))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	opts := decodeOptions(t, rec)
	require.Len(t, opts.PublicKey.AllowCredentials, 1)
	assert.Equal(t, base64.RawURLEncoding.EncodeToString(auth.credentialID), opts.PublicKey.AllowCredentials[0].ID)

	// Verify → password-login-shaped session response.
	auth.counter = 1
	rec = httptest.NewRecorder()
	h.AssertVerify(rec, passkeyPost("/api/v1/auth/passkeys/assert/verify", auth.assertionResponse(t, opts.PublicKey.Challenge)))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, user.ID, mintedFor)

	var resp map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, "passkey-access-token", resp["access_token"])
	assert.Equal(t, user.ID, resp["user_id"])

	// Same cookie contract as password login: HttpOnly refresh + has_session.
	cookies := rec.Result().Cookies()
	var haveRefresh bool
	for _, c := range cookies {
		if c.Name == refreshTokenCookieName && c.Value == "passkey-refresh-token" {
			haveRefresh = true
			assert.True(t, c.HttpOnly)
		}
	}
	assert.True(t, haveRefresh, "refresh_token cookie must be set like password login")

	// Sign count persisted.
	assert.Equal(t, int64(1), store.signCount(auth.credentialID))
}

func TestPasskeyAssertionRoundTrip_Discoverable(t *testing.T) {
	t.Parallel()
	store := newFakePasskeyStore()
	user := seedPasskeyUser(store)
	mock := &passkeyMockUserClient{
		findOrCreateByOAuthFn: func(_ context.Context, req *userv1.FindOrCreateByOAuthRequest) (*userv1.FindOrCreateByOAuthResponse, error) {
			return &userv1.FindOrCreateByOAuthResponse{
				UserId:      user.ID,
				AccessToken: "discoverable-access-token",
			}, nil
		},
	}
	h := newTestPasskeyHandler(t, store, mock)
	auth := newTestAuthenticator(t, user.ID)
	registerPasskey(t, h, auth, user.ID)

	// No body at all (usernameless) → valid options, no allow list.
	rec := httptest.NewRecorder()
	h.AssertOptions(rec, passkeyPost("/api/v1/auth/passkeys/assert/options", nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	opts := decodeOptions(t, rec)
	assert.Empty(t, opts.PublicKey.AllowCredentials)

	auth.counter = 1
	rec = httptest.NewRecorder()
	h.AssertVerify(rec, passkeyPost("/api/v1/auth/passkeys/assert/verify", auth.assertionResponse(t, opts.PublicKey.Challenge)))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "discoverable-access-token")
}

func TestPasskeyAssertOptions_UnknownEmailIsNotEnumerable(t *testing.T) {
	t.Parallel()
	store := newFakePasskeyStore()
	user := seedPasskeyUser(store) // exists but has NO passkeys
	h := newTestPasskeyHandler(t, store, nil)

	// Unknown email and existing-email-without-passkeys must be identical:
	// 200 + options + empty allowCredentials. No signal that the account
	// exists.
	for _, email := range []string{"nobody@example.com", user.Email} {
		rec := httptest.NewRecorder()
		h.AssertOptions(rec, passkeyPost("/api/v1/auth/passkeys/assert/options", []byte(fmt.Sprintf(`{"email":%q}`, email))))
		require.Equal(t, http.StatusOK, rec.Code, "email=%s body=%s", email, rec.Body.String())
		opts := decodeOptions(t, rec)
		assert.Empty(t, opts.PublicKey.AllowCredentials, "email=%s must yield an empty allow list", email)
	}
}

func TestPasskeyAssertVerify_ChallengeIsSingleUse(t *testing.T) {
	t.Parallel()
	store := newFakePasskeyStore()
	user := seedPasskeyUser(store)
	mock := &passkeyMockUserClient{
		findOrCreateByOAuthFn: func(_ context.Context, _ *userv1.FindOrCreateByOAuthRequest) (*userv1.FindOrCreateByOAuthResponse, error) {
			return &userv1.FindOrCreateByOAuthResponse{UserId: user.ID, AccessToken: "tok"}, nil
		},
	}
	h := newTestPasskeyHandler(t, store, mock)
	auth := newTestAuthenticator(t, user.ID)
	registerPasskey(t, h, auth, user.ID)

	rec := httptest.NewRecorder()
	h.AssertOptions(rec, passkeyPost("/api/v1/auth/passkeys/assert/options", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	opts := decodeOptions(t, rec)

	auth.counter = 1
	body := auth.assertionResponse(t, opts.PublicKey.Challenge)

	rec = httptest.NewRecorder()
	h.AssertVerify(rec, passkeyPost("/api/v1/auth/passkeys/assert/verify", body))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// Byte-identical replay: the challenge was burned on first use.
	rec = httptest.NewRecorder()
	h.AssertVerify(rec, passkeyPost("/api/v1/auth/passkeys/assert/verify", body))
	require.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Passkey sign-in failed")
}

func TestPasskeyAssertVerify_SignCountRegressionRejected(t *testing.T) {
	t.Parallel()
	store := newFakePasskeyStore()
	user := seedPasskeyUser(store)
	minted := 0
	mock := &passkeyMockUserClient{
		findOrCreateByOAuthFn: func(_ context.Context, _ *userv1.FindOrCreateByOAuthRequest) (*userv1.FindOrCreateByOAuthResponse, error) {
			minted++
			return &userv1.FindOrCreateByOAuthResponse{UserId: user.ID, AccessToken: "tok"}, nil
		},
	}
	h := newTestPasskeyHandler(t, store, mock)
	auth := newTestAuthenticator(t, user.ID)
	registerPasskey(t, h, auth, user.ID)

	// Legit login at counter 5.
	rec := httptest.NewRecorder()
	h.AssertOptions(rec, passkeyPost("/api/v1/auth/passkeys/assert/options", nil))
	opts := decodeOptions(t, rec)
	auth.counter = 5
	rec = httptest.NewRecorder()
	h.AssertVerify(rec, passkeyPost("/api/v1/auth/passkeys/assert/verify", auth.assertionResponse(t, opts.PublicKey.Challenge)))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Equal(t, int64(5), store.signCount(auth.credentialID))

	// A counter that went BACKWARDS (cloned key symptom) must be rejected and
	// must not mint a session.
	rec = httptest.NewRecorder()
	h.AssertOptions(rec, passkeyPost("/api/v1/auth/passkeys/assert/options", nil))
	opts = decodeOptions(t, rec)
	auth.counter = 3
	rec = httptest.NewRecorder()
	h.AssertVerify(rec, passkeyPost("/api/v1/auth/passkeys/assert/verify", auth.assertionResponse(t, opts.PublicKey.Challenge)))
	require.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, 1, minted, "regressed sign count must not mint a session")
}

func TestPasskeyAssertVerify_UnknownChallenge(t *testing.T) {
	t.Parallel()
	store := newFakePasskeyStore()
	user := seedPasskeyUser(store)
	h := newTestPasskeyHandler(t, store, nil)
	auth := newTestAuthenticator(t, user.ID)
	registerPasskey(t, h, auth, user.ID)

	// Assertion over a challenge the server never issued → generic 401.
	auth.counter = 1
	body := auth.assertionResponse(t, base64.RawURLEncoding.EncodeToString([]byte("never-issued-challenge")))
	rec := httptest.NewRecorder()
	h.AssertVerify(rec, passkeyPost("/api/v1/auth/passkeys/assert/verify", body))
	require.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "Passkey sign-in failed")
}

func TestPasskeyAssertOptions_MalformedBody(t *testing.T) {
	t.Parallel()
	h := newTestPasskeyHandler(t, newFakePasskeyStore(), nil)
	rec := httptest.NewRecorder()
	h.AssertOptions(rec, passkeyPost("/api/v1/auth/passkeys/assert/options", []byte(`{not-json`)))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

// TestPasskeyRoutes_FlagGate verifies the routes ship dark: with the flag row
// missing (nil DB stands in for "no row") production fails CLOSED with 503
// (SEC-01) while non-production fails open and reaches the handler.
func TestPasskeyRoutes_FlagGate(t *testing.T) {
	// t.Setenv cannot combine with t.Parallel.
	newRouter := func(h *PasskeyHandler) *chi.Mux {
		r := chi.NewRouter()
		r.Route("/api/v1/auth/passkeys", func(r chi.Router) {
			r.Use(middleware.RequireFlag(nil, nil, "passkeys"))
			r.Post("/assert/options", h.AssertOptions)
		})
		return r
	}

	t.Run("production fails closed with 503", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "production")
		h := newTestPasskeyHandler(t, newFakePasskeyStore(), nil)
		rec := httptest.NewRecorder()
		newRouter(h).ServeHTTP(rec, passkeyPost("/api/v1/auth/passkeys/assert/options", nil))
		require.Equal(t, http.StatusServiceUnavailable, rec.Code)
		assert.Contains(t, rec.Body.String(), "currently unavailable")
	})

	t.Run("non-production fails open to the handler", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "development")
		h := newTestPasskeyHandler(t, newFakePasskeyStore(), nil)
		rec := httptest.NewRecorder()
		newRouter(h).ServeHTTP(rec, passkeyPost("/api/v1/auth/passkeys/assert/options", nil))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	})
}

// TestPasskeyRPOriginsDefaults pins the RP origin contract: canonical origin
// always; localhost only outside production.
func TestPasskeyRPOriginsDefaults(t *testing.T) {
	t.Setenv("PASSKEY_RP_ORIGINS", "")

	t.Setenv("ENVIRONMENT", "production")
	assert.Equal(t, []string{"https://no-markup.com"}, passkeyRPOrigins())

	t.Setenv("ENVIRONMENT", "development")
	assert.Equal(t, []string{"https://no-markup.com", "http://localhost:3000"}, passkeyRPOrigins())

	t.Setenv("PASSKEY_RP_ORIGINS", "https://staging.no-markup.com, https://no-markup.com")
	assert.Equal(t, []string{"https://staging.no-markup.com", "https://no-markup.com"}, passkeyRPOrigins())
}
