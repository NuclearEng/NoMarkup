package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ProviderHandler handles HTTP endpoints for provider profiles.
type ProviderHandler struct {
	userClient userv1.UserServiceClient
	db         *pgxpool.Pool
}

// NewProviderHandler creates a new ProviderHandler.
// The db pool is used for gateway-level queries (e.g. streaks) that don't
// have a corresponding gRPC RPC. If db is nil, those endpoints degrade gracefully.
func NewProviderHandler(userClient userv1.UserServiceClient, db *pgxpool.Pool) *ProviderHandler {
	return &ProviderHandler{userClient: userClient, db: db}
}

type updateProviderRequest struct {
	BusinessName *string  `json:"business_name,omitempty"`
	Bio          *string  `json:"bio,omitempty"`
	Address      *string  `json:"service_address,omitempty"`
	Latitude     *float64 `json:"latitude,omitempty"`
	Longitude    *float64 `json:"longitude,omitempty"`
	RadiusKm     *float64 `json:"service_radius_km,omitempty"`
}

type setTermsRequest struct {
	PaymentTiming      string               `json:"payment_timing"`
	Milestones         []milestoneRequest    `json:"milestones"`
	CancellationPolicy string               `json:"cancellation_policy"`
	WarrantyTerms      string               `json:"warranty_terms"`
}

type milestoneRequest struct {
	Description string `json:"description"`
	Percentage  int32  `json:"percentage"`
}

type updateCategoriesRequest struct {
	CategoryIDs []string `json:"category_ids"`
}

type portfolioImageRequest struct {
	ImageURL  string `json:"image_url"`
	Caption   string `json:"caption"`
	SortOrder int32  `json:"sort_order"`
}

type updatePortfolioRequest struct {
	Images []portfolioImageRequest `json:"images"`
}

type setAvailabilityRequest struct {
	Enabled      bool                     `json:"enabled"`
	AvailableNow bool                     `json:"available_now"`
	Schedule     []availabilityWindowReq  `json:"schedule"`
}

