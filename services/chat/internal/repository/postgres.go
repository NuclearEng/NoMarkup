package repository

import (
	"context"

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

func (r *PostgresRepository) FindChannelByID(ctx context.Context, id string) (*domain.Channel, error) {
	_ = ctx
	_ = id
	return nil, nil
}

func (r *PostgresRepository) CreateChannel(ctx context.Context, channel *domain.Channel) error {
	_ = ctx
	_ = channel
	return nil
}

func (r *PostgresRepository) ListChannels(ctx context.Context, userID string, page, pageSize int) ([]*domain.Channel, int, error) {
	_ = ctx
	_ = userID
	_ = page
	_ = pageSize
	return nil, 0, nil
}

func (r *PostgresRepository) CreateMessage(ctx context.Context, msg *domain.Message) error {
	_ = ctx
	_ = msg
	return nil
}

func (r *PostgresRepository) ListMessages(ctx context.Context, channelID string, page, pageSize int) ([]*domain.Message, int, error) {
	_ = ctx
	_ = channelID
	_ = page
	_ = pageSize
	return nil, 0, nil
}

func (r *PostgresRepository) MarkRead(ctx context.Context, channelID, userID, lastMessageID string) error {
	_ = ctx
	_ = channelID
	_ = userID
	_ = lastMessageID
	return nil
}
