package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

func (r *PostgresRepository) CreateExpense(ctx context.Context, expense *domain.Expense) error {
	err := r.pool.QueryRow(ctx, `
		INSERT INTO provider_expenses (
			id, provider_id, category, description, amount_cents,
			receipt_url, expense_date
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at, updated_at`,
		expense.ID, expense.ProviderID, expense.Category, expense.Description,
		expense.AmountCents, expense.ReceiptURL, expense.ExpenseDate,
	).Scan(&expense.CreatedAt, &expense.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create expense: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ListExpenses(ctx context.Context, providerID string, startDate, endDate *time.Time, page, pageSize int) ([]*domain.Expense, int64, int, error) {
	where := []string{"provider_id = $1"}
	args := []interface{}{providerID}
	argIdx := 2

	if startDate != nil {
		where = append(where, fmt.Sprintf("expense_date >= $%d", argIdx))
		args = append(args, *startDate)
		argIdx++
	}
	if endDate != nil {
		where = append(where, fmt.Sprintf("expense_date <= $%d", argIdx))
		args = append(args, *endDate)
		argIdx++
	}

	whereClause := strings.Join(where, " AND ")

	// Get total count and total amount.
	var totalCount int
	var totalCents int64
	err := r.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT COUNT(*), COALESCE(SUM(amount_cents), 0) FROM provider_expenses WHERE %s`, whereClause),
		args...,
	).Scan(&totalCount, &totalCents)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("list expenses count: %w", err)
	}

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

	selectQuery := fmt.Sprintf(`
		SELECT id, provider_id, category, description, amount_cents,
		       receipt_url, expense_date, created_at, updated_at
		FROM provider_expenses
		WHERE %s
		ORDER BY expense_date DESC, created_at DESC
		LIMIT $%d OFFSET $%d`, whereClause, argIdx, argIdx+1)

	args = append(args, pageSize, offset)

	rows, err := r.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("list expenses query: %w", err)
	}
	defer rows.Close()

	var expenses []*domain.Expense
	for rows.Next() {
		e := &domain.Expense{}
		err := rows.Scan(
			&e.ID, &e.ProviderID, &e.Category, &e.Description, &e.AmountCents,
			&e.ReceiptURL, &e.ExpenseDate, &e.CreatedAt, &e.UpdatedAt,
		)
		if err != nil {
			return nil, 0, 0, fmt.Errorf("list expenses scan: %w", err)
		}
		expenses = append(expenses, e)
	}

	return expenses, totalCents, totalCount, nil
}

func (r *PostgresRepository) DeleteExpense(ctx context.Context, expenseID, providerID string) error {
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM provider_expenses
		WHERE id = $1 AND provider_id = $2`,
		expenseID, providerID)
	if err != nil {
		return fmt.Errorf("delete expense: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Could be not found or not owned by the provider — same user-facing result.
		return fmt.Errorf("delete expense: %w", domain.ErrExpenseNotFound)
	}
	return nil
}

// GetExpense retrieves a single expense by ID. It is used internally
// but is not part of the repository interface as it is not needed externally.
func (r *PostgresRepository) GetExpense(ctx context.Context, expenseID string) (*domain.Expense, error) {
	e := &domain.Expense{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, provider_id, category, description, amount_cents,
		       receipt_url, expense_date, created_at, updated_at
		FROM provider_expenses
		WHERE id = $1`, expenseID).Scan(
		&e.ID, &e.ProviderID, &e.Category, &e.Description, &e.AmountCents,
		&e.ReceiptURL, &e.ExpenseDate, &e.CreatedAt, &e.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get expense: %w", domain.ErrExpenseNotFound)
		}
		return nil, fmt.Errorf("get expense: %w", err)
	}
	return e, nil
}
