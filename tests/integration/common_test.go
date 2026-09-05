//go:build integration

// Shared helpers for Tier 1 production-readiness integration tests.
//
// Run all integration tests:
//   cd tests/integration && go test -tags=integration ./...
//
// Requires:
//   - Gateway running at $NOMARKUP_GATEWAY_URL (default http://localhost:8081)
//   - Postgres at $DATABASE_URL or postgres://nomarkup:nomarkup@localhost:5433/nomarkup
//   - Seed accounts (password "Password123!"):
//       admin@nomarkup.com, customer@nomarkup.com, provider@nomarkup.com,
//       provider2@nomarkup.com.
//   - Optional: bot1, sim1..sim5 (used by some tests).

package integration

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const seedPassword = "Password123!"

func gatewayURL() string {
	if v := os.Getenv("NOMARKUP_GATEWAY_URL"); v != "" {
		return v
	}
	return "http://localhost:8081"
}

func databaseURL() string {
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return "postgres://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable"
}

// loginAccessToken posts to /api/v1/auth/login and returns the JWT access
// token. Fails the test on any non-200.
func loginAccessToken(t *testing.T, email string) string {
	t.Helper()
	body := bytes.NewBufferString(fmt.Sprintf(`{"email":%q,"password":%q}`, email, seedPassword))
	resp, err := http.Post(gatewayURL()+"/api/v1/auth/login", "application/json", body)
	if err != nil {
		t.Fatalf("login %s: %v", email, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login %s status=%d body=%s", email, resp.StatusCode, raw)
	}
	var out struct {
		AccessToken string `json:"access_token"`
		UserID      string `json:"user_id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("login %s decode: %v", email, err)
	}
	if out.AccessToken == "" {
		t.Fatalf("login %s returned empty token: %s", email, raw)
	}
	return out.AccessToken
}

func loginUserID(t *testing.T, email string) (token, userID string) {
	t.Helper()
	body := bytes.NewBufferString(fmt.Sprintf(`{"email":%q,"password":%q}`, email, seedPassword))
	resp, err := http.Post(gatewayURL()+"/api/v1/auth/login", "application/json", body)
	if err != nil {
		t.Fatalf("login %s: %v", email, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login %s status=%d body=%s", email, resp.StatusCode, raw)
	}
	var out struct {
		AccessToken string `json:"access_token"`
		UserID      string `json:"user_id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("login %s decode: %v", email, err)
	}
	return out.AccessToken, out.UserID
}

// authedRequest builds an http.Request with the given bearer token and
// optional JSON body. Body may be nil.
func authedRequest(t *testing.T, method, path, token string, body any) *http.Request {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, gatewayURL()+path, reader)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req
}

// doRead returns (status, bodyBytes) for an HTTP call, fatalling on transport
// errors so callers don't have to.
func doRead(t *testing.T, req *http.Request) (int, []byte) {
	t.Helper()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("http do %s %s: %v", req.Method, req.URL.Path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body
}

// signWrongKeyJWT mints a syntactically valid RS256 token signed with a
// freshly-generated key the gateway has never seen. Useful for the
// "wrong-key signature" auth-bypass test.
func signWrongKeyJWT(t *testing.T, sub, email string) string {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa gen: %v", err)
	}
	now := time.Now()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss":   "https://auth.nomarkup.com",
		"sub":   sub,
		"aud":   "nomarkup-api",
		"iat":   now.Unix(),
		"exp":   now.Add(15 * time.Minute).Unix(),
		"email": email,
		"roles": []string{"customer"},
	})
	signed, err := tok.SignedString(priv)
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	return signed
}

// signExpiredJWT mints an RS256 token signed with the *gateway* private key
// (so the signature is valid) but with `exp` already in the past. Requires
// JWT_PRIVATE_KEY_PATH to be set or the seed key to live at ./keys/private.pem.
func signExpiredJWT(t *testing.T, sub, email string) string {
	t.Helper()
	keyPath := os.Getenv("JWT_PRIVATE_KEY_PATH")
	if keyPath == "" {
		// Try common dev locations.
		for _, p := range []string{
			"./keys/private.pem",
			"../../keys/private.pem",
			"../keys/private.pem",
		} {
			if _, err := os.Stat(p); err == nil {
				keyPath = p
				break
			}
		}
	}
	if keyPath == "" {
		t.Skip("expired-jwt test requires JWT_PRIVATE_KEY_PATH to be set or ./keys/private.pem to exist")
	}
	pemBytes, err := os.ReadFile(keyPath)
	if err != nil {
		t.Skipf("expired-jwt: cannot read key %s: %v", keyPath, err)
	}
	priv, err := jwt.ParseRSAPrivateKeyFromPEM(pemBytes)
	if err != nil {
		t.Skipf("expired-jwt: parse key %s: %v", keyPath, err)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss":   "https://auth.nomarkup.com",
		"sub":   sub,
		"aud":   "nomarkup-api",
		"iat":   time.Now().Add(-2 * time.Hour).Unix(),
		"exp":   time.Now().Add(-1 * time.Hour).Unix(),
		"email": email,
		"roles": []string{"customer"},
	})
	signed, err := tok.SignedString(priv)
	if err != nil {
		t.Fatalf("sign expired jwt: %v", err)
	}
	return signed
}

// decodeJSON reads and JSON-decodes an HTTP response body into out.
// Skips the test-failing path so callers can choose to recover.
func decodeJSON(resp *http.Response, out any) error {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

// dummyServer ensures we can synthesize requests in unit tests if needed.
// (Currently unused; reserved for tests that don't hit the live gateway.)
var _ = httptest.NewRecorder
var _ = strings.Builder{}
