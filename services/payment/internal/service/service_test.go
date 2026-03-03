package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mock Payment Repository ---

type mockPaymentRepo struct {
	createPaymentFn      func(ctx context.Context, payment *domain.Payment) error
	getPaymentFn         func(ctx context.Context, id string) (*domain.Payment, error)
	updatePaymentStatusFn func(ctx context.Context, id string, status string) error
	listPaymentsFn       func(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*domain.Payment, int, error)
	getFeeConfigFn       func(ctx context.Context, categoryID string) (*domain.FeeConfig, error)
	getDefaultFeeConfigFn func(ctx context.Context) (*domain.FeeConfig, error)
	findByStripePIFn     func(ctx context.Context, paymentIntentID string) (*domain.Payment, error)
	updateStripeFieldsFn func(ctx context.Context, id string, paymentIntentID, chargeID, transferID string) error
	updateRefundFn       func(ctx context.Context, id string, refundAmountCents int64, refundReason string, refundedAt time.Time, stripeRefundID string, status string) error
	getStripeAccountIDFn func(ctx context.Context, userID string) (string, error)
	setStripeAccountIDFn func(ctx context.Context, userID string, stripeAccountID string) error
}

func (m *mockPaymentRepo) CreatePayment(ctx context.Context, payment *domain.Payment) error {
	return m.createPaymentFn(ctx, payment)
}
func (m *mockPaymentRepo) GetPayment(ctx context.Context, id string) (*domain.Payment, error) {
	return m.getPaymentFn(ctx, id)
}
func (m *mockPaymentRepo) UpdatePaymentStatus(ctx context.Context, id string, status string) error {
	return m.updatePaymentStatusFn(ctx, id, status)
}
func (m *mockPaymentRepo) ListPayments(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*domain.Payment, int, error) {
	return m.listPaymentsFn(ctx, userID, statusFilter, page, pageSize)
}
func (m *mockPaymentRepo) GetFeeConfig(ctx context.Context, categoryID string) (*domain.FeeConfig, error) {
	return m.getFeeConfigFn(ctx, categoryID)
}
func (m *mockPaymentRepo) GetDefaultFeeConfig(ctx context.Context) (*domain.FeeConfig, error) {
	return m.getDefaultFeeConfigFn(ctx)
}
func (m *mockPaymentRepo) FindByStripePaymentIntentID(ctx context.Context, paymentIntentID string) (*domain.Payment, error) {
	return m.findByStripePIFn(ctx, paymentIntentID)
}
func (m *mockPaymentRepo) UpdateStripeFields(ctx context.Context, id string, paymentIntentID, chargeID, transferID string) error {
	return m.updateStripeFieldsFn(ctx, id, paymentIntentID, chargeID, transferID)
}
func (m *mockPaymentRepo) UpdateRefund(ctx context.Context, id string, refundAmountCents int64, refundReason string, refundedAt time.Time, stripeRefundID string, status string) error {
	return m.updateRefundFn(ctx, id, refundAmountCents, refundReason, refundedAt, stripeRefundID, status)
}
func (m *mockPaymentRepo) GetStripeAccountID(ctx context.Context, userID string) (string, error) {
	return m.getStripeAccountIDFn(ctx, userID)
}
func (m *mockPaymentRepo) SetStripeAccountID(ctx context.Context, userID string, stripeAccountID string) error {
	return m.setStripeAccountIDFn(ctx, userID, stripeAccountID)
}

// --- Mock Stripe Service ---

type mockStripeService struct {
	createPaymentIntentFn  func(ctx context.Context, amountCents int64, currency string, providerAccountID string, platformFeeCents int64, idempotencyKey string) (string, string, error)
	capturePaymentIntentFn func(ctx context.Context, paymentIntentID string) error
	createTransferFn       func(ctx context.Context, amountCents int64, currency string, destinationAccountID string, paymentIntentID string) (string, error)
	createRefundFn         func(ctx context.Context, paymentIntentID string, amountCents int64) (string, error)
}

// --- helpers ---

