package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	subscriptionv1 "github.com/nomarkup/nomarkup/proto/subscription/v1"
)

// Free-tier digital caps from services/payment/internal/service/subscription.go
// GetUsage defaults. Applied to iOS while APP_STORE_IAP_VERIFY is off so a
// website Stripe plan cannot unlock digital entitlements on iOS (ASR-3.1.3.b.1).
const (
	iosFreeMaxActiveBids        int32   = 3
	iosFreeMaxServiceCategories int32   = 1
	iosFreeMaxPortfolioImages   int32   = 5
	iosFreeFeePercentage        float64 = 0.10
)

const noMarkupClientHeader = "X-NoMarkup-Client"

func isIOSClientWithoutIAPVerify(r *http.Request) bool {
	if r == nil || appStoreIAPVerifyEnabled() {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get(noMarkupClientHeader)), "ios")
}

// iosFreeTierPaidFeature is the free-tier CheckFeatureAccess mapping for
// Stripe-paid digital features. Unknown/basic features are not gated here.
func iosFreeTierPaidFeature(feature string) (requiredTier string, paid bool) {
	switch feature {
	case "analytics":
		return "pro", true
	case "featured_placement", "instant":
		return "business", true
	default:
		return "", false
	}
}

// SubscriptionHandler handles HTTP endpoints for subscriptions.
type SubscriptionHandler struct {
	client subscriptionv1.SubscriptionServiceClient
}

// NewSubscriptionHandler creates a new SubscriptionHandler.
func NewSubscriptionHandler(client subscriptionv1.SubscriptionServiceClient) *SubscriptionHandler {
	return &SubscriptionHandler{client: client}
}

// ListTiers handles GET /api/v1/subscriptions/tiers (public).
func (h *SubscriptionHandler) ListTiers(w http.ResponseWriter, r *http.Request) {
	resp, err := h.client.ListTiers(r.Context(), &subscriptionv1.ListTiersRequest{})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	tiers := make([]map[string]interface{}, 0, len(resp.GetTiers()))
	for _, t := range resp.GetTiers() {
		tiers = append(tiers, protoTierToJSON(t))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tiers": tiers,
	})
}

// GetTier handles GET /api/v1/subscriptions/tiers/{id} (public).
func (h *SubscriptionHandler) GetTier(w http.ResponseWriter, r *http.Request) {
	tierID := chi.URLParam(r, "id")
	if tierID == "" {
		writeError(w, http.StatusBadRequest, "tier id required")
		return
	}
	if !isValidUUID(tierID) {
		writeError(w, http.StatusBadRequest, "invalid subscription tier id")
		return
	}

	resp, err := h.client.GetTier(r.Context(), &subscriptionv1.GetTierRequest{
		TierId: tierID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoTierToJSON(resp.GetTier()))
}

// GetSubscription handles GET /api/v1/subscriptions/me.
func (h *SubscriptionHandler) GetSubscription(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.client.GetSubscription(r.Context(), &subscriptionv1.GetSubscriptionRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	if isIOSClientWithoutIAPVerify(r) || resp.GetSubscription() == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"subscription": nil,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"subscription": protoSubscriptionToJSON(resp.GetSubscription()),
	})
}

type createSubscriptionRequest struct {
	TierID          string `json:"tier_id"`
	BillingInterval string `json:"billing_interval"`
	PaymentMethodID string `json:"payment_method_id"`
}

