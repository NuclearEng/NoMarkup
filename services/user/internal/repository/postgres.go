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
