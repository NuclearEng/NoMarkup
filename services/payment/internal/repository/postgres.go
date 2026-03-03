package repository

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// PostgresRepository implements domain.PaymentRepository using pgx.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository creates a new PostgreSQL-backed payment repository.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) FindByID(ctx context.Context, id string) (*domain.Payment, error) {
	_ = ctx
	_ = id
	return nil, nil
}

func (r *PostgresRepository) Create(ctx context.Context, payment *domain.Payment) error {
	_ = ctx
	_ = payment
	return nil
}

func (r *PostgresRepository) UpdateStatus(ctx context.Context, id string, status string) error {
	_ = ctx
	_ = id
	_ = status
	return nil
}

func (r *PostgresRepository) ListByUser(ctx context.Context, userID string, page, pageSize int) ([]*domain.Payment, int, error) {
	_ = ctx
	_ = userID
	_ = page
	_ = pageSize
	return nil, 0, nil
}
