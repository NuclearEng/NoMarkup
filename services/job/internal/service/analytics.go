package service

import (
	"context"
	"log/slog"
	"time"

	pricingv1 "github.com/nomarkup/nomarkup/proto/pricing/v1"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// PricingEngine is the subset of the Rust pricing-engine client the analytics
// service depends on. Declared here (consumer side) so the service does not
// couple to the concrete client and is trivially fakeable in tests.
type PricingEngine interface {
	ComputeFairPrice(ctx context.Context, req *pricingv1.ComputeFairPriceRequest) (*pricingv1.ComputeFairPriceResponse, error)
}

// FairPrice is the engine's estimate for a (category × geo × time) cell,
// surfaced to gRPC. HasData is false whenever the engine had no usable data or
// errored — the service fails soft and never propagates a 5xx for a missing
// estimate.
type FairPrice struct {
	HasData         bool
	PriceCents      int64
	P25Cents        int64
	P75Cents        int64
	CILoCents       int64
	CIHiCents       int64
	NEff            float64
	Confidence      float64
	ConfidenceLabel string
	LevelUsed       uint32
	ModelVersion    string
}

// AnalyticsService implements analytics business logic.
type AnalyticsService struct {
	repo    domain.AnalyticsRepository
	pricing PricingEngine // optional; nil → GetFairPrice fails soft
}

// NewAnalyticsService creates a new analytics service.
func NewAnalyticsService(repo domain.AnalyticsRepository) *AnalyticsService {
	return &AnalyticsService{repo: repo}
}

// WithPricingEngine wires the Rust Fair-Price engine client. Optional: if never
// called (engine not configured), GetFairPrice returns HasData=false.
func (s *AnalyticsService) WithPricingEngine(p PricingEngine) *AnalyticsService {
	s.pricing = p
	return s
}

// GetFairPrice gathers candidate cleared prices for the category, asks the Rust
// pricing engine for an estimate, and maps the response. It FAILS SOFT: any
// missing engine, repo error, or engine error yields HasData=false (never an
// error), so the surface degrades gracefully instead of 500-ing.
func (s *AnalyticsService) GetFairPrice(ctx context.Context, categoryID, categorySlug, zip, marketID string, asOf time.Time, side uint32) (*FairPrice, error) {
	if s.pricing == nil {
		slog.WarnContext(ctx, "fair price requested but pricing engine not configured")
		return &FairPrice{HasData: false}, nil
	}
	// Slug-or-id flexible inputs (§15): resolve a slug to its category id when no
	// id was supplied. Fail soft to no-data on an unknown slug.
	if categoryID == "" && categorySlug != "" {
		id, err := s.repo.GetCategoryIDBySlug(ctx, categorySlug)
		if err != nil || id == "" {
			slog.WarnContext(ctx, "fair price: category slug not resolved",
				"slug", categorySlug, "error", err)
			return &FairPrice{HasData: false}, nil
		}
		categoryID = id
	}
	if categoryID == "" {
		return &FairPrice{HasData: false}, nil
	}
	if asOf.IsZero() {
		asOf = time.Now()
	}
	asOf = asOf.UTC()

	txns, err := s.repo.GetClearedPriceTransactions(ctx, categoryID, asOf)
	if err != nil {
		// Fail soft: a candidate-gathering failure must not 500 the surface.
		slog.ErrorContext(ctx, "fair price: gather candidates failed, returning no data",
			"error", err, "category_id", categoryID)
		return &FairPrice{HasData: false}, nil
	}

	asOfUnix := asOf.Unix()
	pbTxns := make([]*pricingv1.Transaction, 0, len(txns))
	for _, t := range txns {
		pbTxns = append(pbTxns, &pricingv1.Transaction{
			CategoryId:        t.CategoryID,
			ParentCategoryId:  t.ParentCategoryID,
			MarketId:          t.MarketID,
			Zip:               t.Zip,
			ClearedPriceCents: t.ClearedPriceCents,
			SettledAt:         t.SettledAt.Unix(),
			TrustTier:         t.TrustTier,
			InstantMatch:      t.InstantMatch,
			Condition:         t.Condition,
			Side:              pricingv1.MarketSide(side),
		})
	}

	req := &pricingv1.ComputeFairPriceRequest{
		Query: &pricingv1.FairPriceQuery{
			CategoryId: categoryID,
			Zip:        zip,
			MarketId:   marketID,
			AsOf:       asOfUnix,
			Side:       pricingv1.MarketSide(side),
		},
		Transactions: pbTxns,
	}

	resp, err := s.pricing.ComputeFairPrice(ctx, req)
	if err != nil {
		// Fail soft: engine down/slow/errored → no data, never a 500.
		slog.ErrorContext(ctx, "fair price: pricing engine call failed, returning no data",
			"error", err, "category_id", categoryID, "candidates", len(pbTxns))
		return &FairPrice{HasData: false}, nil
	}

	return &FairPrice{
		HasData:         resp.GetHasData(),
		PriceCents:      resp.GetPriceCents(),
		P25Cents:        resp.GetP25Cents(),
		P75Cents:        resp.GetP75Cents(),
		CILoCents:       resp.GetCiLoCents(),
		CIHiCents:       resp.GetCiHiCents(),
		NEff:            resp.GetNEff(),
		Confidence:      resp.GetConfidence(),
		ConfidenceLabel: resp.GetConfidenceLabel(),
		LevelUsed:       resp.GetLevelUsed(),
		ModelVersion:    resp.GetModelVersion(),
	}, nil
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

// GetCustomerSpending returns spending analytics for a customer, including
// total savings vs. market median. Optional propertyID scopes to jobs linked
// to that property (jobs.property_id); empty means account-wide.
func (s *AnalyticsService) GetCustomerSpending(ctx context.Context, customerID string, startDate, endDate time.Time, groupBy string, propertyID string) ([]domain.SpendingDataPoint, []domain.CategorySpending, int64, int64, error) {
	if groupBy == "" {
		groupBy = "month"
	}
	return s.repo.GetCustomerSpending(ctx, customerID, startDate, endDate, groupBy, propertyID)
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