func defaultFeeConfig() *domain.FeeConfig {
	return &domain.FeeConfig{
		ID:                  "fc-default",
		FeePercentage:       0.05,
		GuaranteePercentage: 0.02,
		MinFeeCents:         100,
		Active:              true,
	}
}

func newTestPaymentService(repo *mockPaymentRepo, stripe *mockStripeService) *PaymentService {
	// We need to work with a real StripeService for the PaymentService.
	// Since tests mock at the repo level and StripeService is a concrete struct,
	// we'll create a dev-mode StripeService which provides stubs.
	ss := &StripeService{devMode: true}
	return NewPaymentService(repo, ss)
}

// --- CalculateFees tests ---

func TestPaymentService_CalculateFees(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		amountCents        int64
		categoryID         *string
		feeConfig          *domain.FeeConfig
		wantErr            error
		wantPlatformFee    int64
		wantGuaranteeFee   int64
		wantProviderPayout int64
	}{
		{
			name:        "standard_5_percent_fee",
			amountCents: 10000, // $100.00
			feeConfig: &domain.FeeConfig{
				FeePercentage:       0.05,
				GuaranteePercentage: 0.02,
				MinFeeCents:         100,
			},
			wantPlatformFee:    500,  // 5% of 10000
			wantGuaranteeFee:   200,  // 2% of 10000
			wantProviderPayout: 9300, // 10000 - 500 - 200
		},
		{
			name:        "minimum_fee_enforced",
			amountCents: 500, // $5.00 -> 5% = 25 cents, below min of 100
			feeConfig: &domain.FeeConfig{
				FeePercentage:       0.05,
				GuaranteePercentage: 0.02,
				MinFeeCents:         100,
			},
			wantPlatformFee:    100, // min fee
			wantGuaranteeFee:   10,  // 2% of 500
			wantProviderPayout: 390, // 500 - 100 - 10
		},
		{
			name:        "maximum_fee_cap",
			amountCents: 1000000, // $10,000
			feeConfig: func() *domain.FeeConfig {
				maxFee := int64(5000) // $50 cap
				return &domain.FeeConfig{
					FeePercentage:       0.05,
					GuaranteePercentage: 0.02,
					MinFeeCents:         100,
					MaxFeeCents:         &maxFee,
				}
			}(),
			wantPlatformFee:    5000,   // capped at max
			wantGuaranteeFee:   20000,  // 2% of 1000000
			wantProviderPayout: 975000, // 1000000 - 5000 - 20000
		},
		{
			name:        "zero_amount_returns_error",
			amountCents: 0,
			wantErr:     domain.ErrInvalidAmount,
		},
		{
			name:        "negative_amount_returns_error",
			amountCents: -100,
			wantErr:     domain.ErrInvalidAmount,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockPaymentRepo{
				getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
					if tt.feeConfig != nil {
						return tt.feeConfig, nil
					}
					return defaultFeeConfig(), nil
				},
				getFeeConfigFn: func(_ context.Context, _ string) (*domain.FeeConfig, error) {
					return nil, domain.ErrFeeConfigNotFound
				},
			}
			svc := newTestPaymentService(repo, nil)

			breakdown, err := svc.CalculateFees(context.Background(), tt.amountCents, tt.categoryID)

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			require.NotNil(t, breakdown)
			assert.Equal(t, tt.wantPlatformFee, breakdown.PlatformFeeCents)
			assert.Equal(t, tt.wantGuaranteeFee, breakdown.GuaranteeFeeCents)
			assert.Equal(t, tt.wantProviderPayout, breakdown.ProviderPayoutCents)
			assert.Equal(t, tt.amountCents, breakdown.TotalCents)
		})
	}
}

