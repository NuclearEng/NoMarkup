package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// AnalyticsHandler handles HTTP endpoints for analytics.
type AnalyticsHandler struct {
	client analyticsv1.AnalyticsServiceClient
}

// NewAnalyticsHandler creates a new AnalyticsHandler.
func NewAnalyticsHandler(client analyticsv1.AnalyticsServiceClient) *AnalyticsHandler {
	return &AnalyticsHandler{client: client}
}

// GetMarketRange handles GET /api/v1/analytics/market/range.
func (h *AnalyticsHandler) GetMarketRange(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	categoryID := q.Get("category_id")
	if categoryID == "" {
		writeError(w, http.StatusBadRequest, "category_id is required")
		return
	}

	req := &analyticsv1.GetMarketRangeRequest{
		CategoryId: categoryID,
	}

	if sid := q.Get("subcategory_id"); sid != "" {
		req.SubcategoryId = &sid
	}
	if stid := q.Get("service_type_id"); stid != "" {
		req.ServiceTypeId = &stid
	}

	if latStr, lngStr := q.Get("lat"), q.Get("lng"); latStr != "" && lngStr != "" {
		lat, errLat := strconv.ParseFloat(latStr, 64)
		lng, errLng := strconv.ParseFloat(lngStr, 64)
		if errLat == nil && errLng == nil {
			req.Location = &commonv1.Location{
				Latitude:  lat,
				Longitude: lng,
			}
		}
	}

	if rkm := q.Get("radius_km"); rkm != "" {
		if v, err := strconv.ParseFloat(rkm, 64); err == nil {
			req.RadiusKm = &v
		}
	}

	resp, err := h.client.GetMarketRange(r.Context(), req)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	mr := resp.GetRange()
	if mr == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"category_id":    mr.GetCategoryId(),
		"subcategory_id": mr.GetSubcategoryId(),
		"service_type_id": mr.GetServiceTypeId(),
		"region":         mr.GetRegion(),
		"low_cents":      mr.GetLowCents(),
		"median_cents":   mr.GetMedianCents(),
		"high_cents":     mr.GetHighCents(),
		"data_points":    mr.GetDataPoints(),
		"source":         mr.GetSource(),
		"confidence":     mr.GetConfidence(),
		"computed_at":    formatTimestamp(mr.GetComputedAt()),
	})
}

