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
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at`

	var ipStr *string
	if token.IPAddress != nil {
		s := token.IPAddress.String()
		ipStr = &s
	}

	err := r.pool.QueryRow(ctx, query,
		token.UserID,
		token.TokenHash,
		token.DeviceInfo,
		ipStr,
		token.ExpiresAt,
	).Scan(&token.ID, &token.CreatedAt)
	if err != nil {
		return fmt.Errorf("create refresh token: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetRefreshToken(ctx context.Context, tokenHash string) (*domain.RefreshToken, error) {
	query := `
		SELECT id, user_id, token_hash, device_info, ip_address::text,
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

// --- OAuth ---

func (r *PostgresRepository) FindUserByOAuth(ctx context.Context, provider, providerID string) (*domain.User, error) {
	query := `
		SELECT u.id, u.email, u.email_verified, u.password_hash, u.phone, u.phone_verified,
		       u.display_name, u.avatar_url, u.roles, u.status, u.suspension_reason,
		       u.mfa_enabled, u.mfa_secret, u.mfa_backup_codes,
		       u.last_login_at, u.last_active_at, u.timezone,
		       u.created_at, u.updated_at, u.deleted_at
		FROM users u
		JOIN oauth_accounts oa ON oa.user_id = u.id
		WHERE oa.provider = $1 AND oa.provider_id = $2 AND u.deleted_at IS NULL`

	u, err := scanUser(r.pool.QueryRow(ctx, query, provider, providerID))
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
		setClauses = append(setClauses, fmt.Sprintf("phone = $%d", argIdx))
		args = append(args, *input.Phone)
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

	setClauses = append(setClauses, "updated_at = now()")
	args = append(args, userID)

	query := fmt.Sprintf(`
		UPDATE users SET %s
		WHERE id = $%d AND deleted_at IS NULL
		RETURNING id, email, email_verified, password_hash, phone, phone_verified,
		          display_name, avatar_url, roles, status, suspension_reason,
		          mfa_enabled, mfa_secret, mfa_backup_codes,
		          last_login_at, last_active_at, timezone,
		          created_at, updated_at, deleted_at`,
		strings.Join(setClauses, ", "), argIdx)

	u, err := scanUser(r.pool.QueryRow(ctx, query, args...))
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
		          created_at, updated_at, deleted_at`

	u, err := scanUser(r.pool.QueryRow(ctx, query, role, userID))
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
		          ST_Y(service_location) AS lat, ST_X(service_location) AS lng,
		          service_radius_km, default_payment_timing, default_milestone_json,
		          cancellation_policy, warranty_terms, instant_enabled, instant_schedule,
		          instant_available, jobs_completed, avg_response_time_minutes,
		          on_time_rate, profile_completeness, stripe_account_id,
		          stripe_onboarding_complete, created_at, updated_at`

	p, err := scanProviderProfile(r.pool.QueryRow(ctx, query, userID))
	if err != nil {
		return nil, fmt.Errorf("create provider profile: %w", err)
	}
	return p, nil
}

