package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// validExpenseCategories matches the CHECK constraint on provider_expenses.category.
var validExpenseCategories = map[string]bool{
	"materials":      true,
	"tools":          true,
	"transportation": true,
	"insurance":      true,
	"licensing":      true,
	"marketing":      true,
	"subcontractor":  true,
	"office":         true,
	"other":          true,
}

// CreateExpense validates and persists a new provider expense.
func (s *PaymentService) CreateExpense(ctx context.Context, providerID, category, description string, amountCents int64, receiptURL string, expenseDate time.Time) (*domain.Expense, error) {
	if providerID == "" {
		return nil, fmt.Errorf("create expense: provider_id is required")
	}
	if !validExpenseCategories[category] {
		return nil, fmt.Errorf("create expense: invalid category %q", category)
	}
	if description == "" {
		return nil, fmt.Errorf("create expense: description is required")
	}
	if amountCents <= 0 {
		return nil, fmt.Errorf("create expense: %w", domain.ErrInvalidAmount)
	}

	expense := &domain.Expense{
		ID:          uuid.New().String(),
		ProviderID:  providerID,
		Category:    category,
		Description: description,
		AmountCents: amountCents,
		ExpenseDate: expenseDate,
	}
	if receiptURL != "" {
		expense.ReceiptURL = &receiptURL
	}

	if err := s.repo.CreateExpense(ctx, expense); err != nil {
		return nil, err
	}

	slog.Info("expense created",
		"expense_id", expense.ID,
		"provider_id", providerID,
		"category", category,
		"amount_cents", amountCents,
	)

	return expense, nil
}

// ListExpenses returns paginated expenses for a provider with optional date filters.
func (s *PaymentService) ListExpenses(ctx context.Context, providerID string, startDate, endDate *time.Time, page, pageSize int) ([]*domain.Expense, int64, int, error) {
	if providerID == "" {
		return nil, 0, 0, fmt.Errorf("list expenses: provider_id is required")
	}
	return s.repo.ListExpenses(ctx, providerID, startDate, endDate, page, pageSize)
}

// DeleteExpense removes a provider expense, ensuring ownership.
func (s *PaymentService) DeleteExpense(ctx context.Context, expenseID, providerID string) error {
	if expenseID == "" {
		return fmt.Errorf("delete expense: expense_id is required")
	}
	if providerID == "" {
		return fmt.Errorf("delete expense: provider_id is required")
	}

	if err := s.repo.DeleteExpense(ctx, expenseID, providerID); err != nil {
		return err
	}

	slog.Info("expense deleted",
		"expense_id", expenseID,
		"provider_id", providerID,
	)

	return nil
}
