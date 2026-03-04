package domain

import (
	"context"
	"time"
)

// PriceTrend represents a price trend data point for a time period.
type PriceTrend struct {
	PeriodStart      time.Time
	MedianCents      int64
	TransactionCount int32
	ChangePercentage float64
}

// CategoryEarnings represents earnings breakdown per category for a provider.
type CategoryEarnings struct {
	CategoryID         string
	CategoryName       string
	JobsCompleted      int32
	TotalEarningsCents int64
	AverageRating      float64
}

// ProviderAnalytics holds aggregated analytics for a provider.
type ProviderAnalytics struct {
	TotalBids              int32
	BidsWon                int32
	WinRate                float64
	AverageBidCents        int64
	JobsCompleted          int32
	JobsInProgress         int32
	OnTimeRate             float64
	CompletionRate         float64
	TotalEarningsCents     int64
	AverageJobValueCents   int64
	AverageRating          float64
	TotalReviews           int32
	RatingTrend            float64
	AvgResponseTimeMinutes int32
	CategoryBreakdown      []CategoryEarnings
}

// EarningsDataPoint represents an earnings data point in a time series.
type EarningsDataPoint struct {
	PeriodStart   time.Time
	EarningsCents int64
	FeesCents     int64
	JobCount      int32
}

// SpendingDataPoint represents a spending data point in a time series.
type SpendingDataPoint struct {
	PeriodStart time.Time
	AmountCents int64
	JobCount    int32
}

// CategorySpending represents spending breakdown per category for a customer.
type CategorySpending struct {
	CategoryID      string
	CategoryName    string
	TotalSpentCents int64
	JobCount        int32
}

// PlatformMetrics holds aggregated platform-wide metrics for admin dashboards.
type PlatformMetrics struct {
	TotalGMVCents          int64
	TotalRevenueCents      int64
	TotalGuaranteeFundCents int64
	EffectiveTakeRate      float64
	TotalUsers             int32
	ActiveUsers            int32
	NewUsers               int32
	TotalJobsPosted        int32
	TotalJobsCompleted     int32
	JobFillRate            float64
	JobCompletionRate      float64
	TotalBids              int32
	AvgBidsPerJob          float64
	DisputesOpened         int32
	DisputesResolved       int32
	DisputeRate            float64
	GuaranteeClaims        int32
	GuaranteePayoutsCents  int64
}

// GrowthDataPoint represents a growth data point in a time series.
type GrowthDataPoint struct {
	PeriodStart    time.Time
	NewUsers       int32
	NewProviders   int32
	JobsPosted     int32
	JobsCompleted  int32
	GMVCents       int64
	RevenueCents   int64
}

// CategoryMetrics holds analytics metrics for a single category.
type CategoryMetrics struct {
	CategoryID       string
	CategoryName     string
	JobsPosted       int32
	JobsCompleted    int32
	GMVCents         int64
	AvgBidsPerJob    float64
	AvgJobValueCents int64
	FillRate         float64
	ActiveProviders  int32
}

// RegionMetrics holds analytics metrics for a geographic region.
type RegionMetrics struct {
	Region             string
	CenterLat          float64
	CenterLng          float64
	ActiveUsers        int32
	ActiveProviders    int32
	JobsPosted         int32
	GMVCents           int64
	SupplyDemandRatio  float64
}

// AnalyticsRepository defines persistence operations for analytics queries.
type AnalyticsRepository interface {
	// Market analytics
	GetMarketRange(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, zipCode string) (*MarketRange, error)
	GetMarketTrends(ctx context.Context, categoryID string, subcategoryID *string, region *string, startDate, endDate time.Time, groupBy string) ([]PriceTrend, error)

	// Provider analytics
	GetProviderAnalytics(ctx context.Context, providerID string, startDate, endDate time.Time) (*ProviderAnalytics, error)
	GetProviderEarnings(ctx context.Context, providerID string, startDate, endDate time.Time, groupBy string) ([]EarningsDataPoint, error)

	// Customer analytics
	GetCustomerSpending(ctx context.Context, customerID string, startDate, endDate time.Time, groupBy string) ([]SpendingDataPoint, []CategorySpending, int64, error)

	// Platform analytics (admin)
	GetPlatformMetrics(ctx context.Context, startDate, endDate time.Time) (*PlatformMetrics, error)
	GetGrowthMetrics(ctx context.Context, startDate, endDate time.Time, groupBy string) ([]GrowthDataPoint, error)
	GetCategoryMetrics(ctx context.Context, startDate, endDate time.Time) ([]CategoryMetrics, error)
	GetGeographicMetrics(ctx context.Context, startDate, endDate time.Time) ([]RegionMetrics, error)

	// Event ingestion
	RecordTransaction(ctx context.Context, transactionID, categoryID, subcategoryID, serviceTypeID, region string, amountCents, platformFeeCents int64, customerID, providerID string, completedAt time.Time) error
	RecordEvent(ctx context.Context, eventType, userID string, properties map[string]string, occurredAt time.Time) error
}