func TestPaymentService_CalculateFees_with_category(t *testing.T) {
	t.Parallel()

	catID := "cat-plumbing"
	repo := &mockPaymentRepo{
		getFeeConfigFn: func(_ context.Context, categoryID string) (*domain.FeeConfig, error) {
			assert.Equal(t, "cat-plumbing", categoryID)
			return &domain.FeeConfig{
				FeePercentage:       0.03, // Lower fee for plumbing
				GuaranteePercentage: 0.01,
				MinFeeCents:         50,
			}, nil
		},
	}
	svc := newTestPaymentService(repo, nil)

	breakdown, err := svc.CalculateFees(context.Background(), 10000, &catID)

	require.NoError(t, err)
	assert.Equal(t, int64(300), breakdown.PlatformFeeCents)  // 3% of 10000
	assert.Equal(t, int64(100), breakdown.GuaranteeFeeCents) // 1% of 10000
	assert.Equal(t, int64(9600), breakdown.ProviderPayoutCents)
}

func TestPaymentService_CalculateFees_category_fallback_to_default(t *testing.T) {
	t.Parallel()

	catID := "cat-nonexistent"
	repo := &mockPaymentRepo{
		getFeeConfigFn: func(_ context.Context, _ string) (*domain.FeeConfig, error) {
			return nil, domain.ErrFeeConfigNotFound
		},
		getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
			return &domain.FeeConfig{
				FeePercentage:       0.05,
				GuaranteePercentage: 0.02,
				MinFeeCents:         100,
			}, nil
		},
	}
	svc := newTestPaymentService(repo, nil)

	breakdown, err := svc.CalculateFees(context.Background(), 10000, &catID)

	require.NoError(t, err)
	assert.Equal(t, int64(500), breakdown.PlatformFeeCents) // Default 5%
}

// --- CreatePayment tests ---

func TestPaymentService_CreatePayment(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		input      domain.CreatePaymentInput
		wantErr    error
		wantStatus string
	}{
		{
			name: "successful_creation",
			input: domain.CreatePaymentInput{
				ContractID:     "contract-1",
				CustomerID:     "cust-1",
				ProviderID:     "prov-1",
				AmountCents:    10000,
				IdempotencyKey: "idem-1",
			},
			wantStatus: "pending",
		},
		{
			name: "zero_amount_returns_error",
			input: domain.CreatePaymentInput{
				ContractID:  "contract-1",
				CustomerID:  "cust-1",
				ProviderID:  "prov-1",
				AmountCents: 0,
			},
			wantErr: domain.ErrInvalidAmount,
		},
		{
			name: "negative_amount_returns_error",
			input: domain.CreatePaymentInput{
				ContractID:  "contract-1",
				CustomerID:  "cust-1",
				ProviderID:  "prov-1",
				AmountCents: -500,
			},
			wantErr: domain.ErrInvalidAmount,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var storedPayment *domain.Payment
			repo := &mockPaymentRepo{
				getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
					return defaultFeeConfig(), nil
				},
				getFeeConfigFn: func(_ context.Context, _ string) (*domain.FeeConfig, error) {
					return nil, domain.ErrFeeConfigNotFound
				},
				getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
					return "acct_prov_1", nil
				},
				createPaymentFn: func(_ context.Context, payment *domain.Payment) error {
					storedPayment = payment
					return nil
				},
				updateStripeFieldsFn: func(_ context.Context, _, _, _, _ string) error {
					return nil
				},
				getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					if storedPayment != nil {
						return storedPayment, nil
					}
					return nil, domain.ErrPaymentNotFound
				},
			}
			svc := newTestPaymentService(repo, nil)

			payment, clientSecret, err := svc.CreatePayment(context.Background(), tt.input)

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			require.NotNil(t, payment)
			assert.NotEmpty(t, payment.ID)
			assert.Equal(t, "pending", payment.Status)
			assert.NotEmpty(t, clientSecret)
			assert.Equal(t, tt.input.CustomerID, payment.CustomerID)
			assert.Equal(t, tt.input.ProviderID, payment.ProviderID)
			assert.Equal(t, tt.input.AmountCents, payment.AmountCents)
			assert.Greater(t, payment.PlatformFeeCents, int64(0))
		})
	}
}

// --- ProcessPayment tests ---

