package grpc

import (
	"context"
	"fmt"
	"strings"
	"time"

	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	"github.com/nomarkup/nomarkup/services/job/internal/service"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// AnalyticsServer implements the AnalyticsService gRPC server.
type AnalyticsServer struct {
	analyticsv1.UnimplementedAnalyticsServiceServer
	svc *service.AnalyticsService
}

// NewAnalyticsServer creates a new gRPC server for the analytics service.
func NewAnalyticsServer(svc *service.AnalyticsService) *AnalyticsServer {
	return &AnalyticsServer{svc: svc}
}

// RegisterAnalytics registers the analytics service with a gRPC server.
func RegisterAnalytics(s *grpclib.Server, srv *AnalyticsServer) {
	analyticsv1.RegisterAnalyticsServiceServer(s, srv)
}

// --- Market RPCs ---

func (s *AnalyticsServer) GetMarketRange(ctx context.Context, req *analyticsv1.GetMarketRangeRequest) (*analyticsv1.GetMarketRangeResponse, error) {
	var subcategoryID, serviceTypeID *string
	if req.GetSubcategoryId() != "" {
		sid := req.GetSubcategoryId()
		subcategoryID = &sid
	}
	if req.GetServiceTypeId() != "" {
		stid := req.GetServiceTypeId()
		serviceTypeID = &stid
	}

	// Convert location lat/lng to a zip code placeholder.
	// The repository looks up by zip code; pass coordinates as a string for now.
	zipCode := ""
	if loc := req.GetLocation(); loc != nil {
		zipCode = fmt.Sprintf("%.4f,%.4f", loc.GetLatitude(), loc.GetLongitude())
	}

	mr, err := s.svc.GetMarketRange(ctx, req.GetCategoryId(), subcategoryID, serviceTypeID, zipCode)
	if err != nil {
		return nil, mapAnalyticsError(err)
	}

	return &analyticsv1.GetMarketRangeResponse{
		Range: &analyticsv1.MarketRange{
			CategoryId:    req.GetCategoryId(),
			SubcategoryId: req.GetSubcategoryId(),
			ServiceTypeId: req.GetServiceTypeId(),
			Region:        mr.City + ", " + mr.State,
			LowCents:      mr.LowCents,
			MedianCents:   mr.MedianCents,
			HighCents:     mr.HighCents,
			DataPoints:    int32(mr.DataPoints),
			Source:        mr.Source,
			Confidence:    mr.Confidence,
			ComputedAt:    timestamppb.New(mr.ComputedAt),
		},
	}, nil
}

func (s *AnalyticsServer) GetMarketTrends(ctx context.Context, req *analyticsv1.GetMarketTrendsRequest) (*analyticsv1.GetMarketTrendsResponse, error) {
	var subcategoryID, region *string
	if req.GetSubcategoryId() != "" {
		sid := req.GetSubcategoryId()
		subcategoryID = &sid
	}
	if req.GetRegion() != "" {
		r := req.GetRegion()
		region = &r
	}

	startDate, endDate := parseDateRange(req.GetDateRange())

	trends, err := s.svc.GetMarketTrends(ctx, req.GetCategoryId(), subcategoryID, region, startDate, endDate, req.GetGroupBy())
	if err != nil {
		return nil, mapAnalyticsError(err)
	}

	protoTrends := make([]*analyticsv1.PriceTrend, 0, len(trends))
	var overallChange float64
	for _, t := range trends {
		protoTrends = append(protoTrends, &analyticsv1.PriceTrend{
			PeriodStart:      timestamppb.New(t.PeriodStart),
			MedianCents:      t.MedianCents,
			TransactionCount: t.TransactionCount,
			ChangePercentage: t.ChangePercentage,
		})
	}
	if len(trends) >= 2 {
		first := trends[0].MedianCents
		last := trends[len(trends)-1].MedianCents
		if first > 0 {
			overallChange = float64(last-first) / float64(first) * 100.0
		}
	}

	return &analyticsv1.GetMarketTrendsResponse{
		Trends:                  protoTrends,
		OverallChangePercentage: overallChange,
	}, nil
}

// --- Provider RPCs ---

func (s *AnalyticsServer) GetProviderAnalytics(ctx context.Context, req *analyticsv1.GetProviderAnalyticsRequest) (*analyticsv1.GetProviderAnalyticsResponse, error) {
	startDate, endDate := parseDateRange(req.GetDateRange())

	analytics, err := s.svc.GetProviderAnalytics(ctx, req.GetProviderId(), startDate, endDate)
	if err != nil {
		return nil, mapAnalyticsError(err)
	}

	catBreakdown := make([]*analyticsv1.CategoryEarnings, 0, len(analytics.CategoryBreakdown))
	for _, ce := range analytics.CategoryBreakdown {
		catBreakdown = append(catBreakdown, &analyticsv1.CategoryEarnings{
			CategoryId:         ce.CategoryID,
			CategoryName:       ce.CategoryName,
			JobsCompleted:      ce.JobsCompleted,
			TotalEarningsCents: ce.TotalEarningsCents,
			AverageRating:      ce.AverageRating,
		})
	}

	return &analyticsv1.GetProviderAnalyticsResponse{
		TotalBids:              analytics.TotalBids,
		BidsWon:                analytics.BidsWon,
		WinRate:                analytics.WinRate,
		AverageBidCents:        analytics.AverageBidCents,
		JobsCompleted:          analytics.JobsCompleted,
		JobsInProgress:         analytics.JobsInProgress,
		OnTimeRate:             analytics.OnTimeRate,
		CompletionRate:         analytics.CompletionRate,
		TotalEarningsCents:     analytics.TotalEarningsCents,
		AverageJobValueCents:   analytics.AverageJobValueCents,
		AverageRating:          analytics.AverageRating,
		TotalReviews:           analytics.TotalReviews,
		RatingTrend:            analytics.RatingTrend,
		AvgResponseTimeMinutes: analytics.AvgResponseTimeMinutes,
		CategoryBreakdown:      catBreakdown,
	}, nil
}

func (s *AnalyticsServer) GetProviderEarnings(ctx context.Context, req *analyticsv1.GetProviderEarningsRequest) (*analyticsv1.GetProviderEarningsResponse, error) {
	startDate, endDate := parseDateRange(req.GetDateRange())

	points, err := s.svc.GetProviderEarnings(ctx, req.GetProviderId(), startDate, endDate, req.GetGroupBy())
	if err != nil {
		return nil, mapAnalyticsError(err)
	}

	protoPoints := make([]*analyticsv1.EarningsDataPoint, 0, len(points))
	var totalEarnings, totalFees int64
	var totalJobs int32
	for _, p := range points {
		protoPoints = append(protoPoints, &analyticsv1.EarningsDataPoint{
			PeriodStart:   timestamppb.New(p.PeriodStart),
			EarningsCents: p.EarningsCents,
			FeesCents:     p.FeesCents,
			JobCount:      p.JobCount,
		})
		totalEarnings += p.EarningsCents
		totalFees += p.FeesCents
		totalJobs += p.JobCount
	}

	return &analyticsv1.GetProviderEarningsResponse{
		DataPoints:         protoPoints,
		TotalEarningsCents: totalEarnings,
		TotalFeesCents:     totalFees,
		NetEarningsCents:   totalEarnings - totalFees,
		TotalJobs:          totalJobs,
	}, nil
}

// --- Customer RPCs ---

func (s *AnalyticsServer) GetCustomerSpending(ctx context.Context, req *analyticsv1.GetCustomerSpendingRequest) (*analyticsv1.GetCustomerSpendingResponse, error) {
	startDate, endDate := parseDateRange(req.GetDateRange())

	points, categories, totalSpending, err := s.svc.GetCustomerSpending(ctx, req.GetCustomerId(), startDate, endDate, req.GetGroupBy())
	if err != nil {
		return nil, mapAnalyticsError(err)
	}

	protoPoints := make([]*analyticsv1.SpendingDataPoint, 0, len(points))
	var totalJobs int32
	for _, p := range points {
		protoPoints = append(protoPoints, &analyticsv1.SpendingDataPoint{
			PeriodStart: timestamppb.New(p.PeriodStart),
			AmountCents: p.AmountCents,
			JobCount:    p.JobCount,
		})
		totalJobs += p.JobCount
	}

	protoCategories := make([]*analyticsv1.CategorySpending, 0, len(categories))
	for _, c := range categories {
		protoCategories = append(protoCategories, &analyticsv1.CategorySpending{
			CategoryId:      c.CategoryID,
			CategoryName:    c.CategoryName,
			TotalSpentCents: c.TotalSpentCents,
			JobCount:        c.JobCount,
		})
	}

	var avgJobCost int64
	if totalJobs > 0 {
		avgJobCost = totalSpending / int64(totalJobs)
	}

	return &analyticsv1.GetCustomerSpendingResponse{
		DataPoints:          protoPoints,
		TotalSpentCents:     totalSpending,
		TotalJobs:           totalJobs,
		AverageJobCostCents: avgJobCost,
		TotalSavingsCents:   0, // Savings vs market median computed when market data available.
		CategoryBreakdown:   protoCategories,
	}, nil
}

// --- Data Ingestion RPCs ---

func (s *AnalyticsServer) RecordTransaction(ctx context.Context, req *analyticsv1.RecordTransactionRequest) (*analyticsv1.RecordTransactionResponse, error) {
	completedAt := time.Now()
	if req.GetCompletedAt() != nil {
		completedAt = req.GetCompletedAt().AsTime()
	}

	err := s.svc.RecordTransaction(ctx,
		req.GetTransactionId(),
		req.GetCategoryId(),
		req.GetSubcategoryId(),
		req.GetServiceTypeId(),
		req.GetRegion(),
		req.GetAmountCents(),
		req.GetPlatformFeeCents(),
		req.GetCustomerId(),
		req.GetProviderId(),
		completedAt,
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "record transaction: %v", err)
	}
	return &analyticsv1.RecordTransactionResponse{}, nil
}