type availabilityWindowReq struct {
	Day       string `json:"day"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

// GetMe handles GET /api/v1/providers/me.
func (h *ProviderHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.userClient.GetProviderProfile(r.Context(), &userv1.GetProviderProfileRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := protoProviderToJSON(resp.GetProfile())
	if label := h.getResponseTimeLabel(r.Context(), claims.UserID); label != nil {
		result["response_time_label"] = *label
	}

	writeJSON(w, http.StatusOK, result)
}

// UpdateMe handles PATCH /api/v1/providers/me.
func (h *ProviderHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req updateProviderRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	grpcReq := &userv1.UpdateProviderProfileRequest{
		UserId:         claims.UserID,
		BusinessName:   req.BusinessName,
		Bio:            req.Bio,
		ServiceAddress: req.Address,
		ServiceRadiusKm: req.RadiusKm,
	}
	if req.Latitude != nil && req.Longitude != nil {
		grpcReq.ServiceLocation = &commonv1.Location{
			Latitude:  *req.Latitude,
			Longitude: *req.Longitude,
		}
	}

	resp, err := h.userClient.UpdateProviderProfile(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoProviderToJSON(resp.GetProfile()))
}

// SetGlobalTerms handles PUT /api/v1/providers/me/terms.
func (h *ProviderHandler) SetGlobalTerms(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req setTermsRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	milestones := make([]*userv1.MilestoneTemplate, 0, len(req.Milestones))
	for _, m := range req.Milestones {
		milestones = append(milestones, &userv1.MilestoneTemplate{
			Description: m.Description,
			Percentage:  m.Percentage,
		})
	}

	resp, err := h.userClient.SetGlobalTerms(r.Context(), &userv1.SetGlobalTermsRequest{
		UserId:             claims.UserID,
		PaymentTiming:      stringToPaymentTiming(req.PaymentTiming),
		Milestones:         milestones,
		CancellationPolicy: req.CancellationPolicy,
		WarrantyTerms:      req.WarrantyTerms,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoProviderToJSON(resp.GetProfile()))
}

// UpdateCategories handles PUT /api/v1/providers/me/categories.
func (h *ProviderHandler) UpdateCategories(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req updateCategoriesRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.userClient.UpdateServiceCategories(r.Context(), &userv1.UpdateServiceCategoriesRequest{
		UserId:      claims.UserID,
		CategoryIds: req.CategoryIDs,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	cats := make([]map[string]interface{}, 0, len(resp.GetCategories()))
	for _, c := range resp.GetCategories() {
		cats = append(cats, map[string]interface{}{
			"id":          c.GetId(),
			"name":        c.GetName(),
			"slug":        c.GetSlug(),
			"level":       c.GetLevel(),
			"parent_name": c.GetParentName(),
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"categories": cats})
}

// UpdatePortfolio handles PUT /api/v1/providers/me/portfolio.
func (h *ProviderHandler) UpdatePortfolio(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req updatePortfolioRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	images := make([]*userv1.PortfolioImage, 0, len(req.Images))
	for _, img := range req.Images {
		images = append(images, &userv1.PortfolioImage{
			ImageUrl:  img.ImageURL,
			Caption:   img.Caption,
			SortOrder: img.SortOrder,
		})
	}

	resp, err := h.userClient.UpdatePortfolio(r.Context(), &userv1.UpdatePortfolioRequest{
		UserId: claims.UserID,
		Images: images,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	resultImages := make([]map[string]interface{}, 0, len(resp.GetImages()))
	for _, img := range resp.GetImages() {
		resultImages = append(resultImages, map[string]interface{}{
			"id":         img.GetId(),
			"image_url":  img.GetImageUrl(),
			"caption":    img.GetCaption(),
			"sort_order": img.GetSortOrder(),
		})
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"images": resultImages})
}

// SetAvailability handles PUT /api/v1/providers/me/availability.
func (h *ProviderHandler) SetAvailability(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req setAvailabilityRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	schedule := make([]*userv1.AvailabilityWindow, 0, len(req.Schedule))
	for _, s := range req.Schedule {
		schedule = append(schedule, &userv1.AvailabilityWindow{
			Day:       s.Day,
			StartTime: s.StartTime,
			EndTime:   s.EndTime,
		})
	}

	resp, err := h.userClient.SetInstantAvailability(r.Context(), &userv1.SetInstantAvailabilityRequest{
		UserId:       claims.UserID,
		Enabled:      req.Enabled,
		AvailableNow: req.AvailableNow,
		Schedule:     schedule,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"instant_enabled":   resp.GetInstantEnabled(),
		"instant_available": resp.GetInstantAvailable(),
	})
}

// GetStreaks handles GET /api/v1/providers/me/streaks.
func (h *ProviderHandler) GetStreaks(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	if h.db == nil {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id, provider_id, category_id, current_streak, longest_streak,
		       total_wins, category_rank, updated_at
		FROM provider_streaks
		WHERE provider_id = $1
		ORDER BY total_wins DESC`, claims.UserID)
	if err != nil {
		slog.Error("failed to query provider streaks", "provider_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get streaks")
		return
	}
	defer rows.Close()

	streaks := make([]map[string]interface{}, 0)
	for rows.Next() {
		var (
			id, providerID                          string
			categoryID                              *string
			currentStreak, longestStreak, totalWins  int
			categoryRank                             *int
			updatedAt                                time.Time
		)
		if err := rows.Scan(&id, &providerID, &categoryID, &currentStreak, &longestStreak, &totalWins, &categoryRank, &updatedAt); err != nil {
			slog.Error("failed to scan provider streak row", "provider_id", claims.UserID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read streaks")
			return
		}
		streak := map[string]interface{}{
			"id":              id,
			"provider_id":     providerID,
			"category_id":     categoryID,
			"current_streak":  currentStreak,
			"longest_streak":  longestStreak,
			"total_wins":      totalWins,
			"category_rank":   categoryRank,
			"updated_at":      updatedAt.UTC().Format(time.RFC3339),
		}
		streaks = append(streaks, streak)
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating provider streak rows", "provider_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get streaks")
		return
	}

	writeJSON(w, http.StatusOK, streaks)
}

