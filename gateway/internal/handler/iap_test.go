package handler

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVerifyAppStore_FlagOff_503(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "")

	h := NewIAPHandler()
	body := `{"jws":"` + testCompactJWS(t, "ES256", `{"transactionId":"0"}`) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
	assert.NotContains(t, rec.Body.String(), `"valid": true`)
	var out map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.Contains(t, out["error"], "not configured")
}

func TestVerifyAppStore_EmptyBody_NeverValidTrue(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "true")

	h := NewIAPHandler()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", nil)
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.NotEqual(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
	assert.NotContains(t, rec.Body.String(), `"valid": true`)
}

func TestVerifyAppStore_MissingJWS_400(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "true")

	h := NewIAPHandler()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
	var out map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.Contains(t, out["error"], "jws")
}

func TestVerifyAppStore_GarbageJWS_400(t *testing.T) {
	h := NewIAPHandler()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(`{"jws":"not-a-jws"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
}

func TestVerifyAppStore_AlgNone_400(t *testing.T) {
	h := NewIAPHandler()
	body := `{"jws":"` + testCompactJWS(t, "none", `{"transactionId":"0"}`) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
}

func TestVerifyAppStore_FlagOnStill503_NeverValidTrue(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "true")
	t.Setenv("APP_STORE_ROOT_CERT_PEM", "-----BEGIN CERTIFICATE-----\nnot-a-real-root\n-----END CERTIFICATE-----")

	h := NewIAPHandler()
	body := `{"jws":"` + testCompactJWS(t, "ES256", `{"transactionId":"0"}`) + `","product_ids":["nomarkup.provider.pro.monthly"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
	assert.NotContains(t, rec.Body.String(), `"valid": true`)
	var out map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.Contains(t, out["error"], "not configured")
}

func TestVerifyAppStore_MissingClaims_401(t *testing.T) {
	h := NewIAPHandler()
	body := `{"jws":"` + testCompactJWS(t, "ES256", `{"transactionId":"0"}`) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
}

func testCompactJWS(t *testing.T, alg, payload string) string {
	t.Helper()
	header, err := json.Marshal(map[string]string{"alg": alg, "typ": "JWT"})
	require.NoError(t, err)
	sig := []byte("not-a-real-signature")
	return strings.Join([]string{
		base64.RawURLEncoding.EncodeToString(header),
		base64.RawURLEncoding.EncodeToString([]byte(payload)),
		base64.RawURLEncoding.EncodeToString(sig),
	}, ".")
}