func (s *AnalyticsServer) RecordEvent(ctx context.Context, req *analyticsv1.RecordEventRequest) (*analyticsv1.RecordEventResponse, error) {
	occurredAt := time.Now()
	if req.GetOccurredAt() != nil {
		occurredAt = req.GetOccurredAt().AsTime()
	}

	err := s.svc.RecordEvent(ctx,
		req.GetEventType(),
		req.GetUserId(),
		req.GetProperties(),
		occurredAt,
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "record event: %v", err)
	}
	return &analyticsv1.RecordEventResponse{}, nil
}

// --- Admin RPCs ---

func (s *AnalyticsServer) GetPlatformMetrics(ctx context.Context, req *analyticsv1.GetPlatformMetricsRequest) (*analyticsv1.GetPlatformMetricsResponse, error) {
	startDate, endDate := parseDateRange(req.GetDateRange())

	metrics, err := s.svc.GetPlatformMetrics(ctx, startDate, endDate)
	if err != nil {
		return nil, mapAnalyticsError(err)
	}

	return &analyticsv1.GetPlatformMetricsResponse{
		TotalGmvCents:           metrics.TotalGMVCents,
		TotalRevenueCents:       metrics.TotalRevenueCents,
		TotalGuaranteeFundCents: metrics.TotalGuaranteeFundCents,
		EffectiveTakeRate:       metrics.EffectiveTakeRate,
		TotalUsers:              metrics.TotalUsers,
		ActiveUsers:             metrics.ActiveUsers,
		NewUsers:                metrics.NewUsers,
		TotalJobsPosted:         metrics.TotalJobsPosted,
		TotalJobsCompleted:      metrics.TotalJobsCompleted,
		JobFillRate:             metrics.JobFillRate,
		JobCompletionRate:       metrics.JobCompletionRate,
		TotalBids:               metrics.TotalBids,
		AvgBidsPerJob:           metrics.AvgBidsPerJob,
		DisputesOpened:          metrics.DisputesOpened,
		DisputesResolved:        metrics.DisputesResolved,
		DisputeRate:             metrics.DisputeRate,
		GuaranteeClaims:         metrics.GuaranteeClaims,
		GuaranteePayoutsCents:   metrics.GuaranteePayoutsCents,
	}, nil
}

