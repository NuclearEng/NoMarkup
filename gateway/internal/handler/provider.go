package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ProviderHandler handles HTTP endpoints for provider profiles.
type ProviderHandler struct {
	userClient userv1.UserServiceClient
}

// NewProviderHandler creates a new ProviderHandler.
func NewProviderHandler(userClient userv1.UserServiceClient) *ProviderHandler {
	return &ProviderHandler{userClient: userClient}
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

	writeJSON(w, http.StatusOK, protoProviderToJSON(resp.GetProfile()))
}

// UpdateMe handles PATCH /api/v1/providers/me.
func (h *ProviderHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req updateProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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

	writeJSON(w, http.StatusOK, protoProviderToJSON(resp.GetProfile()))
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