// GetProvider handles GET /api/v1/providers/{id}.
func (h *ProviderHandler) GetProvider(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	resp, err := h.userClient.GetProviderProfile(r.Context(), &userv1.GetProviderProfileRequest{
		UserId: userID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := protoProviderToJSON(resp.GetProfile())
	if label := h.getResponseTimeLabel(r.Context(), userID); label != nil {
		result["response_time_label"] = *label
	}

	writeJSON(w, http.StatusOK, result)
}

// SearchProviders handles GET /api/v1/providers/search.
func (h *ProviderHandler) SearchProviders(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &userv1.SearchProvidersRequest{}

	if catIDs := q.Get("category_ids"); catIDs != "" {
		grpcReq.CategoryIds = splitCommas(catIDs)
	}

	if lat := q.Get("latitude"); lat != "" {
		if lng := q.Get("longitude"); lng != "" {
			latF, _ := strconv.ParseFloat(lat, 64)
			lngF, _ := strconv.ParseFloat(lng, 64)
			grpcReq.Location = &commonv1.Location{
				Latitude:  latF,
				Longitude: lngF,
			}
		}
	}
	if radius := q.Get("radius_km"); radius != "" {
		r, _ := strconv.ParseFloat(radius, 64)
		grpcReq.RadiusKm = r
	}

	if minRating := q.Get("min_rating"); minRating != "" {
		v, _ := strconv.ParseFloat(minRating, 64)
		grpcReq.MinRating = &v
	}

	if verifiedOnly := q.Get("verified_only"); verifiedOnly == "true" {
		v := true
		grpcReq.VerifiedOnly = &v
	}

	if instantAvailable := q.Get("instant_available"); instantAvailable == "true" {
		v := true
		grpcReq.InstantAvailable = &v
	}

	if sortField := q.Get("sort"); sortField != "" {
		dir := commonv1.SortDirection_SORT_DIRECTION_ASC
		if q.Get("sort_dir") == "desc" {
			dir = commonv1.SortDirection_SORT_DIRECTION_DESC
		}
		grpcReq.Sort = &commonv1.SortRequest{
			Field:     sortField,
			Direction: dir,
		}
	}

	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil {
			pageSize = int32(v)
		}
	}
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     page,
		PageSize: pageSize,
	}

	resp, err := h.userClient.SearchProviders(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	providers := make([]map[string]interface{}, 0, len(resp.GetProviders()))
	for _, p := range resp.GetProviders() {
		pJSON := protoProviderSearchResultToJSON(p)
		if label := h.getResponseTimeLabel(r.Context(), p.GetUserId()); label != nil {
			pJSON["response_time_label"] = *label
		}
		providers = append(providers, pJSON)
	}

	result := map[string]interface{}{
		"providers": providers,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"totalCount": pg.GetTotalCount(),
			"page":       pg.GetPage(),
			"pageSize":   pg.GetPageSize(),
			"totalPages": pg.GetTotalPages(),
			"hasNext":    pg.GetHasNext(),
		}
	}

	// Public provider directory, keyed by query at the edge. 60s CDN TTL +
	// 5m SWR. No auth, no per-user data.
	writeCachedJSON(w, r, http.StatusOK, result, 60, 300)
}

// getResponseTimeLabel calculates the average first-response time for a
// provider across chat channels from the last 90 days and returns a
// human-readable label. Returns nil when there is insufficient data or the
// database pool is unavailable.
func (h *ProviderHandler) getResponseTimeLabel(ctx context.Context, providerID string) *string {
	if h.db == nil {
		return nil
	}

	var avgMinutes *float64
	err := h.db.QueryRow(ctx, `
		SELECT AVG(EXTRACT(EPOCH FROM (first_response - channel_created)) / 60.0)
		FROM (
			SELECT
				ch.created_at AS channel_created,
				MIN(cm.created_at) AS first_response
			FROM chat_channels ch
			JOIN chat_messages cm
				ON cm.channel_id = ch.id
				AND cm.sender_id = $1
			WHERE ch.provider_id = $1
			  AND ch.created_at > now() - interval '90 days'
			GROUP BY ch.id, ch.created_at
		) sub
		WHERE first_response IS NOT NULL
	`, providerID).Scan(&avgMinutes)

	if err != nil {
		slog.Error("failed to query provider response time",
			"provider_id", providerID,
			"error", err,
		)
		return nil
	}
	if avgMinutes == nil {
		return nil
	}

	minutes := *avgMinutes
	var label string
	switch {
	case minutes < 15:
		label = "Usually responds in minutes"
	case minutes < 60:
		label = "Usually responds within an hour"
	case minutes < 180:
		label = "Usually responds within a few hours"
	case minutes < 1440:
		label = "Usually responds within a day"
	default:
		return nil // Too slow to be a positive signal
	}

	return &label
}

func protoProviderSearchResultToJSON(p *userv1.ProviderSearchResult) map[string]interface{} {
	if p == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"user_id":            p.GetUserId(),
		"display_name":       p.GetDisplayName(),
		"business_name":      p.GetBusinessName(),
		"avatar_url":         p.GetAvatarUrl(),
		"distance_km":        p.GetDistanceKm(),
		"instant_available":  p.GetInstantAvailable(),
	}

	if rs := p.GetReviewSummary(); rs != nil {
		result["review_summary"] = map[string]interface{}{
			"average_rating": rs.GetAverageRating(),
			"review_count":   rs.GetReviewCount(),
			"on_time_rate":   rs.GetOnTimeRate(),
		}
	}

	if ts := p.GetTrustScore(); ts != nil {
		result["trust_score"] = map[string]interface{}{
			"overall_score": ts.GetOverallScore(),
			"tier":          ts.GetTier().String(),
		}
	}

	cats := make([]map[string]interface{}, 0, len(p.GetCategories()))
	for _, c := range p.GetCategories() {
		cats = append(cats, map[string]interface{}{
			"id":   c.GetId(),
			"name": c.GetName(),
			"slug": c.GetSlug(),
		})
	}
	// Field is named `service_categories` in the public PublicProvider TS type
	// (matches ProviderProfile naming for consistency on the client).
	result["service_categories"] = cats

	return result
}

