// Package appleauth implements the server-to-server half of Sign in with
// Apple that App Store Review Guideline 5.1.1(v) requires for account
// deletion: exchanging the single-use authorization code for a refresh token
// (POST https://appleid.apple.com/auth/token) and revoking that token when
// the user deletes their account (POST https://appleid.apple.com/auth/revoke).
//
// Both calls authenticate with a "client secret" that is an ES256 JWT signed
// by the team's Sign in with Apple key (.p8). It is generated on demand from:
//
//	APPLE_TEAM_ID      10-char Apple Developer Team ID (JWT iss)
//	APPLE_KEY_ID       Key ID of the SIWA .p8 key (JWT header kid)
//	APPLE_PRIVATE_KEY  PEM contents of the .p8 (PKCS#8 EC P-256). Literal "\n"
//	                   sequences are accepted so it can live in a single-line env.
//	APPLE_CLIENT_ID    Services ID (web) / bundle ID (native) — JWT sub
//
// Only the standard library is used so both the gateway and the user service
// can import this package without new module requirements.
package appleauth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	// DefaultTokenURL is Apple's token endpoint.
	DefaultTokenURL = "https://appleid.apple.com/auth/token"
	// DefaultRevokeURL is Apple's revocation endpoint.
	DefaultRevokeURL = "https://appleid.apple.com/auth/revoke"
	// audience is the fixed JWT aud Apple expects on client secrets.
	audience = "https://appleid.apple.com"
	// secretTTL keeps generated client secrets short-lived (Apple allows ≤6 months).
	secretTTL = 5 * time.Minute
)

// ErrNotConfigured is returned when the team/key/private-key triple is missing.
var ErrNotConfigured = errors.New("appleauth: APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY not configured")

// Config holds the signing material and endpoints.
type Config struct {
	TeamID        string
	KeyID         string
	PrivateKeyPEM string
	// ClientID is the default client_id (APPLE_CLIENT_ID). Callers may pass a
	// different one per call (e.g. the native bundle ID).
	ClientID string

	TokenURL   string
	RevokeURL  string
	HTTPClient *http.Client
	Now        func() time.Time
}

// ConfigFromEnv reads APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY and
// APPLE_CLIENT_ID. It never logs secret values.
func ConfigFromEnv() Config {
	return Config{
		TeamID:        strings.TrimSpace(os.Getenv("APPLE_TEAM_ID")),
		KeyID:         strings.TrimSpace(os.Getenv("APPLE_KEY_ID")),
		PrivateKeyPEM: os.Getenv("APPLE_PRIVATE_KEY"),
		ClientID:      strings.TrimSpace(os.Getenv("APPLE_CLIENT_ID")),
	}
}

// MissingEnv lists the names of unset required variables (empty when complete).
func (c Config) MissingEnv() []string {
	var missing []string
	if c.TeamID == "" {
		missing = append(missing, "APPLE_TEAM_ID")
	}
	if c.KeyID == "" {
		missing = append(missing, "APPLE_KEY_ID")
	}
	if strings.TrimSpace(c.PrivateKeyPEM) == "" {
		missing = append(missing, "APPLE_PRIVATE_KEY")
	}
	if c.ClientID == "" {
		missing = append(missing, "APPLE_CLIENT_ID")
	}
	return missing
}

// Client performs token exchange and revocation.
type Client struct {
	cfg  Config
	key  *ecdsa.PrivateKey
	http *http.Client
	now  func() time.Time
}

// New validates the config and parses the private key.
func New(cfg Config) (*Client, error) {
	if cfg.TeamID == "" || cfg.KeyID == "" || strings.TrimSpace(cfg.PrivateKeyPEM) == "" {
		return nil, ErrNotConfigured
	}
	key, err := parsePrivateKey(cfg.PrivateKeyPEM)
	if err != nil {
		return nil, err
	}
	if cfg.TokenURL == "" {
		cfg.TokenURL = DefaultTokenURL
	}
	if cfg.RevokeURL == "" {
		cfg.RevokeURL = DefaultRevokeURL
	}
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Client{cfg: cfg, key: key, http: hc, now: now}, nil
}

// DefaultClientID returns the configured APPLE_CLIENT_ID.
func (c *Client) DefaultClientID() string { return c.cfg.ClientID }

