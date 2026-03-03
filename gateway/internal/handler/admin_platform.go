package handler

import (
	"net/http"
	"strconv"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	subscriptionv1 "github.com/nomarkup/nomarkup/proto/subscription/v1"
)

// AdminPlatformHandler handles admin platform analytics and subscription management endpoints.
type AdminPlatformHandler struct {
	analyticsClient    analyticsv1.AnalyticsServiceClient
	subscriptionClient subscriptionv1.SubscriptionServiceClient
}

// NewAdminPlatformHandler creates a new AdminPlatformHandler.
func NewAdminPlatformHandler(
	analyticsClient analyticsv1.AnalyticsServiceClient,
	subscriptionClient subscriptionv1.SubscriptionServiceClient,
) *AdminPlatformHandler {
	return &AdminPlatformHandler{
		analyticsClient:    analyticsClient,
		subscriptionClient: subscriptionClient,
	}
}

// GetPlatformMetrics handles GET /api/v1/admin/platform/metrics.
// Query params: start_date, end_date.
func (h *AdminPlatformHandler) GetPlatformMetrics(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &analyticsv1.GetPlatformMetricsRequest{}

	dateRange := parseDateRange(q.Get("start_date"), q.Get("end_date"))
	if dateRange != nil {
		grpcReq.DateRange = dateRange
	}

	resp, err := h.analyticsClient.GetPlatformMetrics(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_gmv_cents":            resp.GetTotalGmvCents(),
		"total_revenue_cents":        resp.GetTotalRevenueCents(),
		"total_guarantee_fund_cents": resp.GetTotalGuaranteeFundCents(),
		"effective_take_rate":        resp.GetEffectiveTakeRate(),
		"total_users":                resp.GetTotalUsers(),
		"active_users":               resp.GetActiveUsers(),
		"new_users":                  resp.GetNewUsers(),
		"total_jobs_posted":          resp.GetTotalJobsPosted(),
		"total_jobs_completed":       resp.GetTotalJobsCompleted(),
		"job_fill_rate":              resp.GetJobFillRate(),
		"job_completion_rate":        resp.GetJobCompletionRate(),
		"total_bids":                 resp.GetTotalBids(),
		"avg_bids_per_job":           resp.GetAvgBidsPerJob(),
		"disputes_opened":            resp.GetDisputesOpened(),
		"disputes_resolved":          resp.GetDisputesResolved(),
		"dispute_rate":               resp.GetDisputeRate(),
		"guarantee_claims":           resp.GetGuaranteeClaims(),
		"guarantee_payouts_cents":    resp.GetGuaranteePayoutsCents(),
	})
}