func stringToPaymentTiming(s string) commonv1.PaymentTiming {
	switch s {
	case "upfront":
		return commonv1.PaymentTiming_PAYMENT_TIMING_UPFRONT
	case "milestone":
		return commonv1.PaymentTiming_PAYMENT_TIMING_MILESTONE
	case "completion":
		return commonv1.PaymentTiming_PAYMENT_TIMING_COMPLETION
	case "payment_plan":
		return commonv1.PaymentTiming_PAYMENT_TIMING_PAYMENT_PLAN
	case "recurring":
		return commonv1.PaymentTiming_PAYMENT_TIMING_RECURRING
	default:
		return commonv1.PaymentTiming_PAYMENT_TIMING_UNSPECIFIED
	}
}

func paymentTimingToString(t commonv1.PaymentTiming) string {
	switch t {
	case commonv1.PaymentTiming_PAYMENT_TIMING_UPFRONT:
		return "upfront"
	case commonv1.PaymentTiming_PAYMENT_TIMING_MILESTONE:
		return "milestone"
	case commonv1.PaymentTiming_PAYMENT_TIMING_COMPLETION:
		return "completion"
	case commonv1.PaymentTiming_PAYMENT_TIMING_PAYMENT_PLAN:
		return "payment_plan"
	case commonv1.PaymentTiming_PAYMENT_TIMING_RECURRING:
		return "recurring"
	default:
		return "completion"
	}
}

func protoProviderToJSON(p *userv1.ProviderProfile) map[string]interface{} {
	if p == nil {
		return nil
	}
	result := map[string]interface{}{
		"id":                         p.GetId(),
		"user_id":                    p.GetUserId(),
		"business_name":              p.GetBusinessName(),
		"bio":                        p.GetBio(),
		"service_address":            p.GetServiceAddress(),
		"service_radius_km":          p.GetServiceRadiusKm(),
		"default_payment_timing":     paymentTimingToString(p.GetDefaultPaymentTiming()),
		"cancellation_policy":        p.GetCancellationPolicy(),
		"warranty_terms":             p.GetWarrantyTerms(),
		"instant_enabled":            p.GetInstantEnabled(),
		"instant_available":          p.GetInstantAvailable(),
		"jobs_completed":             p.GetJobsCompleted(),
		"avg_response_time_minutes":  p.GetAvgResponseTimeMinutes(),
		"on_time_rate":               p.GetOnTimeRate(),
		"profile_completeness":       p.GetProfileCompleteness(),
		"stripe_onboarding_complete": p.GetStripeOnboardingComplete(),
		"member_since":               formatTimestamp(p.GetMemberSince()),
	}

	if loc := p.GetServiceLocation(); loc != nil {
		result["service_location"] = map[string]float64{
			"latitude":  loc.GetLatitude(),
			"longitude": loc.GetLongitude(),
		}
	}

	milestones := make([]map[string]interface{}, 0, len(p.GetDefaultMilestones()))
	for _, m := range p.GetDefaultMilestones() {
		milestones = append(milestones, map[string]interface{}{
			"description": m.GetDescription(),
			"percentage":  m.GetPercentage(),
		})
	}
	result["default_milestones"] = milestones

	cats := make([]map[string]interface{}, 0, len(p.GetServiceCategories()))
	for _, c := range p.GetServiceCategories() {
		cats = append(cats, map[string]interface{}{
			"id":          c.GetId(),
			"name":        c.GetName(),
			"slug":        c.GetSlug(),
			"level":       c.GetLevel(),
			"parent_name": c.GetParentName(),
		})
	}
	result["service_categories"] = cats

	portfolio := make([]map[string]interface{}, 0, len(p.GetPortfolio()))
	for _, img := range p.GetPortfolio() {
		portfolio = append(portfolio, map[string]interface{}{
			"id":         img.GetId(),
			"image_url":  img.GetImageUrl(),
			"caption":    img.GetCaption(),
			"sort_order": img.GetSortOrder(),
		})
	}
	result["portfolio"] = portfolio

	return result
}
