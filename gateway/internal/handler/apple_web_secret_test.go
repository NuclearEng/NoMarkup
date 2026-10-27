package handler

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
)

func TestAppleWebClientSecret_StaticWins(t *testing.T) {
	t.Setenv("APPLE_CLIENT_SECRET", "static-secret")
	t.Setenv("APPLE_TEAM_ID", "")
	if got := appleWebClientSecret(); got != "static-secret" {
		t.Fatalf("got %q, want static secret", got)
	}
}

func TestAppleWebClientSecret_UnconfiguredEmpty(t *testing.T) {
	t.Setenv("APPLE_CLIENT_SECRET", "")
	t.Setenv("APPLE_TEAM_ID", "")
	t.Setenv("APPLE_KEY_ID", "")
	t.Setenv("APPLE_PRIVATE_KEY", "")
	if got := appleWebClientSecret(); got != "" {
		t.Fatalf("got %q, want empty", got)
	}
}

func TestAppleWebClientSecret_MintedFromKey(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("APPLE_CLIENT_SECRET", "")
	t.Setenv("APPLE_TEAM_ID", "TEAM123456")
	t.Setenv("APPLE_KEY_ID", "KEY1234567")
	t.Setenv("APPLE_PRIVATE_KEY", string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})))
	t.Setenv("APPLE_CLIENT_ID", "com.example.web")

	secret := appleWebClientSecret()
	parts := strings.Split(secret, ".")
	if len(parts) != 3 {
		t.Fatalf("want JWT, got %d parts", len(parts))
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatal(err)
	}
	if claims["iss"] != "TEAM123456" || claims["sub"] != "com.example.web" {
		t.Fatalf("unexpected claims: %v", claims)
	}
	if cfg := appleOAuthConfig(); cfg.ClientSecret != secret && cfg.ClientSecret == "" {
		t.Fatal("appleOAuthConfig did not use minted secret")
	}
}
