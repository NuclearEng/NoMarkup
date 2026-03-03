package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
)

// PostgresRepository implements domain.ChannelRepository using pgx.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository creates a new PostgreSQL-backed chat repository.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) CreateChannel(ctx context.Context, channel *domain.Channel) (*domain.Channel, error) {
	var id string
	var createdAt, updatedAt time.Time
	err := r.pool.QueryRow(ctx, `
		INSERT INTO chat_channels (job_id, customer_id, provider_id, channel_type, status)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (job_id, customer_id, provider_id) DO UPDATE SET updated_at = now()
		RETURNING id, created_at, updated_at`,
		channel.JobID, channel.CustomerID, channel.ProviderID, channel.ChannelType, channel.Status,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			// Unique violation -- fetch the existing channel.
			return r.getChannelByJobAndUsers(ctx, channel.JobID, channel.CustomerID, channel.ProviderID)
		}
		return nil, fmt.Errorf("create channel: %w", err)
	}

	channel.ID = id
	channel.CreatedAt = createdAt
	channel.UpdatedAt = updatedAt
	return channel, nil
}

func (r *PostgresRepository) getChannelByJobAndUsers(ctx context.Context, jobID, customerID, providerID string) (*domain.Channel, error) {
	var ch domain.Channel
	err := r.pool.QueryRow(ctx, `
		SELECT id, job_id, customer_id, provider_id, status, channel_type,
		       customer_last_read_at, provider_last_read_at, last_message_at,
		       message_count, created_at, updated_at
		FROM chat_channels
		WHERE job_id = $1 AND customer_id = $2 AND provider_id = $3`,
		jobID, customerID, providerID,
	).Scan(
		&ch.ID, &ch.JobID, &ch.CustomerID, &ch.ProviderID, &ch.Status, &ch.ChannelType,
		&ch.CustomerLastReadAt, &ch.ProviderLastReadAt, &ch.LastMessageAt,
		&ch.MessageCount, &ch.CreatedAt, &ch.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get channel: %w", domain.ErrChannelNotFound)
		}
		return nil, fmt.Errorf("get channel by job and users: %w", err)
	}
	return &ch, nil
}

func (r *PostgresRepository) GetChannel(ctx context.Context, channelID string, userID string) (*domain.Channel, error) {
	var ch domain.Channel
	err := r.pool.QueryRow(ctx, `
		SELECT id, job_id, customer_id, provider_id, status, channel_type,
		       customer_last_read_at, provider_last_read_at, last_message_at,
		       message_count, created_at, updated_at
		FROM chat_channels
		WHERE id = $1`,
		channelID,
	).Scan(
		&ch.ID, &ch.JobID, &ch.CustomerID, &ch.ProviderID, &ch.Status, &ch.ChannelType,
		&ch.CustomerLastReadAt, &ch.ProviderLastReadAt, &ch.LastMessageAt,
		&ch.MessageCount, &ch.CreatedAt, &ch.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get channel: %w", domain.ErrChannelNotFound)
		}
		return nil, fmt.Errorf("get channel: %w", err)
	}

	// Compute unread count based on user role.
	ch.UnreadCount = computeUnread(&ch, userID)

	// Load last message.
	lastMsg, err := r.getLastMessage(ctx, channelID)
	if err == nil {
		ch.LastMessage = lastMsg
	}

	return &ch, nil
}

