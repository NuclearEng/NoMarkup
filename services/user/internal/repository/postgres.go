package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/user/internal/crypto"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// PostgresRepository implements domain.UserRepository using pgx.
type PostgresRepository struct {
	pool   *pgxpool.Pool
	cipher *crypto.Cipher
}

// NewPostgresRepository creates a new PostgreSQL-backed user repository with
// the given PII cipher. Pass a cipher built from
// crypto.FromEnv() — all PII columns flagged in migration 031 are
// encrypted/decrypted through it.
func NewPostgresRepository(pool *pgxpool.Pool, cipher *crypto.Cipher) *PostgresRepository {
	return &PostgresRepository{pool: pool, cipher: cipher}
}

func (r *PostgresRepository) CreateUser(ctx context.Context, user *domain.User) error {
	query := `
		INSERT INTO users (email, email_verified, password_hash, display_name, roles, status, timezone)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at`

	err := r.pool.QueryRow(ctx, query,
		user.Email,
		user.EmailVerified,
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
		       created_at, updated_at, deleted_at, pii_encrypted_v1
		FROM users
		WHERE id = $1 AND deleted_at IS NULL`

	u, err := scanUser(r.pool.QueryRow(ctx, query, id), r.cipher)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get user by id: %w", domain.ErrUserNotFound)
		}
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return u, nil
}

// GetPublicUsersByIDs resolves N user ids in ONE round trip.
//
// `id = ANY($1::uuid[])` is a single index-driven lookup against users_pkey —
// not a loop, and not an IN-list built by string concatenation (parameterized
// only, CLAUDE.md §5/§6). The projection is deliberately narrow: this statement
// cannot return email, phone, mfa_enabled or any other PII because it never
// selects those columns, so the batch path cannot leak more than the single-user
// path after the gateway's strip.
//
// Ids with no live row are simply absent from the slice; callers treat that as
// "unknown user", never as an error.
func (r *PostgresRepository) GetPublicUsersByIDs(ctx context.Context, ids []string) ([]domain.PublicUser, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	query := `
		SELECT id, display_name, avatar_url, roles, status, created_at, last_active_at
		FROM users
		WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`

	rows, err := r.pool.Query(ctx, query, ids)
	if err != nil {
		return nil, fmt.Errorf("get public users by ids: %w", err)
	}
	defer rows.Close()

	out := make([]domain.PublicUser, 0, len(ids))
	for rows.Next() {
		var u domain.PublicUser
		var avatarURL *string
		if err := rows.Scan(
			&u.ID,
			&u.DisplayName,
			&avatarURL,
			&u.Roles,
			&u.Status,
			&u.CreatedAt,
			&u.LastActiveAt,
		); err != nil {
			return nil, fmt.Errorf("get public users by ids scan: %w", err)
		}
		if avatarURL != nil {
			u.AvatarURL = *avatarURL
		}
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("get public users by ids rows: %w", err)
	}
	return out, nil
}

func (r *PostgresRepository) GetUserByEmail(ctx context.Context, email string) (*domain.User, error) {
	query := `
		SELECT id, email, email_verified, password_hash, phone, phone_verified,
		       display_name, avatar_url, roles, status, suspension_reason,
		       mfa_enabled, mfa_secret, mfa_backup_codes,
		       last_login_at, last_active_at, timezone,
		       created_at, updated_at, deleted_at, pii_encrypted_v1
		FROM users
		WHERE email = $1 AND deleted_at IS NULL`

	u, err := scanUser(r.pool.QueryRow(ctx, query, email), r.cipher)
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

// UpdatePassword replaces a user's password hash.
func (r *PostgresRepository) UpdatePassword(ctx context.Context, userID, passwordHash string) error {
	query := `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`
	tag, err := r.pool.Exec(ctx, query, passwordHash, userID)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update password: %w", domain.ErrUserNotFound)
	}
	return nil
}

func (r *PostgresRepository) CreateRefreshToken(ctx context.Context, token *domain.RefreshToken) error {
	// family_id is passed as NULL for a session root and COALESCEd to a fresh
	// uuid, so the caller never has to mint one. A rotation passes the parent's
	// family so the whole lineage stays addressable by a single id.
	query := `
		INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at, family_id, parent_id)
		VALUES ($1, $2, $3, $4, $5, COALESCE($6::uuid, gen_random_uuid()), $7::uuid)
		RETURNING id, created_at, family_id`

	var ipStr *string
	if token.IPAddress != nil {
		s := token.IPAddress.String()
		ipStr = &s
	}

	var familyID *string
	if token.FamilyID != "" {
		familyID = &token.FamilyID
	}

	err := r.pool.QueryRow(ctx, query,
		token.UserID,
		token.TokenHash,
		token.DeviceInfo,
		ipStr,
		token.ExpiresAt,
		familyID,
		token.ParentID,
	).Scan(&token.ID, &token.CreatedAt, &token.FamilyID)
	if err != nil {
		return fmt.Errorf("create refresh token: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetRefreshToken(ctx context.Context, tokenHash string) (*domain.RefreshToken, error) {
	query := `
		SELECT id, user_id, token_hash, device_info, ip_address::text,
		       expires_at, revoked_at, created_at,
		       family_id, parent_id::text, rotated_at
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
		&rt.FamilyID,
		&rt.ParentID,
		&rt.RotatedAt,
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

// RotateRefreshTokenIfActive runs the same revoke UPDATE but reports whether a
// row was actually transitioned from active to consumed (RowsAffected == 1).
// Because Postgres applies the row lock + `revoked_at IS NULL` predicate
// atomically, only the FIRST of N concurrent statements touching the same token
// matches the predicate and affects a row; every later statement sees
// revoked_at already set and affects 0 rows. The caller uses this boolean as
// the single-winner gate for refresh-token rotation.
//
// It additionally stamps rotated_at. Plain revocation paths (logout, password
// change, admin revoke, family revoke) set revoked_at only, so `rotated_at IS
// NOT NULL` means precisely "this token was spent on a rotation and has a
// successor" — the premise reuse detection needs.
func (r *PostgresRepository) RotateRefreshTokenIfActive(ctx context.Context, tokenHash string) (bool, error) {
	query := `
		UPDATE refresh_tokens
		SET revoked_at = now(), rotated_at = now()
		WHERE token_hash = $1 AND revoked_at IS NULL`
	tag, err := r.pool.Exec(ctx, query, tokenHash)
	if err != nil {
		return false, fmt.Errorf("rotate refresh token if active: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// RevokeRefreshTokenFamily revokes every still-active token sharing a lineage
// and returns the count killed. Uses the partial index
// idx_refresh_tokens_family_active, so the cost is proportional to the live
// descendants (in practice 1-2), not the table.
func (r *PostgresRepository) RevokeRefreshTokenFamily(ctx context.Context, familyID string) (int64, error) {
	query := `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`
	tag, err := r.pool.Exec(ctx, query, familyID)
	if err != nil {
		return 0, fmt.Errorf("revoke refresh token family: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (r *PostgresRepository) RevokeAllUserTokens(ctx context.Context, userID string) error {
	query := `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`
	_, err := r.pool.Exec(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("revoke all user tokens: %w", err)
	}
	return nil
}

// --- OAuth ---

func (r *PostgresRepository) FindUserByOAuth(ctx context.Context, provider, providerID string) (*domain.User, error) {
	query := `
		SELECT u.id, u.email, u.email_verified, u.password_hash, u.phone, u.phone_verified,
		       u.display_name, u.avatar_url, u.roles, u.status, u.suspension_reason,
		       u.mfa_enabled, u.mfa_secret, u.mfa_backup_codes,
		       u.last_login_at, u.last_active_at, u.timezone,
		       u.created_at, u.updated_at, u.deleted_at, u.pii_encrypted_v1
		FROM users u
		JOIN oauth_accounts oa ON oa.user_id = u.id
		WHERE oa.provider = $1 AND oa.provider_id = $2 AND u.deleted_at IS NULL`

	u, err := scanUser(r.pool.QueryRow(ctx, query, provider, providerID), r.cipher)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("find user by oauth: %w", domain.ErrUserNotFound)
		}
		return nil, fmt.Errorf("find user by oauth: %w", err)
	}
	return u, nil
}

func (r *PostgresRepository) CreateOAuthUser(ctx context.Context, user *domain.User, provider, providerID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("create oauth user begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	userQuery := `
		INSERT INTO users (email, email_verified, password_hash, display_name, avatar_url, roles, status, timezone)
		VALUES ($1, true, NULL, $2, $3, $4, $5, $6)
		RETURNING id, created_at, updated_at`

	err = tx.QueryRow(ctx, userQuery,
		user.Email,
		user.DisplayName,
		user.AvatarURL,
		user.Roles,
		user.Status,
		user.Timezone,
	).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return fmt.Errorf("create oauth user: %w", domain.ErrEmailTaken)
		}
		return fmt.Errorf("create oauth user: %w", err)
	}

	oauthQuery := `
		INSERT INTO oauth_accounts (user_id, provider, provider_id, email)
		VALUES ($1, $2, $3, $4)`

	_, err = tx.Exec(ctx, oauthQuery, user.ID, provider, providerID, user.Email)
	if err != nil {
		return fmt.Errorf("create oauth account: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("create oauth user commit: %w", err)
	}
	return nil
}

func (r *PostgresRepository) LinkOAuthAccount(ctx context.Context, userID, provider, providerID, email string) error {
	query := `
		INSERT INTO oauth_accounts (user_id, provider, provider_id, email)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (provider, provider_id) DO NOTHING`

	_, err := r.pool.Exec(ctx, query, userID, provider, providerID, email)
	if err != nil {
		return fmt.Errorf("link oauth account: %w", err)
	}
	return nil
}

func (r *PostgresRepository) UpdateUser(ctx context.Context, userID string, input domain.UpdateUserInput) (*domain.User, error) {
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if input.DisplayName != nil {
		setClauses = append(setClauses, fmt.Sprintf("display_name = $%d", argIdx))
		args = append(args, *input.DisplayName)
		argIdx++
	}
	if input.Phone != nil {
		// Encrypt phone before storing. Empty string passes through (encryptStringOrEmpty).
		encrypted, err := r.cipher.EncryptString(*input.Phone)
		if err != nil {
			return nil, fmt.Errorf("update user: encrypt phone: %w", err)
		}
		setClauses = append(setClauses, fmt.Sprintf("phone = $%d", argIdx))
		args = append(args, encrypted)
		argIdx++
	}
	if input.AvatarURL != nil {
		setClauses = append(setClauses, fmt.Sprintf("avatar_url = $%d", argIdx))
		args = append(args, *input.AvatarURL)
		argIdx++
	}
	if input.Timezone != nil {
		setClauses = append(setClauses, fmt.Sprintf("timezone = $%d", argIdx))
		args = append(args, *input.Timezone)
		argIdx++
	}

	if len(setClauses) == 0 {
		return r.GetUserByID(ctx, userID)
	}

	// Any update touching encrypted columns marks the row as encrypted so reads
	// know to decrypt. Setting it unconditionally is fine because all
	// non-encrypted columns above are no-ops on the flag's meaning, but only
	// the encrypted-column writes (phone) actually need the flip. We set it
	// only when phone was present to avoid lying about the row's state.
	if input.Phone != nil {
		setClauses = append(setClauses, "pii_encrypted_v1 = TRUE")
	}

	setClauses = append(setClauses, "updated_at = now()")
	args = append(args, userID)

	query := fmt.Sprintf(`
		UPDATE users SET %s
		WHERE id = $%d AND deleted_at IS NULL
		RETURNING id, email, email_verified, password_hash, phone, phone_verified,
		          display_name, avatar_url, roles, status, suspension_reason,
		          mfa_enabled, mfa_secret, mfa_backup_codes,
		          last_login_at, last_active_at, timezone,
		          created_at, updated_at, deleted_at, pii_encrypted_v1`,
		strings.Join(setClauses, ", "), argIdx)

	u, err := scanUser(r.pool.QueryRow(ctx, query, args...), r.cipher)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("update user: %w", domain.ErrUserNotFound)
		}
		return nil, fmt.Errorf("update user: %w", err)
	}
	return u, nil
}

func (r *PostgresRepository) EnableRole(ctx context.Context, userID string, role string) (*domain.User, error) {
	query := `
		UPDATE users
		SET roles = CASE
			WHEN NOT ($1 = ANY(roles)) THEN array_append(roles, $1)
			ELSE roles
		END,
		updated_at = now()
		WHERE id = $2 AND deleted_at IS NULL
		RETURNING id, email, email_verified, password_hash, phone, phone_verified,
		          display_name, avatar_url, roles, status, suspension_reason,
		          mfa_enabled, mfa_secret, mfa_backup_codes,
		          last_login_at, last_active_at, timezone,
		          created_at, updated_at, deleted_at, pii_encrypted_v1`

	u, err := scanUser(r.pool.QueryRow(ctx, query, role, userID), r.cipher)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("enable role: %w", domain.ErrUserNotFound)
		}
		return nil, fmt.Errorf("enable role: %w", err)
	}
	return u, nil
}

func (r *PostgresRepository) CreateProviderProfile(ctx context.Context, userID string) (*domain.ProviderProfile, error) {
	query := `
		INSERT INTO provider_profiles (user_id)
		VALUES ($1)
		ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
		RETURNING id, user_id, business_name, bio, service_address,
		          ein_tin, insurance_policy_number,
		          ST_Y(service_location) AS lat, ST_X(service_location) AS lng,
		          service_radius_km, default_payment_timing, default_milestone_json,
		          cancellation_policy, warranty_terms, instant_enabled, instant_schedule,
		          instant_available, jobs_completed, avg_response_time_minutes,
		          on_time_rate, profile_completeness, stripe_account_id,
		          stripe_onboarding_complete, created_at, updated_at, pii_encrypted_v1`

	p, err := scanProviderProfile(r.pool.QueryRow(ctx, query, userID), r.cipher)
	if err != nil {
		return nil, fmt.Errorf("create provider profile: %w", err)
	}
	return p, nil
}

func (r *PostgresRepository) GetProviderProfile(ctx context.Context, userID string) (*domain.ProviderProfile, error) {
	query := `
		SELECT id, user_id, business_name, bio, service_address,
		       ein_tin, insurance_policy_number,
		       ST_Y(service_location) AS lat, ST_X(service_location) AS lng,
		       service_radius_km, default_payment_timing, default_milestone_json,
		       cancellation_policy, warranty_terms, instant_enabled, instant_schedule,
		       instant_available, jobs_completed, avg_response_time_minutes,
		       on_time_rate, profile_completeness, stripe_account_id,
		       stripe_onboarding_complete, created_at, updated_at, pii_encrypted_v1
		FROM provider_profiles
		WHERE user_id = $1`

	p, err := scanProviderProfile(r.pool.QueryRow(ctx, query, userID), r.cipher)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get provider profile: %w", domain.ErrProviderProfileNotFound)
		}
		return nil, fmt.Errorf("get provider profile: %w", err)
	}

	cats, err := r.GetServiceCategories(ctx, p.ID)
	if err != nil {
		return nil, fmt.Errorf("get provider profile categories: %w", err)
	}
	p.Categories = cats

	images, err := r.GetPortfolioImages(ctx, p.ID)
	if err != nil {
		return nil, fmt.Errorf("get provider profile portfolio: %w", err)
	}
	p.PortfolioImages = images

	return p, nil
}

func (r *PostgresRepository) UpdateProviderProfile(ctx context.Context, userID string, input domain.UpdateProviderInput) (*domain.ProviderProfile, error) {
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if input.BusinessName != nil {
		setClauses = append(setClauses, fmt.Sprintf("business_name = $%d", argIdx))
		args = append(args, *input.BusinessName)
		argIdx++
	}
	if input.Bio != nil {
		setClauses = append(setClauses, fmt.Sprintf("bio = $%d", argIdx))
		args = append(args, *input.Bio)
		argIdx++
	}
	// PII-at-rest columns (CLAUDE.md §6 / migration 031). Every one of these
	// goes through r.cipher on the way in — a plaintext write to any of them
	// is the bug this block exists to make impossible.
	piiFields := []struct {
		column string
		value  *string
	}{
		{"service_address", input.ServiceAddress},
		{"ein_tin", input.EINTIN},
		{"insurance_policy_number", input.InsurancePolicyNumber},
	}
	wrotePII := false
	for _, f := range piiFields {
		if f.value == nil {
			continue
		}
		// EncryptString returns "" for "" so clearing a field stays a clear,
		// not an encrypted empty string.
		encrypted, err := r.cipher.EncryptString(*f.value)
		if err != nil {
			return nil, fmt.Errorf("update provider profile: encrypt %s: %w", f.column, err)
		}
		// f.column is a compile-time literal from the slice above, never
		// caller input — the value itself is bound as $n.
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", f.column, argIdx))
		args = append(args, encrypted)
		argIdx++
		wrotePII = true
	}
	if wrotePII {
		// Assigned at most once: Postgres rejects two assignments to the same
		// column in one UPDATE. The flag stays for observability and for the
		// backfill tool's reporting, but the read path no longer depends on it
		// — see scanProviderProfile.
		setClauses = append(setClauses, "pii_encrypted_v1 = TRUE")
	}
	if input.Latitude != nil && input.Longitude != nil {
		setClauses = append(setClauses, fmt.Sprintf("service_location = ST_SetSRID(ST_MakePoint($%d, $%d), 4326)", argIdx, argIdx+1))
		args = append(args, *input.Longitude, *input.Latitude)
		argIdx += 2
	}
	if input.ServiceRadiusKm != nil {
		setClauses = append(setClauses, fmt.Sprintf("service_radius_km = $%d", argIdx))
		args = append(args, *input.ServiceRadiusKm)
		argIdx++
	}

	if len(setClauses) == 0 {
		return r.GetProviderProfile(ctx, userID)
	}

	setClauses = append(setClauses, "updated_at = now()")
	args = append(args, userID)

	query := fmt.Sprintf(`
		UPDATE provider_profiles SET %s
		WHERE user_id = $%d
		RETURNING id, user_id, business_name, bio, service_address,
		          ein_tin, insurance_policy_number,
		          ST_Y(service_location) AS lat, ST_X(service_location) AS lng,
		          service_radius_km, default_payment_timing, default_milestone_json,
		          cancellation_policy, warranty_terms, instant_enabled, instant_schedule,
		          instant_available, jobs_completed, avg_response_time_minutes,
		          on_time_rate, profile_completeness, stripe_account_id,
		          stripe_onboarding_complete, created_at, updated_at, pii_encrypted_v1`,
		strings.Join(setClauses, ", "), argIdx)

	p, err := scanProviderProfile(r.pool.QueryRow(ctx, query, args...), r.cipher)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("update provider profile: %w", domain.ErrProviderProfileNotFound)
		}
		return nil, fmt.Errorf("update provider profile: %w", err)
	}
	return p, nil
}

func (r *PostgresRepository) SetGlobalTerms(ctx context.Context, userID string, input domain.GlobalTermsInput) error {
	milestoneJSON, err := json.Marshal(input.Milestones)
	if err != nil {
		return fmt.Errorf("set global terms marshal milestones: %w", err)
	}

	query := `
		UPDATE provider_profiles
		SET default_payment_timing = $1,
		    default_milestone_json = $2,
		    cancellation_policy = $3,
		    warranty_terms = $4,
		    updated_at = now()
		WHERE user_id = $5`

	tag, err := r.pool.Exec(ctx, query,
		input.PaymentTiming,
		milestoneJSON,
		input.CancellationPolicy,
		input.WarrantyTerms,
		userID,
	)
	if err != nil {
		return fmt.Errorf("set global terms: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("set global terms: %w", domain.ErrProviderProfileNotFound)
	}
	return nil
}

func (r *PostgresRepository) GetProviderIDByUserID(ctx context.Context, userID string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx, `SELECT id FROM provider_profiles WHERE user_id = $1`, userID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("get provider id: %w", domain.ErrProviderProfileNotFound)
		}
		return "", fmt.Errorf("get provider id: %w", err)
	}
	return id, nil
}

func (r *PostgresRepository) UpdateServiceCategories(ctx context.Context, providerID string, categoryIDs []string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("update service categories begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `DELETE FROM provider_service_categories WHERE provider_id = $1`, providerID)
	if err != nil {
		return fmt.Errorf("update service categories delete: %w", err)
	}

	if len(categoryIDs) > 0 {
		query := `INSERT INTO provider_service_categories (provider_id, category_id) VALUES `
		args := []interface{}{providerID}
		for i, catID := range categoryIDs {
			if i > 0 {
				query += ", "
			}
			query += fmt.Sprintf("($1, $%d)", i+2)
			args = append(args, catID)
		}
		_, err = tx.Exec(ctx, query, args...)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23503" {
				return fmt.Errorf("update service categories: %w", domain.ErrCategoryNotFound)
			}
			return fmt.Errorf("update service categories insert: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("update service categories commit: %w", err)
	}
	return nil
}

func (r *PostgresRepository) UpdatePortfolio(ctx context.Context, providerID string, images []domain.PortfolioImage) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("update portfolio begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `DELETE FROM provider_portfolio_images WHERE provider_id = $1`, providerID)
	if err != nil {
		return fmt.Errorf("update portfolio delete: %w", err)
	}

	for _, img := range images {
		_, err = tx.Exec(ctx,
			`INSERT INTO provider_portfolio_images (provider_id, image_url, caption, sort_order) VALUES ($1, $2, $3, $4)`,
			providerID, img.ImageURL, img.Caption, img.SortOrder,
		)
		if err != nil {
			return fmt.Errorf("update portfolio insert: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("update portfolio commit: %w", err)
	}
	return nil
}

func (r *PostgresRepository) SetInstantAvailability(ctx context.Context, userID string, input domain.AvailabilityInput) error {
	query := `
		UPDATE provider_profiles
		SET instant_enabled = $1,
		    instant_available = $2,
		    instant_schedule = $3,
		    updated_at = now()
		WHERE user_id = $4`

	tag, err := r.pool.Exec(ctx, query, input.Enabled, input.AvailableNow, input.Schedule, userID)
	if err != nil {
		return fmt.Errorf("set instant availability: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("set instant availability: %w", domain.ErrProviderProfileNotFound)
	}
	return nil
}

func (r *PostgresRepository) GetServiceCategories(ctx context.Context, providerID string) ([]domain.ServiceCategory, error) {
	query := `
		SELECT sc.id, sc.parent_id, sc.name, sc.slug, sc.level, sc.description, sc.icon,
		       sc.sort_order, sc.active,
		       COALESCE(p.name, '') AS parent_name,
		       sc.created_at, sc.updated_at
		FROM service_categories sc
		JOIN provider_service_categories psc ON psc.category_id = sc.id
		LEFT JOIN service_categories p ON p.id = sc.parent_id
		WHERE psc.provider_id = $1
		ORDER BY sc.level, sc.sort_order`

	rows, err := r.pool.Query(ctx, query, providerID)
	if err != nil {
		return nil, fmt.Errorf("get service categories: %w", err)
	}
	defer rows.Close()

	var cats []domain.ServiceCategory
	for rows.Next() {
		var c domain.ServiceCategory
		var description, icon *string
		err := rows.Scan(
			&c.ID, &c.ParentID, &c.Name, &c.Slug, &c.Level,
			&description, &icon, &c.SortOrder, &c.Active,
			&c.ParentName, &c.CreatedAt, &c.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("get service categories scan: %w", err)
		}
		if description != nil {
			c.Description = *description
		}
		if icon != nil {
			c.Icon = *icon
		}
		cats = append(cats, c)
	}
	return cats, nil
}

func (r *PostgresRepository) GetPortfolioImages(ctx context.Context, providerID string) ([]domain.PortfolioImage, error) {
	query := `
		SELECT id, provider_id, image_url, caption, sort_order, created_at
		FROM provider_portfolio_images
		WHERE provider_id = $1
		ORDER BY sort_order`

	rows, err := r.pool.Query(ctx, query, providerID)
	if err != nil {
		return nil, fmt.Errorf("get portfolio images: %w", err)
	}
	defer rows.Close()

	var images []domain.PortfolioImage
	for rows.Next() {
		var img domain.PortfolioImage
		var caption *string
		err := rows.Scan(&img.ID, &img.ProviderID, &img.ImageURL, &caption, &img.SortOrder, &img.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("get portfolio images scan: %w", err)
		}
		if caption != nil {
			img.Caption = *caption
		}
		images = append(images, img)
	}
	return images, nil
}

func (r *PostgresRepository) ListServiceCategories(ctx context.Context, level *int, parentID *string) ([]domain.ServiceCategory, error) {
	query := `
		SELECT sc.id, sc.parent_id, sc.name, sc.slug, sc.level, sc.description, sc.icon,
		       sc.sort_order, sc.active,
		       COALESCE(p.name, '') AS parent_name,
		       sc.created_at, sc.updated_at
		FROM service_categories sc
		LEFT JOIN service_categories p ON p.id = sc.parent_id
		WHERE sc.active = true`
	args := []interface{}{}
	argIdx := 1

	if level != nil {
		query += fmt.Sprintf(" AND sc.level = $%d", argIdx)
		args = append(args, *level)
		argIdx++
	}
	if parentID != nil {
		query += fmt.Sprintf(" AND sc.parent_id = $%d", argIdx)
		args = append(args, *parentID)
		argIdx++
	}

	query += " ORDER BY sc.level, sc.sort_order"

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list service categories: %w", err)
	}
	defer rows.Close()

	var cats []domain.ServiceCategory
	for rows.Next() {
		var c domain.ServiceCategory
		var description, icon *string
		err := rows.Scan(
			&c.ID, &c.ParentID, &c.Name, &c.Slug, &c.Level,
			&description, &icon, &c.SortOrder, &c.Active,
			&c.ParentName, &c.CreatedAt, &c.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("list service categories scan: %w", err)
		}
		if description != nil {
			c.Description = *description
		}
		if icon != nil {
			c.Icon = *icon
		}
		cats = append(cats, c)
	}
	return cats, nil
}

func (r *PostgresRepository) GetCategoryTree(ctx context.Context) ([]domain.ServiceCategory, error) {
	return r.ListServiceCategories(ctx, nil, nil)
}

func (r *PostgresRepository) SuspendUser(ctx context.Context, userID, reason, adminID string) error {
	query := `
		UPDATE users
		SET status = 'suspended', suspension_reason = $2, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL`

	tag, err := r.pool.Exec(ctx, query, userID, reason)
	if err != nil {
		return fmt.Errorf("suspend user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("suspend user: %w", domain.ErrUserNotFound)
	}
	return nil
}

func (r *PostgresRepository) BanUser(ctx context.Context, userID, reason, adminID string) error {
	query := `
		UPDATE users
		SET status = 'banned', suspension_reason = $2, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL`

	tag, err := r.pool.Exec(ctx, query, userID, reason)
	if err != nil {
		return fmt.Errorf("ban user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("ban user: %w", domain.ErrUserNotFound)
	}
	return nil
}

// suspendOrBanWithRevoke updates a user's status to newStatus and revokes all
// active refresh tokens in a single transaction. Used by SuspendUserAndRevokeTokens
// and BanUserAndRevokeTokens to guarantee a moderation action and its session
// invalidation succeed or fail together.
func (r *PostgresRepository) suspendOrBanWithRevoke(ctx context.Context, userID, reason, newStatus, opName string) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("%s: begin tx: %w", opName, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Ban is the most severe terminal moderation state; a later suspend must not
	// silently downgrade a banned account back to merely suspended. The NOT(...)
	// clause blocks only the suspend->banned downgrade; ban still escalates a
	// suspended account normally.
	tag, err := tx.Exec(ctx, `
		UPDATE users
		SET status = $2, suspension_reason = $3, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
		  AND NOT ($2 = 'suspended' AND status = 'banned')`, userID, newStatus, reason)
	if err != nil {
		return fmt.Errorf("%s: update status: %w", opName, err)
	}
	if tag.RowsAffected() == 0 {
		// 0 rows means the user is missing OR a banned account was protected from
		// a suspend downgrade — distinguish so the caller gets the right status.
		if newStatus == "suspended" {
			var current string
			if e := tx.QueryRow(ctx,
				`SELECT status FROM users WHERE id = $1 AND deleted_at IS NULL`, userID).Scan(&current); e == nil && current == "banned" {
				return fmt.Errorf("%s: %w", opName, domain.ErrCannotSuspendBanned)
			}
		}
		return fmt.Errorf("%s: %w", opName, domain.ErrUserNotFound)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at = now()
		WHERE user_id = $1 AND revoked_at IS NULL`, userID); err != nil {
		return fmt.Errorf("%s: revoke tokens: %w", opName, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("%s: commit: %w", opName, err)
	}
	return nil
}

func (r *PostgresRepository) SuspendUserAndRevokeTokens(ctx context.Context, userID, reason, adminID string) error {
	return r.suspendOrBanWithRevoke(ctx, userID, reason, "suspended", "suspend user")
}

func (r *PostgresRepository) BanUserAndRevokeTokens(ctx context.Context, userID, reason, adminID string) error {
	return r.suspendOrBanWithRevoke(ctx, userID, reason, "banned", "ban user")
}

// ReactivateUser flips users.status back to 'active' and clears
// suspension_reason. Used by AdminReactivateUser to undo a suspension
// (counterpart to SuspendUserAndRevokeTokens). No-op if the user is
// already active. Returns ErrUserNotFound if the user doesn't exist.
func (r *PostgresRepository) ReactivateUser(ctx context.Context, userID, adminID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users
		   SET status            = 'active',
		       suspension_reason = NULL,
		       updated_at        = now()
		 WHERE id = $1 AND deleted_at IS NULL`, userID)
	if err != nil {
		return fmt.Errorf("reactivate user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("reactivate user: %w", domain.ErrUserNotFound)
	}
	return nil
}

func (r *PostgresRepository) InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any, ipAddress string) error {
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("insert audit log marshal details: %w", err)
	}

	query := `
		INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details, ip_address)
		VALUES ($1, $2, $3, $4, $5, $6)`

	_, err = r.pool.Exec(ctx, query, adminID, action, targetType, targetID, detailsJSON, ipAddress)
	if err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func (r *PostgresRepository) AdminSearchUsers(ctx context.Context, query, status, role string, page, pageSize int) ([]domain.User, int, error) {
	whereClauses := []string{"deleted_at IS NULL"}
	args := []interface{}{}
	argIdx := 1

	if query != "" {
		// Phone is stored encrypted (per migration 031 / nacl secretbox), so
		// ILIKE on phone cannot match. Search by email and display_name only.
		whereClauses = append(whereClauses, fmt.Sprintf(
			"(email ILIKE $%d OR display_name ILIKE $%d)",
			argIdx, argIdx,
		))
		args = append(args, "%"+query+"%")
		argIdx++
	}
	if status != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, status)
		argIdx++
	}
	if role != "" {
		// roles is a text[] column; membership test mirrors the provider
		// search ('provider' = ANY(u.roles)).
		whereClauses = append(whereClauses, fmt.Sprintf("$%d = ANY(roles)", argIdx))
		args = append(args, role)
		argIdx++
	}

	whereSQL := strings.Join(whereClauses, " AND ")

	// Count total matching rows.
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM users WHERE %s", whereSQL)
	var total int
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("admin search users count: %w", err)
	}

	// Fetch the page.
	offset := (page - 1) * pageSize
	dataQuery := fmt.Sprintf(`
		SELECT id, email, email_verified, password_hash, phone, phone_verified,
		       display_name, avatar_url, roles, status, suspension_reason,
		       mfa_enabled, mfa_secret, mfa_backup_codes,
		       last_login_at, last_active_at, timezone,
		       created_at, updated_at, deleted_at, pii_encrypted_v1
		FROM users
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`,
		whereSQL, argIdx, argIdx+1)
	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("admin search users query: %w", err)
	}
	defer rows.Close()

	var users []domain.User
	for rows.Next() {
		u, err := scanUserFromRows(rows, r.cipher)
		if err != nil {
			return nil, 0, fmt.Errorf("admin search users scan: %w", err)
		}
		users = append(users, *u)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("admin search users rows: %w", err)
	}
	return users, total, nil
}

// scanUserFromRows scans a single user from a pgx.Rows iterator. When the
// row's pii_encrypted_v1 flag is true, phone and mfa_secret are decrypted
// through cipher; legacy plaintext rows are passed through unchanged so the
// repo continues to work pre-encrypt-pii backfill.
func scanUserFromRows(rows pgx.Rows, cipher *crypto.Cipher) (*domain.User, error) {
	var u domain.User
	var phone, avatarURL, suspensionReason, mfaSecret *string
	var piiEncrypted bool
	err := rows.Scan(
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
		&piiEncrypted,
	)
	if err != nil {
		return nil, err
	}
	if avatarURL != nil {
		u.AvatarURL = *avatarURL
	}
	if suspensionReason != nil {
		u.SuspensionReason = *suspensionReason
	}
	if err := decryptUserPII(&u, phone, mfaSecret, piiEncrypted, cipher); err != nil {
		return nil, err
	}
	return &u, nil
}

// decryptUserPII assigns Phone / MFASecret from raw column values, decrypting
// when the row is flagged as encrypted. mfa_backup_codes are argon2id hashes
// (one-way) and are left as-is.
func decryptUserPII(u *domain.User, phone, mfaSecret *string, piiEncrypted bool, cipher *crypto.Cipher) error {
	if !piiEncrypted {
		if phone != nil {
			u.Phone = *phone
		}
		if mfaSecret != nil {
			u.MFASecret = *mfaSecret
		}
		return nil
	}
	if phone != nil && *phone != "" {
		decrypted, err := cipher.DecryptString(*phone)
		if err != nil {
			return fmt.Errorf("decrypt phone: %w", err)
		}
		u.Phone = decrypted
	}
	if mfaSecret != nil && *mfaSecret != "" {
		decrypted, err := cipher.DecryptString(*mfaSecret)
		if err != nil {
			return fmt.Errorf("decrypt mfa secret: %w", err)
		}
		u.MFASecret = decrypted
	}
	return nil
}

// scanProviderProfile decrypts the three PII-at-rest columns declared by
// migration 031: service_address, ein_tin and insurance_policy_number.
//
// Detection is PER VALUE (crypto.DecryptStringOrPassthrough), not per row via
// pii_encrypted_v1. The flag is a row-level boolean but encryption is a
// column-level property, and UpdateProviderProfile sets the flag TRUE whenever
// service_address is written — so a row can legitimately be flagged TRUE while
// ein_tin is still the plaintext the backfill never revisited. Trusting the
// flag there would hand raw plaintext back as if it had been decrypted, or, on
// the write side, encrypt an already-encrypted value. Per-value authentication
// cannot drift that way.
func scanProviderProfile(row pgx.Row, cipher *crypto.Cipher) (*domain.ProviderProfile, error) {
	var p domain.ProviderProfile
	var businessName, bio, serviceAddress, cancellationPolicy, warrantyTerms, stripeAccountID *string
	var einTin, insurancePolicy *string
	var piiEncrypted bool
	err := row.Scan(
		&p.ID, &p.UserID, &businessName, &bio, &serviceAddress,
		&einTin, &insurancePolicy,
		&p.Latitude, &p.Longitude,
		&p.ServiceRadiusKm, &p.DefaultPaymentTiming, &p.DefaultMilestoneJSON,
		&cancellationPolicy, &warrantyTerms, &p.InstantEnabled, &p.InstantSchedule,
		&p.InstantAvailable, &p.JobsCompleted, &p.AvgResponseTimeMinutes,
		&p.OnTimeRate, &p.ProfileCompleteness, &stripeAccountID,
		&p.StripeOnboardingComplete, &p.CreatedAt, &p.UpdatedAt, &piiEncrypted,
	)
	if err != nil {
		return nil, err
	}
	_ = piiEncrypted // retained in the projection for observability; not load-bearing
	if businessName != nil {
		p.BusinessName = *businessName
	}
	if bio != nil {
		p.Bio = *bio
	}
	if cancellationPolicy != nil {
		p.CancellationPolicy = *cancellationPolicy
	}
	if warrantyTerms != nil {
		p.WarrantyTerms = *warrantyTerms
	}
	if stripeAccountID != nil {
		p.StripeAccountID = *stripeAccountID
	}
	if serviceAddress != nil {
		plain, err := cipher.DecryptStringOrPassthrough(*serviceAddress)
		if err != nil {
			return nil, fmt.Errorf("decrypt service_address: %w", err)
		}
		p.ServiceAddress = plain
	}
	if einTin != nil {
		plain, err := cipher.DecryptStringOrPassthrough(*einTin)
		if err != nil {
			return nil, fmt.Errorf("decrypt ein_tin: %w", err)
		}
		p.EINTIN = plain
	}
	if insurancePolicy != nil {
		plain, err := cipher.DecryptStringOrPassthrough(*insurancePolicy)
		if err != nil {
			return nil, fmt.Errorf("decrypt insurance_policy_number: %w", err)
		}
		p.InsurancePolicyNumber = plain
	}
	return &p, nil
}

func ComputeProfileCompleteness(p *domain.ProviderProfile) int {
	total := 8
	filled := 0
	if p.BusinessName != "" {
		filled++
	}
	if p.Bio != "" {
		filled++
	}
	if p.ServiceAddress != "" {
		filled++
	}
	if p.Latitude != nil && p.Longitude != nil {
		filled++
	}
	if p.CancellationPolicy != "" {
		filled++
	}
	if p.WarrantyTerms != "" {
		filled++
	}
	if len(p.Categories) > 0 {
		filled++
	}
	if len(p.PortfolioImages) > 0 {
		filled++
	}
	return (filled * 100) / total
}

// scanUser scans a single user row from a pgx.Row. See scanUserFromRows for
// the decryption behavior.
func scanUser(row pgx.Row, cipher *crypto.Cipher) (*domain.User, error) {
	var u domain.User
	var phone, avatarURL, suspensionReason, mfaSecret *string
	var piiEncrypted bool
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
		&piiEncrypted,
	)
	if err != nil {
		return nil, err
	}
	if avatarURL != nil {
		u.AvatarURL = *avatarURL
	}
	if suspensionReason != nil {
		u.SuspensionReason = *suspensionReason
	}
	if err := decryptUserPII(&u, phone, mfaSecret, piiEncrypted, cipher); err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *PostgresRepository) UpdatePhoneVerified(ctx context.Context, userID string, verified bool) error {
	query := `UPDATE users SET phone_verified = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL`
	tag, err := r.pool.Exec(ctx, query, verified, userID)
	if err != nil {
		return fmt.Errorf("update phone verified: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update phone verified: %w", domain.ErrUserNotFound)
	}
	return nil
}

func (r *PostgresRepository) CreateDocument(ctx context.Context, doc *domain.Document) error {
	// file_size_bytes and mime_type are NOT NULL; omitting them made every
	// document upload fail the not-null constraint (a 500 on the happy path —
	// the feature was effectively dead).
	query := `
		INSERT INTO verification_documents (user_id, document_type, status, file_name, file_url, mime_type, file_size_bytes, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at, updated_at`

	err := r.pool.QueryRow(ctx, query,
		doc.UserID,
		string(doc.Type),
		string(doc.Status),
		doc.FileName,
		doc.StorageURL,
		doc.MimeType,
		doc.SizeBytes,
		doc.ExpiresAt,
	).Scan(&doc.ID, &doc.CreatedAt, &doc.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create document: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetDocument(ctx context.Context, documentID string) (*domain.Document, error) {
	query := `
		SELECT id, user_id, document_type, status, file_name, file_url,
		       rejection_reason, expires_at, created_at, updated_at
		FROM verification_documents
		WHERE id = $1`

	var doc domain.Document
	var fileName, rejectionReason, storageURL *string
	var expiresAt *time.Time
	err := r.pool.QueryRow(ctx, query, documentID).Scan(
		&doc.ID, &doc.UserID, &doc.Type, &doc.Status,
		&fileName, &storageURL, &rejectionReason,
		&expiresAt, &doc.CreatedAt, &doc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get document: %w", domain.ErrDocumentNotFound)
		}
		return nil, fmt.Errorf("get document: %w", err)
	}
	if fileName != nil {
		doc.FileName = *fileName
	}
	if rejectionReason != nil {
		doc.RejectionReason = *rejectionReason
	}
	if storageURL != nil {
		doc.StorageURL = *storageURL
	}
	doc.ExpiresAt = expiresAt
	return &doc, nil
}

func (r *PostgresRepository) GetDocumentByUserAndType(ctx context.Context, userID string, docType domain.DocumentType) (*domain.Document, error) {
	query := `
		SELECT id, user_id, document_type, status, file_name, file_url,
		       rejection_reason, expires_at, created_at, updated_at
		FROM verification_documents
		WHERE user_id = $1 AND document_type = $2
		ORDER BY created_at DESC
		LIMIT 1`

	var doc domain.Document
	var fileName, rejectionReason, storageURL *string
	var expiresAt *time.Time
	err := r.pool.QueryRow(ctx, query, userID, string(docType)).Scan(
		&doc.ID, &doc.UserID, &doc.Type, &doc.Status,
		&fileName, &storageURL, &rejectionReason,
		&expiresAt, &doc.CreatedAt, &doc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get document by user and type: %w", domain.ErrDocumentNotFound)
		}
		return nil, fmt.Errorf("get document by user and type: %w", err)
	}
	if fileName != nil {
		doc.FileName = *fileName
	}
	if rejectionReason != nil {
		doc.RejectionReason = *rejectionReason
	}
	if storageURL != nil {
		doc.StorageURL = *storageURL
	}
	doc.ExpiresAt = expiresAt
	return &doc, nil
}

func (r *PostgresRepository) ListDocuments(ctx context.Context, userID string) ([]domain.Document, error) {
	query := `
		SELECT id, user_id, document_type, status, file_name, file_url,
		       rejection_reason, expires_at, created_at, updated_at
		FROM verification_documents
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 50`

	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	defer rows.Close()

	var docs []domain.Document
	for rows.Next() {
		var doc domain.Document
		var fileName, rejectionReason, storageURL *string
		var expiresAt *time.Time
		err := rows.Scan(
			&doc.ID, &doc.UserID, &doc.Type, &doc.Status,
			&fileName, &storageURL, &rejectionReason,
			&expiresAt, &doc.CreatedAt, &doc.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("list documents scan: %w", err)
		}
		if fileName != nil {
			doc.FileName = *fileName
		}
		if rejectionReason != nil {
			doc.RejectionReason = *rejectionReason
		}
		if storageURL != nil {
			doc.StorageURL = *storageURL
		}
		doc.ExpiresAt = expiresAt
		docs = append(docs, doc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list documents rows: %w", err)
	}
	return docs, nil
}

func (r *PostgresRepository) UpdateDocumentStatus(ctx context.Context, documentID string, status domain.DocumentStatus, rejectionReason string) error {
	query := `
		UPDATE verification_documents
		SET status = $1, rejection_reason = $2, updated_at = now()
		WHERE id = $3`

	tag, err := r.pool.Exec(ctx, query, string(status), rejectionReason, documentID)
	if err != nil {
		return fmt.Errorf("update document status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update document status: %w", domain.ErrDocumentNotFound)
	}
	return nil
}

// ListPendingDocuments returns verification documents in the 'pending' state
// across all users, joined with the owning user's identity, ordered oldest
// first (FIFO review queue). Soft-deleted users are excluded.
func (r *PostgresRepository) ListPendingDocuments(ctx context.Context, page, pageSize int) ([]domain.PendingDocument, int, error) {
	const countQuery = `
		SELECT COUNT(*)
		FROM verification_documents vd
		JOIN users u ON u.id = vd.user_id
		WHERE vd.status = 'pending' AND u.deleted_at IS NULL`

	var total int
	if err := r.pool.QueryRow(ctx, countQuery).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("list pending documents count: %w", err)
	}

	offset := (page - 1) * pageSize
	const dataQuery = `
		SELECT vd.id, vd.user_id, vd.document_type, vd.status,
		       vd.file_name, vd.file_url, vd.rejection_reason,
		       vd.expires_at, vd.created_at, vd.updated_at,
		       u.email, u.display_name
		FROM verification_documents vd
		JOIN users u ON u.id = vd.user_id
		WHERE vd.status = 'pending' AND u.deleted_at IS NULL
		ORDER BY vd.created_at ASC
		LIMIT $1 OFFSET $2`

	rows, err := r.pool.Query(ctx, dataQuery, pageSize, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list pending documents query: %w", err)
	}
	defer rows.Close()

	var docs []domain.PendingDocument
	for rows.Next() {
		var pd domain.PendingDocument
		var fileName, rejectionReason, storageURL *string
		var expiresAt *time.Time
		if err := rows.Scan(
			&pd.ID, &pd.UserID, &pd.Type, &pd.Status,
			&fileName, &storageURL, &rejectionReason,
			&expiresAt, &pd.CreatedAt, &pd.UpdatedAt,
			&pd.UserEmail, &pd.UserDisplayName,
		); err != nil {
			return nil, 0, fmt.Errorf("list pending documents scan: %w", err)
		}
		if fileName != nil {
			pd.FileName = *fileName
		}
		if rejectionReason != nil {
			pd.RejectionReason = *rejectionReason
		}
		if storageURL != nil {
			pd.StorageURL = *storageURL
		}
		pd.ExpiresAt = expiresAt
		docs = append(docs, pd)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("list pending documents rows: %w", err)
	}
	return docs, total, nil
}

// --- MFA ---

// StoreMFASecret encrypts the TOTP secret with the row's PII cipher and
// writes it. Sets pii_encrypted_v1 = TRUE so subsequent reads decrypt.
// The parameter name historically said "encryptedSecret" but the service
// always passed plaintext; we now actually do the encryption here.
func (r *PostgresRepository) StoreMFASecret(ctx context.Context, userID, plaintextSecret string) error {
	encrypted, err := r.cipher.EncryptString(plaintextSecret)
	if err != nil {
		return fmt.Errorf("store mfa secret: encrypt: %w", err)
	}
	query := `UPDATE users SET mfa_secret = $1, pii_encrypted_v1 = TRUE, updated_at = now() WHERE id = $2 AND deleted_at IS NULL`
	tag, err := r.pool.Exec(ctx, query, encrypted, userID)
	if err != nil {
		return fmt.Errorf("store mfa secret: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("store mfa secret: %w", domain.ErrUserNotFound)
	}
	return nil
}

// GetMFASecret returns the decrypted TOTP secret for the given user. Rows that
// predate the PII encryption rollout (pii_encrypted_v1 = false) return their
// plaintext value, preserving backwards compatibility until the re-encryption
// job runs.
func (r *PostgresRepository) GetMFASecret(ctx context.Context, userID string) (string, error) {
	query := `SELECT mfa_secret, pii_encrypted_v1 FROM users WHERE id = $1 AND deleted_at IS NULL`
	var secret *string
	var encrypted bool
	err := r.pool.QueryRow(ctx, query, userID).Scan(&secret, &encrypted)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("get mfa secret: %w", domain.ErrUserNotFound)
		}
		return "", fmt.Errorf("get mfa secret: %w", err)
	}
	if secret == nil {
		return "", fmt.Errorf("get mfa secret: %w", domain.ErrMFANotSetup)
	}
	if !encrypted || *secret == "" {
		return *secret, nil
	}
	plaintext, err := r.cipher.DecryptString(*secret)
	if err != nil {
		return "", fmt.Errorf("get mfa secret: decrypt: %w", err)
	}
	return plaintext, nil
}

// EnableMFA persists argon2id-hashed backup codes. The hashes are one-way and
// never decrypted — they are compared via crypto/subtle in the service layer.
func (r *PostgresRepository) EnableMFA(ctx context.Context, userID string, hashedBackupCodes []string) error {
	query := `UPDATE users SET mfa_enabled = true, mfa_backup_codes = $1, pii_encrypted_v1 = TRUE, updated_at = now() WHERE id = $2 AND deleted_at IS NULL`
	tag, err := r.pool.Exec(ctx, query, hashedBackupCodes, userID)
	if err != nil {
		return fmt.Errorf("enable mfa: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("enable mfa: %w", domain.ErrUserNotFound)
	}
	return nil
}

func (r *PostgresRepository) DisableMFA(ctx context.Context, userID string) error {
	query := `UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_backup_codes = NULL, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`
	tag, err := r.pool.Exec(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("disable mfa: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("disable mfa: %w", domain.ErrUserNotFound)
	}
	return nil
}

func (r *PostgresRepository) IsMFAEnabled(ctx context.Context, userID string) (bool, error) {
	query := `SELECT mfa_enabled FROM users WHERE id = $1 AND deleted_at IS NULL`
	var enabled bool
	err := r.pool.QueryRow(ctx, query, userID).Scan(&enabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, fmt.Errorf("is mfa enabled: %w", domain.ErrUserNotFound)
		}
		return false, fmt.Errorf("is mfa enabled: %w", err)
	}
	return enabled, nil
}

// --- Provider Search ---

func (r *PostgresRepository) SearchProviders(ctx context.Context, input domain.ProviderSearchInput) ([]domain.ProviderSearchResult, int, error) {
	whereClauses := []string{
		"u.deleted_at IS NULL",
		"u.status = 'active'",
		"'provider' = ANY(u.roles)",
	}
	// WHERE args are numbered independently of the distance SELECT expression.
	// The distance computation (distanceExpr) only appears in the data query's
	// SELECT and ORDER BY, never in WHERE, so its lng/lat parameters must NOT be
	// bound to the count query — doing so passed pgx more parameters than the
	// count statement referenced and failed every geo search with a 500. Build
	// whereArgs ($1..) for the count; the data query appends the distance + page
	// args after them.
	whereArgs := []interface{}{}
	argIdx := 1

	if input.Latitude != nil && input.Longitude != nil && input.RadiusKm > 0 {
		whereClauses = append(whereClauses, fmt.Sprintf(
			"pp.service_location IS NOT NULL AND ST_DistanceSphere(pp.service_location, ST_SetSRID(ST_MakePoint($%d, $%d), 4326)) / 1000.0 <= $%d",
			argIdx, argIdx+1, argIdx+2,
		))
		whereArgs = append(whereArgs, *input.Longitude, *input.Latitude, input.RadiusKm)
		argIdx += 3
	}

	// Filter by category IDs.
	if len(input.CategoryIDs) > 0 {
		whereClauses = append(whereClauses, fmt.Sprintf(
			"EXISTS (SELECT 1 FROM provider_service_categories psc WHERE psc.provider_id = pp.id AND psc.category_id = ANY($%d))",
			argIdx,
		))
		whereArgs = append(whereArgs, input.CategoryIDs)
		argIdx++
	}

	// Filter by minimum rating.
	if input.MinRating != nil {
		whereClauses = append(whereClauses, fmt.Sprintf(
			"COALESCE(rs.average_rating, 0) >= $%d",
			argIdx,
		))
		whereArgs = append(whereArgs, *input.MinRating)
		argIdx++
	}

	// Filter by verified providers only (at least one verified document).
	if input.VerifiedOnly != nil && *input.VerifiedOnly {
		whereClauses = append(whereClauses, `
			EXISTS (SELECT 1 FROM verification_documents vd WHERE vd.user_id = u.id AND vd.status = 'verified')`)
	}

	// Filter by instant availability.
	if input.InstantAvailable != nil && *input.InstantAvailable {
		whereClauses = append(whereClauses, "pp.instant_available = true")
	}

	whereSQL := strings.Join(whereClauses, " AND ")

	// Count total matching providers — bound only with whereArgs (the count
	// query has no distance SELECT, so it references nothing beyond WHERE).
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM users u
		JOIN provider_profiles pp ON pp.user_id = u.id
		LEFT JOIN LATERAL (
			SELECT AVG(r.overall_rating)::float8 AS average_rating
			FROM reviews r WHERE r.reviewee_id = u.id
		) rs ON true
		WHERE %s`, whereSQL)

	var total int
	if err := r.pool.QueryRow(ctx, countQuery, whereArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("search providers count: %w", err)
	}

	// The data query reuses the WHERE args, then appends the distance lng/lat
	// (referenced only by the SELECT/ORDER BY distance expression) and finally
	// the LIMIT/OFFSET — so its placeholders continue past whereArgs.
	args := append([]interface{}{}, whereArgs...)
	distanceExpr := "0"
	if input.Latitude != nil && input.Longitude != nil {
		// ST_DistanceSphere returns metres; divide by 1000 for km.
		distanceExpr = fmt.Sprintf(
			"ST_DistanceSphere(pp.service_location, ST_SetSRID(ST_MakePoint($%d, $%d), 4326)) / 1000.0",
			argIdx, argIdx+1,
		)
		args = append(args, *input.Longitude, *input.Latitude)
		argIdx += 2
	}

	// Determine ORDER BY clause.
	orderBy := "pp.created_at DESC"
	if input.SortField != "" {
		dir := "ASC"
		if input.SortDirection == "desc" {
			dir = "DESC"
		}
		switch input.SortField {
		case "rating":
			orderBy = fmt.Sprintf("COALESCE(rs.average_rating, 0) %s", dir)
		case "distance":
			if input.Latitude != nil && input.Longitude != nil {
				orderBy = fmt.Sprintf("%s %s", distanceExpr, dir)
			}
		case "review_count":
			orderBy = fmt.Sprintf("COALESCE(rs.review_count, 0) %s", dir)
		case "jobs_completed":
			orderBy = fmt.Sprintf("pp.jobs_completed %s", dir)
		}
	}

	offset := (input.Page - 1) * input.PageSize

	dataQuery := fmt.Sprintf(`
		SELECT
			u.id AS user_id,
			u.display_name,
			COALESCE(pp.business_name, '') AS business_name,
			COALESCE(u.avatar_url, '') AS avatar_url,
			COALESCE((%s), 0)::float8 AS distance_km,
			COALESCE(rs.average_rating, 0)::float8 AS average_rating,
			COALESCE(rs.review_count, 0) AS review_count,
			COALESCE(pp.on_time_rate, 0)::float8 AS on_time_rate,
			pp.instant_available,
			pp.id AS provider_id
		FROM users u
		JOIN provider_profiles pp ON pp.user_id = u.id
		LEFT JOIN LATERAL (
			SELECT AVG(r.overall_rating)::float8 AS average_rating, COUNT(*)::int AS review_count
			FROM reviews r WHERE r.reviewee_id = u.id
		) rs ON true
		WHERE %s
		ORDER BY %s
		LIMIT $%d OFFSET $%d`,
		distanceExpr, whereSQL, orderBy, argIdx, argIdx+1)
	args = append(args, input.PageSize, offset)

	rows, err := r.pool.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("search providers query: %w", err)
	}
	defer rows.Close()

	var results []domain.ProviderSearchResult
	var providerIDs []string
	providerByUser := make(map[string]int) // user_id -> index in results

	for rows.Next() {
		var res domain.ProviderSearchResult
		var providerID string
		err := rows.Scan(
			&res.UserID,
			&res.DisplayName,
			&res.BusinessName,
			&res.AvatarURL,
			&res.DistanceKm,
			&res.AverageRating,
			&res.ReviewCount,
			&res.OnTimeRate,
			&res.InstantAvailable,
			&providerID,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("search providers scan: %w", err)
		}
		providerByUser[res.UserID] = len(results)
		providerIDs = append(providerIDs, providerID)
		results = append(results, res)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("search providers rows: %w", err)
	}

	if len(results) == 0 {
		return results, total, nil
	}

	// Batch-load categories for returned providers.
	catQuery := `
		SELECT psc.provider_id, sc.id, sc.name, sc.slug, sc.level,
		       COALESCE(p.name, '') AS parent_name
		FROM provider_service_categories psc
		JOIN service_categories sc ON sc.id = psc.category_id
		LEFT JOIN service_categories p ON p.id = sc.parent_id
		WHERE psc.provider_id = ANY($1)
		ORDER BY sc.level, sc.sort_order`

	catRows, err := r.pool.Query(ctx, catQuery, providerIDs)
	if err != nil {
		return nil, 0, fmt.Errorf("search providers categories: %w", err)
	}
	defer catRows.Close()

	// Map provider_id -> user_id so we can attach categories to results.
	providerToIdx := make(map[string]int, len(providerIDs))
	for i, pid := range providerIDs {
		providerToIdx[pid] = i
	}

	for catRows.Next() {
		var pid, catID, catName, catSlug, parentName string
		var catLevel int
		if err := catRows.Scan(&pid, &catID, &catName, &catSlug, &catLevel, &parentName); err != nil {
			return nil, 0, fmt.Errorf("search providers categories scan: %w", err)
		}
		if idx, ok := providerToIdx[pid]; ok {
			results[idx].Categories = append(results[idx].Categories, domain.ServiceCategory{
				ID:         catID,
				Name:       catName,
				Slug:       catSlug,
				Level:      catLevel,
				ParentName: parentName,
			})
		}
	}

	// Batch-load verification badges for returned providers.
	badgeQuery := `
		SELECT vd.user_id, vd.document_type, vd.status, vd.updated_at, vd.expires_at
		FROM verification_documents vd
		WHERE vd.user_id = ANY($1) AND vd.status = 'verified'`

	userIDs := make([]string, 0, len(results))
	for _, res := range results {
		userIDs = append(userIDs, res.UserID)
	}

	badgeRows, err := r.pool.Query(ctx, badgeQuery, userIDs)
	if err != nil {
		return nil, 0, fmt.Errorf("search providers badges: %w", err)
	}
	defer badgeRows.Close()

	for badgeRows.Next() {
		var userID, docType, docStatus string
		var verifiedAt, expiresAt *time.Time
		if err := badgeRows.Scan(&userID, &docType, &docStatus, &verifiedAt, &expiresAt); err != nil {
			return nil, 0, fmt.Errorf("search providers badges scan: %w", err)
		}
		if idx, ok := providerByUser[userID]; ok {
			results[idx].Badges = append(results[idx].Badges, domain.VerificationBadge{
				DocumentType: docType,
				Status:       docStatus,
				VerifiedAt:   verifiedAt,
				ExpiresAt:    expiresAt,
			})
		}
	}

	return results, total, nil
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

// --- Property Repository Methods ---

func (r *PostgresRepository) CreateProperty(ctx context.Context, input domain.CreatePropertyInput) (*domain.Property, error) {
	// Encrypt address + notes before write. city/state/zip/location stay
	// plaintext for indexed search and PostGIS proximity queries (see
	// migration 033 comment).
	encAddress, err := r.cipher.EncryptString(input.Address)
	if err != nil {
		return nil, fmt.Errorf("create property: encrypt address: %w", err)
	}
	encNotes, err := r.cipher.EncryptString(input.Notes)
	if err != nil {
		return nil, fmt.Errorf("create property: encrypt notes: %w", err)
	}

	p := &domain.Property{}
	var addrCol, notesCol string
	var piiEncrypted bool
	err = r.pool.QueryRow(ctx, `
		INSERT INTO properties (user_id, nickname, address, city, state, zip_code, location, notes, is_primary, pii_encrypted_v1)
		VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9, $10, TRUE)
		RETURNING id, user_id, nickname, address, city, state, zip_code,
		          ST_X(location) AS longitude, ST_Y(location) AS latitude,
		          COALESCE(notes, ''), is_primary, created_at, updated_at, pii_encrypted_v1`,
		input.UserID, input.Nickname, encAddress, input.City, input.State, input.ZipCode,
		input.Longitude, input.Latitude, encNotes, input.IsPrimary,
	).Scan(
		&p.ID, &p.UserID, &p.Nickname, &addrCol, &p.City, &p.State, &p.ZipCode,
		&p.Longitude, &p.Latitude,
		&notesCol, &p.IsPrimary, &p.CreatedAt, &p.UpdatedAt, &piiEncrypted,
	)
	if err != nil {
		return nil, fmt.Errorf("create property: %w", err)
	}
	if err := decryptPropertyFields(&p.Address, &p.Notes, addrCol, notesCol, piiEncrypted, r.cipher); err != nil {
		return nil, fmt.Errorf("create property: %w", err)
	}

	// If this property is set as primary, unset other primaries for the user.
	if input.IsPrimary {
		_, err = r.pool.Exec(ctx, `
			UPDATE properties SET is_primary = false, updated_at = now()
			WHERE user_id = $1 AND id != $2 AND is_primary = true AND deleted_at IS NULL`,
			input.UserID, p.ID)
		if err != nil {
			return nil, fmt.Errorf("create property unset primary: %w", err)
		}
	}

	return p, nil
}

func (r *PostgresRepository) ListProperties(ctx context.Context, userID string) ([]domain.Property, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, user_id, COALESCE(nickname, ''), address, city, state, zip_code,
		       ST_X(location) AS longitude, ST_Y(location) AS latitude,
		       COALESCE(notes, ''), is_primary, created_at, updated_at, pii_encrypted_v1
		FROM properties
		WHERE user_id = $1 AND deleted_at IS NULL
		ORDER BY is_primary DESC, created_at ASC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list properties: %w", err)
	}
	defer rows.Close()

	var properties []domain.Property
	for rows.Next() {
		var p domain.Property
		var addrCol, notesCol string
		var piiEncrypted bool
		err := rows.Scan(
			&p.ID, &p.UserID, &p.Nickname, &addrCol, &p.City, &p.State, &p.ZipCode,
			&p.Longitude, &p.Latitude,
			&notesCol, &p.IsPrimary, &p.CreatedAt, &p.UpdatedAt, &piiEncrypted,
		)
		if err != nil {
			return nil, fmt.Errorf("list properties scan: %w", err)
		}
		if err := decryptPropertyFields(&p.Address, &p.Notes, addrCol, notesCol, piiEncrypted, r.cipher); err != nil {
			return nil, fmt.Errorf("list properties decrypt: %w", err)
		}
		properties = append(properties, p)
	}

	return properties, nil
}

func (r *PostgresRepository) UpdateProperty(ctx context.Context, propertyID string, input domain.UpdatePropertyInput) (*domain.Property, error) {
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if input.Nickname != nil {
		setClauses = append(setClauses, fmt.Sprintf("nickname = $%d", argIdx))
		args = append(args, *input.Nickname)
		argIdx++
	}
	if input.Notes != nil {
		encNotes, err := r.cipher.EncryptString(*input.Notes)
		if err != nil {
			return nil, fmt.Errorf("update property: encrypt notes: %w", err)
		}
		setClauses = append(setClauses, fmt.Sprintf("notes = $%d", argIdx))
		args = append(args, encNotes)
		argIdx++
		// Mark row as encrypted so reads decrypt the new ciphertext.
		setClauses = append(setClauses, "pii_encrypted_v1 = TRUE")
	}
	if input.IsPrimary != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_primary = $%d", argIdx))
		args = append(args, *input.IsPrimary)
		argIdx++
	}

	if len(setClauses) == 0 {
		// Nothing to update; return the current property.
		return r.getPropertyByID(ctx, propertyID)
	}

	setClauses = append(setClauses, "updated_at = now()")
	args = append(args, propertyID)

	query := fmt.Sprintf(`UPDATE properties SET %s WHERE id = $%d AND deleted_at IS NULL`,
		strings.Join(setClauses, ", "), argIdx)

	tag, err := r.pool.Exec(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("update property: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("update property: %w", domain.ErrPropertyNotFound)
	}

	// If this property was set as primary, unset others.
	if input.IsPrimary != nil && *input.IsPrimary {
		p, err := r.getPropertyByID(ctx, propertyID)
		if err != nil {
			return nil, err
		}
		_, err = r.pool.Exec(ctx, `
			UPDATE properties SET is_primary = false, updated_at = now()
			WHERE user_id = $1 AND id != $2 AND is_primary = true AND deleted_at IS NULL`,
			p.UserID, propertyID)
		if err != nil {
			return nil, fmt.Errorf("update property unset primary: %w", err)
		}
	}

	return r.getPropertyByID(ctx, propertyID)
}

func (r *PostgresRepository) DeleteProperty(ctx context.Context, propertyID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE properties SET deleted_at = now(), updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL`, propertyID)
	if err != nil {
		return fmt.Errorf("delete property: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("delete property: %w", domain.ErrPropertyNotFound)
	}
	return nil
}

func (r *PostgresRepository) getPropertyByID(ctx context.Context, propertyID string) (*domain.Property, error) {
	p := &domain.Property{}
	var addrCol, notesCol string
	var piiEncrypted bool
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, COALESCE(nickname, ''), address, city, state, zip_code,
		       ST_X(location) AS longitude, ST_Y(location) AS latitude,
		       COALESCE(notes, ''), is_primary, created_at, updated_at, pii_encrypted_v1
		FROM properties
		WHERE id = $1 AND deleted_at IS NULL`, propertyID).Scan(
		&p.ID, &p.UserID, &p.Nickname, &addrCol, &p.City, &p.State, &p.ZipCode,
		&p.Longitude, &p.Latitude,
		&notesCol, &p.IsPrimary, &p.CreatedAt, &p.UpdatedAt, &piiEncrypted,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get property: %w", domain.ErrPropertyNotFound)
		}
		return nil, fmt.Errorf("get property: %w", err)
	}
	if err := decryptPropertyFields(&p.Address, &p.Notes, addrCol, notesCol, piiEncrypted, r.cipher); err != nil {
		return nil, fmt.Errorf("get property: %w", err)
	}
	return p, nil
}

// decryptPropertyFields fills addressOut/notesOut from raw column values,
// decrypting via cipher when piiEncrypted is true. Pre-033 rows pass through
// untouched so the repository keeps working before the backfill.
func decryptPropertyFields(addressOut, notesOut *string, addrCol, notesCol string, piiEncrypted bool, cipher *crypto.Cipher) error {
	if !piiEncrypted {
		*addressOut = addrCol
		*notesOut = notesCol
		return nil
	}
	if addrCol != "" {
		dec, err := cipher.DecryptString(addrCol)
		if err != nil {
			return fmt.Errorf("decrypt address: %w", err)
		}
		*addressOut = dec
	}
	if notesCol != "" {
		dec, err := cipher.DecryptString(notesCol)
		if err != nil {
			return fmt.Errorf("decrypt notes: %w", err)
		}
		*notesOut = dec
	}
	return nil
}