func (s *AnalyticsServer) GetGrowthMetrics(ctx context.Context, req *analyticsv1.GetGrowthMetricsRequest) (*analyticsv1.GetGrowthMetricsResponse, error) {
	startDate, endDate := parseDateRange(req.GetDateRange())

	points, err := s.svc.GetGrowthMetrics(ctx, startDate, endDate, req.GetGroupBy())
	if err != nil {
		return nil, mapAnalyticsError(err)
	}

	protoPoints := make([]*analyticsv1.GrowthDataPoint, 0, len(points))
	for _, p := range points {
		protoPoints = append(protoPoints, &analyticsv1.GrowthDataPoint{
			PeriodStart:    timestamppb.New(p.PeriodStart),
			NewUsers:       p.NewUsers,
			NewProviders:   p.NewProviders,
			JobsPosted:     p.JobsPosted,
			JobsCompleted:  p.JobsCompleted,
			GmvCents:       p.GMVCents,
			RevenueCents:   p.RevenueCents,
		})
	}

	// Calculate growth rates from first and last periods.
	var gmvGrowth, userGrowth, jobGrowth float64
	if len(points) >= 2 {
		first := points[0]
		last := points[len(points)-1]
		if first.GMVCents > 0 {
			gmvGrowth = float64(last.GMVCents-first.GMVCents) / float64(first.GMVCents) * 100.0
		}
		if first.NewUsers > 0 {
			userGrowth = float64(last.NewUsers-first.NewUsers) / float64(first.NewUsers) * 100.0
		}
		if first.JobsPosted > 0 {
			jobGrowth = float64(last.JobsPosted-first.JobsPosted) / float64(first.JobsPosted) * 100.0
		}
	}

	return &analyticsv1.GetGrowthMetricsResponse{
		DataPoints:     protoPoints,
		GmvGrowthRate:  gmvGrowth,
		UserGrowthRate: userGrowth,
		JobGrowthRate:  jobGrowth,
	}, nil
}