func TestPaymentService_ProcessPayment(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		payment    *domain.Payment
		wantErr    error
		wantStatus string
	}{
		{
			name: "successful_processing",
			payment: &domain.Payment{
				ID:                    "pay-1",
				Status:                "pending",
				StripePaymentIntentID: "pi_123",
			},
			wantStatus: "escrow",
		},
		{
			name: "already_processed_returns_error",
			payment: &domain.Payment{
				ID:     "pay-2",
				Status: "escrow",
			},
			wantErr: domain.ErrPaymentAlreadyProcessed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			currentStatus := tt.payment.Status
			repo := &mockPaymentRepo{
				getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					p := *tt.payment
					p.Status = currentStatus
					return &p, nil
				},
				updatePaymentStatusFn: func(_ context.Context, _ string, status string) error {
					currentStatus = status
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			payment, err := svc.ProcessPayment(context.Background(), tt.payment.ID, "pm_test")

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantStatus, payment.Status)
		})
	}
}

// --- ReleaseEscrow tests ---

func TestPaymentService_ReleaseEscrow(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		payment    *domain.Payment
		wantErr    error
		wantStatus string
	}{
		{
			name: "successful_release",
			payment: &domain.Payment{
				ID:                    "pay-1",
				Status:                "escrow",
				ProviderID:            "prov-1",
				ProviderPayoutCents:   9300,
				StripePaymentIntentID: "pi_123",
			},
			wantStatus: "released",
		},
		{
			name: "not_in_escrow_returns_error",
			payment: &domain.Payment{
				ID:     "pay-2",
				Status: "pending",
			},
			wantErr: domain.ErrInvalidStatus,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			currentStatus := tt.payment.Status
			repo := &mockPaymentRepo{
				getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					p := *tt.payment
					p.Status = currentStatus
					return &p, nil
				},
				updatePaymentStatusFn: func(_ context.Context, _ string, status string) error {
					currentStatus = status
					return nil
				},
				getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
					return "acct_prov_1", nil
				},
				updateStripeFieldsFn: func(_ context.Context, _, _, _, _ string) error {
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			payment, err := svc.ReleaseEscrow(context.Background(), tt.payment.ID, "job completed")

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantStatus, payment.Status)
		})
	}
}

// --- CreateRefund tests ---

func TestPaymentService_CreateRefund(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		payment     *domain.Payment
		refundCents int64
		wantErr     error
		wantStatus  string
	}{
		{
			name: "full_refund",
			payment: &domain.Payment{
				ID:                    "pay-1",
				Status:                "escrow",
				AmountCents:           10000,
				StripePaymentIntentID: "pi_123",
			},
			refundCents: 0, // 0 means full refund
			wantStatus:  "refunded",
		},
		{
			name: "partial_refund",
			payment: &domain.Payment{
				ID:                    "pay-2",
				Status:                "released",
				AmountCents:           10000,
				StripePaymentIntentID: "pi_456",
			},
			refundCents: 5000,
			wantStatus:  "partially_refunded",
		},
		{
			name: "invalid_status_returns_error",
			payment: &domain.Payment{
				ID:     "pay-3",
				Status: "pending",
			},
			refundCents: 0,
			wantErr:     domain.ErrInvalidStatus,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			currentStatus := tt.payment.Status
			repo := &mockPaymentRepo{
				getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					p := *tt.payment
					p.Status = currentStatus
					return &p, nil
				},
				updateRefundFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _ string, status string) error {
					currentStatus = status
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			payment, err := svc.CreateRefund(context.Background(), tt.payment.ID, tt.refundCents, "customer requested")

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantStatus, payment.Status)
		})
	}
}

// --- Escrow state transition tests ---

