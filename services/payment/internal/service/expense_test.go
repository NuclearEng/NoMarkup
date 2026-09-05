package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPaymentService_CreateExpense(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		providerID  string
		category    string
		description string
		amountCents int64
		receiptURL  string
		repoErr     error
		wantErr     bool
		errContains string
	}{
		{
			name:        "happy_path_with_receipt",
			providerID:  "prov-1",
			category:    "materials",
			description: "drywall sheets",
			amountCents: 12500,
			receiptURL:  "https://s3.example/receipt.jpg",
		},
		{
			name:        "happy_path_no_receipt",
			providerID:  "prov-1",
			category:    "tools",
			description: "drill bit set",
			amountCents: 4500,
		},
		{
			name:        "missing_provider_id",
			category:    "materials",
			description: "x",
			amountCents: 100,
			wantErr:     true,
			errContains: "provider_id is required",
		},
		{
			name:        "invalid_category",
			providerID:  "prov-1",
			category:    "yacht",
			description: "x",
			amountCents: 100,
			wantErr:     true,
			errContains: "invalid category",
		},
		{
			name:        "missing_description",
			providerID:  "prov-1",
			category:    "materials",
			description: "",
			amountCents: 100,
			wantErr:     true,
			errContains: "description is required",
		},
		{
			name:        "zero_amount_rejected",
			providerID:  "prov-1",
			category:    "materials",
			description: "x",
			amountCents: 0,
			wantErr:     true,
			errContains: "invalid amount",
		},
		{
			name:        "negative_amount_rejected",
			providerID:  "prov-1",
			category:    "materials",
			description: "x",
			amountCents: -1,
			wantErr:     true,
			errContains: "invalid amount",
		},
		{
			name:        "repo_failure_propagates",
			providerID:  "prov-1",
			category:    "materials",
			description: "x",
			amountCents: 100,
			repoErr:     errors.New("db down"),
			wantErr:     true,
			errContains: "db down",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var captured *domain.Expense
			repo := &mockPaymentRepo{
				createExpenseFn: func(_ context.Context, exp *domain.Expense) error {
					if tt.repoErr != nil {
						return tt.repoErr
					}
					captured = exp
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			exp, err := svc.CreateExpense(context.Background(), tt.providerID, tt.category,
				tt.description, tt.amountCents, tt.receiptURL, time.Now())

			if tt.wantErr {
				require.Error(t, err)
				assert.True(t, strings.Contains(err.Error(), tt.errContains),
					"expected error to contain %q, got %v", tt.errContains, err)
				return
			}

			require.NoError(t, err)
			require.NotNil(t, exp)
			assert.NotEmpty(t, exp.ID)
			assert.Equal(t, tt.providerID, exp.ProviderID)
			assert.Equal(t, tt.category, exp.Category)
			assert.Equal(t, tt.description, exp.Description)
			assert.Equal(t, tt.amountCents, exp.AmountCents)
			if tt.receiptURL != "" {
				require.NotNil(t, exp.ReceiptURL)
				assert.Equal(t, tt.receiptURL, *exp.ReceiptURL)
			} else {
				assert.Nil(t, exp.ReceiptURL)
			}
			require.NotNil(t, captured)
			assert.Equal(t, exp.ID, captured.ID)
		})
	}
}

func TestPaymentService_ListExpenses(t *testing.T) {
	t.Parallel()

	t.Run("missing_provider_id", func(t *testing.T) {
		t.Parallel()
		svc := newTestPaymentService(&mockPaymentRepo{}, nil)
		_, _, _, err := svc.ListExpenses(context.Background(), "", nil, nil, 1, 20)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "provider_id is required")
	})

	t.Run("delegates_to_repo", func(t *testing.T) {
		t.Parallel()
		expected := []*domain.Expense{{ID: "e1"}, {ID: "e2"}}
		repo := &mockPaymentRepo{
			listExpensesFn: func(_ context.Context, providerID string, _, _ *time.Time, page, pageSize int) ([]*domain.Expense, int64, int, error) {
				assert.Equal(t, "prov-1", providerID)
				assert.Equal(t, 2, page)
				assert.Equal(t, 50, pageSize)
				return expected, 1500, 2, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		got, total, count, err := svc.ListExpenses(context.Background(), "prov-1", nil, nil, 2, 50)
		require.NoError(t, err)
		assert.Equal(t, expected, got)
		assert.Equal(t, int64(1500), total)
		assert.Equal(t, 2, count)
	})
}

func TestPaymentService_DeleteExpense(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		expenseID   string
		providerID  string
		repoErr     error
		wantErr     bool
		errContains string
	}{
		{
			name:       "happy_path",
			expenseID:  "e1",
			providerID: "prov-1",
		},
		{
			name:        "missing_expense_id",
			providerID:  "prov-1",
			wantErr:     true,
			errContains: "expense_id is required",
		},
		{
			name:        "missing_provider_id",
			expenseID:   "e1",
			wantErr:     true,
			errContains: "provider_id is required",
		},
		{
			name:        "repo_error_propagates",
			expenseID:   "e1",
			providerID:  "prov-1",
			repoErr:     errors.New("not found"),
			wantErr:     true,
			errContains: "not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			repo := &mockPaymentRepo{
				deleteExpenseFn: func(_ context.Context, _, _ string) error { return tt.repoErr },
			}
			svc := newTestPaymentService(repo, nil)
			err := svc.DeleteExpense(context.Background(), tt.expenseID, tt.providerID)
			if tt.wantErr {
				require.Error(t, err)
				assert.True(t, strings.Contains(err.Error(), tt.errContains),
					"expected error to contain %q, got %v", tt.errContains, err)
				return
			}
			require.NoError(t, err)
		})
	}
}
