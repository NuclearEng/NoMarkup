package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminPaymentsHandler handles admin payment management endpoints.
type AdminPaymentsHandler struct {
	paymentClient paymentv1.PaymentServiceClient
}

// NewAdminPaymentsHandler creates a new AdminPaymentsHandler.
func NewAdminPaymentsHandler(paymentClient paymentv1.PaymentServiceClient) *AdminPaymentsHandler {
	return &AdminPaymentsHandler{paymentClient: paymentClient}
}

// ListPayments handles GET /api/v1/admin/payments.
// Query params: user_id, status, start_date, end_date, page, page_size.
func (h *AdminPaymentsHandler) ListPayments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &paymentv1.AdminListPaymentsRequest{}

	// Parse optional user_id filter.
	if uid := q.Get("user_id"); uid != "" {
		grpcReq.UserId = &uid
	}

	// Parse optional status filter.
	if s := q.Get("status"); s != "" {
		status := parsePaymentStatus(s)
		if status != paymentv1.PaymentStatus_PAYMENT_STATUS_UNSPECIFIED {
			grpcReq.StatusFilter = &status
		}
	}

	// Parse optional date range.
	dateRange := parseDateRange(q.Get("start_date"), q.Get("end_date"))
	if dateRange != nil {
		grpcReq.DateRange = dateRange
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

	resp, err := h.paymentClient.AdminListPayments(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	payments := make([]map[string]interface{}, 0, len(resp.GetPayments()))
	for _, p := range resp.GetPayments() {
		payments = append(payments, adminPaymentToJSON(p))
	}

	result := map[string]interface{}{
		"payments":           payments,
		"total_amount_cents": resp.GetTotalAmountCents(),
		"total_fees_cents":   resp.GetTotalFeesCents(),
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

// GetPaymentDetails handles GET /api/v1/admin/payments/{id}.
func (h *AdminPaymentsHandler) GetPaymentDetails(w http.ResponseWriter, r *http.Request) {
	paymentID := chi.URLParam(r, "id")
	if paymentID == "" {
		writeError(w, http.StatusBadRequest, "payment id required")
		return
	}

	resp, err := h.paymentClient.AdminGetPaymentDetails(r.Context(), &paymentv1.AdminGetPaymentDetailsRequest{
		PaymentId: paymentID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := map[string]interface{}{
		"payment": adminPaymentToJSON(resp.GetPayment()),
	}
	if resp.GetBreakdown() != nil {
		result["breakdown"] = map[string]interface{}{
			"subtotal_cents":        resp.GetBreakdown().GetSubtotalCents(),
			"platform_fee_cents":    resp.GetBreakdown().GetPlatformFeeCents(),
			"guarantee_fee_cents":   resp.GetBreakdown().GetGuaranteeFeeCents(),
			"total_cents":           resp.GetBreakdown().GetTotalCents(),
			"provider_payout_cents": resp.GetBreakdown().GetProviderPayoutCents(),
			"fee_percentage":        resp.GetBreakdown().GetFeePercentage(),
			"guarantee_percentage":  resp.GetBreakdown().GetGuaranteePercentage(),
		}
	}
	if resp.GetStripePaymentIntentId() != "" {
		result["stripe_payment_intent_id"] = resp.GetStripePaymentIntentId()
	}
	if resp.GetStripeChargeId() != "" {
		result["stripe_charge_id"] = resp.GetStripeChargeId()
	}
	if resp.GetStripeTransferId() != "" {
		result["stripe_transfer_id"] = resp.GetStripeTransferId()
	}

	writeJSON(w, http.StatusOK, result)
}

// UpdateFeeConfig handles PUT /api/v1/admin/fees.
func (h *AdminPaymentsHandler) UpdateFeeConfig(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		CategoryID          *string  `json:"category_id"`
		FeePercentage       float64  `json:"fee_percentage"`
		GuaranteePercentage float64  `json:"guarantee_percentage"`
		MinFeeCents         int64    `json:"min_fee_cents"`
		MaxFeeCents         *int64   `json:"max_fee_cents"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	grpcReq := &paymentv1.AdminUpdateFeeConfigRequest{
		AdminId:             claims.UserID,
		FeePercentage:       body.FeePercentage,
		GuaranteePercentage: body.GuaranteePercentage,
		MinFeeCents:         body.MinFeeCents,
	}
	if body.CategoryID != nil {
		grpcReq.CategoryId = body.CategoryID
	}
	if body.MaxFeeCents != nil {
		grpcReq.MaxFeeCents = body.MaxFeeCents
	}

	resp, err := h.paymentClient.AdminUpdateFeeConfig(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := map[string]interface{}{}
	if cfg := resp.GetConfig(); cfg != nil {
		result["config"] = map[string]interface{}{
			"fee_percentage":       cfg.GetFeePercentage(),
			"guarantee_percentage": cfg.GetGuaranteePercentage(),
			"min_fee_cents":        cfg.GetMinFeeCents(),
			"max_fee_cents":        cfg.GetMaxFeeCents(),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// GetRevenueReport handles GET /api/v1/admin/revenue.
// Query params: start_date, end_date, group_by.
func (h *AdminPaymentsHandler) GetRevenueReport(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &paymentv1.GetRevenueReportRequest{
		GroupBy: q.Get("group_by"),
	}

	dateRange := parseDateRange(q.Get("start_date"), q.Get("end_date"))
	if dateRange != nil {
		grpcReq.DateRange = dateRange
	}

	resp, err := h.paymentClient.GetRevenueReport(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	dataPoints := make([]map[string]interface{}, 0, len(resp.GetDataPoints()))
	for _, dp := range resp.GetDataPoints() {
		dataPoints = append(dataPoints, map[string]interface{}{
			"period_start":      formatTimestamp(dp.GetPeriodStart()),
			"gmv_cents":         dp.GetGmvCents(),
			"revenue_cents":     dp.GetRevenueCents(),
			"transaction_count": dp.GetTransactionCount(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data_points":               dataPoints,
		"total_gmv_cents":           resp.GetTotalGmvCents(),
		"total_revenue_cents":       resp.GetTotalRevenueCents(),
		"total_guarantee_fund_cents": resp.GetTotalGuaranteeFundCents(),
		"effective_take_rate":       resp.GetEffectiveTakeRate(),
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func adminPaymentToJSON(p *paymentv1.Payment) map[string]interface{} {
	if p == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"id":                    p.GetId(),
		"contract_id":          p.GetContractId(),
		"customer_id":          p.GetCustomerId(),
		"provider_id":          p.GetProviderId(),
		"amount_cents":         p.GetAmountCents(),
		"platform_fee_cents":   p.GetPlatformFeeCents(),
		"guarantee_fee_cents":  p.GetGuaranteeFeeCents(),
		"provider_payout_cents": p.GetProviderPayoutCents(),
		"status":               p.GetStatus().String(),
		"created_at":           formatTimestamp(p.GetCreatedAt()),
	}
}

func parsePaymentStatus(s string) paymentv1.PaymentStatus {
	switch s {
	case "pending":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_PENDING
	case "processing":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_PROCESSING
	case "escrow":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW
	case "released":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED
	case "completed":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_COMPLETED
	case "failed":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_FAILED
	case "refunded":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_REFUNDED
	case "partially_refunded":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_PARTIALLY_REFUNDED
	case "disputed":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_DISPUTED
	case "chargeback":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_CHARGEBACK
	default:
		return paymentv1.PaymentStatus_PAYMENT_STATUS_UNSPECIFIED
	}
}

func parseDateRange(startStr, endStr string) *commonv1.DateRange {
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
