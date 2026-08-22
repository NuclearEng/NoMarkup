package grpc

import (
	"context"
	"errors"
	"testing"
	"time"

	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var _ domain.AnalyticsRepository = (*stubAnalyticsRepo)(nil)

type stubAnalyticsRepo struct {
	getMarketRangeFn   func(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, zipCode string) (*domain.MarketRange, error)
	getMarketRangeAtFn func(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, lat, lng, radiusKm float64) (*domain.MarketRange, error)
}

func (s *stubAnalyticsRepo) GetMarketRange(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, zipCode string) (*domain.MarketRange, error) {
	if s.getMarketRangeFn != nil {
		return s.getMarketRangeFn(ctx, categoryID, subcategoryID, serviceTypeID, zipCode)
	}
	return nil, domain.ErrMarketRangeNotFound
}
func (s *stubAnalyticsRepo) GetMarketRangeAt(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, lat, lng, radiusKm float64) (*domain.MarketRange, error) {
	if s.getMarketRangeAtFn != nil {
		return s.getMarketRangeAtFn(ctx, categoryID, subcategoryID, serviceTypeID, lat, lng, radiusKm)
	}
	return nil, domain.ErrMarketRangeNotFound
}
func (s *stubAnalyticsRepo) GetClearedPriceTransactions(context.Context, string, time.Time) ([]domain.ClearedPriceTransaction, error) {
	return nil, nil
}
func (s *stubAnalyticsRepo) GetCategoryIDBySlug(context.Context, string) (string, error) {
	return "", nil
}
func (s *stubAnalyticsRepo) GetMarketTrends(context.Context, string, *string, *string, time.Time, time.Time, string) ([]domain.PriceTrend, error) {
	return nil, nil
}
func (s *stubAnalyticsRepo) GetProviderAnalytics(context.Context, string, time.Time, time.Time) (*domain.ProviderAnalytics, error) {
	return &domain.ProviderAnalytics{}, nil
}
func (s *stubAnalyticsRepo) GetProviderEarnings(context.Context, string, time.Time, time.Time, string) ([]domain.EarningsDataPoint, error) {
	return nil, nil
}
func (s *stubAnalyticsRepo) GetCustomerSpending(context.Context, string, time.Time, time.Time, string, string) ([]domain.SpendingDataPoint, []domain.CategorySpending, int64, int64, error) {
	return nil, nil, 0, 0, nil
}
func (s *stubAnalyticsRepo) GetPlatformMetrics(context.Context, time.Time, time.Time) (*domain.PlatformMetrics, error) {
	return &domain.PlatformMetrics{}, nil
}
func (s *stubAnalyticsRepo) GetGrowthMetrics(context.Context, time.Time, time.Time, string) ([]domain.GrowthDataPoint, error) {
	return nil, nil
}
func (s *stubAnalyticsRepo) GetCategoryMetrics(context.Context, time.Time, time.Time) ([]domain.CategoryMetrics, error) {
	return nil, nil
}
func (s *stubAnalyticsRepo) GetGeographicMetrics(context.Context, time.Time, time.Time) ([]domain.RegionMetrics, error) {
	return nil, nil
}
func (s *stubAnalyticsRepo) RecordTransaction(context.Context, string, string, string, string, string, int64, int64, string, string, time.Time) error {
	return nil
}
func (s *stubAnalyticsRepo) RecordEvent(context.Context, string, string, map[string]string, time.Time) error {
	return nil
}

func fixtureRange() *domain.MarketRange {
	return &domain.MarketRange{
		ZipCode:     "78701",
		City:        "Austin",
		State:       "TX",
		LowCents:    15000,
		MedianCents: 30000,
		HighCents:   50000,
		DataPoints:  42,
		Source:      "seeded",
		Confidence:  0.65,
		ComputedAt:  time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
}

func TestGetMarketRange_ZipStringPath(t *testing.T) {
	t.Parallel()
	var gotZip string
	repo := &stubAnalyticsRepo{
		getMarketRangeFn: func(_ context.Context, _ string, _, _ *string, zipCode string) (*domain.MarketRange, error) {
			gotZip = zipCode
			return fixtureRange(), nil
		},
	}
	srv := NewAnalyticsServer(service.NewAnalyticsService(repo))
	zip := "78701"
	resp, err := srv.GetMarketRange(context.Background(), &analyticsv1.GetMarketRangeRequest{
		CategoryId: "00000000-0000-0000-0000-000000000001",
		ZipCode:    &zip,
	})
	require.NoError(t, err)
	require.Equal(t, "78701", gotZip)
	require.Equal(t, int64(30000), resp.GetRange().GetMedianCents())
	require.Equal(t, "Austin, TX", resp.GetRange().GetRegion())
}

func TestGetMarketRange_LocationResolvesViaGeoNotCoordString(t *testing.T) {
	t.Parallel()
	var gotLat, gotLng, gotRadius float64
	var zipCalled bool
	repo := &stubAnalyticsRepo{
		getMarketRangeFn: func(_ context.Context, _ string, _, _ *string, zipCode string) (*domain.MarketRange, error) {
			zipCalled = true
			return nil, errors.New("must not look up zip=" + zipCode)
		},
		getMarketRangeAtFn: func(_ context.Context, _ string, _, _ *string, lat, lng, radiusKm float64) (*domain.MarketRange, error) {
			gotLat, gotLng, gotRadius = lat, lng, radiusKm
			return fixtureRange(), nil
		},
	}
	srv := NewAnalyticsServer(service.NewAnalyticsService(repo))
	resp, err := srv.GetMarketRange(context.Background(), &analyticsv1.GetMarketRangeRequest{
		CategoryId: "00000000-0000-0000-0000-000000000001",
		Location:   &commonv1.Location{Latitude: 30.2672, Longitude: -97.7431},
	})
	require.NoError(t, err)
	require.False(t, zipCalled, "location must not be sprintf'd into a zip lookup")
	assert.InDelta(t, 30.2672, gotLat, 1e-9)
	assert.InDelta(t, -97.7431, gotLng, 1e-9)
	assert.Equal(t, 0.0, gotRadius)
	require.Equal(t, int64(30000), resp.GetRange().GetMedianCents())
}

func TestGetMarketRange_OceanNotFound(t *testing.T) {
	t.Parallel()
	repo := &stubAnalyticsRepo{
		getMarketRangeAtFn: func(_ context.Context, _ string, _, _ *string, _, _, _ float64) (*domain.MarketRange, error) {
			return nil, domain.ErrMarketRangeNotFound
		},
	}
	srv := NewAnalyticsServer(service.NewAnalyticsService(repo))
	_, err := srv.GetMarketRange(context.Background(), &analyticsv1.GetMarketRangeRequest{
		CategoryId: "00000000-0000-0000-0000-000000000001",
		Location:   &commonv1.Location{Latitude: 0, Longitude: -40},
	})
	require.Error(t, err)
	require.Equal(t, codes.NotFound, status.Code(err))
}

func TestGetMarketRange_NoLocationNoZip(t *testing.T) {
	t.Parallel()
	srv := NewAnalyticsServer(service.NewAnalyticsService(&stubAnalyticsRepo{}))
	_, err := srv.GetMarketRange(context.Background(), &analyticsv1.GetMarketRangeRequest{
		CategoryId: "00000000-0000-0000-0000-000000000001",
	})
	require.Error(t, err)
	require.Equal(t, codes.NotFound, status.Code(err))
}

func TestMapAnalyticsError_MarketRangeNotFound(t *testing.T) {
	t.Parallel()
	wrapped := errors.New("get market range: " + domain.ErrMarketRangeNotFound.Error())
	// errors.Is path
	require.Equal(t, codes.NotFound, status.Code(mapAnalyticsError(domain.ErrMarketRangeNotFound)))
	require.Equal(t, codes.NotFound, status.Code(mapAnalyticsError(wrapped)))
}