// CreateSubscription handles POST /api/v1/subscriptions.
func (h *SubscriptionHandler) CreateSubscription(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req createSubscriptionRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	// Validate the tier id up front like GetTier/ChangeTier do; a malformed UUID
	// otherwise reaches the uuid-typed tier lookup and 500s on this money path.
	if !isValidUUID(req.TierID) {
		writeError(w, http.StatusBadRequest, "invalid subscription tier id")
		return
	}

	resp, err := h.client.CreateSubscription(r.Context(), &subscriptionv1.CreateSubscriptionRequest{
		UserId:          claims.UserID,
		TierId:          req.TierID,
		BillingInterval: stringToBillingIntervalProto(req.BillingInterval),
		PaymentMethodId: req.PaymentMethodID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := map[string]interface{}{
		"subscription": protoSubscriptionToJSON(resp.GetSubscription()),
	}
	if resp.GetClientSecret() != "" {
		result["client_secret"] = resp.GetClientSecret()
	}

	writeJSON(w, http.StatusCreated, result)
}

type cancelSubscriptionRequest struct {
	Reason            string `json:"reason"`
	CancelImmediately bool   `json:"cancel_immediately"`
}

// CancelSubscription handles POST /api/v1/subscriptions/cancel.
func (h *SubscriptionHandler) CancelSubscription(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req cancelSubscriptionRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.client.CancelSubscription(r.Context(), &subscriptionv1.CancelSubscriptionRequest{
		UserId:            claims.UserID,
		Reason:            req.Reason,
		CancelImmediately: req.CancelImmediately,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"subscription": protoSubscriptionToJSON(resp.GetSubscription()),
	})
}

type changeTierRequest struct {
	NewTierID       string `json:"new_tier_id"`
	BillingInterval string `json:"billing_interval"`
}

// ChangeTier handles POST /api/v1/subscriptions/change-tier.
func (h *SubscriptionHandler) ChangeTier(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req changeTierRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate the UUID before the gRPC call so a malformed new_tier_id
	// returns 400 (not a 500 from the downstream service). A valid-but-missing
	// UUID still correctly 404s downstream.
	if !isValidUUID(req.NewTierID) {
		writeError(w, http.StatusBadRequest, "invalid tier id")
		return
	}

	resp, err := h.client.ChangeSubscriptionTier(r.Context(), &subscriptionv1.ChangeSubscriptionTierRequest{
		UserId:          claims.UserID,
		NewTierId:       req.NewTierID,
		BillingInterval: stringToBillingIntervalProto(req.BillingInterval),
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"subscription":           protoSubscriptionToJSON(resp.GetSubscription()),
		"proration_amount_cents": resp.GetProrationAmountCents(),
	})
}

// GetUsage handles GET /api/v1/subscriptions/usage.
func (h *SubscriptionHandler) GetUsage(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.client.GetUsage(r.Context(), &subscriptionv1.GetUsageRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	maxActiveBids := resp.GetMaxActiveBids()
	maxServiceCategories := resp.GetMaxServiceCategories()
	maxPortfolioImages := resp.GetMaxPortfolioImages()
	feePercentage := resp.GetCurrentFeePercentage()
	if isIOSClientWithoutIAPVerify(r) {
		maxActiveBids = iosFreeMaxActiveBids
		maxServiceCategories = iosFreeMaxServiceCategories
		maxPortfolioImages = iosFreeMaxPortfolioImages
		feePercentage = iosFreeFeePercentage
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"active_bids":            resp.GetActiveBids(),
		"max_active_bids":        maxActiveBids,
		"service_categories":     resp.GetServiceCategories(),
		"max_service_categories": maxServiceCategories,
		"portfolio_images":       resp.GetPortfolioImages(),
		"max_portfolio_images":   maxPortfolioImages,
		"current_fee_percentage": feePercentage,
	})
}

// CheckFeatureAccess handles GET /api/v1/subscriptions/features/{feature}.
func (h *SubscriptionHandler) CheckFeatureAccess(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	feature := chi.URLParam(r, "feature")
	if feature == "" {
		writeError(w, http.StatusBadRequest, "feature name required")
		return
	}

	resp, err := h.client.CheckFeatureAccess(r.Context(), &subscriptionv1.CheckFeatureAccessRequest{
		UserId:  claims.UserID,
		Feature: feature,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	hasAccess := resp.GetHasAccess()
	requiredTier := resp.GetRequiredTier()
	if isIOSClientWithoutIAPVerify(r) {
		if required, paid := iosFreeTierPaidFeature(feature); paid && hasAccess {
			hasAccess = false
			requiredTier = required
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"has_access":    hasAccess,
		"required_tier": requiredTier,
	})
}

// ListInvoices handles GET /api/v1/subscriptions/invoices.
func (h *SubscriptionHandler) ListInvoices(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()
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

	resp, err := h.client.ListInvoices(r.Context(), &subscriptionv1.ListInvoicesRequest{
		UserId: claims.UserID,
		Pagination: &commonv1.PaginationRequest{
			Page:     page,
			PageSize: pageSize,
		},
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	invoices := make([]map[string]interface{}, 0, len(resp.GetInvoices()))
	for _, inv := range resp.GetInvoices() {
		invoices = append(invoices, protoInvoiceToJSON(inv))
	}

	result := map[string]interface{}{
		"invoices": invoices,
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

	writeJSON(w, http.StatusOK, result)
}

// --- Proto to JSON conversion helpers ---

func protoTierToJSON(t *subscriptionv1.SubscriptionTier) map[string]interface{} {
	if t == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"id":                      t.GetId(),
		"name":                    t.GetName(),
		"slug":                    t.GetSlug(),
		"monthly_price_cents":     t.GetMonthlyPriceCents(),
		"annual_price_cents":      t.GetAnnualPriceCents(),
		"fee_discount_percentage": t.GetFeeDiscountPercentage(),
		"max_active_bids":         t.GetMaxActiveBids(),
		"max_service_categories":  t.GetMaxServiceCategories(),
		"featured_placement":      t.GetFeaturedPlacement(),
		"analytics_access":        t.GetAnalyticsAccess(),
		"priority_support":        t.GetPrioritySupport(),
		"verified_badge_boost":    t.GetVerifiedBadgeBoost(),
		"portfolio_image_limit":   t.GetPortfolioImageLimit(),
		"instant_enabled":         t.GetInstantEnabled(),
		"sort_order":              t.GetSortOrder(),
		"is_active":               t.GetIsActive(),
		"created_at":              formatTimestamp(t.GetCreatedAt()),
	}
}

func protoSubscriptionToJSON(sub *subscriptionv1.Subscription) map[string]interface{} {
	if sub == nil {
		return map[string]interface{}{}
	}
	result := map[string]interface{}{
		"id":                     sub.GetId(),
		"user_id":                sub.GetUserId(),
		"tier_id":                sub.GetTierId(),
		"status":                 subscriptionStatusToString(sub.GetStatus()),
		"billing_interval":       billingIntervalToString(sub.GetBillingInterval()),
		"current_price_cents":    sub.GetCurrentPriceCents(),
		"stripe_subscription_id": sub.GetStripeSubscriptionId(),
		"current_period_start":   formatTimestamp(sub.GetCurrentPeriodStart()),
		"current_period_end":     formatTimestamp(sub.GetCurrentPeriodEnd()),
		"created_at":             formatTimestamp(sub.GetCreatedAt()),
	}
	if sub.GetTier() != nil {
		result["tier"] = protoTierToJSON(sub.GetTier())
	}
	if sub.GetTrialEnd() != nil {
		result["trial_end"] = formatTimestamp(sub.GetTrialEnd())
	}
	if sub.GetCancelledAt() != nil {
		result["cancelled_at"] = formatTimestamp(sub.GetCancelledAt())
	}
	return result
}

func protoInvoiceToJSON(inv *subscriptionv1.Invoice) map[string]interface{} {
	if inv == nil {
		return map[string]interface{}{}
	}
	result := map[string]interface{}{
		"id":                inv.GetId(),
		"subscription_id":   inv.GetSubscriptionId(),
		"stripe_invoice_id": inv.GetStripeInvoiceId(),
		"amount_cents":      inv.GetAmountCents(),
		"status":            inv.GetStatus(),
		"pdf_url":           inv.GetPdfUrl(),
		"period_start":      formatTimestamp(inv.GetPeriodStart()),
		"period_end":        formatTimestamp(inv.GetPeriodEnd()),
	}
	if inv.GetPaidAt() != nil {
		result["paid_at"] = formatTimestamp(inv.GetPaidAt())
	}
	return result
}

func subscriptionStatusToString(s subscriptionv1.SubscriptionStatus) string {
	switch s {
	case subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE:
		return "active"
	case subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_PAST_DUE:
		return "past_due"
	case subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_CANCELLED:
		return "cancelled"
	case subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_EXPIRED:
		return "expired"
	case subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_TRIALING:
		return "trialing"
	default:
		return "unspecified"
	}
}

func billingIntervalToString(b subscriptionv1.BillingInterval) string {
	switch b {
	case subscriptionv1.BillingInterval_BILLING_INTERVAL_MONTHLY:
		return "monthly"
	case subscriptionv1.BillingInterval_BILLING_INTERVAL_ANNUAL:
		return "annual"
	default:
		return "unspecified"
	}
}

func stringToBillingIntervalProto(s string) subscriptionv1.BillingInterval {
	switch s {
	case "monthly":
		return subscriptionv1.BillingInterval_BILLING_INTERVAL_MONTHLY
	case "annual":
		return subscriptionv1.BillingInterval_BILLING_INTERVAL_ANNUAL
	default:
		return subscriptionv1.BillingInterval_BILLING_INTERVAL_UNSPECIFIED
	}
}