func (r *PostgresRepository) GetProviderProfile(ctx context.Context, userID string) (*domain.ProviderProfile, error) {
	query := `
		SELECT id, user_id, business_name, bio, service_address,
		       ST_Y(service_location) AS lat, ST_X(service_location) AS lng,
		       service_radius_km, default_payment_timing, default_milestone_json,
		       cancellation_policy, warranty_terms, instant_enabled, instant_schedule,
		       instant_available, jobs_completed, avg_response_time_minutes,
		       on_time_rate, profile_completeness, stripe_account_id,
		       stripe_onboarding_complete, created_at, updated_at
		FROM provider_profiles
		WHERE user_id = $1`

	p, err := scanProviderProfile(r.pool.QueryRow(ctx, query, userID))
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
	if input.ServiceAddress != nil {
		setClauses = append(setClauses, fmt.Sprintf("service_address = $%d", argIdx))
		args = append(args, *input.ServiceAddress)
		argIdx++
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
		          ST_Y(service_location) AS lat, ST_X(service_location) AS lng,
		          service_radius_km, default_payment_timing, default_milestone_json,
		          cancellation_policy, warranty_terms, instant_enabled, instant_schedule,
		          instant_available, jobs_completed, avg_response_time_minutes,
		          on_time_rate, profile_completeness, stripe_account_id,
		          stripe_onboarding_complete, created_at, updated_at`,
		strings.Join(setClauses, ", "), argIdx)

	p, err := scanProviderProfile(r.pool.QueryRow(ctx, query, args...))
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

	tag, err := tx.Exec(ctx, `
		UPDATE users
		SET status = $2, suspension_reason = $3, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL`, userID, newStatus, reason)
	if err != nil {
		return fmt.Errorf("%s: update status: %w", opName, err)
	}
	if tag.RowsAffected() == 0 {
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

func (r *PostgresRepository) AdminSearchUsers(ctx context.Context, query, status string, page, pageSize int) ([]domain.User, int, error) {
	whereClauses := []string{"deleted_at IS NULL"}
	args := []interface{}{}
	argIdx := 1

	if query != "" {
		whereClauses = append(whereClauses, fmt.Sprintf(
			"(email ILIKE $%d OR display_name ILIKE $%d OR phone ILIKE $%d)",
			argIdx, argIdx, argIdx,
		))
		args = append(args, "%"+query+"%")
		argIdx++
	}
	if status != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, status)
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
		       created_at, updated_at, deleted_at
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
		u, err := scanUserFromRows(rows)
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

// scanUserFromRows scans a single user from a pgx.Rows iterator.
func scanUserFromRows(rows pgx.Rows) (*domain.User, error) {
	var u domain.User
	var phone, avatarURL, suspensionReason, mfaSecret *string
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

func scanProviderProfile(row pgx.Row) (*domain.ProviderProfile, error) {
	var p domain.ProviderProfile
	var businessName, bio, serviceAddress, cancellationPolicy, warrantyTerms, stripeAccountID *string
	err := row.Scan(
		&p.ID, &p.UserID, &businessName, &bio, &serviceAddress,
		&p.Latitude, &p.Longitude,
		&p.ServiceRadiusKm, &p.DefaultPaymentTiming, &p.DefaultMilestoneJSON,
		&cancellationPolicy, &warrantyTerms, &p.InstantEnabled, &p.InstantSchedule,
		&p.InstantAvailable, &p.JobsCompleted, &p.AvgResponseTimeMinutes,
		&p.OnTimeRate, &p.ProfileCompleteness, &stripeAccountID,
		&p.StripeOnboardingComplete, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if businessName != nil {
		p.BusinessName = *businessName
	}
	if bio != nil {
		p.Bio = *bio
	}
	if serviceAddress != nil {
		p.ServiceAddress = *serviceAddress
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
	query := `
		INSERT INTO verification_documents (user_id, document_type, status, file_name, storage_url, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at, updated_at`

	err := r.pool.QueryRow(ctx, query,
		doc.UserID,
		string(doc.Type),
		string(doc.Status),
		doc.FileName,
		doc.StorageURL,
		doc.ExpiresAt,
	).Scan(&doc.ID, &doc.CreatedAt, &doc.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create document: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetDocument(ctx context.Context, documentID string) (*domain.Document, error) {
	query := `
		SELECT id, user_id, document_type, status, file_name, storage_url,
		       rejection_reason, expires_at, created_at, updated_at
		FROM verification_documents
		WHERE id = $1`

	var doc domain.Document
	var rejectionReason, storageURL *string
	err := r.pool.QueryRow(ctx, query, documentID).Scan(
		&doc.ID, &doc.UserID, &doc.Type, &doc.Status,
		&doc.FileName, &storageURL, &rejectionReason,
		&doc.ExpiresAt, &doc.CreatedAt, &doc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get document: %w", domain.ErrDocumentNotFound)
		}
		return nil, fmt.Errorf("get document: %w", err)
	}
	if rejectionReason != nil {
		doc.RejectionReason = *rejectionReason
	}
	if storageURL != nil {
		doc.StorageURL = *storageURL
	}
	return &doc, nil
}

func (r *PostgresRepository) GetDocumentByUserAndType(ctx context.Context, userID string, docType domain.DocumentType) (*domain.Document, error) {
	query := `
		SELECT id, user_id, document_type, status, file_name, storage_url,
		       rejection_reason, expires_at, created_at, updated_at
		FROM verification_documents
		WHERE user_id = $1 AND document_type = $2
		ORDER BY created_at DESC
		LIMIT 1`

	var doc domain.Document
	var rejectionReason, storageURL *string
	err := r.pool.QueryRow(ctx, query, userID, string(docType)).Scan(
		&doc.ID, &doc.UserID, &doc.Type, &doc.Status,
		&doc.FileName, &storageURL, &rejectionReason,
		&doc.ExpiresAt, &doc.CreatedAt, &doc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get document by user and type: %w", domain.ErrDocumentNotFound)
		}
		return nil, fmt.Errorf("get document by user and type: %w", err)
	}
	if rejectionReason != nil {
		doc.RejectionReason = *rejectionReason
	}
	if storageURL != nil {
		doc.StorageURL = *storageURL
	}
	return &doc, nil
}

func (r *PostgresRepository) ListDocuments(ctx context.Context, userID string) ([]domain.Document, error) {
	query := `
		SELECT id, user_id, document_type, status, file_name, storage_url,
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
		var rejectionReason, storageURL *string
		err := rows.Scan(
			&doc.ID, &doc.UserID, &doc.Type, &doc.Status,
			&doc.FileName, &storageURL, &rejectionReason,
			&doc.ExpiresAt, &doc.CreatedAt, &doc.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("list documents scan: %w", err)
		}
		if rejectionReason != nil {
			doc.RejectionReason = *rejectionReason
		}
		if storageURL != nil {
			doc.StorageURL = *storageURL
		}
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

// --- MFA ---

func (r *PostgresRepository) StoreMFASecret(ctx context.Context, userID, encryptedSecret string) error {
	query := `UPDATE users SET mfa_secret = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL`
	tag, err := r.pool.Exec(ctx, query, encryptedSecret, userID)
	if err != nil {
		return fmt.Errorf("store mfa secret: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("store mfa secret: %w", domain.ErrUserNotFound)
	}
	return nil
}

func (r *PostgresRepository) GetMFASecret(ctx context.Context, userID string) (string, error) {
	query := `SELECT mfa_secret FROM users WHERE id = $1 AND deleted_at IS NULL`
	var secret *string
	err := r.pool.QueryRow(ctx, query, userID).Scan(&secret)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("get mfa secret: %w", domain.ErrUserNotFound)
		}
		return "", fmt.Errorf("get mfa secret: %w", err)
	}
	if secret == nil {
		return "", fmt.Errorf("get mfa secret: %w", domain.ErrMFANotSetup)
	}
	return *secret, nil
}

func (r *PostgresRepository) EnableMFA(ctx context.Context, userID string, hashedBackupCodes []string) error {
	query := `UPDATE users SET mfa_enabled = true, mfa_backup_codes = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL`
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
	args := []interface{}{}
	argIdx := 1

	// Distance calculation and filtering by location/radius.
	distanceExpr := "0"
	if input.Latitude != nil && input.Longitude != nil {
		// ST_DistanceSphere returns metres; divide by 1000 for km.
		distanceExpr = fmt.Sprintf(
			"ST_DistanceSphere(pp.service_location, ST_SetSRID(ST_MakePoint($%d, $%d), 4326)) / 1000.0",
			argIdx, argIdx+1,
		)
		args = append(args, *input.Longitude, *input.Latitude)
		argIdx += 2

		if input.RadiusKm > 0 {
			whereClauses = append(whereClauses, fmt.Sprintf(
				"pp.service_location IS NOT NULL AND ST_DistanceSphere(pp.service_location, ST_SetSRID(ST_MakePoint($%d, $%d), 4326)) / 1000.0 <= $%d",
				argIdx, argIdx+1, argIdx+2,
			))
			args = append(args, *input.Longitude, *input.Latitude, input.RadiusKm)
			argIdx += 3
		}
	}

	// Filter by category IDs.
	if len(input.CategoryIDs) > 0 {
		whereClauses = append(whereClauses, fmt.Sprintf(
			"EXISTS (SELECT 1 FROM provider_service_categories psc WHERE psc.provider_id = pp.id AND psc.category_id = ANY($%d))",
			argIdx,
		))
		args = append(args, input.CategoryIDs)
		argIdx++
	}

	// Filter by minimum rating.
	if input.MinRating != nil {
		whereClauses = append(whereClauses, fmt.Sprintf(
			"COALESCE(rs.average_rating, 0) >= $%d",
			argIdx,
		))
		args = append(args, *input.MinRating)
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

	// Count total matching providers.
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
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("search providers count: %w", err)
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
			(%s)::float8 AS distance_km,
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
	p := &domain.Property{}
	err := r.pool.QueryRow(ctx, `
		INSERT INTO properties (user_id, nickname, address, city, state, zip_code, location, notes, is_primary)
		VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9, $10)
		RETURNING id, user_id, nickname, address, city, state, zip_code,
		          ST_X(location) AS longitude, ST_Y(location) AS latitude,
		          COALESCE(notes, ''), is_primary, created_at, updated_at`,
		input.UserID, input.Nickname, input.Address, input.City, input.State, input.ZipCode,
		input.Longitude, input.Latitude, input.Notes, input.IsPrimary,
	).Scan(
		&p.ID, &p.UserID, &p.Nickname, &p.Address, &p.City, &p.State, &p.ZipCode,
		&p.Longitude, &p.Latitude,
		&p.Notes, &p.IsPrimary, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
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
		       COALESCE(notes, ''), is_primary, created_at, updated_at
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
		err := rows.Scan(
			&p.ID, &p.UserID, &p.Nickname, &p.Address, &p.City, &p.State, &p.ZipCode,
			&p.Longitude, &p.Latitude,
			&p.Notes, &p.IsPrimary, &p.CreatedAt, &p.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("list properties scan: %w", err)
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
		setClauses = append(setClauses, fmt.Sprintf("notes = $%d", argIdx))
		args = append(args, *input.Notes)
		argIdx++
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
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, COALESCE(nickname, ''), address, city, state, zip_code,
		       ST_X(location) AS longitude, ST_Y(location) AS latitude,
		       COALESCE(notes, ''), is_primary, created_at, updated_at
		FROM properties
		WHERE id = $1 AND deleted_at IS NULL`, propertyID).Scan(
		&p.ID, &p.UserID, &p.Nickname, &p.Address, &p.City, &p.State, &p.ZipCode,
		&p.Longitude, &p.Latitude,
		&p.Notes, &p.IsPrimary, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get property: %w", domain.ErrPropertyNotFound)
		}
		return nil, fmt.Errorf("get property: %w", err)
	}
	return p, nil
}
