package repository

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// PostgresRepository implements domain.JobRepository using pgx.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository creates a new PostgreSQL-backed job repository.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) FindByID(ctx context.Context, id string) (*domain.Job, error) {
	_ = ctx
	_ = id
	return nil, nil
}

func (r *PostgresRepository) Create(ctx context.Context, job *domain.Job) error {
	_ = ctx
	_ = job
	return nil
}

func (r *PostgresRepository) Update(ctx context.Context, job *domain.Job) error {
	_ = ctx
	_ = job
	return nil
}

func (r *PostgresRepository) Search(ctx context.Context, filter domain.SearchFilter) ([]*domain.Job, int, error) {
	_ = ctx
	_ = filter
	return nil, 0, nil
}