// GetGrowthMetrics handles GET /api/v1/admin/platform/growth.
// Query params: start_date, end_date, group_by.
func (h *AdminPlatformHandler) GetGrowthMetrics(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &analyticsv1.GetGrowthMetricsRequest{
		GroupBy: q.Get("group_by"),
	}

	dateRange := parseDateRange(q.Get("start_date"), q.Get("end_date"))
	if dateRange != nil {
		grpcReq.DateRange = dateRange
	}

	resp, err := h.analyticsClient.GetGrowthMetrics(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	dataPoints := make([]map[string]interface{}, 0, len(resp.GetDataPoints()))
	for _, dp := range resp.GetDataPoints() {
		dataPoints = append(dataPoints, map[string]interface{}{
			"period_start":   formatTimestamp(dp.GetPeriodStart()),
			"new_users":      dp.GetNewUsers(),
			"new_providers":  dp.GetNewProviders(),
			"jobs_posted":    dp.GetJobsPosted(),
			"jobs_completed": dp.GetJobsCompleted(),
			"gmv_cents":      dp.GetGmvCents(),
			"revenue_cents":  dp.GetRevenueCents(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data_points":      dataPoints,
		"gmv_growth_rate":  resp.GetGmvGrowthRate(),
		"user_growth_rate": resp.GetUserGrowthRate(),
		"job_growth_rate":  resp.GetJobGrowthRate(),
	})
}

// GetCategoryMetrics handles GET /api/v1/admin/platform/categories.
// Query params: start_date, end_date.
func (h *AdminPlatformHandler) GetCategoryMetrics(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &analyticsv1.GetCategoryMetricsRequest{}

	dateRange := parseDateRange(q.Get("start_date"), q.Get("end_date"))
	if dateRange != nil {
		grpcReq.DateRange = dateRange
	}

	resp, err := h.analyticsClient.GetCategoryMetrics(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	categories := make([]map[string]interface{}, 0, len(resp.GetCategories()))
	for _, c := range resp.GetCategories() {
		categories = append(categories, map[string]interface{}{
			"category_id":         c.GetCategoryId(),
			"category_name":       c.GetCategoryName(),
			"jobs_posted":         c.GetJobsPosted(),
			"jobs_completed":      c.GetJobsCompleted(),
			"gmv_cents":           c.GetGmvCents(),
			"avg_bids_per_job":    c.GetAvgBidsPerJob(),
			"avg_job_value_cents": c.GetAvgJobValueCents(),
			"fill_rate":           c.GetFillRate(),
			"active_providers":    c.GetActiveProviders(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"categories": categories,
	})
}

// GetGeographicMetrics handles GET /api/v1/admin/platform/geographic.
// Query params: start_date, end_date.
func (h *AdminPlatformHandler) GetGeographicMetrics(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &analyticsv1.GetGeographicMetricsRequest{}

	dateRange := parseDateRange(q.Get("start_date"), q.Get("end_date"))
	if dateRange != nil {
		grpcReq.DateRange = dateRange
	}

	resp, err := h.analyticsClient.GetGeographicMetrics(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	regions := make([]map[string]interface{}, 0, len(resp.GetRegions()))
	for _, reg := range resp.GetRegions() {
		regionJSON := map[string]interface{}{
			"region":               reg.GetRegion(),
			"active_users":         reg.GetActiveUsers(),
			"active_providers":     reg.GetActiveProviders(),
			"jobs_posted":          reg.GetJobsPosted(),
			"gmv_cents":            reg.GetGmvCents(),
			"supply_demand_ratio":  reg.GetSupplyDemandRatio(),
		}
		if center := reg.GetCenter(); center != nil {
			regionJSON["center"] = map[string]interface{}{
				"latitude":  center.GetLatitude(),
				"longitude": center.GetLongitude(),
			}
		}
		regions = append(regions, regionJSON)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"regions": regions,
	})
}

// ListSubscriptions handles GET /api/v1/admin/subscriptions.
// Query params: status, tier_id, page, page_size.
func (h *AdminPlatformHandler) ListSubscriptions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &subscriptionv1.AdminListSubscriptionsRequest{}

	// Parse optional status filter.
	if s := q.Get("status"); s != "" {
		status := parseSubscriptionStatus(s)
		if status != subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_UNSPECIFIED {
			grpcReq.StatusFilter = &status
		}
	}

	// Parse optional tier_id filter.
	if tid := q.Get("tier_id"); tid != "" {
		grpcReq.TierId = &tid
	}

	// Parse pagination.
	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 {
			pageSize = int32(v)
		}
	}
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     page,
		PageSize: pageSize,
	}

	resp, err := h.subscriptionClient.AdminListSubscriptions(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	subscriptions := make([]map[string]interface{}, 0, len(resp.GetSubscriptions()))
	for _, sub := range resp.GetSubscriptions() {
		subscriptions = append(subscriptions, adminSubscriptionToJSON(sub))
	}

	result := map[string]interface{}{
		"subscriptions":   subscriptions,
		"total_mrr_cents": resp.GetTotalMrrCents(),
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func adminSubscriptionToJSON(sub *subscriptionv1.Subscription) map[string]interface{} {
	if sub == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"id":         sub.GetId(),
		"user_id":    sub.GetUserId(),
		"tier_id":    sub.GetTierId(),
		"status":     sub.GetStatus().String(),
		"created_at": formatTimestamp(sub.GetCreatedAt()),
	}
}

func parseSubscriptionStatus(s string) subscriptionv1.SubscriptionStatus {
	switch s {
	case "active":
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE
	case "past_due":
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_PAST_DUE
	case "cancelled":
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_CANCELLED
	case "expired":
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_EXPIRED
	case "trialing":
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_TRIALING
	default:
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_UNSPECIFIED
	}
}
