package handler

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const testBackgroundCheckUserID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

func withProviderClaims(req *http.Request, userID string) *http.Request {
	c := &middleware.Claims{
		UserID: userID,
		Email:  "provider@example.com",
		Roles:  []string{"provider"},
	}
	return req.WithContext(context.WithValue(req.Context(), middleware.ClaimsContextKey, c))
}

// TestBackgroundCheckCreate_MissingAPIKey_503 asserts FR-2.9 fail-closed:
// POST without CHECKR_API_KEY must never invent a PASS / clear status.
func TestBackgroundCheckCreate_MissingAPIKey_503(t *testing.T) {
	t.Setenv("CHECKR_API_KEY", "")
	t.Setenv("CHECKR_PACKAGE", "driver_pro")

	h := &BackgroundCheckHandler{db: nil, client: http.DefaultClient}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/providers/me/background-check", nil)
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.Create(rec, req)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code, "body=%s", rec.Body.String())
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Contains(t, body["error"], "CHECKR_API_KEY")
	lower := strings.ToLower(rec.Body.String())
	assert.NotContains(t, lower, `"status":"clear"`)
	assert.NotContains(t, lower, `"status":"passed"`)
	assert.NotContains(t, lower, `"status":"pass"`)
}

// TestBackgroundCheckCreate_MissingClaims_401.
func TestBackgroundCheckCreate_MissingClaims_401(t *testing.T) {
	t.Setenv("CHECKR_API_KEY", "test-key")
	h := &BackgroundCheckHandler{db: nil}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/providers/me/background-check", nil)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

// TestBackgroundCheckCreate_MissingPackage_503 when key is set but package is not.
func TestBackgroundCheckCreate_MissingPackage_503(t *testing.T) {
	t.Setenv("CHECKR_API_KEY", "ck_test_secret")
	t.Setenv("CHECKR_PACKAGE", "")

	h := &BackgroundCheckHandler{db: nil, client: http.DefaultClient}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/providers/me/background-check", nil)
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()
	h.Create(rec, req)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code, "body=%s", rec.Body.String())
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Contains(t, body["error"], "CHECKR_PACKAGE")
}

// TestBackgroundCheckGet_NilDB_503.
func TestBackgroundCheckGet_NilDB_503(t *testing.T) {
	h := NewBackgroundCheckHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers/me/background-check", nil)
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
}

// TestSplitDisplayName covers candidate name splitting for Checkr payload.
func TestSplitDisplayName(t *testing.T) {
	f, l := splitDisplayName("Jane Doe")
	assert.Equal(t, "Jane", f)
	assert.Equal(t, "Doe", l)

	f, l = splitDisplayName("Madonna")
	assert.Equal(t, "Madonna", f)
	assert.Equal(t, "User", l)

	f, l = splitDisplayName("  ")
	assert.Equal(t, "Provider", f)
	assert.Equal(t, "User", l)
}

// TestCheckrCreateCandidate_HTTPSuccess hits a local stub server.
func TestCheckrCreateCandidate_HTTPSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/candidates", r.URL.Path)
		user, _, ok := r.BasicAuth()
		assert.True(t, ok)
		assert.Equal(t, "ck_test", user)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cand_123","object":"candidate"}`))
	}))
	t.Cleanup(srv.Close)

	id, err := checkrCreateCandidate(
		t.Context(),
		srv.Client(),
		srv.URL+"/v1",
		"ck_test",
		"p@example.com",
		"Pat",
		"Provider",
	)
	require.NoError(t, err)
	assert.Equal(t, "cand_123", id)
}

