package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
)

// PostgresRepository implements domain.NotificationRepository using pgx.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// New creates a new PostgreSQL-backed notification repository.
func New(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) CreateNotification(ctx context.Context, n *domain.Notification) (*domain.Notification, error) {
	var id string
	var createdAt = n.CreatedAt

	err := r.pool.QueryRow(ctx, `
		INSERT INTO notifications (user_id, notification_type, title, body, action_url, entity_type, entity_id, channels, email_sent, push_sent)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, '')::uuid, $8, $9, $10)
		RETURNING id, created_at`,
		n.UserID, n.NotificationType, n.Title, n.Body, n.ActionURL,
		n.EntityType, n.EntityID, n.Channels, n.EmailSent, n.PushSent,
	).Scan(&id, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("create notification: %w", err)
	}

	n.ID = id
	n.CreatedAt = createdAt
	return n, nil
}

func (r *PostgresRepository) ListNotifications(ctx context.Context, userID string, unreadOnly bool, page, pageSize int) ([]*domain.Notification, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	// Count total matching notifications.
	var totalCount int
	countQuery := `SELECT COUNT(*) FROM notifications WHERE user_id = $1`
	if unreadOnly {
		countQuery += ` AND read = false`
	}
	err := r.pool.QueryRow(ctx, countQuery, userID).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("list notifications count: %w", err)
	}

	// Fetch the page.
	query := `
		SELECT id, user_id, notification_type, title, body,
		       COALESCE(action_url, ''), COALESCE(entity_type, ''), COALESCE(entity_id::text, ''),
		       channels, email_sent, push_sent, read, read_at, created_at
		FROM notifications
		WHERE user_id = $1`
	if unreadOnly {
		query += ` AND read = false`
	}
	query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`

	rows, err := r.pool.Query(ctx, query, userID, pageSize, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list notifications query: %w", err)
	}
	defer rows.Close()

	var notifications []*domain.Notification
	for rows.Next() {
		var n domain.Notification
		err := rows.Scan(
			&n.ID, &n.UserID, &n.NotificationType, &n.Title, &n.Body,
			&n.ActionURL, &n.EntityType, &n.EntityID,
			&n.Channels, &n.EmailSent, &n.PushSent, &n.Read, &n.ReadAt, &n.CreatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("list notifications scan: %w", err)
		}
		notifications = append(notifications, &n)
	}

	return notifications, totalCount, nil
}

func (r *PostgresRepository) MarkAsRead(ctx context.Context, notificationID, userID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE notifications SET read = true, read_at = now()
		WHERE id = $1 AND user_id = $2 AND read = false`,
		notificationID, userID,
	)
	if err != nil {
		return fmt.Errorf("mark as read: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Check if the notification exists at all.
		var exists bool
		err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2)`,
			notificationID, userID,
		).Scan(&exists)
		if err != nil {
			return fmt.Errorf("mark as read check: %w", err)
		}
		if !exists {
			return fmt.Errorf("mark as read: %w", domain.ErrNotificationNotFound)
		}
		// Already read, that's fine.
	}
	return nil
}

func (r *PostgresRepository) MarkAllAsRead(ctx context.Context, userID string) (int, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE notifications SET read = true, read_at = now()
		WHERE user_id = $1 AND read = false`,
		userID,
	)
	if err != nil {
		return 0, fmt.Errorf("mark all as read: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func (r *PostgresRepository) GetUnreadCount(ctx context.Context, userID string) (int, error) {
	var count int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false`,
		userID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("get unread count: %w", err)
	}
	return count, nil
}

func (r *PostgresRepository) GetPreferences(ctx context.Context, userID string) (*domain.NotificationPreferences, error) {
	var prefsJSON []byte
	var emailDigest string

	err := r.pool.QueryRow(ctx, `
		SELECT preferences, email_digest
		FROM notification_preferences
		WHERE user_id = $1`,
		userID,
	).Scan(&prefsJSON, &emailDigest)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get preferences: %w", domain.ErrPreferencesNotFound)
		}
		return nil, fmt.Errorf("get preferences: %w", err)
	}

	prefs := &domain.NotificationPreferences{
		UserID:      userID,
		EmailDigest: emailDigest,
		Preferences: make(map[string]domain.ChannelPrefs),
	}

	if len(prefsJSON) > 0 {
		if err := json.Unmarshal(prefsJSON, &prefs.Preferences); err != nil {
			return nil, fmt.Errorf("get preferences unmarshal: %w", err)
		}
	}

	return prefs, nil
}

func (r *PostgresRepository) UpsertPreferences(ctx context.Context, prefs *domain.NotificationPreferences) (*domain.NotificationPreferences, error) {
	prefsJSON, err := json.Marshal(prefs.Preferences)
	if err != nil {
		return nil, fmt.Errorf("upsert preferences marshal: %w", err)
	}

	_, err = r.pool.Exec(ctx, `
		INSERT INTO notification_preferences (user_id, preferences, email_digest)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		SET preferences = $2, email_digest = $3, updated_at = now()`,
		prefs.UserID, prefsJSON, prefs.EmailDigest,
	)
	if err != nil {
		return nil, fmt.Errorf("upsert preferences: %w", err)
	}

	return prefs, nil
}

// --- Device Token Repository ---

func (r *PostgresRepository) SaveDeviceToken(ctx context.Context, userID, token, platform, deviceID string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO device_tokens (user_id, token, platform, device_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, token) DO UPDATE
		SET platform = $3, device_id = $4`,
		userID, token, platform, deviceID,
	)
	if err != nil {
		return fmt.Errorf("save device token: %w", err)
	}
	return nil
}

func (r *PostgresRepository) DeleteDeviceToken(ctx context.Context, userID, deviceID string) error {
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM device_tokens WHERE user_id = $1 AND device_id = $2`,
		userID, deviceID,
	)
	if err != nil {
		return fmt.Errorf("delete device token: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("delete device token: %w", domain.ErrDeviceTokenNotFound)
	}
	return nil
}

func (r *PostgresRepository) GetDeviceTokens(ctx context.Context, userID string) ([]domain.DeviceToken, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, user_id, token, platform, COALESCE(device_id, ''), created_at
		FROM device_tokens
		WHERE user_id = $1
		ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get device tokens: %w", err)
	}
	defer rows.Close()

	var tokens []domain.DeviceToken
	for rows.Next() {
		var dt domain.DeviceToken
		if err := rows.Scan(&dt.ID, &dt.UserID, &dt.Token, &dt.Platform, &dt.DeviceID, &dt.CreatedAt); err != nil {
			return nil, fmt.Errorf("get device tokens scan: %w", err)
		}
		tokens = append(tokens, dt)
	}

	return tokens, nil
}