func (r *PostgresRepository) ListChannels(ctx context.Context, userID string, page, pageSize int) ([]*domain.Channel, int, error) {
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

	// Count total.
	var totalCount int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM chat_channels
		WHERE (customer_id = $1 OR provider_id = $1)`,
		userID,
	).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("list channels count: %w", err)
	}

	rows, err := r.pool.Query(ctx, `
		SELECT c.id, c.job_id, c.customer_id, c.provider_id, c.status, c.channel_type,
		       c.customer_last_read_at, c.provider_last_read_at, c.last_message_at,
		       c.message_count, c.created_at, c.updated_at,
		       m.id, m.channel_id, m.sender_id, m.message_type, m.content, m.created_at
		FROM chat_channels c
		LEFT JOIN LATERAL (
			SELECT id, channel_id, sender_id, message_type, content, created_at
			FROM chat_messages
			WHERE channel_id = c.id AND is_deleted = false
			ORDER BY created_at DESC
			LIMIT 1
		) m ON true
		WHERE (c.customer_id = $1 OR c.provider_id = $1)
		ORDER BY c.last_message_at DESC NULLS LAST
		LIMIT $2 OFFSET $3`,
		userID, pageSize, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list channels query: %w", err)
	}
	defer rows.Close()

	var channels []*domain.Channel
	for rows.Next() {
		var ch domain.Channel
		var msgID, msgChannelID, msgSenderID, msgType, msgContent *string
		var msgCreatedAt *time.Time

		err := rows.Scan(
			&ch.ID, &ch.JobID, &ch.CustomerID, &ch.ProviderID, &ch.Status, &ch.ChannelType,
			&ch.CustomerLastReadAt, &ch.ProviderLastReadAt, &ch.LastMessageAt,
			&ch.MessageCount, &ch.CreatedAt, &ch.UpdatedAt,
			&msgID, &msgChannelID, &msgSenderID, &msgType, &msgContent, &msgCreatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("list channels scan: %w", err)
		}

		ch.UnreadCount = computeUnread(&ch, userID)

		if msgID != nil {
			ch.LastMessage = &domain.Message{
				ID:          *msgID,
				ChannelID:   *msgChannelID,
				SenderID:    *msgSenderID,
				MessageType: *msgType,
				Content:     *msgContent,
				CreatedAt:   *msgCreatedAt,
			}
		}

		channels = append(channels, &ch)
	}

	return channels, totalCount, nil
}

func (r *PostgresRepository) SendMessage(ctx context.Context, msg *domain.Message) (*domain.Message, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("send message begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var id string
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO chat_messages (channel_id, sender_id, message_type, content,
		                           metadata_json, attachment_url, attachment_name,
		                           attachment_type, attachment_size, flagged_contact_info)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at`,
		msg.ChannelID, msg.SenderID, msg.MessageType, msg.Content,
		msg.MetadataJSON, msg.AttachmentURL, msg.AttachmentName,
		msg.AttachmentType, msg.AttachmentSize, msg.FlaggedContactInfo,
	).Scan(&id, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("send message insert: %w", err)
	}

	// Update channel metadata.
	_, err = tx.Exec(ctx, `
		UPDATE chat_channels
		SET last_message_at = $1,
		    message_count = message_count + 1,
		    updated_at = now()
		WHERE id = $2`,
		createdAt, msg.ChannelID,
	)
	if err != nil {
		return nil, fmt.Errorf("send message update channel: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("send message commit: %w", err)
	}

	msg.ID = id
	msg.CreatedAt = createdAt
	return msg, nil
}

