package handler

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
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
	if !decodeJSON(w, r, &req) {
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
		ProviderId:  claims.UserID,
		ContractId:  req.ContractID,
		AmountCents: req.AmountCents,
	})
	if err != nil {
		if strings.Contains(err.Error(), "declined") {
			writeError(w, http.StatusUnprocessableEntity,
				"Advance declined: your business credit score is below the minimum to qualify right now. Complete and repay more jobs on time to build it up.")
			return
		}
		if strings.Contains(err.Error(), "exceeds available credit") {
			writeError(w, http.StatusUnprocessableEntity,
				"Advance declined: the requested amount exceeds your available credit. Check your credit limit and reduce the amount, or repay outstanding advances to free up credit.")
			return
		}
		slog.Error("request advance gRPC call failed", "error", err, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	advanceJSON := protoAdvanceToJSON(resp.GetAdvance())

	// Surface WHY the fee is what it is on the creation response so the borrower
	// sees the pricing rationale inline (APR, base rate, risk grade) instead of
	// having to cross-reference the separate /credit-limit quote. We recompute
	// the score via the same authoritative gRPC path the credit-limit uses; the
	// payment service is the authority that actually charged the fee, and the
	// per-advance fee_breakdown above is the source of truth for the amounts.
	if cl, clErr := h.paymentClient.GetCreditLimit(r.Context(), &paymentv1.GetCreditLimitRequest{
		ProviderId: claims.UserID,
	}); clErr == nil {
		var onTimeRate *float64
		if v := cl.GetOnTimeRate(); v > 0 {
			onTimeRate = &v
		}
		score := businessCreditScore(onTimeRate, int(cl.GetJobsCompleted()), cl.GetTotalEarningsCents())
		aprBps := dynamicAPRBps(score)
		advanceJSON["pricing"] = map[string]interface{}{
			"business_credit_score": score,
			"credit_grade":          creditGrade(score),
			"base_rate_bps":         baseAdvanceRateBps(),
			"apr_bps":               aprBps,
			"term_days":             defaultAdvanceTermDays,
		}
	} else {
		slog.Warn("could not attach advance pricing rationale; fee breakdown still present",
			"error", clErr, "provider_id", claims.UserID)
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"advance": advanceJSON,
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

	resp, err := h.paymentClient.GetAdvance(r.Context(), &paymentv1.GetAdvanceRequest{
		AdvanceId: advanceID,
	})
	if err != nil {
		slog.Error("get advance gRPC call failed", "error", err, "advance_id", advanceID)
		writeGRPCError(w, err)
		return
	}

	// Ownership check (IDOR guard): this is the provider-facing `/me/` route, so
	// the advance MUST belong to the calling provider. The payment service fetches
	// by id only, so enforce ownership here against the verified JWT subject.
	// Respond 404 (not 403) so a non-owner cannot even confirm the id exists.
	advance := resp.GetAdvance()
	if advance == nil || advance.GetProviderId() != claims.UserID {
		slog.Warn("advance ownership check failed",
			"advance_id", advanceID, "caller_provider_id", claims.UserID)
		writeError(w, http.StatusNotFound, "advance not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advance": protoAdvanceToJSON(advance),
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
	if !decodeJSON(w, r, &req) {
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
		"provider_id":             resp.GetProviderId(),
		"max_advance_cents":       resp.GetMaxAdvanceCents(),
		"total_outstanding_cents": resp.GetTotalOutstandingCents(),
		// Web contract (CreditLimit) reads `available_cents`; keep this key in
		// sync with it so the provider dashboard renders the real number instead
		// of NaN.
		"available_cents":      resp.GetAvailableAdvanceCents(),
		"risk_score":           resp.GetRiskScore(),
		"jobs_completed":       resp.GetJobsCompleted(),
		"total_earnings_cents": resp.GetTotalEarningsCents(),
		"avg_job_value_cents":  resp.GetAvgJobValueCents(),
		"on_time_rate":         resp.GetOnTimeRate(),
		"last_computed_at":     nil,
	}
	if resp.GetLastComputedAt() != nil {
		result["last_computed_at"] = formatTimestamp(resp.GetLastComputedAt())
	}

	// Risk-based pricing quote: business credit score → grade → dynamic APR.
	// A zero on-time rate is treated as "no advance history" (neutral); the
	// payment service is authoritative at charge time.
	var onTimeRate *float64
	if v := resp.GetOnTimeRate(); v > 0 {
		onTimeRate = &v
	}
	score := businessCreditScore(onTimeRate, int(resp.GetJobsCompleted()), resp.GetTotalEarningsCents())
	grade := creditGrade(score)
	result["business_credit_score"] = score
	result["credit_grade"] = grade
	result["base_rate_bps"] = baseAdvanceRateBps()
	result["apr_bps"] = dynamicAPRBps(score)
	result["eligible"] = score >= minLendingScore

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"credit_limit": result,
	})
}

// --- Proto to JSON helper ---

func protoAdvanceToJSON(a *paymentv1.Advance) map[string]interface{} {
	if a == nil {
		return map[string]interface{}{}
	}

	// Transparent, itemized fee breakdown (founder rule: "be very transparent
	// on all fees, hide nothing"). All values below are derived directly from
	// the stored advance — no recomputation, so they can never drift from what
	// the provider was actually charged:
	//   fee_cents          = service_fee_cents + interest_cents
	//   total_repayable    = principal + fee_cents
	principal := a.GetAdvanceAmountCents()
	serviceFee := a.GetServiceFeeCents()
	interest := a.GetFeeCents() - serviceFee
	if interest < 0 {
		interest = 0
	}

	result := map[string]interface{}{
		"id":                   a.GetId(),
		"provider_id":          a.GetProviderId(),
		"contract_id":          a.GetContractId(),
		"advance_amount_cents": principal,
		"fee_cents":            a.GetFeeCents(),
		// Itemized fee breakdown — what makes up fee_cents.
		"fee_breakdown": map[string]interface{}{
			"service_fee_cents": serviceFee, // flat 3% origination on principal
			"service_fee_rate":  advanceServiceFeeRate,
			"interest_cents":    interest, // prorated APR interest over the term
			"term_days":         defaultAdvanceTermDays,
			"total_fee_cents":   a.GetFeeCents(),
		},
		"total_repayable_cents": principal + a.GetFeeCents(),
		"repaid_cents":          a.GetRepaidCents(),
		"status":                a.GetStatus(),
		"reviewed_by":           nil,
		"reviewed_at":           nil,
		"rejection_reason":      nil,
		"disbursed_at":          nil,
		"repaid_at":             nil,
		"stripe_transfer_id":    nil,
		"created_at":            formatTimestamp(a.GetCreatedAt()),
		"updated_at":            formatTimestamp(a.GetUpdatedAt()),
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