// TestCheckrWebhook_MissingSecret_503 never persists without CHECKR_WEBHOOK_SECRET.
func TestCheckrWebhook_MissingSecret_503(t *testing.T) {
	t.Setenv("CHECKR_WEBHOOK_SECRET", "")

	h := &BackgroundCheckHandler{db: nil}
	payload := `{"type":"report.completed","data":{"object":{"id":"rep_1","status":"complete","result":"clear"}}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/checkr", strings.NewReader(payload))
	req.Header.Set("X-Checkr-Signature", "00")
	rec := httptest.NewRecorder()

	h.HandleWebhook(rec, req)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code, "body=%s", rec.Body.String())
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Contains(t, body["error"], "CHECKR_WEBHOOK_SECRET")
	lower := strings.ToLower(rec.Body.String())
	assert.NotContains(t, lower, `"status":"clear"`)
	assert.NotContains(t, lower, `"status":"pass"`)
	assert.NotContains(t, lower, `"status":"passed"`)
}

// TestCheckrWebhook_BadSignature_401 does not persist on HMAC mismatch.
func TestCheckrWebhook_BadSignature_401(t *testing.T) {
	t.Setenv("CHECKR_WEBHOOK_SECRET", "whsec_test")

	h := &BackgroundCheckHandler{db: nil}
	payload := `{"type":"report.completed","data":{"object":{"id":"rep_1","status":"complete","result":"clear"}}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/checkr", strings.NewReader(payload))
	req.Header.Set("X-Checkr-Signature", "deadbeef")
	rec := httptest.NewRecorder()

	h.HandleWebhook(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code, "body=%s", rec.Body.String())
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Contains(t, body["error"], "signature")
	assert.NotContains(t, strings.ToLower(rec.Body.String()), `"status":"clear"`)
}

// TestCheckrWebhook_MissingSignature_401.
func TestCheckrWebhook_MissingSignature_401(t *testing.T) {
	t.Setenv("CHECKR_WEBHOOK_SECRET", "whsec_test")

	h := &BackgroundCheckHandler{db: nil}
	payload := `{"type":"report.completed","data":{"object":{"id":"rep_1","result":"clear"}}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/checkr", strings.NewReader(payload))
	rec := httptest.NewRecorder()

	h.HandleWebhook(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code, "body=%s", rec.Body.String())
}

// TestCheckrWebhook_ValidSignature_NilDB_503 proves persist is after verify.
func TestCheckrWebhook_ValidSignature_NilDB_503(t *testing.T) {
	const secret = "whsec_test"
	t.Setenv("CHECKR_WEBHOOK_SECRET", secret)

	h := &BackgroundCheckHandler{db: nil}
	payload := `{"type":"report.completed","data":{"object":{"id":"rep_1","candidate_id":"cand_1","status":"complete","result":"clear"}}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/checkr", strings.NewReader(payload))
	req.Header.Set("X-Checkr-Signature", checkrTestHMAC(secret, payload))
	rec := httptest.NewRecorder()

	h.HandleWebhook(rec, req)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code, "body=%s", rec.Body.String())
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Contains(t, body["error"], "database")
	assert.NotContains(t, strings.ToLower(rec.Body.String()), `"status":"pass"`)
}

func TestMapCheckrWebhookStatus_NeverInventPass(t *testing.T) {
	_, ok := mapCheckrWebhookStatus("report.completed", "complete", "pass")
	assert.False(t, ok, "must not map invented PASS")

	_, ok = mapCheckrWebhookStatus("report.completed", "complete", "passed")
	assert.False(t, ok)

	got, ok := mapCheckrWebhookStatus("report.completed", "complete", "clear")
	assert.True(t, ok)
	assert.Equal(t, "clear", got)

	got, ok = mapCheckrWebhookStatus("report.completed", "complete", "consider")
	assert.True(t, ok)
	assert.Equal(t, "consider", got)

	got, ok = mapCheckrWebhookStatus("invitation.completed", "completed", "")
	assert.True(t, ok)
	assert.Equal(t, "pending", got)
}

func TestCheckrWebhookSignatureValid(t *testing.T) {
	const secret = "whsec_test"
	body := []byte(`{"type":"report.updated"}`)
	sig := checkrTestHMAC(secret, string(body))
	assert.True(t, checkrWebhookSignatureValid(secret, body, sig))
	assert.True(t, checkrWebhookSignatureValid(secret, body, "sha256="+sig))
	assert.False(t, checkrWebhookSignatureValid(secret, body, "00"))
	assert.False(t, checkrWebhookSignatureValid(secret, body, ""))
	assert.False(t, checkrWebhookSignatureValid("", body, sig))
}

func checkrTestHMAC(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

// TestCheckrCreateInvitation_FallsBackToReport when invitation endpoint errors.
func TestCheckrCreateInvitation_FallsBackToReport(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/invitations", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"not allowed"}`, http.StatusUnprocessableEntity)
	})
	mux.HandleFunc("/v1/reports", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"rep_999","object":"report","status":"pending"}`))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	invURL, id, err := checkrCreateInvitation(
		t.Context(),
		srv.Client(),
		srv.URL+"/v1",
		"ck_test",
		"cand_1",
		"driver_pro",
		"WA",
	)
	require.NoError(t, err)
	assert.Empty(t, invURL)
	assert.Equal(t, "rep_999", id)
}
