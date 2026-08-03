package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// AnalyticsHandler handles HTTP endpoints for analytics.
type AnalyticsHandler struct {
	client     analyticsv1.AnalyticsServiceClient
	jobClient  jobv1.JobServiceClient // for the Fair-Price engine RPC (GetFairPrice)
	userClient userv1.UserServiceClient // property ownership for optional property_id filter
}

// NewAnalyticsHandler creates a new AnalyticsHandler.
// userClient may be nil only in unit tests that never hit property-scoped spending.
func NewAnalyticsHandler(client analyticsv1.AnalyticsServiceClient, jobClient jobv1.JobServiceClient, userClient userv1.UserServiceClient) *AnalyticsHandler {
	return &AnalyticsHandler{client: client, jobClient: jobClient, userClient: userClient}
}

// GetFairPrice serves the Fair Price Index for a (category × geo) cell from the
// Rust pricing engine. Public aggregate (no PII). Accepts category_id or
// category_slug (slug-or-id flexible, §15) + optional zip/market. Fails soft to
// has_data=false (never a 500) — pricing is decorative social proof, not a gate.
func (h *AnalyticsHandler) GetFairPrice(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	categoryID := q.Get("category_id")
	categorySlug := q.Get("category_slug")
	if categoryID == "" && categorySlug == "" {
		writeError(w, http.StatusBadRequest, "category_id or category_slug is required")
		return
	}
	if categoryID != "" && !isValidUUID(categoryID) {
		writeError(w, http.StatusBadRequest, "category_id must be a valid UUID")
		return
	}

	// side: 1=service (default), 2=good.
	side := uint32(1)
	if s := q.Get("side"); s != "" {
		if v, err := strconv.ParseUint(s, 10, 32); err == nil && (v == 1 || v == 2) {
			side = uint32(v)
		}
	}
	var asOf int64
	if a := q.Get("as_of"); a != "" {
		if v, err := strconv.ParseInt(a, 10, 64); err == nil {
			asOf = v
		}
	}

	resp, err := h.jobClient.GetFairPrice(r.Context(), &jobv1.GetFairPriceRequest{
		CategoryId:   categoryID,
		CategorySlug: categorySlug,
		Zip:          q.Get("zip"),
		MarketId:     q.Get("market_id"),
		AsOf:         asOf,
		Side:         side,
	})
	if err != nil {
		// Fail soft: a pricing estimate must never 500 the surface.
		writeJSON(w, http.StatusOK, map[string]interface{}{"has_data": false})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"has_data":         resp.GetHasData(),
		"price_cents":      resp.GetPriceCents(),
		"p25_cents":        resp.GetP25Cents(),
		"p75_cents":        resp.GetP75Cents(),
		"ci_lo_cents":      resp.GetCiLoCents(),
		"ci_hi_cents":      resp.GetCiHiCents(),
		"n_eff":            resp.GetNEff(),
		"confidence":       resp.GetConfidence(),
		"confidence_label": resp.GetConfidenceLabel(),
		"level_used":       resp.GetLevelUsed(),
		"model_version":    resp.GetModelVersion(),
	})
}