func (r *PostgresRepository) ListMessages(ctx context.Context, channelID string, before *time.Time, pageSize int) ([]*domain.Message, error) {
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 100 {
		pageSize = 100
	}

	var rows pgx.Rows
	var err error

	if before != nil {
		rows, err = r.pool.Query(ctx, `
			SELECT id, channel_id, sender_id, message_type, content,
			       COALESCE(attachment_url, ''), COALESCE(attachment_name, ''),
			       COALESCE(attachment_type, ''), COALESCE(attachment_size, 0),
			       flagged_contact_info, is_deleted, deleted_at, created_at
			FROM chat_messages
			WHERE channel_id = $1 AND created_at < $2 AND is_deleted = false
			ORDER BY created_at DESC
			LIMIT $3`,
			channelID, *before, pageSize,
		)
	} else {
		rows, err = r.pool.Query(ctx, `
			SELECT id, channel_id, sender_id, message_type, content,
			       COALESCE(attachment_url, ''), COALESCE(attachment_name, ''),
			       COALESCE(attachment_type, ''), COALESCE(attachment_size, 0),
			       flagged_contact_info, is_deleted, deleted_at, created_at
			FROM chat_messages
			WHERE channel_id = $1 AND is_deleted = false
			ORDER BY created_at DESC
			LIMIT $2`,
			channelID, pageSize,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("list messages query: %w", err)
	}
	defer rows.Close()

	var messages []*domain.Message
	for rows.Next() {
		var m domain.Message
		err := rows.Scan(
			&m.ID, &m.ChannelID, &m.SenderID, &m.MessageType, &m.Content,
			&m.AttachmentURL, &m.AttachmentName, &m.AttachmentType, &m.AttachmentSize,
			&m.FlaggedContactInfo, &m.IsDeleted, &m.DeletedAt, &m.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("list messages scan: %w", err)
		}
		messages = append(messages, &m)
	}

	return messages, nil
}

func (r *PostgresRepository) MarkRead(ctx context.Context, channelID string, userID string) error {
	// Determine if the user is customer or provider.
	var customerID, providerID string
	err := r.pool.QueryRow(ctx, `
		SELECT customer_id, provider_id FROM chat_channels WHERE id = $1`,
		channelID,
	).Scan(&customerID, &providerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("mark read: %w", domain.ErrChannelNotFound)
		}
		return fmt.Errorf("mark read get channel: %w", err)
	}

	if userID != customerID && userID != providerID {
		return fmt.Errorf("mark read: %w", domain.ErrNotChannelMember)
	}

	now := time.Now()
	var tag pgconn.CommandTag
	if userID == customerID {
		tag, err = r.pool.Exec(ctx, `
			UPDATE chat_channels SET customer_last_read_at = $1, updated_at = now()
			WHERE id = $2`, now, channelID)
	} else {
		tag, err = r.pool.Exec(ctx, `
			UPDATE chat_channels SET provider_last_read_at = $1, updated_at = now()
			WHERE id = $2`, now, channelID)
	}
	if err != nil {
		return fmt.Errorf("mark read update: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("mark read: %w", domain.ErrChannelNotFound)
	}
	return nil
}

func (r *PostgresRepository) GetUnreadCounts(ctx context.Context, userID string) ([]domain.ChannelUnread, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id,
		       CASE
		           WHEN customer_id = $1 THEN
		               (SELECT COUNT(*) FROM chat_messages
		                WHERE channel_id = chat_channels.id
		                  AND is_deleted = false
		                  AND created_at > COALESCE(chat_channels.customer_last_read_at, '1970-01-01'))
		           WHEN provider_id = $1 THEN
		               (SELECT COUNT(*) FROM chat_messages
		                WHERE channel_id = chat_channels.id
		                  AND is_deleted = false
		                  AND created_at > COALESCE(chat_channels.provider_last_read_at, '1970-01-01'))
		           ELSE 0
		       END AS unread_count
		FROM chat_channels
		WHERE (customer_id = $1 OR provider_id = $1)
		  AND last_message_at IS NOT NULL`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get unread counts: %w", err)
	}
	defer rows.Close()

	var unreads []domain.ChannelUnread
	for rows.Next() {
		var u domain.ChannelUnread
		if err := rows.Scan(&u.ChannelID, &u.UnreadCount); err != nil {
			return nil, fmt.Errorf("get unread counts scan: %w", err)
		}
		if u.UnreadCount > 0 {
			unreads = append(unreads, u)
		}
	}
	return unreads, nil
}

// getLastMessage loads the latest message for a channel.
func (r *PostgresRepository) getLastMessage(ctx context.Context, channelID string) (*domain.Message, error) {
	var m domain.Message
	err := r.pool.QueryRow(ctx, `
		SELECT id, channel_id, sender_id, message_type, content, created_at
		FROM chat_messages
		WHERE channel_id = $1 AND is_deleted = false
		ORDER BY created_at DESC
		LIMIT 1`,
		channelID,
	).Scan(&m.ID, &m.ChannelID, &m.SenderID, &m.MessageType, &m.Content, &m.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// computeUnread calculates unread count for the given user in a channel.
func computeUnread(ch *domain.Channel, userID string) int {
	if ch.LastMessageAt == nil {
		return 0
	}

	var lastRead *time.Time
	if userID == ch.CustomerID {
		lastRead = ch.CustomerLastReadAt
	} else if userID == ch.ProviderID {
		lastRead = ch.ProviderLastReadAt
	} else {
		return 0
	}

	if lastRead == nil {
		return ch.MessageCount
	}

	if ch.LastMessageAt.After(*lastRead) {
		// Approximate: we know there are unread messages but do not know exactly how many
		// without a count query. Return message_count as an upper bound. The exact count
		// is computed by the GetUnreadCounts method.
		return ch.MessageCount
	}
	return 0
}
