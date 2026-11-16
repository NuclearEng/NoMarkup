package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

const appleRevokeEndpoint = "https://appleid.apple.com/auth/revoke"

// AppleRefreshReader loads decrypted Sign in with Apple refresh tokens.
type AppleRefreshReader interface {
	ListAppleRefreshTokens(ctx context.Context, userID string) ([]domain.AppleRefreshToken, error)
}

// AppleOAuthRevoker calls Apple's revoke endpoint with the stored refresh
// token and APPLE_CLIENT_SECRET. It does not generate a client secret.
type AppleOAuthRevoker struct {
	reader    AppleRefreshReader
	client    *http.Client
	revokeURL string
}

// NewAppleOAuthRevoker returns a revoker that reads APPLE_CLIENT_SECRET at call time.
func NewAppleOAuthRevoker(reader AppleRefreshReader) *AppleOAuthRevoker {
	return &AppleOAuthRevoker{
		reader:    reader,
		client:    &http.Client{Timeout: 10 * time.Second},
		revokeURL: appleRevokeEndpoint,
	}
}

// RevokeUserTokens revokes every stored Apple refresh token for userID.
// No stored token is success. A stored token without APPLE_CLIENT_SECRET fails.
func (a *AppleOAuthRevoker) RevokeUserTokens(ctx context.Context, userID string) error {
	if a == nil || a.reader == nil {
		return errors.New("apple revoke: reader is not configured")
	}
	tokens, err := a.reader.ListAppleRefreshTokens(ctx, userID)
	if err != nil {
		return err
	}
	if len(tokens) == 0 {
		return nil
	}
	secret := strings.TrimSpace(os.Getenv("APPLE_CLIENT_SECRET"))
	if secret == "" {
		return errors.New("apple revoke: APPLE_CLIENT_SECRET is not configured")
	}
	var errs []error
	for _, tok := range tokens {
		if strings.TrimSpace(tok.ClientID) == "" || strings.TrimSpace(tok.RefreshToken) == "" {
			errs = append(errs, errors.New("apple revoke: stored client id or refresh token is empty"))
			continue
		}
		if err := a.revokeOne(ctx, tok.ClientID, secret, tok.RefreshToken); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (a *AppleOAuthRevoker) revokeOne(ctx context.Context, clientID, clientSecret, refreshToken string) error {
	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("token", refreshToken)
	form.Set("token_type_hint", "refresh_token")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.revokeURL, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("apple revoke request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := a.client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("apple revoke endpoint: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("apple revoke endpoint: status %d", resp.StatusCode)
	}
	return nil
}
