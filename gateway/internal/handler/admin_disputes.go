package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminDisputesHandler handles admin dispute management endpoints.
type AdminDisputesHandler struct {
	contractClient contractv1.ContractServiceClient
}

// NewAdminDisputesHandler creates a new AdminDisputesHandler.
func NewAdminDisputesHandler(contractClient contractv1.ContractServiceClient) *AdminDisputesHandler {
	return &AdminDisputesHandler{contractClient: contractClient}
}

// ListDisputes handles GET /api/v1/admin/disputes.
// Query params: status, page, page_size.
func (h *AdminDisputesHandler) ListDisputes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &contractv1.ListDisputesRequest{}

	// Parse optional status filter.
	if s := q.Get("status"); s != "" {
		status := parseDisputeStatus(s)
		if status != contractv1.DisputeStatus_DISPUTE_STATUS_UNSPECIFIED {
			grpcReq.StatusFilter = &status
		}
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

	resp, err := h.contractClient.ListDisputes(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	disputes := make([]map[string]interface{}, 0, len(resp.GetDisputes()))
	for _, d := range resp.GetDisputes() {
		disputes = append(disputes, disputeToJSON(d))
	}

	result := map[string]interface{}{
		"disputes": disputes,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

// GetDispute handles GET /api/v1/admin/disputes/{id}.
func (h *AdminDisputesHandler) GetDispute(w http.ResponseWriter, r *http.Request) {
	disputeID := chi.URLParam(r, "id")
	if disputeID == "" {
		writeError(w, http.StatusBadRequest, "dispute id required")
		return
	}

	resp, err := h.contractClient.GetDispute(r.Context(), &contractv1.GetDisputeRequest{
		DisputeId: disputeID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"dispute": disputeToJSON(resp.GetDispute()),
	})
}

// ResolveDispute handles POST /api/v1/admin/disputes/{id}/resolve.
func (h *AdminDisputesHandler) ResolveDispute(w http.ResponseWriter, r *http.Request) {
	disputeID := chi.URLParam(r, "id")
	if disputeID == "" {
		writeError(w, http.StatusBadRequest, "dispute id required")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		ResolutionType    string `json:"resolution_type"`
		ResolutionNotes   string `json:"resolution_notes"`
		RefundAmountCents int64  `json:"refund_amount_cents"`
		GuaranteeOutcome  string `json:"guarantee_outcome"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	resp, err := h.contractClient.AdminResolveDispute(r.Context(), &contractv1.AdminResolveDisputeRequest{
		DisputeId:         disputeID,
		AdminId:           claims.UserID,
		ResolutionType:    body.ResolutionType,
		ResolutionNotes:   body.ResolutionNotes,
		RefundAmountCents: body.RefundAmountCents,
		GuaranteeOutcome:  body.GuaranteeOutcome,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"dispute": disputeToJSON(resp.GetDispute()),
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func disputeToJSON(d *contractv1.Dispute) map[string]interface{} {
	if d == nil {
		return map[string]interface{}{}
	}
	result := map[string]interface{}{
		"id":                 d.GetId(),
		"contract_id":       d.GetContractId(),
		"opened_by":         d.GetOpenedBy(),
		"dispute_type":      d.GetDisputeType().String(),
		"description":       d.GetDescription(),
		"status":            d.GetStatus().String(),
		"is_guarantee_claim": d.GetIsGuaranteeClaim(),
		"created_at":        formatTimestamp(d.GetCreatedAt()),
	}
	if d.GetResolvedAt() != nil {
		result["resolved_at"] = formatTimestamp(d.GetResolvedAt())
	}
	if d.GetResolutionType() != "" {
		result["resolution_type"] = d.GetResolutionType()
	}
	if d.GetResolutionNotes() != "" {
		result["resolution_notes"] = d.GetResolutionNotes()
	}
	return result
}

func parseDisputeStatus(s string) contractv1.DisputeStatus {
	switch s {
	case "open":
		return contractv1.DisputeStatus_DISPUTE_STATUS_OPEN
	case "under_review":
		return contractv1.DisputeStatus_DISPUTE_STATUS_UNDER_REVIEW
	case "resolved":
		return contractv1.DisputeStatus_DISPUTE_STATUS_RESOLVED
	case "escalated":
		return contractv1.DisputeStatus_DISPUTE_STATUS_ESCALATED
	case "closed":
		return contractv1.DisputeStatus_DISPUTE_STATUS_CLOSED
	default:
		return contractv1.DisputeStatus_DISPUTE_STATUS_UNSPECIFIED
	}
}