// GetMarketTrends handles GET /api/v1/analytics/market/trends.
func (h *AnalyticsHandler) GetMarketTrends(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	categoryID := q.Get("category_id")
	if categoryID == "" {
		writeError(w, http.StatusBadRequest, "category_id is required")
		return
	}

	req := &analyticsv1.GetMarketTrendsRequest{
		CategoryId: categoryID,
		GroupBy:    q.Get("group_by"),
	}

	if sid := q.Get("subcategory_id"); sid != "" {
		req.SubcategoryId = &sid
	}
	if region := q.Get("region"); region != "" {
		req.Region = &region
	}

	req.DateRange = parseDateRangeFromQuery(q)

	resp, err := h.client.GetMarketTrends(r.Context(), req)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	trends := make([]map[string]interface{}, 0, len(resp.GetTrends()))
	for _, t := range resp.GetTrends() {
		trends = append(trends, map[string]interface{}{
			"period_start":      formatTimestamp(t.GetPeriodStart()),
			"median_cents":      t.GetMedianCents(),
			"transaction_count": t.GetTransactionCount(),
			"change_percentage": t.GetChangePercentage(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"trends":                    trends,
		"overall_change_percentage": resp.GetOverallChangePercentage(),
	})
}

// GetProviderAnalytics handles GET /api/v1/analytics/providers/{id}.
func (h *AnalyticsHandler) GetProviderAnalytics(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	providerID := chi.URLParam(r, "id")
	if providerID == "" {
		providerID = claims.UserID
	}

	req := &analyticsv1.GetProviderAnalyticsRequest{
		ProviderId: providerID,
		DateRange:  parseDateRangeFromQuery(r.URL.Query()),
	}

	resp, err := h.client.GetProviderAnalytics(r.Context(), req)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	catBreakdown := make([]map[string]interface{}, 0, len(resp.GetCategoryBreakdown()))
	for _, ce := range resp.GetCategoryBreakdown() {
		catBreakdown = append(catBreakdown, map[string]interface{}{
			"category_id":          ce.GetCategoryId(),
			"category_name":        ce.GetCategoryName(),
			"jobs_completed":       ce.GetJobsCompleted(),
			"total_earnings_cents": ce.GetTotalEarningsCents(),
			"average_rating":       ce.GetAverageRating(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_bids":                resp.GetTotalBids(),
		"bids_won":                  resp.GetBidsWon(),
		"win_rate":                  resp.GetWinRate(),
		"average_bid_cents":         resp.GetAverageBidCents(),
		"jobs_completed":            resp.GetJobsCompleted(),
		"jobs_in_progress":          resp.GetJobsInProgress(),
		"on_time_rate":              resp.GetOnTimeRate(),
		"completion_rate":           resp.GetCompletionRate(),
		"total_earnings_cents":      resp.GetTotalEarningsCents(),
		"average_job_value_cents":   resp.GetAverageJobValueCents(),
		"average_rating":            resp.GetAverageRating(),
		"total_reviews":             resp.GetTotalReviews(),
		"rating_trend":              resp.GetRatingTrend(),
		"avg_response_time_minutes": resp.GetAvgResponseTimeMinutes(),
		"category_breakdown":        catBreakdown,
	})
}

// GetProviderEarnings handles GET /api/v1/analytics/providers/{id}/earnings.
func (h *AnalyticsHandler) GetProviderEarnings(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	providerID := chi.URLParam(r, "id")
	if providerID == "" {
		providerID = claims.UserID
	}

	q := r.URL.Query()
	req := &analyticsv1.GetProviderEarningsRequest{
		ProviderId: providerID,
		DateRange:  parseDateRangeFromQuery(q),
		GroupBy:    q.Get("group_by"),
	}

	resp, err := h.client.GetProviderEarnings(r.Context(), req)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	dataPoints := make([]map[string]interface{}, 0, len(resp.GetDataPoints()))
	for _, dp := range resp.GetDataPoints() {
		dataPoints = append(dataPoints, map[string]interface{}{
			"period_start":   formatTimestamp(dp.GetPeriodStart()),
			"earnings_cents": dp.GetEarningsCents(),
			"fees_cents":     dp.GetFeesCents(),
			"job_count":      dp.GetJobCount(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data_points":          dataPoints,
		"total_earnings_cents": resp.GetTotalEarningsCents(),
		"total_fees_cents":     resp.GetTotalFeesCents(),
		"net_earnings_cents":   resp.GetNetEarningsCents(),
		"total_jobs":           resp.GetTotalJobs(),
	})
}

// GetCustomerSpending handles GET /api/v1/analytics/customers/me/spending.
func (h *AnalyticsHandler) GetCustomerSpending(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()
	req := &analyticsv1.GetCustomerSpendingRequest{
		CustomerId: claims.UserID,
		DateRange:  parseDateRangeFromQuery(q),
		GroupBy:    q.Get("group_by"),
	}

	resp, err := h.client.GetCustomerSpending(r.Context(), req)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	dataPoints := make([]map[string]interface{}, 0, len(resp.GetDataPoints()))
	for _, dp := range resp.GetDataPoints() {
		dataPoints = append(dataPoints, map[string]interface{}{
			"period_start": formatTimestamp(dp.GetPeriodStart()),
			"amount_cents": dp.GetAmountCents(),
			"job_count":    dp.GetJobCount(),
		})
	}

	catBreakdown := make([]map[string]interface{}, 0, len(resp.GetCategoryBreakdown()))
	for _, c := range resp.GetCategoryBreakdown() {
		catBreakdown = append(catBreakdown, map[string]interface{}{
			"category_id":      c.GetCategoryId(),
			"category_name":    c.GetCategoryName(),
			"total_spent_cents": c.GetTotalSpentCents(),
			"job_count":        c.GetJobCount(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data_points":            dataPoints,
		"total_spent_cents":      resp.GetTotalSpentCents(),
		"total_jobs":             resp.GetTotalJobs(),
		"average_job_cost_cents": resp.GetAverageJobCostCents(),
		"total_savings_cents":    resp.GetTotalSavingsCents(),
		"category_breakdown":     catBreakdown,
	})
}

// --- Helpers ---

// parseDateRangeFromQuery extracts start_date and end_date from query params.
func parseDateRangeFromQuery(q interface{ Get(string) string }) *commonv1.DateRange {
	startStr := q.Get("start_date")
	endStr := q.Get("end_date")

	if startStr == "" && endStr == "" {
		return nil
	}

	dr := &commonv1.DateRange{}

	if startStr != "" {
		if t, err := time.Parse("2006-01-02", startStr); err == nil {
			dr.Start = timestamppb.New(t)
		}
	}
	if endStr != "" {
		if t, err := time.Parse("2006-01-02", endStr); err == nil {
			dr.End = timestamppb.New(t)
		}
	}

	return dr
}