func parsePrivateKey(raw string) (*ecdsa.PrivateKey, error) {
	raw = strings.ReplaceAll(strings.TrimSpace(raw), `\n`, "\n")
	block, _ := pem.Decode([]byte(raw))
	if block == nil {
		return nil, errors.New("appleauth: APPLE_PRIVATE_KEY is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		ec, ecErr := x509.ParseECPrivateKey(block.Bytes)
		if ecErr != nil {
			return nil, fmt.Errorf("appleauth: parse APPLE_PRIVATE_KEY: %w", err)
		}
		parsed = ec
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, errors.New("appleauth: APPLE_PRIVATE_KEY must be an EC P-256 key")
	}
	return key, nil
}

// ClientSecret builds the ES256 client-secret JWT for clientID.
func (c *Client) ClientSecret(clientID string) (string, error) {
	if clientID == "" {
		clientID = c.cfg.ClientID
	}
	if clientID == "" {
		return "", errors.New("appleauth: client_id is required")
	}
	now := c.now().UTC()
	header, _ := json.Marshal(map[string]string{"alg": "ES256", "kid": c.cfg.KeyID, "typ": "JWT"})
	claims, _ := json.Marshal(map[string]any{
		"iss": c.cfg.TeamID,
		"iat": now.Unix(),
		"exp": now.Add(secretTTL).Unix(),
		"aud": audience,
		"sub": clientID,
	})
	enc := base64.RawURLEncoding
	signingInput := enc.EncodeToString(header) + "." + enc.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, c.key, digest[:])
	if err != nil {
		return "", fmt.Errorf("appleauth: sign client secret: %w", err)
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return signingInput + "." + enc.EncodeToString(sig), nil
}

// TokenResponse is the subset of Apple's /auth/token response we use.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	ExpiresIn    int    `json:"expires_in"`
}

// APIError carries Apple's error code (never the request secrets).
type APIError struct {
	Status int
	Code   string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("appleauth: apple returned %d (%s)", e.Status, e.Code)
}

// Retryable reports whether the failure is transient (5xx / 429).
func (e *APIError) Retryable() bool { return e.Status >= 500 || e.Status == http.StatusTooManyRequests }

// ExchangeCode trades a single-use authorization code for tokens.
// redirectURI must be empty for native (AuthenticationServices) codes.
func (c *Client) ExchangeCode(ctx context.Context, clientID, code, redirectURI string) (*TokenResponse, error) {
	if strings.TrimSpace(code) == "" {
		return nil, errors.New("appleauth: authorization code is required")
	}
	if clientID == "" {
		clientID = c.cfg.ClientID
	}
	secret, err := c.ClientSecret(clientID)
	if err != nil {
		return nil, err
	}
	form := url.Values{
		"client_id":     {clientID},
		"client_secret": {secret},
		"code":          {code},
		"grant_type":    {"authorization_code"},
	}
	if redirectURI != "" {
		form.Set("redirect_uri", redirectURI)
	}
	body, err := c.post(ctx, c.cfg.TokenURL, form)
	if err != nil {
		return nil, err
	}
	var tr TokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return nil, fmt.Errorf("appleauth: decode token response: %w", err)
	}
	if tr.RefreshToken == "" {
		return nil, errors.New("appleauth: token response has no refresh_token")
	}
	return &tr, nil
}

// Revoke revokes a refresh token once. Apple answers 200 for success
// (including already-invalid tokens).
func (c *Client) Revoke(ctx context.Context, clientID, refreshToken string) error {
	if clientID == "" {
		clientID = c.cfg.ClientID
	}
	secret, err := c.ClientSecret(clientID)
	if err != nil {
		return err
	}
	_, err = c.post(ctx, c.cfg.RevokeURL, url.Values{
		"client_id":       {clientID},
		"client_secret":   {secret},
		"token":           {refreshToken},
		"token_type_hint": {"refresh_token"},
	})
	return err
}

// RevokeWithRetry retries transient failures (network, 5xx, 429) with
// exponential backoff. Non-retryable 4xx errors return immediately.
func (c *Client) RevokeWithRetry(ctx context.Context, clientID, refreshToken string, attempts int, backoff time.Duration) error {
	if attempts < 1 {
		attempts = 1
	}
	var err error
	for i := 0; i < attempts; i++ {
		if err = c.Revoke(ctx, clientID, refreshToken); err == nil {
			return nil
		}
		var apiErr *APIError
		if errors.As(err, &apiErr) && !apiErr.Retryable() {
			return err
		}
		if i == attempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return errors.Join(err, ctx.Err())
		case <-time.After(backoff << i):
		}
	}
	return err
}

func (c *Client) post(ctx context.Context, endpoint string, form url.Values) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("appleauth: request failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		if e.Error == "" {
			e.Error = "unknown"
		}
		return nil, &APIError{Status: resp.StatusCode, Code: e.Error}
	}
	return body, nil
}

// verifyES256 is used by tests to check generated client secrets.
func verifyES256(pub *ecdsa.PublicKey, token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) != 64 {
		return false
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	return ecdsa.Verify(pub, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:]))
}
