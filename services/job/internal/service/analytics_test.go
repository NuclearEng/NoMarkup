package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mock Analytics Repository ---

type mockAnalyticsRepo struct {
	getMarketRangeFn       func(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, zipCode string) (*domain.MarketRange, error)
	getMarketTrendsFn      func(ctx context.Context, categoryID string, subcategoryID *string, region *string, startDate, endDate time.Time, groupBy string) ([]domain.PriceTrend, error)
	getProviderAnalyticsFn func(ctx context.Context, providerID string, startDate, endDate time.Time) (*domain.ProviderAnalytics, error)
	getProviderEarningsFn  func(ctx context.Context, providerID string, startDate, endDate time.Time, groupBy string) ([]domain.EarningsDataPoint, error)
	getCustomerSpendingFn  func(ctx context.Context, customerID string, startDate, endDate time.Time, groupBy string) ([]domain.SpendingDataPoint, []domain.CategorySpending, int64, error)
	recordTransactionFn    func(ctx context.Context, transactionID, categoryID, subcategoryID, serviceTypeID, region string, amountCents, platformFeeCents int64, customerID, providerID string, completedAt time.Time) error
	recordEventFn          func(ctx context.Context, eventType, userID string, properties map[string]string, occurredAt time.Time) error
}

func (m *mockAnalyticsRepo) GetMarketRange(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, zipCode string) (*domain.MarketRange, error) {
	return m.getMarketRangeFn(ctx, categoryID, subcategoryID, serviceTypeID, zipCode)
}
func (m *mockAnalyticsRepo) GetMarketTrends(ctx context.Context, categoryID string, subcategoryID *string, region *string, startDate, endDate time.Time, groupBy string) ([]domain.PriceTrend, error) {
	return m.getMarketTrendsFn(ctx, categoryID, subcategoryID, region, startDate, endDate, groupBy)
}
func (m *mockAnalyticsRepo) GetProviderAnalytics(ctx context.Context, providerID string, startDate, endDate time.Time) (*domain.ProviderAnalytics, error) {
	return m.getProviderAnalyticsFn(ctx, providerID, startDate, endDate)
}
func (m *mockAnalyticsRepo) GetProviderEarnings(ctx context.Context, providerID string, startDate, endDate time.Time, groupBy string) ([]domain.EarningsDataPoint, error) {
	return m.getProviderEarningsFn(ctx, providerID, startDate, endDate, groupBy)
}
func (m *mockAnalyticsRepo) GetCustomerSpending(ctx context.Context, customerID string, startDate, endDate time.Time, groupBy string) ([]domain.SpendingDataPoint, []domain.CategorySpending, int64, error) {
	return m.getCustomerSpendingFn(ctx, customerID, startDate, endDate, groupBy)
}
func (m *mockAnalyticsRepo) RecordTransaction(ctx context.Context, transactionID, categoryID, subcategoryID, serviceTypeID, region string, amountCents, platformFeeCents int64, customerID, providerID string, completedAt time.Time) error {
	return m.recordTransactionFn(ctx, transactionID, categoryID, subcategoryID, serviceTypeID, region, amountCents, platformFeeCents, customerID, providerID, completedAt)
}
func (m *mockAnalyticsRepo) RecordEvent(ctx context.Context, eventType, userID string, properties map[string]string, occurredAt time.Time) error {
	return m.recordEventFn(ctx, eventType, userID, properties, occurredAt)
}

// --- GetMarketRange tests ---

func TestAnalyticsService_GetMarketRange(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, zipCode string) (*domain.MarketRange, error)
		wantErr bool
	}{
		{
			name: "returns_market_range",
			repoFn: func(_ context.Context, _ string, _, _ *string, _ string) (*domain.MarketRange, error) {
				return &domain.MarketRange{
					LowCents:    5000,
					MedianCents: 10000,
					HighCents:   15000,
					DataPoints:  42,
				}, nil
			},
		},
		{
			name: "not_found",
			repoFn: func(_ context.Context, _ string, _, _ *string, _ string) (*domain.MarketRange, error) {
				return nil, domain.ErrMarketRangeNotFound
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockAnalyticsRepo{getMarketRangeFn: tt.repoFn}
			svc := NewAnalyticsService(repo)

			mr, err := svc.GetMarketRange(context.Background(), "cat-1", nil, nil, "90210")

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			require.NotNil(t, mr)
			assert.Equal(t, int64(10000), mr.MedianCents)
			assert.Equal(t, 42, mr.DataPoints)
		})
	}
}

// --- GetMarketTrends tests ---

func TestAnalyticsService_GetMarketTrends(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		groupBy     string
		wantGroupBy string
	}{
		{name: "explicit_groupBy", groupBy: "week", wantGroupBy: "week"},
		{name: "default_groupBy", groupBy: "", wantGroupBy: "month"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockAnalyticsRepo{
				getMarketTrendsFn: func(_ context.Context, _ string, _ *string, _ *string, _, _ time.Time, groupBy string) ([]domain.PriceTrend, error) {
					assert.Equal(t, tt.wantGroupBy, groupBy)
					return []domain.PriceTrend{
						{MedianCents: 10000, TransactionCount: 5},
					}, nil
				},
			}
			svc := NewAnalyticsService(repo)

			start := time.Now().Add(-30 * 24 * time.Hour)
			end := time.Now()
			trends, err := svc.GetMarketTrends(context.Background(), "cat-1", nil, nil, start, end, tt.groupBy)

			require.NoError(t, err)
			assert.Len(t, trends, 1)
		})
	}
}

// --- GetProviderAnalytics tests ---

