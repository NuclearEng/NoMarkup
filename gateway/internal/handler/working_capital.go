package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// WorkingCapitalHandler handles HTTP endpoints for working capital advances.
type WorkingCapitalHandler struct {
	paymentClient paymentv1.PaymentServiceClient
}

// NewWorkingCapitalHandler creates a new WorkingCapitalHandler.
func NewWorkingCapitalHandler(paymentClient paymentv1.PaymentServiceClient) *WorkingCapitalHandler {
	return &WorkingCapitalHandler{paymentClient: paymentClient}
}

type requestAdvanceRequest struct {
	ContractID  string `json:"contract_id"`
	AmountCents int64  `json:"amount_cents"`
}

// RequestAdvance handles POST /api/v1/providers/me/advances.
func (h *WorkingCapitalHandler) RequestAdvance(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req requestAdvanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.ContractID == "" {
		writeError(w, http.StatusBadRequest, "contract_id is required")
		return
	}
	if req.AmountCents <= 0 {
		writeError(w, http.StatusBadRequest, "amount_cents must be positive")
		return
	}

	resp, err := h.paymentClient.RequestAdvance(r.Context(), &paymentv1.RequestAdvanceRequest{
		ProviderId: claims.UserID,
		ContractId: req.ContractID,
		AmountCents: req.AmountCents,
	})
	if err != nil {
		slog.Error("request advance gRPC call failed", "error", err, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"advance": protoAdvanceToJSON(resp.GetAdvance()),
	})
}

