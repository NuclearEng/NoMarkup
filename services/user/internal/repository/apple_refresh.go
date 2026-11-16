package repository

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// ListAppleRefreshTokens returns decrypted Apple refresh tokens for userID.
// A missing migration-136 column is an error in production and an empty list
// elsewhere, so local stacks that have not migrated can still delete accounts.
func (r *PostgresRepository) ListAppleRefreshTokens(ctx context.Context, userID string) ([]domain.AppleRefreshToken, error) {
	if r == nil || r.cipher == nil {
		return nil, errors.New("list apple refresh tokens: cipher is not configured")
	}
	rows, err := r.pool.Query(ctx, `
		SELECT COALESCE(apple_client_id, ''), COALESCE(apple_refresh_token, '')
		  FROM oauth_accounts
		 WHERE user_id = $1
		   AND provider = 'apple'
		   AND apple_refresh_token IS NOT NULL`, userID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" {
			if strings.EqualFold(strings.TrimSpace(os.Getenv("ENVIRONMENT")), "production") {
				return nil, fmt.Errorf("list apple refresh tokens: %w", err)
			}
			slog.Warn("apple refresh column missing; run migration 136", "error", err)
			return nil, nil
		}
		return nil, fmt.Errorf("list apple refresh tokens: %w", err)
	}
	defer rows.Close()

	var out []domain.AppleRefreshToken
	for rows.Next() {
		var clientID, ciphertext string
		if err := rows.Scan(&clientID, &ciphertext); err != nil {
			return nil, fmt.Errorf("list apple refresh tokens: %w", err)
		}
		ciphertext = strings.TrimSpace(ciphertext)
		if ciphertext == "" {
			continue
		}
		plain, err := r.cipher.DecryptString(ciphertext)
		if err != nil {
			return nil, fmt.Errorf("list apple refresh tokens: decrypt: %w", err)
		}
		plain = strings.TrimSpace(plain)
		if plain == "" {
			continue
		}
		out = append(out, domain.AppleRefreshToken{
			ClientID:     strings.TrimSpace(clientID),
			RefreshToken: plain,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list apple refresh tokens: %w", err)
	}
	return out, nil
}
