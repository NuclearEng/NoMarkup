package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/pkg/appleauth"
)

const appleTokenEndpoint = "https://appleid.apple.com/auth/token"

// appleTokenHTTPClient is the production caller for Apple's token endpoint.
// Tests replace exchangeAppleAuthorizationCodeFn and do not use this client.
var appleTokenHTTPClient = &http.Client{Timeout: 10 * time.Second}

// exchangeAppleAuthorizationCodeFn posts an authorization code to Apple and
// returns the refresh token. Tests replace it. The caller passes the client
// secret from appleClientSecret; it is never accepted from the request.
var exchangeAppleAuthorizationCodeFn = exchangeAppleAuthorizationCode

type appleTokenResponse struct {
	RefreshToken string `json:"refresh_token"`
	Error        string `json:"error"`
}

func exchangeAppleAuthorizationCode(ctx context.Context, code, clientID, clientSecret string) (string, error) {
	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("code", code)
	form.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, appleTokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("apple token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := appleTokenHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("apple token endpoint: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("apple token response: %w", err)
	}
	var parsed appleTokenResponse
	if jErr := json.Unmarshal(body, &parsed); jErr != nil {
		return "", fmt.Errorf("apple token response: status %d", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK || parsed.RefreshToken == "" {
		if parsed.Error != "" {
			return "", fmt.Errorf("apple token endpoint: %s", parsed.Error)
		}
		return "", fmt.Errorf("apple token endpoint: status %d", resp.StatusCode)
	}
	return parsed.RefreshToken, nil
}

func nativeAppleClientID() string {
	if id := strings.TrimSpace(os.Getenv("APPLE_NATIVE_CLIENT_ID")); id != "" {
		return id
	}
	return strings.TrimSpace(os.Getenv("APPLE_CLIENT_ID"))
}

// appleClientSecret returns the client_secret for clientID. A static
// APPLE_CLIENT_SECRET wins; otherwise an ES256 JWT is minted per call from
// APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY, so the web Services ID and
// the native bundle id each get a secret whose `sub` matches, and nothing
// expires after 6 months. Returns "" when neither is configured.
func appleClientSecret(clientID string) string {
	secret, err := appleauth.ClientSecretFromEnv(clientID)
	if err != nil {
		if !errors.Is(err, appleauth.ErrNotConfigured) {
			slog.Error("apple sign-in: mint client secret failed", "error", err)
		}
		return ""
	}
	return secret
}

func appleRefreshStoreRequired() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT"))) {
	case "production", "staging":
		return true
	default:
		return false
	}
}
