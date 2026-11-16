package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const appleTokenEndpoint = "https://appleid.apple.com/auth/token"

// appleTokenHTTPClient is the production caller for Apple's token endpoint.
// Tests replace exchangeAppleAuthorizationCodeFn and do not use this client.
var appleTokenHTTPClient = &http.Client{Timeout: 10 * time.Second}

// exchangeAppleAuthorizationCodeFn posts an authorization code to Apple and
// returns the refresh token. Tests replace it. Production must not invent a
// client secret: the caller passes APPLE_CLIENT_SECRET.
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

func appleClientSecret() string {
	return strings.TrimSpace(os.Getenv("APPLE_CLIENT_SECRET"))
}

func appleRefreshStoreRequired() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT"))) {
	case "production", "staging":
		return true
	default:
		return false
	}
}
