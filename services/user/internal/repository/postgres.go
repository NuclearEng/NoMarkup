package repository

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// PostgresRepository implements domain.UserRepository using pgx.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository creates a new PostgreSQL-backed user repository.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) CreateUser(ctx context.Context, user *domain.User) error {
	query := `
		INSERT INTO users (email, password_hash, display_name, roles, status, timezone)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at, updated_at`

	err := r.pool.QueryRow(ctx, query,
		user.Email,
		user.PasswordHash,
		user.DisplayName,
		user.Roles,
		user.Status,
		user.Timezone,
	).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return fmt.Errorf("create user: %w", domain.ErrEmailTaken)
		}
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetUserByID(ctx context.Context, id string) (*domain.User, error) {
	query := `
		SELECT id, email, email_verified, password_hash, phone, phone_verified,
		       display_name, avatar_url, roles, status, suspension_reason,
		       mfa_enabled, mfa_secret, mfa_backup_codes,
		       last_login_at, last_active_at, timezone,
		       created_at, updated_at, deleted_at
		FROM users
		WHERE id = $1 AND deleted_at IS NULL`

	u, err := scanUser(r.pool.QueryRow(ctx, query, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get user by id: %w", domain.ErrUserNotFound)
		}
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return u, nil
}

func (r *PostgresRepository) GetUserByEmail(ctx context.Context, email string) (*domain.User, error) {
	query := `
		SELECT id, email, email_verified, password_hash, phone, phone_verified,
		       display_name, avatar_url, roles, status, suspension_reason,
		       mfa_enabled, mfa_secret, mfa_backup_codes,
		       last_login_at, last_active_at, timezone,
		       created_at, updated_at, deleted_at
		FROM users
		WHERE email = $1 AND deleted_at IS NULL`

	u, err := scanUser(r.pool.QueryRow(ctx, query, email))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get user by email: %w", domain.ErrUserNotFound)
		}
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	return u, nil
}

func (r *PostgresRepository) UpdateLastLogin(ctx context.Context, userID string, at time.Time) error {
	query := `UPDATE users SET last_login_at = $1, updated_at = now() WHERE id = $2`
	tag, err := r.pool.Exec(ctx, query, at, userID)
	if err != nil {
		return fmt.Errorf("update last login: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update last login: %w", domain.ErrUserNotFound)
	}
	return nil
}

func (r *PostgresRepository) UpdateEmailVerified(ctx context.Context, userID string, verified bool) error {
	query := `UPDATE users SET email_verified = $1, updated_at = now() WHERE id = $2`
	tag, err := r.pool.Exec(ctx, query, verified, userID)
	if err != nil {
		return fmt.Errorf("update email verified: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update email verified: %w", domain.ErrUserNotFound)
	}
	return nil
}

func (r *PostgresRepository) CreateRefreshToken(ctx context.Context, token *domain.RefreshToken) error {
	query := `
		INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
		VALUES ($1, $2, $3, $4::inet, $5)
		RETURNING id, created_at`

	err := r.pool.QueryRow(ctx, query,
		token.UserID,
		token.TokenHash,
		token.DeviceInfo,
		token.IPAddress.String(),
		token.ExpiresAt,
	).Scan(&token.ID, &token.CreatedAt)
	if err != nil {
		return fmt.Errorf("create refresh token: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetRefreshToken(ctx context.Context, tokenHash string) (*domain.RefreshToken, error) {
	query := `
		SELECT id, user_id, token_hash, device_info, ip_address,
		       expires_at, revoked_at, created_at
		FROM refresh_tokens
		WHERE token_hash = $1`

	var rt domain.RefreshToken
	var ipStr *string
	err := r.pool.QueryRow(ctx, query, tokenHash).Scan(
		&rt.ID,
		&rt.UserID,
		&rt.TokenHash,
		&rt.DeviceInfo,
		&ipStr,
		&rt.ExpiresAt,
		&rt.RevokedAt,
		&rt.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get refresh token: %w", domain.ErrTokenExpired)
		}
		return nil, fmt.Errorf("get refresh token: %w", err)
	}
	if ipStr != nil {
		rt.IPAddress = parseIP(*ipStr)
	}
	return &rt, nil
}

func (r *PostgresRepository) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	query := `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`
	_, err := r.pool.Exec(ctx, query, tokenHash)
	if err != nil {
		return fmt.Errorf("revoke refresh token: %w", err)
	}
	return nil
}

func (r *PostgresRepository) RevokeAllUserTokens(ctx context.Context, userID string) error {
	query := `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`
	_, err := r.pool.Exec(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("revoke all user tokens: %w", err)
	}
	return nil
}

// scanUser scans a single user row from a pgx.Row.
func scanUser(row pgx.Row) (*domain.User, error) {
	var u domain.User
	var phone, avatarURL, suspensionReason, mfaSecret *string
	err := row.Scan(
		&u.ID,
		&u.Email,
		&u.EmailVerified,
		&u.PasswordHash,
		&phone,
		&u.PhoneVerified,
		&u.DisplayName,
		&avatarURL,
		&u.Roles,
		&u.Status,
		&suspensionReason,
		&u.MFAEnabled,
		&mfaSecret,
		&u.MFABackupCodes,
		&u.LastLoginAt,
		&u.LastActiveAt,
		&u.Timezone,
		&u.CreatedAt,
		&u.UpdatedAt,
		&u.DeletedAt,
	)
	if err != nil {
		return nil, err
	}
	if phone != nil {
		u.Phone = *phone
	}
	if avatarURL != nil {
		u.AvatarURL = *avatarURL
	}
	if suspensionReason != nil {
		u.SuspensionReason = *suspensionReason
	}
	if mfaSecret != nil {
		u.MFASecret = *mfaSecret
	}
	return &u, nil
}

// parseIP parses an IP address string, stripping any CIDR suffix from PostgreSQL inet type.
func parseIP(s string) net.IP {
	// PostgreSQL inet may include /32 or /128 suffix
	for i := 0; i < len(s); i++ {
		if s[i] == '/' {
			s = s[:i]
			break
		}
	}
	return net.ParseIP(s)
}
