package repository

import (
	"context"

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

func (r *PostgresRepository) FindByID(ctx context.Context, id string) (*domain.User, error) {
	_ = ctx
	_ = id
	return nil, nil
}

func (r *PostgresRepository) FindByEmail(ctx context.Context, email string) (*domain.User, error) {
	_ = ctx
	_ = email
	return nil, nil
}

func (r *PostgresRepository) Create(ctx context.Context, user *domain.User) error {
	_ = ctx
	_ = user
	return nil
}

func (r *PostgresRepository) Update(ctx context.Context, user *domain.User) error {
	_ = ctx
	_ = user
	return nil
}
