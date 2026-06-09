package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ContractHandler handles HTTP endpoints for contracts.
type ContractHandler struct {
	contractClient contractv1.ContractServiceClient
	// userClient resolves the customer/provider display names that enrich a
	// contract response, so the web client can render a human-readable party
	// name instead of a raw UUID (mirrors the chat channel name enrichment).
	// It may be nil in tests; enrichment then degrades to absent.
	userClient userv1.UserServiceClient
	// db is used to read fields that live on the contracts table but are not
	// carried by the contract proto/domain (e.g. tip_amount_cents, added by the
	// Wave 5 services-polish tip feature without a proto regen). It may be nil
	// in tests; the tip enrichment degrades to absent rather than erroring.
	db *pgxpool.Pool
}

// NewContractHandler creates a new ContractHandler.
func NewContractHandler(contractClient contractv1.ContractServiceClient, userClient userv1.UserServiceClient, db *pgxpool.Pool) *ContractHandler {
	return &ContractHandler{contractClient: contractClient, userClient: userClient, db: db}
}

// resolvePartyNames resolves a set of user ids → public display_name via the
// user gRPC service, deduping ids so a list makes at most one GetUser call per
// unique party. It is fail-soft: a lookup error or empty display_name leaves
// that id out of the map rather than failing the contract response. Only the
// public-safe display_name is surfaced — no other PII. Returns nil when there
// is no user client configured or no ids to resolve.
func (h *ContractHandler) resolvePartyNames(ctx context.Context, ids ...string) map[string]string {
	if h.userClient == nil {
		return nil
	}

	unique := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if id != "" {
			unique[id] = struct{}{}
		}
	}
	if len(unique) == 0 {
		return nil
	}

	names := make(map[string]string, len(unique))
	for id := range unique {
		resp, err := h.userClient.GetUser(ctx, &userv1.GetUserRequest{UserId: id})
		if err != nil {
			slog.WarnContext(ctx, "contract: resolve party name failed",
				"user_id", id, "error", err)
			continue // fail soft — omit this name
		}
		if name := resp.GetUser().GetDisplayName(); name != "" {
			names[id] = name
		}
	}

	return names
}

// enrichPartyNames adds customer_name / provider_name to an already-projected
// contract JSON map, given the resolved id→name lookup. A missing entry simply
// leaves that name absent (the web client falls back to a truncated id).
func enrichPartyNames(jc map[string]interface{}, names map[string]string) {
	if names == nil {
		return
	}
	if id, ok := jc["customer_id"].(string); ok {
		if name := names[id]; name != "" {
			jc["customer_name"] = name
		}
	}
	if id, ok := jc["provider_id"].(string); ok {
		if name := names[id]; name != "" {
			jc["provider_name"] = name
		}
	}
}

