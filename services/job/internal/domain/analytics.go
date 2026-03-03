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

	// Event ingestion
	RecordTransaction(ctx context.Context, transactionID, categoryID, subcategoryID, serviceTypeID, region string, amountCents, platformFeeCents int64, customerID, providerID string, completedAt time.Time) error
	RecordEvent(ctx context.Context, eventType, userID string, properties map[string]string, occurredAt time.Time) error
}
