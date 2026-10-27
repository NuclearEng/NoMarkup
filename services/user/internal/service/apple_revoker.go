package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

// Sign in with Apple revocation on account deletion (App Store Review
// Guideline 5.1.1(v)). The gateway stores the Apple refresh token encrypted
// in oauth_accounts.apple_refresh_token_enc (migration 136); this revoker
// reads it BEFORE the GDPR cascade deletes the row, then revokes it at
// https://appleid.apple.com/auth/revoke AFTER the cascade. Revocation is
// best-effort (retried, logged) and never blocks deletion.

// EncryptedAppleToken is one stored Apple grant.
type EncryptedAppleToken struct {
	ClientID        string
	EncryptedSecret string
}

// AppleTokenLister loads a user's stored (encrypted) Apple refresh tokens.
type AppleTokenLister interface {
	ListAppleRefreshTokens(ctx context.Context, userID string) ([]EncryptedAppleToken, error)
}

// AppleTokenRevoker is satisfied by *appleauth.Client.
type AppleTokenRevoker interface {
	RevokeWithRetry(ctx context.Context, clientID, refreshToken string, attempts int, backoff time.Duration) error
	DefaultClientID() string
}

// stringDecrypter is satisfied by *crypto.Cipher.
type stringDecrypter interface {
	DecryptString(ciphertext string) (string, error)
}

// OAuthRevocationPreparer lets Erasure capture provider tokens before the DB
// cascade deletes them and revoke them afterwards.
type OAuthRevocationPreparer interface {
	PrepareOAuthRevocation(ctx context.Context, userID string) (revoke func(context.Context) error, err error)
}

// AppleRevoker implements OAuthRevoker and OAuthRevocationPreparer.
type AppleRevoker struct {
	tokens   AppleTokenLister
	cipher   stringDecrypter
	apple    AppleTokenRevoker
	attempts int
	backoff  time.Duration
}

// NewAppleRevoker wires a revoker. attempts/backoff default to 3 / 500ms.
func NewAppleRevoker(tokens AppleTokenLister, cipher stringDecrypter, apple AppleTokenRevoker) *AppleRevoker {
	return &AppleRevoker{tokens: tokens, cipher: cipher, apple: apple, attempts: 3, backoff: 500 * time.Millisecond}
}

type plainAppleToken struct{ clientID, token string }

// PrepareOAuthRevocation decrypts the user's Apple tokens now (while the
// oauth_accounts rows still exist) and returns a closure that revokes them.
func (a *AppleRevoker) PrepareOAuthRevocation(ctx context.Context, userID string) (func(context.Context) error, error) {
	enc, err := a.tokens.ListAppleRefreshTokens(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("apple revoke: list tokens: %w", err)
	}
	plain := make([]plainAppleToken, 0, len(enc))
	var decErrs []error
	for _, t := range enc {
		tok, dErr := a.cipher.DecryptString(t.EncryptedSecret)
		if dErr != nil || tok == "" {
			decErrs = append(decErrs, fmt.Errorf("apple revoke: decrypt token: %w", dErr))
			continue
		}
		cid := t.ClientID
		if cid == "" {
			cid = a.apple.DefaultClientID()
		}
		plain = append(plain, plainAppleToken{clientID: cid, token: tok})
	}
	return func(ctx context.Context) error {
		errs := append([]error(nil), decErrs...)
		for _, p := range plain {
			if rErr := a.apple.RevokeWithRetry(ctx, p.clientID, p.token, a.attempts, a.backoff); rErr != nil {
				errs = append(errs, rErr)
				continue
			}
			slog.InfoContext(ctx, "gdpr: apple sign-in grant revoked", "user_id", userID, "client_id", p.clientID)
		}
		return errors.Join(errs...)
	}, nil
}

// RevokeUserTokens satisfies OAuthRevoker (prepare + revoke in one step).
func (a *AppleRevoker) RevokeUserTokens(ctx context.Context, userID string) error {
	revoke, err := a.PrepareOAuthRevocation(ctx, userID)
	if err != nil {
		return err
	}
	return revoke(ctx)
}

// pgQuerier is satisfied by *pgxpool.Pool.
type pgQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// PGAppleTokenLister reads tokens from oauth_accounts.
type PGAppleTokenLister struct{ DB pgQuerier }

// ListAppleRefreshTokens returns the user's stored Apple tokens (encrypted).
func (l PGAppleTokenLister) ListAppleRefreshTokens(ctx context.Context, userID string) ([]EncryptedAppleToken, error) {
	rows, err := l.DB.Query(ctx, `
		SELECT COALESCE(apple_token_client_id, ''), apple_refresh_token_enc
		  FROM oauth_accounts
		 WHERE user_id = $1 AND provider = 'apple' AND apple_refresh_token_enc IS NOT NULL`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EncryptedAppleToken
	for rows.Next() {
		var t EncryptedAppleToken
		if err := rows.Scan(&t.ClientID, &t.EncryptedSecret); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