// tipAmountsByContract reads tip_amount_cents for the given contract ids in a
// single query. The tip lives on the contracts table directly (migration 046)
// but is not part of the contract proto, so the gateway projects it in. A nil
// db or query error returns an empty map — the tip simply won't be enriched,
// which is the correct fail-soft behavior for a display-only field.
func (h *ContractHandler) tipAmountsByContract(ctx context.Context, ids []string) map[string]int64 {
	out := make(map[string]int64, len(ids))
	if h.db == nil || len(ids) == 0 {
		return out
	}
	rows, err := h.db.Query(ctx,
		`SELECT id, tip_amount_cents FROM contracts WHERE id = ANY($1)`, ids)
	if err != nil {
		slog.ErrorContext(ctx, "tip enrichment query failed", "error", err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var tip int64
		if err := rows.Scan(&id, &tip); err != nil {
			slog.ErrorContext(ctx, "tip enrichment scan failed", "error", err)
			return out
		}
		out[id] = tip
	}
	return out
}

// GetContract handles GET /api/v1/contracts/{id}.
func (h *ContractHandler) GetContract(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
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
	if id := resp.GetContract().GetId(); id != "" {
		result["tip_amount_cents"] = h.tipAmountsByContract(r.Context(), []string{id})[id]
	}
	// Enrich the "Parties" display with human-readable names so the UI shows the
	// counterparty's display_name instead of a raw UUID.
	c := resp.GetContract()
	names := h.resolvePartyNames(r.Context(), c.GetCustomerId(), c.GetProviderId())
	enrichPartyNames(result, names)
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
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
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
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
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

	ids := make([]string, 0, len(resp.GetContracts()))
	partyIDs := make([]string, 0, len(resp.GetContracts())*2)
	for _, c := range resp.GetContracts() {
		if id := c.GetId(); id != "" {
			ids = append(ids, id)
		}
		partyIDs = append(partyIDs, c.GetCustomerId(), c.GetProviderId())
	}
	tips := h.tipAmountsByContract(r.Context(), ids)
	// One batched, deduped resolve for every party across the page so each row
	// can render the counterparty name instead of a raw UUID.
	names := h.resolvePartyNames(r.Context(), partyIDs...)

	contracts := make([]map[string]interface{}, 0, len(resp.GetContracts()))
	for _, c := range resp.GetContracts() {
		jc := protoContractToJSON(c)
		jc["tip_amount_cents"] = tips[c.GetId()]
		enrichPartyNames(jc, names)
		contracts = append(contracts, jc)
	}

	result := map[string]interface{}{
		"contracts": contracts,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"totalCount": pg.GetTotalCount(),
			"page":        pg.GetPage(),
			"pageSize":   pg.GetPageSize(),
			"totalPages": pg.GetTotalPages(),
			"hasNext":    pg.GetHasNext(),
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
	if !isValidUUID(milestoneID) {
		writeError(w, http.StatusBadRequest, "invalid milestone id")
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
	if !isValidUUID(milestoneID) {
		writeError(w, http.StatusBadRequest, "invalid milestone id")
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

	// Notify the provider that the customer approved their milestone. The
	// approver is always the customer, so the recipient is the contract's
	// provider, resolved from the milestone's contract_id via the gateway pool.
	// Fail-soft: a lookup miss skips the notification (the approval already
	// committed); emitNotification guards nil-db + self-notify.
	m := resp.GetMilestone()
	if h.db != nil && m.GetContractId() != "" {
		var providerID string
		if err := h.db.QueryRow(r.Context(),
			`SELECT provider_id::text FROM contracts WHERE id = $1`, m.GetContractId(),
		).Scan(&providerID); err != nil {
			slog.ErrorContext(r.Context(), "milestone approved notification: provider lookup failed",
				"error", err, "contract_id", m.GetContractId())
		} else {
			emitNotification(r.Context(), h.db,
				claims.UserID, providerID,
				"milestone_approved",
				"Milestone approved",
				"The customer approved a milestone on your contract.",
				"/contracts/"+m.GetContractId(),
				"contract", m.GetContractId(),
			)
		}
	}

	writeJSON(w, http.StatusOK, protoMilestoneToJSON(m))
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
	if !isValidUUID(milestoneID) {
		writeError(w, http.StatusBadRequest, "invalid milestone id")
		return
	}

	var req requestRevisionRequest
	if !decodeJSON(w, r, &req) {
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
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
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
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
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
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}

	// The reason is optional — the decline action in the UI sends no body, and
	// requiring one made an empty request fail with 400 ("invalid request body:
	// EOF"). Tolerate an absent/empty body; only surface malformed JSON.
	var req cancelContractRequest
	if err := decodeJSONOptional(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
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

// --- Change Order handlers ---

type createChangeOrderRequest struct {
	Description        string `json:"description"`
	AmountDeltaCents   int64  `json:"amount_delta_cents"`
}

// CreateChangeOrder handles POST /api/v1/contracts/{id}/change-orders.
func (h *ContractHandler) CreateChangeOrder(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}

	var req createChangeOrderRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.contractClient.ProposeChangeOrder(r.Context(), &contractv1.ProposeChangeOrderRequest{
		ContractId:       contractID,
		ProposedBy:       claims.UserID,
		Description:      req.Description,
		AmountDeltaCents: req.AmountDeltaCents,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, protoChangeOrderToJSON(resp.GetChangeOrder()))
}

// ListChangeOrders handles GET /api/v1/contracts/{id}/change-orders.
func (h *ContractHandler) ListChangeOrders(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}

	// Get the contract which includes change orders.
	resp, err := h.contractClient.GetContract(r.Context(), &contractv1.GetContractRequest{
		ContractId:       contractID,
		RequestingUserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	orders := make([]map[string]interface{}, 0, len(resp.GetChangeOrders()))
	for _, co := range resp.GetChangeOrders() {
		orders = append(orders, protoChangeOrderToJSON(co))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"change_orders": orders,
	})
}

type respondChangeOrderRequest struct {
	Accepted bool `json:"accepted"`
}

// RespondToChangeOrder handles PUT /api/v1/contracts/{id}/change-orders/{orderId}.
func (h *ContractHandler) RespondToChangeOrder(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	orderID := chi.URLParam(r, "orderId")
	if !isValidUUID(orderID) {
		writeError(w, http.StatusBadRequest, "invalid change order id")
		return
	}

	var req respondChangeOrderRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.contractClient.RespondToChangeOrder(r.Context(), &contractv1.RespondToChangeOrderRequest{
		ChangeOrderId: orderID,
		UserId:        claims.UserID,
		Accepted:      req.Accepted,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoChangeOrderToJSON(resp.GetChangeOrder()))
}

// --- Dispute handlers ---

type openDisputeRequest struct {
	DisputeType      string   `json:"dispute_type"`
	Description      string   `json:"description"`
	EvidenceURLs     []string `json:"evidence_urls"`
	IsGuaranteeClaim bool     `json:"is_guarantee_claim"`
}

// OpenDispute handles POST /api/v1/contracts/{id}/disputes.
func (h *ContractHandler) OpenDispute(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}

	var req openDisputeRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.contractClient.OpenDispute(r.Context(), &contractv1.OpenDisputeRequest{
		ContractId:       contractID,
		UserId:           claims.UserID,
		DisputeType:      stringToDisputeType(req.DisputeType),
		Description:      req.Description,
		EvidenceUrls:     req.EvidenceURLs,
		IsGuaranteeClaim: req.IsGuaranteeClaim,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, protoDisputeToJSON(resp.GetDispute()))
}

// --- Guarantee Claim handlers ---

type submitGuaranteeClaimRequest struct {
	Reason       string   `json:"reason"`
	Description  string   `json:"description"`
	EvidenceURLs []string `json:"evidence_urls"`
}

// SubmitGuaranteeClaim handles POST /api/v1/contracts/{id}/guarantee-claim.
// Submits a NoMarkup Guarantee claim against a completed contract.
func (h *ContractHandler) SubmitGuaranteeClaim(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}

	var req submitGuaranteeClaimRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason is required")
		return
	}
	if len(req.Description) < 50 {
		writeError(w, http.StatusBadRequest, "description must be at least 50 characters")
		return
	}

	// Map reason to dispute type.
	disputeType := stringToDisputeType(req.Reason)
	if disputeType == contractv1.DisputeType_DISPUTE_TYPE_UNSPECIFIED {
		disputeType = contractv1.DisputeType_DISPUTE_TYPE_GUARANTEE_CLAIM
	}

	resp, err := h.contractClient.OpenDispute(r.Context(), &contractv1.OpenDisputeRequest{
		ContractId:       contractID,
		UserId:           claims.UserID,
		DisputeType:      disputeType,
		Description:      req.Description,
		EvidenceUrls:     req.EvidenceURLs,
		IsGuaranteeClaim: true,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, protoDisputeToJSON(resp.GetDispute()))
}

// GetGuaranteeClaim handles GET /api/v1/contracts/{id}/guarantee-claim.
// Returns any guarantee claim filed against this contract.
func (h *ContractHandler) GetGuaranteeClaim(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}

	// List disputes for this contract filtered to guarantee claims.
	isGuarantee := true
	resp, err := h.contractClient.ListDisputes(r.Context(), &contractv1.ListDisputesRequest{
		ContractId:       &contractID,
		IsGuaranteeClaim: &isGuarantee,
		Pagination: &commonv1.PaginationRequest{
			Page:     1,
			PageSize: 1,
		},
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	// Suppress the claim if the requesting user is not a party.
	// The ListDisputes call does not enforce party check, so we verify here.
	contractResp, err := h.contractClient.GetContract(r.Context(), &contractv1.GetContractRequest{
		ContractId:       contractID,
		RequestingUserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	_ = contractResp

	if len(resp.GetDisputes()) == 0 {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"guarantee_claim": nil,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"guarantee_claim": protoDisputeToJSON(resp.GetDisputes()[0]),
	})
}

// --- No-show / Abandonment handlers ---

// ReportNoShow handles POST /api/v1/contracts/{id}/report-noshow.
func (h *ContractHandler) ReportNoShow(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}

	resp, err := h.contractClient.ReportNoShow(r.Context(), &contractv1.ReportNoShowRequest{
		ContractId: contractID,
		CustomerId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoContractToJSON(resp.GetContract()))
}

// ReportAbandonment handles POST /api/v1/contracts/{id}/report-abandonment.
func (h *ContractHandler) ReportAbandonment(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}

	resp, err := h.contractClient.ReportAbandonment(r.Context(), &contractv1.ReportAbandonmentRequest{
		ContractId: contractID,
		CustomerId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoContractToJSON(resp.GetContract()))
}

// --- Contract PDF export ---

// ExportPDF handles GET /api/v1/contracts/{id}/pdf.
func (h *ContractHandler) ExportPDF(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}

	resp, err := h.contractClient.ExportContractPDF(r.Context(), &contractv1.ExportContractPDFRequest{
		ContractId: contractID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"pdf_url": resp.GetPdfUrl(),
	})
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
		"job_title":           c.GetJobTitle(),
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

	milestones := make([]map[string]interface{}, 0, len(c.GetMilestones()))
	for _, m := range c.GetMilestones() {
		milestones = append(milestones, protoMilestoneToJSON(m))
	}
	result["milestones"] = milestones

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

func protoDisputeToJSON(d *contractv1.Dispute) map[string]interface{} {
	if d == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":                 d.GetId(),
		"contract_id":        d.GetContractId(),
		"opened_by":          d.GetOpenedBy(),
		"dispute_type":       disputeTypeToString(d.GetDisputeType()),
		"description":        d.GetDescription(),
		"evidence_urls":      d.GetEvidenceUrls(),
		"status":             disputeStatusToString(d.GetStatus()),
		"is_guarantee_claim": d.GetIsGuaranteeClaim(),
		"created_at":         formatTimestamp(d.GetCreatedAt()),
	}

	if d.GetResolutionType() != "" {
		result["resolution_type"] = d.GetResolutionType()
	}
	if d.GetResolutionNotes() != "" {
		result["resolution_notes"] = d.GetResolutionNotes()
	}
	if d.GetRefundAmountCents() > 0 {
		result["refund_amount_cents"] = d.GetRefundAmountCents()
	}
	if d.GetResolvedAt() != nil {
		result["resolved_at"] = formatTimestamp(d.GetResolvedAt())
	}

	return result
}

func disputeTypeToString(dt contractv1.DisputeType) string {
	switch dt {
	case contractv1.DisputeType_DISPUTE_TYPE_QUALITY:
		return "quality"
	case contractv1.DisputeType_DISPUTE_TYPE_INCOMPLETE_WORK:
		return "incomplete_work"
	case contractv1.DisputeType_DISPUTE_TYPE_NO_SHOW:
		return "no_show"
	case contractv1.DisputeType_DISPUTE_TYPE_ABANDONMENT:
		return "abandonment"
	case contractv1.DisputeType_DISPUTE_TYPE_PAYMENT:
		return "payment"
	case contractv1.DisputeType_DISPUTE_TYPE_SCOPE_DISAGREEMENT:
		return "scope_disagreement"
	case contractv1.DisputeType_DISPUTE_TYPE_GUARANTEE_CLAIM:
		return "guarantee_claim"
	case contractv1.DisputeType_DISPUTE_TYPE_OTHER:
		return "other"
	default:
		return "unspecified"
	}
}

func stringToDisputeType(s string) contractv1.DisputeType {
	switch s {
	case "quality":
		return contractv1.DisputeType_DISPUTE_TYPE_QUALITY
	case "incomplete_work":
		return contractv1.DisputeType_DISPUTE_TYPE_INCOMPLETE_WORK
	case "no_show":
		return contractv1.DisputeType_DISPUTE_TYPE_NO_SHOW
	case "abandonment":
		return contractv1.DisputeType_DISPUTE_TYPE_ABANDONMENT
	case "payment":
		return contractv1.DisputeType_DISPUTE_TYPE_PAYMENT
	case "scope_disagreement":
		return contractv1.DisputeType_DISPUTE_TYPE_SCOPE_DISAGREEMENT
	case "guarantee_claim":
		return contractv1.DisputeType_DISPUTE_TYPE_GUARANTEE_CLAIM
	case "other":
		return contractv1.DisputeType_DISPUTE_TYPE_OTHER
	default:
		return contractv1.DisputeType_DISPUTE_TYPE_UNSPECIFIED
	}
}

func disputeStatusToString(ds contractv1.DisputeStatus) string {
	switch ds {
	case contractv1.DisputeStatus_DISPUTE_STATUS_OPEN:
		return "open"
	case contractv1.DisputeStatus_DISPUTE_STATUS_UNDER_REVIEW:
		return "under_review"
	case contractv1.DisputeStatus_DISPUTE_STATUS_RESOLVED:
		return "resolved"
	case contractv1.DisputeStatus_DISPUTE_STATUS_ESCALATED:
		return "escalated"
	case contractv1.DisputeStatus_DISPUTE_STATUS_CLOSED:
		return "closed"
	default:
		return "unspecified"
	}
}