func TestPaymentService_EscrowStateTransitions(t *testing.T) {
	t.Parallel()

	// Test valid transitions: pending -> processing -> escrow -> released
	tests := []struct {
		name           string
		initialStatus  string
		operation      string
		wantNextStatus string
		wantErr        bool
	}{
		{name: "pending_to_escrow_via_process", initialStatus: "pending", operation: "process", wantNextStatus: "escrow"},
		{name: "escrow_to_released", initialStatus: "escrow", operation: "release", wantNextStatus: "released"},
		{name: "escrow_to_refunded", initialStatus: "escrow", operation: "refund", wantNextStatus: "refunded"},
		{name: "released_to_refunded", initialStatus: "released", operation: "refund", wantNextStatus: "refunded"},
		// Invalid transitions
		{name: "pending_cannot_release", initialStatus: "pending", operation: "release", wantErr: true},
		{name: "pending_cannot_refund", initialStatus: "pending", operation: "refund", wantErr: true},
		{name: "escrow_cannot_process_again", initialStatus: "escrow", operation: "process", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			currentStatus := tt.initialStatus
			payment := &domain.Payment{
				ID:                    "pay-state",
				Status:                tt.initialStatus,
				AmountCents:           10000,
				ProviderID:            "prov-1",
				ProviderPayoutCents:   9300,
				StripePaymentIntentID: "pi_test",
			}

			repo := &mockPaymentRepo{
				getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					p := *payment
					p.Status = currentStatus
					return &p, nil
				},
				updatePaymentStatusFn: func(_ context.Context, _ string, status string) error {
					currentStatus = status
					return nil
				},
				getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
					return "acct_prov_1", nil
				},
				updateStripeFieldsFn: func(_ context.Context, _, _, _, _ string) error {
					return nil
				},
				updateRefundFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _ string, status string) error {
					currentStatus = status
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)
			ctx := context.Background()

			var err error
			switch tt.operation {
			case "process":
				_, err = svc.ProcessPayment(ctx, payment.ID, "pm_test")
			case "release":
				_, err = svc.ReleaseEscrow(ctx, payment.ID, "completed")
			case "refund":
				_, err = svc.CreateRefund(ctx, payment.ID, 0, "requested")
			}

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantNextStatus, currentStatus)
		})
	}
}

// --- GetPayment tests ---

func TestPaymentService_GetPayment(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, id string) (*domain.Payment, error)
		wantErr bool
	}{
		{
			name: "found",
			repoFn: func(_ context.Context, id string) (*domain.Payment, error) {
				return &domain.Payment{ID: id, Status: "pending"}, nil
			},
		},
		{
			name: "not_found",
			repoFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return nil, domain.ErrPaymentNotFound
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockPaymentRepo{getPaymentFn: tt.repoFn}
			svc := newTestPaymentService(repo, nil)

			payment, err := svc.GetPayment(context.Background(), "pay-1")

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, "pay-1", payment.ID)
		})
	}
}

// --- GetFeeConfig tests ---

func TestPaymentService_GetFeeConfig(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		categoryID     *string
		catFeeConfig   *domain.FeeConfig
		catErr         error
		defaultConfig  *domain.FeeConfig
		wantPercentage float64
	}{
		{
			name:       "nil_category_returns_default",
			categoryID: nil,
			defaultConfig: &domain.FeeConfig{
				FeePercentage: 0.05,
			},
			wantPercentage: 0.05,
		},
		{
			name: "category_found",
			categoryID: func() *string {
				s := "cat-1"
				return &s
			}(),
			catFeeConfig: &domain.FeeConfig{
				FeePercentage: 0.03,
			},
			wantPercentage: 0.03,
		},
		{
			name: "category_not_found_falls_back_to_default",
			categoryID: func() *string {
				s := "cat-unknown"
				return &s
			}(),
			catErr: domain.ErrFeeConfigNotFound,
			defaultConfig: &domain.FeeConfig{
				FeePercentage: 0.05,
			},
			wantPercentage: 0.05,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockPaymentRepo{
				getFeeConfigFn: func(_ context.Context, _ string) (*domain.FeeConfig, error) {
					if tt.catFeeConfig != nil {
						return tt.catFeeConfig, nil
					}
					if tt.catErr != nil {
						return nil, tt.catErr
					}
					return nil, domain.ErrFeeConfigNotFound
				},
				getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
					if tt.defaultConfig != nil {
						return tt.defaultConfig, nil
					}
					return defaultFeeConfig(), nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			fc, err := svc.GetFeeConfig(context.Background(), tt.categoryID)

			require.NoError(t, err)
			assert.InDelta(t, tt.wantPercentage, fc.FeePercentage, 0.001)
		})
	}
}
