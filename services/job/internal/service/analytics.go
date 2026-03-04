package service

import (
	"context"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// AnalyticsService implements analytics business logic.
type AnalyticsService struct {
	repo domain.AnalyticsRepository
}

// NewAnalyticsService creates a new analytics service.
func NewAnalyticsService(repo domain.AnalyticsRepository) *AnalyticsService {
	return &AnalyticsService{repo: repo}
}

// GetMarketRange returns market pricing for a service type in a location.
func (s *AnalyticsService) GetMarketRange(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, zipCode string) (*domain.MarketRange, error) {
	return s.repo.GetMarketRange(ctx, categoryID, subcategoryID, serviceTypeID, zipCode)
}

// GetMarketTrends returns market pricing trends over time.
func (s *AnalyticsService) GetMarketTrends(ctx context.Context, categoryID string, subcategoryID *string, region *string, startDate, endDate time.Time, groupBy string) ([]domain.PriceTrend, error) {
	if groupBy == "" {
		groupBy = "month"
	}
	return s.repo.GetMarketTrends(ctx, categoryID, subcategoryID, region, startDate, endDate, groupBy)
}

// GetProviderAnalytics returns aggregated analytics for a provider.
func (s *AnalyticsService) GetProviderAnalytics(ctx context.Context, providerID string, startDate, endDate time.Time) (*domain.ProviderAnalytics, error) {
	return s.repo.GetProviderAnalytics(ctx, providerID, startDate, endDate)
}

// GetProviderEarnings returns earnings time series for a provider.
func (s *AnalyticsService) GetProviderEarnings(ctx context.Context, providerID string, startDate, endDate time.Time, groupBy string) ([]domain.EarningsDataPoint, error) {
	if groupBy == "" {
		groupBy = "month"
	}
	return s.repo.GetProviderEarnings(ctx, providerID, startDate, endDate, groupBy)
}

// GetCustomerSpending returns spending analytics for a customer.
func (s *AnalyticsService) GetCustomerSpending(ctx context.Context, customerID string, startDate, endDate time.Time, groupBy string) ([]domain.SpendingDataPoint, []domain.CategorySpending, int64, error) {
	if groupBy == "" {
		groupBy = "month"
	}
	return s.repo.GetCustomerSpending(ctx, customerID, startDate, endDate, groupBy)
}

// GetPlatformMetrics returns aggregated platform-wide metrics for admin dashboards.
func (s *AnalyticsService) GetPlatformMetrics(ctx context.Context, startDate, endDate time.Time) (*domain.PlatformMetrics, error) {
	return s.repo.GetPlatformMetrics(ctx, startDate, endDate)
}

// GetGrowthMetrics returns growth time series data for admin dashboards.
func (s *AnalyticsService) GetGrowthMetrics(ctx context.Context, startDate, endDate time.Time, groupBy string) ([]domain.GrowthDataPoint, error) {
	if groupBy == "" {
		groupBy = "month"
	}
	return s.repo.GetGrowthMetrics(ctx, startDate, endDate, groupBy)
}

// GetCategoryMetrics returns per-category analytics for admin dashboards.
func (s *AnalyticsService) GetCategoryMetrics(ctx context.Context, startDate, endDate time.Time) ([]domain.CategoryMetrics, error) {
	return s.repo.GetCategoryMetrics(ctx, startDate, endDate)
}

// GetGeographicMetrics returns per-region analytics for admin dashboards.
func (s *AnalyticsService) GetGeographicMetrics(ctx context.Context, startDate, endDate time.Time) ([]domain.RegionMetrics, error) {
	return s.repo.GetGeographicMetrics(ctx, startDate, endDate)
}

// RecordTransaction records an analytics transaction event.
func (s *AnalyticsService) RecordTransaction(ctx context.Context, transactionID, categoryID, subcategoryID, serviceTypeID, region string, amountCents, platformFeeCents int64, customerID, providerID string, completedAt time.Time) error {
	return s.repo.RecordTransaction(ctx, transactionID, categoryID, subcategoryID, serviceTypeID, region, amountCents, platformFeeCents, customerID, providerID, completedAt)
}

// RecordEvent records a generic analytics event.
func (s *AnalyticsService) RecordEvent(ctx context.Context, eventType, userID string, properties map[string]string, occurredAt time.Time) error {
	return s.repo.RecordEvent(ctx, eventType, userID, properties, occurredAt)
}