func (s *AnalyticsServer) GetCategoryMetrics(ctx context.Context, req *analyticsv1.GetCategoryMetricsRequest) (*analyticsv1.GetCategoryMetricsResponse, error) {
	startDate, endDate := parseDateRange(req.GetDateRange())

	categories, err := s.svc.GetCategoryMetrics(ctx, startDate, endDate)
	if err != nil {
		return nil, mapAnalyticsError(err)
	}

	protoCategories := make([]*analyticsv1.CategoryMetrics, 0, len(categories))
	for _, c := range categories {
		protoCategories = append(protoCategories, &analyticsv1.CategoryMetrics{
			CategoryId:       c.CategoryID,
			CategoryName:     c.CategoryName,
			JobsPosted:       c.JobsPosted,
			JobsCompleted:    c.JobsCompleted,
			GmvCents:         c.GMVCents,
			AvgBidsPerJob:    c.AvgBidsPerJob,
			AvgJobValueCents: c.AvgJobValueCents,
			FillRate:         c.FillRate,
			ActiveProviders:  c.ActiveProviders,
		})
	}

	return &analyticsv1.GetCategoryMetricsResponse{
		Categories: protoCategories,
	}, nil
}

func (s *AnalyticsServer) GetGeographicMetrics(ctx context.Context, req *analyticsv1.GetGeographicMetricsRequest) (*analyticsv1.GetGeographicMetricsResponse, error) {
	startDate, endDate := parseDateRange(req.GetDateRange())

	regions, err := s.svc.GetGeographicMetrics(ctx, startDate, endDate)
	if err != nil {
		return nil, mapAnalyticsError(err)
	}

	protoRegions := make([]*analyticsv1.RegionMetrics, 0, len(regions))
	for _, r := range regions {
		rm := &analyticsv1.RegionMetrics{
			Region:            r.Region,
			ActiveUsers:       r.ActiveUsers,
			ActiveProviders:   r.ActiveProviders,
			JobsPosted:        r.JobsPosted,
			GmvCents:          r.GMVCents,
			SupplyDemandRatio: r.SupplyDemandRatio,
		}
		if r.CenterLat != 0 || r.CenterLng != 0 {
			rm.Center = &commonv1.Location{
				Latitude:  r.CenterLat,
				Longitude: r.CenterLng,
			}
		}
		protoRegions = append(protoRegions, rm)
	}

	return &analyticsv1.GetGeographicMetricsResponse{
		Regions: protoRegions,
	}, nil
}

// --- Helpers ---

func parseDateRange(dr *commonv1.DateRange) (time.Time, time.Time) {
	startDate := time.Now().AddDate(0, -3, 0) // Default: last 3 months.
	endDate := time.Now()

	if dr != nil {
		if dr.GetStart() != nil {
			startDate = dr.GetStart().AsTime()
		}
		if dr.GetEnd() != nil {
			endDate = dr.GetEnd().AsTime()
		}
	}

	return startDate, endDate
}

func mapAnalyticsError(err error) error {
	if err == nil {
		return nil
	}
	errMsg := err.Error()
	if strings.Contains(errMsg, "not found") {
		return status.Error(codes.NotFound, errMsg)
	}
	return status.Error(codes.Internal, "internal error")
}