func TestAnalyticsService_GetProviderAnalytics(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, providerID string, startDate, endDate time.Time) (*domain.ProviderAnalytics, error)
		wantErr bool
	}{
		{
			name: "returns_analytics",
			repoFn: func(_ context.Context, _ string, _, _ time.Time) (*domain.ProviderAnalytics, error) {
				return &domain.ProviderAnalytics{
					TotalBids:          50,
					BidsWon:            10,
					WinRate:            0.2,
					TotalEarningsCents: 500000,
				}, nil
			},
		},
		{
			name: "error_propagates",
			repoFn: func(_ context.Context, _ string, _, _ time.Time) (*domain.ProviderAnalytics, error) {
				return nil, errors.New("db error")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockAnalyticsRepo{getProviderAnalyticsFn: tt.repoFn}
			svc := NewAnalyticsService(repo)

			start := time.Now().Add(-90 * 24 * time.Hour)
			end := time.Now()
			analytics, err := svc.GetProviderAnalytics(context.Background(), "prov-1", start, end)

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, int32(50), analytics.TotalBids)
			assert.InDelta(t, 0.2, analytics.WinRate, 0.001)
		})
	}
}

// --- GetProviderEarnings tests ---

func TestAnalyticsService_GetProviderEarnings(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		groupBy     string
		wantGroupBy string
	}{
		{name: "explicit_groupBy", groupBy: "week", wantGroupBy: "week"},
		{name: "default_groupBy", groupBy: "", wantGroupBy: "month"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockAnalyticsRepo{
				getProviderEarningsFn: func(_ context.Context, _ string, _, _ time.Time, groupBy string) ([]domain.EarningsDataPoint, error) {
					assert.Equal(t, tt.wantGroupBy, groupBy)
					return []domain.EarningsDataPoint{
						{EarningsCents: 50000, JobCount: 3},
					}, nil
				},
			}
			svc := NewAnalyticsService(repo)

			earnings, err := svc.GetProviderEarnings(context.Background(), "prov-1", time.Now().Add(-30*24*time.Hour), time.Now(), tt.groupBy)

			require.NoError(t, err)
			assert.Len(t, earnings, 1)
			assert.Equal(t, int64(50000), earnings[0].EarningsCents)
		})
	}
}

// --- GetCustomerSpending tests ---

func TestAnalyticsService_GetCustomerSpending(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		groupBy     string
		wantGroupBy string
	}{
		{name: "explicit_groupBy", groupBy: "week", wantGroupBy: "week"},
		{name: "default_groupBy", groupBy: "", wantGroupBy: "month"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockAnalyticsRepo{
				getCustomerSpendingFn: func(_ context.Context, _ string, _, _ time.Time, groupBy string) ([]domain.SpendingDataPoint, []domain.CategorySpending, int64, error) {
					assert.Equal(t, tt.wantGroupBy, groupBy)
					return []domain.SpendingDataPoint{
							{AmountCents: 25000, JobCount: 2},
						}, []domain.CategorySpending{
							{CategoryID: "cat-1", TotalSpentCents: 25000},
						}, 25000, nil
				},
			}
			svc := NewAnalyticsService(repo)

			spending, catSpending, total, err := svc.GetCustomerSpending(context.Background(), "cust-1", time.Now().Add(-30*24*time.Hour), time.Now(), tt.groupBy)

			require.NoError(t, err)
			assert.Len(t, spending, 1)
			assert.Len(t, catSpending, 1)
			assert.Equal(t, int64(25000), total)
		})
	}
}

// --- RecordTransaction tests ---

func TestAnalyticsService_RecordTransaction(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, transactionID, categoryID, subcategoryID, serviceTypeID, region string, amountCents, platformFeeCents int64, customerID, providerID string, completedAt time.Time) error
		wantErr bool
	}{
		{
			name: "successful_record",
			repoFn: func(_ context.Context, transactionID, _, _, _, _ string, amountCents, _ int64, _, _ string, _ time.Time) error {
				assert.Equal(t, "txn-1", transactionID)
				assert.Equal(t, int64(10000), amountCents)
				return nil
			},
		},
		{
			name: "repo_error",
			repoFn: func(_ context.Context, _, _, _, _, _ string, _, _ int64, _, _ string, _ time.Time) error {
				return errors.New("insert failed")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockAnalyticsRepo{recordTransactionFn: tt.repoFn}
			svc := NewAnalyticsService(repo)

			err := svc.RecordTransaction(context.Background(), "txn-1", "cat-1", "sub-1", "svc-1", "US-CA", 10000, 500, "cust-1", "prov-1", time.Now())

			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// --- RecordEvent tests ---

func TestAnalyticsService_RecordEvent(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		repoFn  func(ctx context.Context, eventType, userID string, properties map[string]string, occurredAt time.Time) error
		wantErr bool
	}{
		{
			name: "successful_event",
			repoFn: func(_ context.Context, eventType, userID string, props map[string]string, _ time.Time) error {
				assert.Equal(t, "page_view", eventType)
				assert.Equal(t, "user-1", userID)
				assert.Equal(t, "homepage", props["page"])
				return nil
			},
		},
		{
			name: "repo_error",
			repoFn: func(_ context.Context, _, _ string, _ map[string]string, _ time.Time) error {
				return errors.New("write failed")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockAnalyticsRepo{recordEventFn: tt.repoFn}
			svc := NewAnalyticsService(repo)

			err := svc.RecordEvent(context.Background(), "page_view", "user-1", map[string]string{"page": "homepage"}, time.Now())

			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}
