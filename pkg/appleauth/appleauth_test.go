package appleauth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// TestKey returns a throwaway P-256 key and its PKCS#8 PEM.
func testKey(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(k)
	if err != nil {
		t.Fatal(err)
	}
	return k, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func newTestClient(t *testing.T, srv *httptest.Server) (*Client, *ecdsa.PrivateKey) {
	t.Helper()
	k, p := testKey(t)
	c, err := New(Config{
		TeamID: "TEAMID1234", KeyID: "KEYID12345", PrivateKeyPEM: strings.ReplaceAll(p, "\n", `\n`),
		ClientID: "com.example.app", TokenURL: srv.URL + "/auth/token", RevokeURL: srv.URL + "/auth/revoke",
		HTTPClient: srv.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return c, k
}

func TestClientSecretIsValidES256JWT(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()
	c, k := newTestClient(t, srv)
	tok, err := c.ClientSecret("")
	if err != nil {
		t.Fatal(err)
	}
	if !verifyES256(&k.PublicKey, tok) {
		t.Fatal("signature does not verify")
	}
	parts := strings.Split(tok, ".")
	var hdr map[string]string
	var claims map[string]any
	b, _ := base64.RawURLEncoding.DecodeString(parts[0])
	_ = json.Unmarshal(b, &hdr)
	b, _ = base64.RawURLEncoding.DecodeString(parts[1])
	_ = json.Unmarshal(b, &claims)
	if hdr["alg"] != "ES256" || hdr["kid"] != "KEYID12345" {
		t.Fatalf("header = %v", hdr)
	}
	if claims["iss"] != "TEAMID1234" || claims["sub"] != "com.example.app" || claims["aud"] != "https://appleid.apple.com" {
		t.Fatalf("claims = %v", claims)
	}
	if exp, iat := claims["exp"].(float64), claims["iat"].(float64); exp-iat <= 0 || exp-iat > 15552000 {
		t.Fatalf("bad lifetime exp=%v iat=%v", exp, iat)
	}
}

func TestExchangeAndRevokeAgainstFakeApple(t *testing.T) {
	var revoked atomic.Value
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("code") != "code-1" ||
			r.Form.Get("client_id") != "com.example.app" || r.Form.Get("client_secret") == "" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"a","refresh_token":"r-123","id_token":"i","expires_in":3600}`))
	})
	mux.HandleFunc("/auth/revoke", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("token_type_hint") != "refresh_token" || r.Form.Get("client_secret") == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		revoked.Store(r.Form.Get("token"))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	c, _ := newTestClient(t, srv)

	tr, err := c.ExchangeCode(context.Background(), "", "code-1", "")
	if err != nil || tr.RefreshToken != "r-123" {
		t.Fatalf("exchange: %v %+v", err, tr)
	}
	if _, err := c.ExchangeCode(context.Background(), "", "bad", ""); err == nil || !strings.Contains(err.Error(), "invalid_grant") {
		t.Fatalf("want invalid_grant, got %v", err)
	}
	if err := c.Revoke(context.Background(), "", "r-123"); err != nil {
		t.Fatal(err)
	}
	if revoked.Load() != "r-123" {
		t.Fatalf("revoked = %v", revoked.Load())
	}
}

func TestRevokeWithRetry(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
	}))
	defer srv.Close()
	c, _ := newTestClient(t, srv)
	if err := c.RevokeWithRetry(context.Background(), "", "tok", 3, time.Millisecond); err != nil {
		t.Fatalf("want success on 3rd attempt: %v", err)
	}
	if calls.Load() != 3 {
		t.Fatalf("calls = %d", calls.Load())
	}

	var bad atomic.Int32
	srv4 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bad.Add(1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
	}))
	defer srv4.Close()
	c4, _ := newTestClient(t, srv4)
	if err := c4.RevokeWithRetry(context.Background(), "", "tok", 5, time.Millisecond); err == nil {
		t.Fatal("want error")
	}
	if bad.Load() != 1 {
		t.Fatalf("4xx must not be retried; calls = %d", bad.Load())
	}
}

func TestNewRequiresConfig(t *testing.T) {
	if _, err := New(Config{}); err != ErrNotConfigured {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
	if _, err := New(Config{TeamID: "t", KeyID: "k", PrivateKeyPEM: "not pem"}); err == nil {
		t.Fatal("want PEM error")
	}
	if got := (Config{TeamID: "t"}).MissingEnv(); len(got) != 3 {
		t.Fatalf("MissingEnv = %v", got)
	}
}