// ListMyAdvances handles GET /api/v1/providers/me/advances.
func (h *WorkingCapitalHandler) ListMyAdvances(w http.ResponseWriter, r *http.Request) {
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

	grpcReq := &paymentv1.ListAdvancesRequest{
		ProviderId: claims.UserID,
		Pagination: &commonv1.PaginationRequest{
			Page:     page,
			PageSize: pageSize,
		},
	}

	if statusFilter := q.Get("status"); statusFilter != "" {
		grpcReq.StatusFilter = &statusFilter
	}

	resp, err := h.paymentClient.ListAdvances(r.Context(), grpcReq)
	if err != nil {
		slog.Error("list advances gRPC call failed", "error", err, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	advances := make([]map[string]interface{}, 0, len(resp.GetAdvances()))
	for _, a := range resp.GetAdvances() {
		advances = append(advances, protoAdvanceToJSON(a))
	}

	result := map[string]interface{}{
		"advances": advances,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"total_count": pg.GetTotalCount(),
			"page":        pg.GetPage(),
			"page_size":   pg.GetPageSize(),
			"total_pages": pg.GetTotalPages(),
			"has_next":    pg.GetHasNext(),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// GetAdvance handles GET /api/v1/providers/me/advances/{id}.
func (h *WorkingCapitalHandler) GetAdvance(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	advanceID := chi.URLParam(r, "id")
	if advanceID == "" {
		writeError(w, http.StatusBadRequest, "advance id required")
		return
	}

	resp, err := h.paymentClient.GetAdvance(r.Context(), &paymentv1.GetAdvanceRequest{
		AdvanceId: advanceID,
	})
	if err != nil {
		slog.Error("get advance gRPC call failed", "error", err, "advance_id", advanceID)
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advance": protoAdvanceToJSON(resp.GetAdvance()),
	})
}

// AdminListAdvances handles GET /api/v1/admin/advances.
func (h *WorkingCapitalHandler) AdminListAdvances(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
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

	// Admin list: empty provider_id to get all advances.
	grpcReq := &paymentv1.ListAdvancesRequest{
		ProviderId: "",
		Pagination: &commonv1.PaginationRequest{
			Page:     page,
			PageSize: pageSize,
		},
	}

	if statusFilter := q.Get("status"); statusFilter != "" {
		grpcReq.StatusFilter = &statusFilter
	}

	resp, err := h.paymentClient.ListAdvances(r.Context(), grpcReq)
	if err != nil {
		slog.Error("admin list advances gRPC call failed", "error", err)
		writeGRPCError(w, err)
		return
	}

	advances := make([]map[string]interface{}, 0, len(resp.GetAdvances()))
	for _, a := range resp.GetAdvances() {
		advances = append(advances, protoAdvanceToJSON(a))
	}

	result := map[string]interface{}{
		"advances": advances,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"total_count": pg.GetTotalCount(),
			"page":        pg.GetPage(),
			"page_size":   pg.GetPageSize(),
			"total_pages": pg.GetTotalPages(),
			"has_next":    pg.GetHasNext(),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

type adminReviewAdvanceRequest struct {
	Action string `json:"action"`
	Reason string `json:"reason"`
}

// AdminReviewAdvance handles POST /api/v1/admin/advances/{id}/review.
func (h *WorkingCapitalHandler) AdminReviewAdvance(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	advanceID := chi.URLParam(r, "id")
	if advanceID == "" {
		writeError(w, http.StatusBadRequest, "advance id required")
		return
	}

	var req adminReviewAdvanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Action != "approve" && req.Action != "reject" {
		writeError(w, http.StatusBadRequest, "action must be 'approve' or 'reject'")
		return
	}

	resp, err := h.paymentClient.ReviewAdvance(r.Context(), &paymentv1.ReviewAdvanceRequest{
		AdvanceId:  advanceID,
		ReviewerId: claims.UserID,
		Action:     req.Action,
		Reason:     req.Reason,
	})
	if err != nil {
		slog.Error("review advance gRPC call failed", "error", err, "advance_id", advanceID, "reviewer_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advance": protoAdvanceToJSON(resp.GetAdvance()),
	})
}

// AdminDisburseAdvance handles POST /api/v1/admin/advances/{id}/disburse.
func (h *WorkingCapitalHandler) AdminDisburseAdvance(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	advanceID := chi.URLParam(r, "id")
	if advanceID == "" {
		writeError(w, http.StatusBadRequest, "advance id required")
		return
	}

	resp, err := h.paymentClient.DisburseAdvance(r.Context(), &paymentv1.DisburseAdvanceRequest{
		AdvanceId: advanceID,
		AdminId:   claims.UserID,
	})
	if err != nil {
		slog.Error("disburse advance gRPC call failed", "error", err, "advance_id", advanceID, "admin_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	result := protoAdvanceToJSON(resp.GetAdvance())
	result["stripe_transfer_id"] = resp.GetStripeTransferId()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advance": result,
	})
}

// GetCreditLimit handles GET /api/v1/providers/me/credit-limit.
func (h *WorkingCapitalHandler) GetCreditLimit(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.paymentClient.GetCreditLimit(r.Context(), &paymentv1.GetCreditLimitRequest{
		ProviderId: claims.UserID,
	})
	if err != nil {
		slog.Error("get credit limit gRPC call failed", "error", err, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	result := map[string]interface{}{
		"provider_id":            resp.GetProviderId(),
		"max_advance_cents":      resp.GetMaxAdvanceCents(),
		"total_outstanding_cents": resp.GetTotalOutstandingCents(),
		"available_advance_cents": resp.GetAvailableAdvanceCents(),
		"risk_score":             resp.GetRiskScore(),
		"jobs_completed":         resp.GetJobsCompleted(),
		"total_earnings_cents":   resp.GetTotalEarningsCents(),
		"avg_job_value_cents":    resp.GetAvgJobValueCents(),
		"on_time_rate":           resp.GetOnTimeRate(),
		"last_computed_at":       nil,
	}
	if resp.GetLastComputedAt() != nil {
		result["last_computed_at"] = formatTimestamp(resp.GetLastComputedAt())
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"credit_limit": result,
	})
}

// --- Proto to JSON helper ---

func protoAdvanceToJSON(a *paymentv1.Advance) map[string]interface{} {
	if a == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":                   a.GetId(),
		"provider_id":          a.GetProviderId(),
		"contract_id":          a.GetContractId(),
		"advance_amount_cents": a.GetAdvanceAmountCents(),
		"fee_cents":            a.GetFeeCents(),
		"repaid_cents":         a.GetRepaidCents(),
		"status":               a.GetStatus(),
		"reviewed_by":          nil,
		"reviewed_at":          nil,
		"rejection_reason":     nil,
		"disbursed_at":         nil,
		"repaid_at":            nil,
		"stripe_transfer_id":   nil,
		"created_at":           formatTimestamp(a.GetCreatedAt()),
		"updated_at":           formatTimestamp(a.GetUpdatedAt()),
	}

	if a.GetReviewedBy() != "" {
		result["reviewed_by"] = a.GetReviewedBy()
	}
	if a.GetReviewedAt() != nil {
		result["reviewed_at"] = formatTimestamp(a.GetReviewedAt())
	}
	if a.GetRejectionReason() != "" {
		result["rejection_reason"] = a.GetRejectionReason()
	}
	if a.GetDisbursedAt() != nil {
		result["disbursed_at"] = formatTimestamp(a.GetDisbursedAt())
	}
	if a.GetRepaidAt() != nil {
		result["repaid_at"] = formatTimestamp(a.GetRepaidAt())
	}
	if a.GetStripeTransferId() != "" {
		result["stripe_transfer_id"] = a.GetStripeTransferId()
	}

	return result
}
