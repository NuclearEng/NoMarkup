package handler

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAppleRootCAG3PEM_Parses(t *testing.T) {
	block, _ := pem.Decode([]byte(appleRootCAG3PEM))
	require.NotNil(t, block)
	cert, err := x509.ParseCertificate(block.Bytes)
	require.NoError(t, err)
	assert.Equal(t, "Apple Root CA - G3", cert.Subject.CommonName)

	pool, err := appleRootCertPool()
	require.NoError(t, err)
	require.NotNil(t, pool)
}

func TestVerifyAppStore_FlagOff_503(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "")

	h := NewIAPHandler(nil)
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

	h := NewIAPHandler(nil)
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

	h := NewIAPHandler(nil)
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
	h := NewIAPHandler(nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(`{"jws":"not-a-jws"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
}

func TestVerifyAppStore_AlgNone_400(t *testing.T) {
	h := NewIAPHandler(nil)
	body := `{"jws":"` + testCompactJWS(t, "none", `{"transactionId":"0"}`) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
}

func TestVerifyAppStore_MissingX5C_400(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "true")
	t.Setenv("APP_STORE_ROOT_CERT_PEM", "-----BEGIN CERTIFICATE-----\nnot-a-real-root\n-----END CERTIFICATE-----")

	h := NewIAPHandler(nil)
	body := `{"jws":"` + testCompactJWS(t, "ES256", `{"transactionId":"0"}`) + `","product_ids":["nomarkup.provider.pro.monthly"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
	assert.NotContains(t, rec.Body.String(), `"valid": true`)
	var out map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.Contains(t, out["error"], "x5c")
}

func TestVerifyAppStore_MissingClaims_401(t *testing.T) {
	h := NewIAPHandler(nil)
	body := `{"jws":"` + testCompactJWS(t, "ES256", `{"transactionId":"0"}`) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
}

func TestVerifyAppStore_SyntheticChain_ValidTrue(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "true")

	root, rootKey := mustTestCA(t, "test-root")
	inter, interKey := mustTestCert(t, "test-inter", root, rootKey, true)
	leaf, leafKey := mustTestCert(t, "test-leaf", inter, interKey, false)

	pool := x509.NewCertPool()
	pool.AddCert(root)

	var persisted struct {
		userID, productID, transactionID, environment string
		called                                        bool
	}
	h := NewIAPHandler(nil)
	h.RootPool = pool
	h.persist = func(_ context.Context, userID, productID, transactionID, environment string) error {
		persisted.called = true
		persisted.userID = userID
		persisted.productID = productID
		persisted.transactionID = transactionID
		persisted.environment = environment
		return nil
	}

	jws := mustSignAppStoreJWS(t, leafKey, []*x509.Certificate{leaf, inter}, map[string]any{
		"productId":     "nomarkup.provider.pro.monthly",
		"transactionId": "1000000123456789",
		"environment":   "Sandbox",
	})
	body, err := json.Marshal(map[string]any{
		"jws":         jws,
		"product_ids": []string{"nomarkup.provider.pro.monthly"},
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var out appStoreVerifyResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.True(t, out.Valid)
	assert.Equal(t, "nomarkup.provider.pro.monthly", out.ProductID)
	assert.Equal(t, "1000000123456789", out.TransactionID)
	assert.Equal(t, "Sandbox", out.Environment)
	assert.True(t, persisted.called)
	assert.Equal(t, testBackgroundCheckUserID, persisted.userID)
	assert.Equal(t, "nomarkup.provider.pro.monthly", persisted.productID)
	assert.Equal(t, "1000000123456789", persisted.transactionID)
	assert.Equal(t, "Sandbox", persisted.environment)
}

func TestVerifyAppStore_UntrustedLeaf_400(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "true")

	_, _, leaf, leafKey := mustUnrelatedChain(t)

	h := NewIAPHandler(nil)
	jws := mustSignAppStoreJWS(t, leafKey, []*x509.Certificate{leaf}, map[string]any{
		"productId":     "nomarkup.provider.pro.monthly",
		"transactionId": "1000000123456789",
		"environment":   "Sandbox",
	})
	body, err := json.Marshal(map[string]any{"jws": jws})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), `"valid":true`)
	var out map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.Contains(t, out["error"], "not trusted")
}

func TestVerifyAppStore_UntrustedLeafAgainstInjectedRoot_400(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "true")

	trustedRoot, _ := mustTestCA(t, "trusted-root")
	_, _, leaf, leafKey := mustUnrelatedChain(t)

	pool := x509.NewCertPool()
	pool.AddCert(trustedRoot)

	h := NewIAPHandler(nil)
	h.RootPool = pool
	jws := mustSignAppStoreJWS(t, leafKey, []*x509.Certificate{leaf}, map[string]any{
		"productId":     "nomarkup.provider.pro.monthly",
		"transactionId": "999",
		"environment":   "Sandbox",
	})
	body, err := json.Marshal(map[string]any{"jws": jws})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/iap/app-store/verify", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req = withProviderClaims(req, testBackgroundCheckUserID)
	rec := httptest.NewRecorder()

	h.VerifyAppStore(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
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

func mustSignAppStoreJWS(t *testing.T, key *ecdsa.PrivateKey, chain []*x509.Certificate, payload map[string]any) string {
	t.Helper()
	claims := jwt.MapClaims{}
	for k, v := range payload {
		claims[k] = v
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	x5c := make([]string, len(chain))
	for i, cert := range chain {
		x5c[i] = base64.StdEncoding.EncodeToString(cert.Raw)
	}
	tok.Header["x5c"] = x5c
	signed, err := tok.SignedString(key)
	require.NoError(t, err)
	return signed
}

func mustUnrelatedChain(t *testing.T) (root *x509.Certificate, rootKey *ecdsa.PrivateKey, leaf *x509.Certificate, leafKey *ecdsa.PrivateKey) {
	t.Helper()
	root, rootKey = mustTestCA(t, "untrusted-root")
	leaf, leafKey = mustTestCert(t, "untrusted-leaf", root, rootKey, false)
	return root, rootKey, leaf, leafKey
}

func mustTestCA(t *testing.T, cn string) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	return mustTestCert(t, cn, nil, nil, true)
}

func mustTestCert(t *testing.T, cn string, parent *x509.Certificate, parentKey *ecdsa.PrivateKey, isCA bool) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	require.NoError(t, err)

	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: cn, Organization: []string{"NoMarkup Test"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  isCA,
	}
	if isCA {
		tmpl.KeyUsage = x509.KeyUsageCertSign | x509.KeyUsageCRLSign
	}

	signer := tmpl
	signerKey := key
	if parent != nil {
		signer = parent
		signerKey = parentKey
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, signer, &key.PublicKey, signerKey)
	require.NoError(t, err)
	cert, err := x509.ParseCertificate(der)
	require.NoError(t, err)
	return cert, key
}
