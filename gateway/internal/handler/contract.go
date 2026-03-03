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

// ContractHandler handles HTTP endpoints for contracts.
type ContractHandler struct {
	contractClient contractv1.ContractServiceClient
}

// NewContractHandler creates a new ContractHandler.
func NewContractHandler(contractClient contractv1.ContractServiceClient) *ContractHandler {
	return &ContractHandler{contractClient: contractClient}
}

// GetContract handles GET /api/v1/contracts/{id}.
func (h *ContractHandler) GetContract(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	resp, err := h.contractClient.GetContract(r.Context(), &contractv1.GetContractRequest{
		ContractId:       contractID,
		RequestingUserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := protoContractToJSON(resp.GetContract())
	if len(resp.GetChangeOrders()) > 0 {
		orders := make([]map[string]interface{}, 0, len(resp.GetChangeOrders()))
		for _, co := range resp.GetChangeOrders() {
			orders = append(orders, protoChangeOrderToJSON(co))
		}
		result["change_orders"] = orders
	}

	writeJSON(w, http.StatusOK, result)
}

// AcceptContract handles POST /api/v1/contracts/{id}/accept.
func (h *ContractHandler) AcceptContract(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	resp, err := h.contractClient.AcceptContract(r.Context(), &contractv1.AcceptContractRequest{
		ContractId: contractID,
		UserId:     claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoContractToJSON(resp.GetContract()))
}

// StartWork handles POST /api/v1/contracts/{id}/start.
func (h *ContractHandler) StartWork(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	resp, err := h.contractClient.StartWork(r.Context(), &contractv1.StartWorkRequest{
		ContractId: contractID,
		ProviderId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoContractToJSON(resp.GetContract()))
}

// ListContracts handles GET /api/v1/contracts.
func (h *ContractHandler) ListContracts(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()

	grpcReq := &contractv1.ListContractsRequest{
		UserId: claims.UserID,
	}

	if statusStr := q.Get("status"); statusStr != "" {
		st := stringToContractStatus(statusStr)
		grpcReq.StatusFilter = &st
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

	resp, err := h.contractClient.ListContracts(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	contracts := make([]map[string]interface{}, 0, len(resp.GetContracts()))
	for _, c := range resp.GetContracts() {
		contracts = append(contracts, protoContractToJSON(c))
	}

	result := map[string]interface{}{
		"contracts": contracts,
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

// SubmitMilestone handles POST /api/v1/milestones/{id}/submit.
func (h *ContractHandler) SubmitMilestone(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	milestoneID := chi.URLParam(r, "id")
	if milestoneID == "" {
		writeError(w, http.StatusBadRequest, "milestone id required")
		return
	}

	resp, err := h.contractClient.SubmitMilestone(r.Context(), &contractv1.SubmitMilestoneRequest{
		MilestoneId: milestoneID,
		ProviderId:  claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoMilestoneToJSON(resp.GetMilestone()))
}

// ApproveMilestone handles POST /api/v1/milestones/{id}/approve.
func (h *ContractHandler) ApproveMilestone(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	milestoneID := chi.URLParam(r, "id")
	if milestoneID == "" {
		writeError(w, http.StatusBadRequest, "milestone id required")
		return
	}

	resp, err := h.contractClient.ApproveMilestone(r.Context(), &contractv1.ApproveMilestoneRequest{
		MilestoneId: milestoneID,
		CustomerId:  claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoMilestoneToJSON(resp.GetMilestone()))
}

type requestRevisionRequest struct {
	RevisionNotes string `json:"revision_notes"`
}

// RequestRevision handles POST /api/v1/milestones/{id}/revision.
func (h *ContractHandler) RequestRevision(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	milestoneID := chi.URLParam(r, "id")
	if milestoneID == "" {
		writeError(w, http.StatusBadRequest, "milestone id required")
		return
	}

	var req requestRevisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	resp, err := h.contractClient.RequestRevision(r.Context(), &contractv1.RequestRevisionRequest{
		MilestoneId:   milestoneID,
		CustomerId:    claims.UserID,
		RevisionNotes: req.RevisionNotes,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoMilestoneToJSON(resp.GetMilestone()))
}

// MarkComplete handles POST /api/v1/contracts/{id}/complete.
func (h *ContractHandler) MarkComplete(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	resp, err := h.contractClient.MarkComplete(r.Context(), &contractv1.MarkCompleteRequest{
		ContractId: contractID,
		ProviderId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoContractToJSON(resp.GetContract()))
}

// ApproveCompletion handles POST /api/v1/contracts/{id}/approve-completion.
func (h *ContractHandler) ApproveCompletion(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	resp, err := h.contractClient.ApproveCompletion(r.Context(), &contractv1.ApproveCompletionRequest{
		ContractId: contractID,
		CustomerId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoContractToJSON(resp.GetContract()))
}

type cancelContractRequest struct {
	Reason string `json:"reason"`
}

// CancelContract handles POST /api/v1/contracts/{id}/cancel.
func (h *ContractHandler) CancelContract(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	var req cancelContractRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	resp, err := h.contractClient.CancelContract(r.Context(), &contractv1.CancelContractRequest{
		ContractId: contractID,
		UserId:     claims.UserID,
		Reason:     req.Reason,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoContractToJSON(resp.GetContract()))
}

// --- Proto to JSON conversion helpers ---

func protoContractToJSON(c *contractv1.Contract) map[string]interface{} {
	if c == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":                  c.GetId(),
		"contract_number":     c.GetContractNumber(),
		"job_id":              c.GetJobId(),
		"customer_id":         c.GetCustomerId(),
		"provider_id":         c.GetProviderId(),
		"bid_id":              c.GetBidId(),
		"amount_cents":        c.GetAmountCents(),
		"payment_timing":      contractPaymentTimingToString(c.GetPaymentTiming()),
		"status":              contractStatusToString(c.GetStatus()),
		"customer_accepted":   c.GetCustomerAccepted(),
		"provider_accepted":   c.GetProviderAccepted(),
		"acceptance_deadline": formatTimestamp(c.GetAcceptanceDeadline()),
		"created_at":          formatTimestamp(c.GetCreatedAt()),
	}

	if c.GetAcceptedAt() != nil {
		result["accepted_at"] = formatTimestamp(c.GetAcceptedAt())
	}
	if c.GetStartedAt() != nil {
		result["started_at"] = formatTimestamp(c.GetStartedAt())
	}
	if c.GetCompletedAt() != nil {
		result["completed_at"] = formatTimestamp(c.GetCompletedAt())
	}

	if len(c.GetMilestones()) > 0 {
		milestones := make([]map[string]interface{}, 0, len(c.GetMilestones()))
		for _, m := range c.GetMilestones() {
			milestones = append(milestones, protoMilestoneToJSON(m))
		}
		result["milestones"] = milestones
	}

	return result
}

func protoMilestoneToJSON(m *contractv1.Milestone) map[string]interface{} {
	if m == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":             m.GetId(),
		"contract_id":    m.GetContractId(),
		"description":    m.GetDescription(),
		"amount_cents":   m.GetAmountCents(),
		"sort_order":     m.GetSortOrder(),
		"status":         milestoneStatusToString(m.GetStatus()),
		"revision_count": m.GetRevisionCount(),
		"revision_notes": m.GetRevisionNotes(),
	}

	if m.GetSubmittedAt() != nil {
		result["submitted_at"] = formatTimestamp(m.GetSubmittedAt())
	}
	if m.GetApprovedAt() != nil {
		result["approved_at"] = formatTimestamp(m.GetApprovedAt())
	}

	return result
}

func protoChangeOrderToJSON(co *contractv1.ChangeOrder) map[string]interface{} {
	if co == nil {
		return map[string]interface{}{}
	}

	return map[string]interface{}{
		"id":                 co.GetId(),
		"contract_id":        co.GetContractId(),
		"proposed_by":        co.GetProposedBy(),
		"description":        co.GetDescription(),
		"amount_delta_cents": co.GetAmountDeltaCents(),
		"status":             co.GetStatus(),
		"created_at":         formatTimestamp(co.GetCreatedAt()),
	}
}

// --- Enum conversions ---

func contractStatusToString(s contractv1.ContractStatus) string {
	switch s {
	case contractv1.ContractStatus_CONTRACT_STATUS_PENDING_ACCEPTANCE:
		return "pending_acceptance"
	case contractv1.ContractStatus_CONTRACT_STATUS_ACTIVE:
		return "active"
	case contractv1.ContractStatus_CONTRACT_STATUS_COMPLETED:
		return "completed"
	case contractv1.ContractStatus_CONTRACT_STATUS_CANCELLED:
		return "cancelled"
	case contractv1.ContractStatus_CONTRACT_STATUS_VOIDED:
		return "voided"
	case contractv1.ContractStatus_CONTRACT_STATUS_DISPUTED:
		return "disputed"
	case contractv1.ContractStatus_CONTRACT_STATUS_ABANDONED:
		return "abandoned"
	case contractv1.ContractStatus_CONTRACT_STATUS_SUSPENDED:
		return "suspended"
	default:
		return "unspecified"
	}
}

func stringToContractStatus(s string) contractv1.ContractStatus {
	switch s {
	case "pending_acceptance":
		return contractv1.ContractStatus_CONTRACT_STATUS_PENDING_ACCEPTANCE
	case "active":
		return contractv1.ContractStatus_CONTRACT_STATUS_ACTIVE
	case "completed":
		return contractv1.ContractStatus_CONTRACT_STATUS_COMPLETED
	case "cancelled":
		return contractv1.ContractStatus_CONTRACT_STATUS_CANCELLED
	case "voided":
		return contractv1.ContractStatus_CONTRACT_STATUS_VOIDED
	case "disputed":
		return contractv1.ContractStatus_CONTRACT_STATUS_DISPUTED
	case "abandoned":
		return contractv1.ContractStatus_CONTRACT_STATUS_ABANDONED
	case "suspended":
		return contractv1.ContractStatus_CONTRACT_STATUS_SUSPENDED
	default:
		return contractv1.ContractStatus_CONTRACT_STATUS_UNSPECIFIED
	}
}

func milestoneStatusToString(s contractv1.MilestoneStatus) string {
	switch s {
	case contractv1.MilestoneStatus_MILESTONE_STATUS_PENDING:
		return "pending"
	case contractv1.MilestoneStatus_MILESTONE_STATUS_IN_PROGRESS:
		return "in_progress"
	case contractv1.MilestoneStatus_MILESTONE_STATUS_SUBMITTED:
		return "submitted"
	case contractv1.MilestoneStatus_MILESTONE_STATUS_APPROVED:
		return "approved"
	case contractv1.MilestoneStatus_MILESTONE_STATUS_DISPUTED:
		return "disputed"
	case contractv1.MilestoneStatus_MILESTONE_STATUS_REVISION_REQUESTED:
		return "revision_requested"
	default:
		return "unspecified"
	}
}

func contractPaymentTimingToString(pt commonv1.PaymentTiming) string {
	switch pt {
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
		return "unspecified"
	}
}
