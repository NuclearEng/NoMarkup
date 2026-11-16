package handler

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
)

// errAppleRefreshColumnMissing means migration 136 has not been applied.
var errAppleRefreshColumnMissing = errors.New("apple refresh token column missing")

// AppleRefreshSaver stores the Apple refresh token for a user after the
// authorization code has been exchanged. The plaintext token must not be logged.
type AppleRefreshSaver interface {
	SaveAppleRefreshToken(ctx context.Context, userID, clientID, refreshToken string) error
}

// PGAppleRefreshSaver writes secretbox ciphertext onto oauth_accounts.
type PGAppleRefreshSaver struct {
	pool   *pgxpool.Pool
	cipher *crypto.Cipher
}

// NewPGAppleRefreshSaver returns a saver. pool and cipher are required.
func NewPGAppleRefreshSaver(pool *pgxpool.Pool, cipher *crypto.Cipher) *PGAppleRefreshSaver {
	return &PGAppleRefreshSaver{pool: pool, cipher: cipher}
}

// SaveAppleRefreshToken encrypts refreshToken and updates the Apple row.
func (s *PGAppleRefreshSaver) SaveAppleRefreshToken(ctx context.Context, userID, clientID, refreshToken string) error {
	if s == nil || s.pool == nil || s.cipher == nil {
		return errors.New("apple refresh token store is not configured")
	}
	userID = strings.TrimSpace(userID)
	clientID = strings.TrimSpace(clientID)
	refreshToken = strings.TrimSpace(refreshToken)
	if userID == "" || clientID == "" || refreshToken == "" {
		return errors.New("apple refresh token store: user, client id, and token are required")
	}
	encrypted, err := s.cipher.EncryptString(refreshToken)
	if err != nil {
		return fmt.Errorf("apple refresh token store: encrypt: %w", err)
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE oauth_accounts
		   SET apple_refresh_token = $1,
		       apple_client_id = $2
		 WHERE user_id = $3
		   AND provider = 'apple'`, encrypted, clientID, userID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" {
			return fmt.Errorf("%w: %s", errAppleRefreshColumnMissing, pgErr.Message)
		}
		return fmt.Errorf("apple refresh token store: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errors.New("apple refresh token store: no apple oauth_accounts row")
	}
	return nil
}
