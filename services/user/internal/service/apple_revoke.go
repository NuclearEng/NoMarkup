package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/pkg/appleauth"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

const appleRevokeEndpoint = "https://appleid.apple.com/auth/revoke"

// AppleRefreshReader loads decrypted Sign in with Apple refresh tokens.
type AppleRefreshReader interface {
	ListAppleRefreshTokens(ctx context.Context, userID string) ([]domain.AppleRefreshToken, error)
}

// AppleOAuthRevoker calls Apple's revoke endpoint with the stored refresh
// token. The client secret is resolved per token at call time
// (appleauth.ClientSecretFromEnv): a static APPLE_CLIENT_SECRET wins,
// otherwise an ES256 JWT is minted for the token's own client_id from
// APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY. Transient failures
// (network, 5xx, 429) are retried.
type AppleOAuthRevoker struct {
	reader    AppleRefreshReader
	client    *http.Client
	revokeURL string
	attempts  int
	backoff   time.Duration
}

// NewAppleOAuthRevoker returns a revoker that resolves the client secret at call time.
func NewAppleOAuthRevoker(reader AppleRefreshReader) *AppleOAuthRevoker {
	return &AppleOAuthRevoker{
		reader:    reader,
		client:    &http.Client{Timeout: 10 * time.Second},
		revokeURL: appleRevokeEndpoint,
		attempts:  3,
		backoff:   500 * time.Millisecond,
	}
}

// appleRevokeStatusError is a non-200 answer from Apple's revoke endpoint.
type appleRevokeStatusError struct{ status int }

func (e *appleRevokeStatusError) Error() string {
	return fmt.Sprintf("apple revoke endpoint: status %d", e.status)
}

func (e *appleRevokeStatusError) retryable() bool {
	return e.status >= 500 || e.status == http.StatusTooManyRequests
}

// RevokeUserTokens revokes every stored Apple refresh token for userID.
// No stored token is success. A stored token with no usable client secret
// (neither APPLE_CLIENT_SECRET nor the .p8 key triple) fails.
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
	var errs []error
	for _, tok := range tokens {
		clientID := strings.TrimSpace(tok.ClientID)
		if clientID == "" || strings.TrimSpace(tok.RefreshToken) == "" {
			errs = append(errs, errors.New("apple revoke: stored client id or refresh token is empty"))
			continue
		}
		secret, sErr := appleauth.ClientSecretFromEnv(clientID)
		if sErr != nil || secret == "" {
			errs = append(errs, fmt.Errorf("apple revoke: no client secret (set APPLE_CLIENT_SECRET, or APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY): %w", sErr))
			continue
		}
		if err := a.revokeWithRetry(ctx, clientID, secret, tok.RefreshToken); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// revokeWithRetry retries transient failures (network, 5xx, 429) with
// exponential backoff. Other 4xx answers return at once.
func (a *AppleOAuthRevoker) revokeWithRetry(ctx context.Context, clientID, clientSecret, refreshToken string) error {
	attempts := a.attempts
	if attempts < 1 {
		attempts = 1
	}
	var err error
	for i := 0; i < attempts; i++ {
		if err = a.revokeOne(ctx, clientID, clientSecret, refreshToken); err == nil {
			return nil
		}
		var statusErr *appleRevokeStatusError
		if errors.As(err, &statusErr) && !statusErr.retryable() {
			return err
		}
		if i == attempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return errors.Join(err, ctx.Err())
		case <-time.After(a.backoff << i):
		}
	}
	return err
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
		return &appleRevokeStatusError{status: resp.StatusCode}
	}
	return nil
}