// GetMarketRange handles GET /api/v1/analytics/market/range.
func (h *AnalyticsHandler) GetMarketRange(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	categoryID := q.Get("category_id")
	if categoryID == "" {
		writeError(w, http.StatusBadRequest, "category_id is required")
		return
	}
	// Validate the UUID at the gateway boundary so a malformed id is a clean 400
	// rather than a Postgres cast error surfacing as a 500 from the analytics
	// service (§6/§15: validate at the boundary, fail closed on a 4xx).
	if !isValidUUID(categoryID) {
		writeError(w, http.StatusBadRequest, "category_id must be a valid UUID")
		return
	}

	req := &analyticsv1.GetMarketRangeRequest{
		CategoryId: categoryID,
	}

	if sid := q.Get("subcategory_id"); sid != "" {
		if !isValidUUID(sid) {
			writeError(w, http.StatusBadRequest, "subcategory_id must be a valid UUID")
			return
		}
		req.SubcategoryId = &sid
	}
	if stid := q.Get("service_type_id"); stid != "" {
		if !isValidUUID(stid) {
			writeError(w, http.StatusBadRequest, "service_type_id must be a valid UUID")
			return
		}
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
		// "No market range computed yet for this category" is a predictable
		// empty state, not a missing resource — the analytics service signals it
		// with gRPC NotFound. Surface it as a 200 no-data response so the
		// fair-price widget can distinguish "no data yet" from a real error and
		// stop spamming the console with 404s on every dataless category (§15).
		if st, ok := status.FromError(err); ok && st.Code() == codes.NotFound {
			writeJSON(w, http.StatusOK, map[string]interface{}{"has_data": false})
			return
		}
		writeGRPCError(w, err)
		return
	}

	mr := resp.GetRange()
	if mr == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"has_data": false})
		return
	}

	// Public SEO-friendly fair-price data, same class as /api/v1/pricing (which
	// caches) — no per-caller variance, edge-cacheable per §14.
	writeCachedJSON(w, r, http.StatusOK, map[string]interface{}{
		"has_data":        true,
		"category_id":     mr.GetCategoryId(),
		"subcategory_id":  mr.GetSubcategoryId(),
		"service_type_id": mr.GetServiceTypeId(),
		"region":          mr.GetRegion(),
		"low_cents":       mr.GetLowCents(),
		"median_cents":    mr.GetMedianCents(),
		"high_cents":      mr.GetHighCents(),
		"data_points":     mr.GetDataPoints(),
		"source":          mr.GetSource(),
		"confidence":      mr.GetConfidence(),
		"computed_at":     formatTimestamp(mr.GetComputedAt()),
	}, 300, 600)
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
	// Resolve the "me" alias to the authenticated caller, matching the
	// /providers/me/* routes. Without this, the literal "me" is compared as a
	// UUID against claims.UserID below and always 403s for the owner.
	if providerID == "" || providerID == "me" {
		providerID = claims.UserID
	}
	// A malformed provider id reaches a UUID-typed query in the analytics
	// service and surfaces as a 500. Reject it as a 400 up front. (Checked after
	// "me" resolution so the alias still works.)
	if !isValidUUID(providerID) {
		writeError(w, http.StatusBadRequest, "invalid provider id")
		return
	}

	// Owner-scoped: only the provider themselves or an admin may read a
	// provider's analytics (revenue/win-rate is sensitive). (IDOR, §6)
	if providerID != claims.UserID && !hasRole(claims, "admin") {
		writeError(w, http.StatusForbidden, "not authorized to view this provider's analytics")
		return
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
	// Resolve the "me" alias to the authenticated caller, matching the
	// /providers/me/* routes. Without this, the literal "me" is compared as a
	// UUID against claims.UserID below and always 403s for the owner.
	if providerID == "" || providerID == "me" {
		providerID = claims.UserID
	}
	// Reject a malformed provider id before it reaches the analytics service's
	// UUID-typed query, mirroring GetProviderAnalytics. (After "me" resolution.)
	if !isValidUUID(providerID) {
		writeError(w, http.StatusBadRequest, "invalid provider id")
		return
	}

	// Owner-scoped: only the provider themselves or an admin may read a
	// provider's earnings (revenue). (IDOR, §6)
	if providerID != claims.UserID && !hasRole(claims, "admin") {
		writeError(w, http.StatusForbidden, "not authorized to view this provider's earnings")
		return
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
//
// Optional query property_id scopes spend to jobs linked to that property.
// Ownership is enforced fail-closed (404 if not owned; 503 if ownership check
// cannot run). UUID format is validated before any RPC.
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

	if prop := strings.TrimSpace(q.Get("property_id")); prop != "" {
		if !isValidUUID(prop) {
			writeError(w, http.StatusBadRequest, "property_id must be a valid UUID")
			return
		}
		if !h.ownsPropertyForSpending(w, r, claims.UserID, prop) {
			return
		}
		req.PropertyId = prop
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
			"category_id":       c.GetCategoryId(),
			"category_name":     c.GetCategoryName(),
			"total_spent_cents": c.GetTotalSpentCents(),
			"job_count":         c.GetJobCount(),
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

// ownsPropertyForSpending verifies propertyID belongs to userID via ListProperties
// (scoped by user_id). Fail closed: missing user client → 503; gRPC error → mapped
// status; not in list → 404 (no existence leak of other users' property IDs).
func (h *AnalyticsHandler) ownsPropertyForSpending(w http.ResponseWriter, r *http.Request, userID, propertyID string) bool {
	if h.userClient == nil {
		writeError(w, http.StatusServiceUnavailable, "property ownership check unavailable")
		return false
	}
	resp, err := h.userClient.ListProperties(r.Context(), &userv1.ListPropertiesRequest{
		UserId: userID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return false
	}
	for _, p := range resp.GetProperties() {
		if p.GetId() == propertyID {
			return true
		}
	}
	writeError(w, http.StatusNotFound, "property not found")
	return false
}

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
