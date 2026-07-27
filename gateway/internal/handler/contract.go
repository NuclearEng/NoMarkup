package handler

import (
	"context"
	"encoding/json"
	"html"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
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
	// Also backs FR-16.7 partial payment_retry_count + next_retry_at on
	// recurring_configs (migrations 112/113) without a proto regen.
	db *pgxpool.Pool
	// paymentClient creates a real Stripe PaymentIntent for recurring-instance
	// approve (FR-18 residual). Optional: nil → approve still succeeds with
	// status/timestamps only — never invent a payment_id or client_secret.
	paymentClient paymentv1.PaymentServiceClient
	// incrPaymentRetryFn / resetPaymentRetryFn override the SQL helpers for
	// unit tests (production leaves them nil and uses h.db).
	// incr returns (count, nextRetryAt); nextRetryAt is nil at/above threshold.
	incrPaymentRetryFn  func(ctx context.Context, recurringID string) (int, *time.Time, error)
	resetPaymentRetryFn func(ctx context.Context, recurringID string) error
}

// NewContractHandler creates a new ContractHandler.
func NewContractHandler(contractClient contractv1.ContractServiceClient, userClient userv1.UserServiceClient, db *pgxpool.Pool) *ContractHandler {
	return &ContractHandler{contractClient: contractClient, userClient: userClient, db: db}
}

// SetPaymentClient wires CreatePayment for recurring-instance approve and for
// auto-approve on complete (FR-18). Safe to leave unset in tests that never hit
// the money path.
func (h *ContractHandler) SetPaymentClient(c paymentv1.PaymentServiceClient) {
	h.paymentClient = c
}

// resolvePartyNames resolves a set of user ids → public display_name via the
// user gRPC service, deduping ids and resolving them in ONE batched round trip
// (chunked at the server's cap) rather than one sequential GetUser per unique
// party. It is fail-soft: a lookup error or empty display_name leaves that id
// out of the map rather than failing the contract response. Only the
// public-safe display_name is surfaced — no other PII. Returns nil when there
// is no user client configured or no ids to resolve.
func (h *ContractHandler) resolvePartyNames(ctx context.Context, ids ...string) map[string]string {
	if h.userClient == nil {
		return nil
	}

	unique := dedupeUserIDs(ids)
	if len(unique) == 0 {
		return nil
	}

	names, err := batchGetDisplayNames(ctx, h.userClient, unique)
	if err != nil {
		// fail soft — the failed chunk's names are simply absent.
		slog.WarnContext(ctx, "contract: resolve party names failed", "error", err)
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

// localTermsByContract reads contracts.terms_json→local_terms for display.
// Chat Accept / award residual bind write a nested local_terms object (FR-5.4)
// that is not on the contract proto. Only the local_terms sub-object is
// projected (not the full terms_json blob). Fail-soft: nil/empty when missing.
// Authorization is already enforced by GetContract party checks — this is
// enrichment only for callers who already may see the contract.
func (h *ContractHandler) localTermsByContract(ctx context.Context, contractID string) map[string]interface{} {
	if h.db == nil || contractID == "" {
		return nil
	}
	var raw []byte
	err := h.db.QueryRow(ctx,
		`SELECT COALESCE(terms_json, '{}'::jsonb) FROM contracts WHERE id = $1 AND deleted_at IS NULL`,
		contractID,
	).Scan(&raw)
	if err != nil {
		// NotFound / scan error → no enrichment (GetContract already authorized).
		return nil
	}
	return projectLocalTermsJSON(raw)
}

// projectLocalTermsJSON extracts the local_terms object from a terms_json
// document and keeps only scalar values for safe client projection.
func projectLocalTermsJSON(raw []byte) map[string]interface{} {
	if len(raw) == 0 {
		return nil
	}
	var root map[string]interface{}
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil
	}
	local, ok := root["local_terms"].(map[string]interface{})
	if !ok || len(local) == 0 {
		return nil
	}
	// Project only string/number/bool primitives for display safety — drop
	// nested objects so the UI never renders unexpected structure.
	out := make(map[string]interface{}, len(local))
	for k, v := range local {
		switch v.(type) {
		case string, float64, bool, nil:
			out[k] = v
		case json.Number:
			out[k] = v
		default:
			// Skip arrays/objects (e.g. unexpected nested blobs).
		}
	}
	if len(out) == 0 {
		return nil
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
		// FR-5.4: surface chat/award-bound local terms for the contract detail UI.
		if local := h.localTermsByContract(r.Context(), id); local != nil {
			result["local_terms"] = local
		}
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
			"page":       pg.GetPage(),
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
	Description      string `json:"description"`
	AmountDeltaCents int64  `json:"amount_delta_cents"`
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

// --- Contract PDF / document export ---

// ExportPDF handles GET /api/v1/contracts/{id}/pdf.
// Returns a relative path that clients resolve against the API base and fetch
// with auth (see DownloadContractDocument). Absolute URLs are avoided so the
// same response works for localhost, LAN, and production.
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

	// Confirm the contract exists for this party (RequirePartyAccess already
	// gated the route; still validate via service when available).
	if _, err := h.contractClient.ExportContractPDF(r.Context(), &contractv1.ExportContractPDFRequest{
		ContractId: contractID,
	}); err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"pdf_url": "/api/v1/contracts/" + contractID + "/document.pdf",
	})
}

// DownloadContractDocument handles GET /api/v1/contracts/{id}/document.pdf.
// Serves an HTML contract summary (printable) with attachment disposition.
// Auth is required; party access is enforced by router middleware.
func (h *ContractHandler) DownloadContractDocument(w http.ResponseWriter, r *http.Request) {
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
	c := resp.GetContract()
	if c == nil {
		writeError(w, http.StatusNotFound, "contract not found")
		return
	}

	body := buildContractDocumentHTML(c)
	filenameID := contractID
	if len(filenameID) > 8 {
		filenameID = filenameID[:8]
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"contract-"+filenameID+".html\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(body))
}

func buildContractDocumentHTML(c *contractv1.Contract) string {
	title := c.GetJobTitle()
	if title == "" {
		title = "Contract"
	}
	status := contractStatusToString(c.GetStatus())
	num := c.GetContractNumber()
	if num == "" {
		num = c.GetId()
	}
	amount := formatCentsUSD(c.GetAmountCents())
	created := formatTimestamp(c.GetCreatedAt())
	completed := ""
	if c.GetCompletedAt() != nil {
		completed = formatTimestamp(c.GetCompletedAt())
	}
	esc := html.EscapeString
	// Minimal printable HTML — clients open/share via authenticated download.
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Contract ` + esc(num) + `</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; color: #111; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .meta { color: #555; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; max-width: 36rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #ddd; }
  th { width: 40%; color: #555; font-weight: 600; }
  .footer { margin-top: 2rem; font-size: 0.85rem; color: #777; }
</style>
</head>
<body>
  <h1>` + esc(title) + `</h1>
  <p class="meta">NoMarkup contract summary · printable HTML</p>
  <table>
    <tr><th>Contract number</th><td>` + esc(num) + `</td></tr>
    <tr><th>Status</th><td>` + esc(status) + `</td></tr>
    <tr><th>Amount</th><td>` + esc(amount) + `</td></tr>
    <tr><th>Customer ID</th><td>` + esc(c.GetCustomerId()) + `</td></tr>
    <tr><th>Provider ID</th><td>` + esc(c.GetProviderId()) + `</td></tr>
    <tr><th>Created</th><td>` + esc(created) + `</td></tr>
    <tr><th>Completed</th><td>` + esc(completed) + `</td></tr>
  </table>
  <p class="footer">Generated for the signed-in party. Do not share publicly.</p>
</body>
</html>`
}

// --- Recurring (FR-18) ---

// GetRecurringConfig handles GET /api/v1/contracts/{id}/recurring.
func (h *ContractHandler) GetRecurringConfig(w http.ResponseWriter, r *http.Request) {
	if _, ok := middleware.GetClaims(r.Context()); !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}
	resp, err := h.contractClient.GetRecurringConfig(r.Context(), &contractv1.GetRecurringConfigRequest{
		ContractId: contractID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config": protoRecurringConfigToJSON(resp.GetConfig()),
	})
}

// UpdateRecurringConfig handles PATCH /api/v1/contracts/{id}/recurring.
func (h *ContractHandler) UpdateRecurringConfig(w http.ResponseWriter, r *http.Request) {
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

	var body struct {
		ProposedRateCents *int64 `json:"proposed_rate_cents"`
		AutoApprove       *bool  `json:"auto_approve"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}

	cfg, err := h.resolveRecurringConfig(r, contractID)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	req := &contractv1.UpdateRecurringConfigRequest{
		RecurringId: cfg.GetId(),
		UserId:      claims.UserID,
	}
	if body.ProposedRateCents != nil {
		req.ProposedRateCents = body.ProposedRateCents
	}
	if body.AutoApprove != nil {
		req.AutoApprove = body.AutoApprove
	}

	resp, err := h.contractClient.UpdateRecurringConfig(r.Context(), req)
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config": protoRecurringConfigToJSON(resp.GetConfig()),
	})
}

// PauseRecurring handles POST /api/v1/contracts/{id}/recurring/pause.
func (h *ContractHandler) PauseRecurring(w http.ResponseWriter, r *http.Request) {
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
	cfg, err := h.resolveRecurringConfig(r, contractID)
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	resp, err := h.contractClient.PauseRecurring(r.Context(), &contractv1.PauseRecurringRequest{
		RecurringId: cfg.GetId(),
		UserId:      claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config": protoRecurringConfigToJSON(resp.GetConfig()),
	})
}

// ResumeRecurring handles POST /api/v1/contracts/{id}/recurring/resume.
func (h *ContractHandler) ResumeRecurring(w http.ResponseWriter, r *http.Request) {
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
	cfg, err := h.resolveRecurringConfig(r, contractID)
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	resp, err := h.contractClient.ResumeRecurring(r.Context(), &contractv1.ResumeRecurringRequest{
		RecurringId: cfg.GetId(),
		UserId:      claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config": protoRecurringConfigToJSON(resp.GetConfig()),
	})
}

// CancelRecurring handles POST /api/v1/contracts/{id}/recurring/cancel.
func (h *ContractHandler) CancelRecurring(w http.ResponseWriter, r *http.Request) {
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
	cfg, err := h.resolveRecurringConfig(r, contractID)
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	resp, err := h.contractClient.CancelRecurring(r.Context(), &contractv1.CancelRecurringRequest{
		RecurringId: cfg.GetId(),
		UserId:      claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config": protoRecurringConfigToJSON(resp.GetConfig()),
	})
}

// ListRecurringInstances handles GET /api/v1/contracts/{id}/recurring/instances.
func (h *ContractHandler) ListRecurringInstances(w http.ResponseWriter, r *http.Request) {
	if _, ok := middleware.GetClaims(r.Context()); !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}
	cfg, err := h.resolveRecurringConfig(r, contractID)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	page := 1
	pageSize := 20
	if p := r.URL.Query().Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = v
		}
	}
	if ps := r.URL.Query().Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 {
			pageSize = v
		}
	}

	resp, err := h.contractClient.ListRecurringInstances(r.Context(), &contractv1.ListRecurringInstancesRequest{
		RecurringId: cfg.GetId(),
		Pagination: &commonv1.PaginationRequest{
			Page:     int32(page),
			PageSize: int32(pageSize),
		},
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	instances := make([]map[string]interface{}, 0, len(resp.GetInstances()))
	for _, inst := range resp.GetInstances() {
		instances = append(instances, protoRecurringInstanceToJSON(inst))
	}
	result := map[string]interface{}{
		"instances": instances,
	}
	if p := resp.GetPagination(); p != nil {
		result["pagination"] = map[string]interface{}{
			"total_count": p.GetTotalCount(),
			"page":        p.GetPage(),
			"page_size":   p.GetPageSize(),
			"total_pages": p.GetTotalPages(),
			"has_next":    p.GetHasNext(),
		}
	}
	writeJSON(w, http.StatusOK, result)
}

// CompleteRecurringInstance handles POST .../recurring/instances/{instanceId}/complete.
//
// Status completion is always durable via the contract service (provider-only).
// When the recurring config has auto_approve, the job service marks the instance
// approved in the same write. The gateway then best-effort creates a real
// services PaymentIntent for the contract customer (CreatePayment requires the
// contract customer — never the provider actor). Failure to create a PI does
// NOT roll back completion/auto-approval and does NOT invent a stub payment_id.
func (h *ContractHandler) CompleteRecurringInstance(w http.ResponseWriter, r *http.Request) {
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
	instanceID := chi.URLParam(r, "instanceId")
	if !isValidUUID(instanceID) {
		writeError(w, http.StatusBadRequest, "invalid instance id")
		return
	}
	resp, err := h.contractClient.CompleteRecurringInstance(r.Context(), &contractv1.CompleteRecurringInstanceRequest{
		InstanceId: instanceID,
		ProviderId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	inst := resp.GetInstance()
	result := map[string]interface{}{
		"instance": protoRecurringInstanceToJSON(inst),
	}
	// Non-auto-approve path: provider marked complete only; customer will approve
	// (and pay) separately. No money orchestration here.
	if inst == nil || !inst.GetAutoApproved() {
		writeJSON(w, http.StatusOK, result)
		return
	}

	// Auto-approve: create PI as the contract customer (not the provider caller).
	customerID, custErr := h.resolveContractCustomerID(r.Context(), contractID, claims.UserID)
	if custErr != nil || customerID == "" {
		slog.WarnContext(r.Context(), "recurring instance complete auto-approve: customer unresolved (completion kept)",
			"instance_id", instanceID,
			"contract_id", contractID,
			"error", custErr,
		)
		result["payment_residual"] = "customer_unresolved"
		result["payment_error"] = "Visit completed and auto-approved, but customer could not be resolved for escrow PaymentIntent. Customer can pay via POST /payments with recurring_instance_id."
		writeJSON(w, http.StatusOK, result)
		return
	}
	h.attachRecurringInstancePayment(r.Context(), result, contractID, instanceID, customerID, inst.GetAmountCents(), "complete_auto_approve")
	writeJSON(w, http.StatusOK, result)
}

// ApproveRecurringInstance handles POST .../recurring/instances/{instanceId}/approve.
//
// Status approval is always durable via the contract service. When a payment
// client is wired, the gateway best-effort creates a real services PaymentIntent
// for the instance amount (payments.recurring_instance_id FK — there is no
// payment_id column on recurring_instances). CreatePayment refuses amount >
// contract total and non-customer actors. Failure to create a PI does NOT roll
// back approval and does NOT invent a stub payment_id (fail-safe residual —
// no fake money).
func (h *ContractHandler) ApproveRecurringInstance(w http.ResponseWriter, r *http.Request) {
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
	instanceID := chi.URLParam(r, "instanceId")
	if !isValidUUID(instanceID) {
		writeError(w, http.StatusBadRequest, "invalid instance id")
		return
	}
	resp, err := h.contractClient.ApproveRecurringInstance(r.Context(), &contractv1.ApproveRecurringInstanceRequest{
		InstanceId: instanceID,
		CustomerId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	inst := resp.GetInstance()
	result := map[string]interface{}{
		"instance": protoRecurringInstanceToJSON(inst),
	}
	// Job service leaves payment_id empty today (orchestration residual). Prefer
	// any id it does return; otherwise create a real PI when amount is known.
	if pid := resp.GetPaymentId(); pid != "" {
		result["payment_id"] = pid
	}

	amountCents := int64(0)
	if inst != nil {
		amountCents = inst.GetAmountCents()
	}
	// Customer is the authenticated approver — CreatePayment requires contract customer.
	h.attachRecurringInstancePayment(r.Context(), result, contractID, instanceID, claims.UserID, amountCents, "approve")
	writeJSON(w, http.StatusOK, result)
}

// resolveContractCustomerID loads the contract as requestingUserID (party) and
// returns the customer id. Empty string + error when lookup fails.
func (h *ContractHandler) resolveContractCustomerID(ctx context.Context, contractID, requestingUserID string) (string, error) {
	if h.contractClient == nil {
		return "", nil
	}
	resp, err := h.contractClient.GetContract(ctx, &contractv1.GetContractRequest{
		ContractId:       contractID,
		RequestingUserId: requestingUserID,
	})
	if err != nil {
		return "", err
	}
	if c := resp.GetContract(); c != nil {
		return c.GetCustomerId(), nil
	}
	return "", nil
}

// attachRecurringInstancePayment best-effort CreatePayment for an approved
// recurring visit. Mutates result with payment_id / client_secret / residual.
// Never invents payment_id or client_secret. customerID must be the contract
// customer (payment service enforces ownership). Sticky idempotency key
// recurring-instance-pay:{instanceID} dedupes approve + auto-approve complete.
//
// CreatePayment for recurring_instance_id performs ONE safe off-session attempt
// when the customer has a default saved card: on success status is escrow and
// client_secret is omitted; on skip/fail the on-session PI residual remains
// (client_secret for PaymentSheet). Never invents money.
//
// On CreatePayment failure, FR-16.7 partial + FR-18.8: increment
// recurring_configs.payment_retry_count (migration 112) and only PauseRecurring
// when count >= 3 (contract stays intact; config pauses only). Charge-failure
// pause after Stripe payment_intent.payment_failed is owned by the payment
// service (still immediate pause — day-0/3/7 scheduled charge retries residual).
// Resume on successful visit pay lives on PaymentHandler.ProcessPayment
// (FR-18.8) and resets the retry counter. Residual: FR-16.7 day-0/3/7
// scheduled retries (not wired); webhook-only capture without ProcessPayment
// does not resume (services use manual capture + POST /payments/{id}/process).
func (h *ContractHandler) attachRecurringInstancePayment(
	ctx context.Context,
	result map[string]interface{},
	contractID, instanceID, customerID string,
	amountCents int64,
	source string,
) {
	if h.paymentClient == nil {
		// Honest residual: status stands; no money path without payment mesh.
		result["payment_residual"] = "payment_service_unwired"
		return
	}
	if amountCents <= 0 {
		result["payment_residual"] = "instance_amount_missing"
		return
	}
	if customerID == "" {
		result["payment_residual"] = "customer_unresolved"
		return
	}

	// Sticky server-side key: one PI per instance across approve retries and
	// auto-approve complete. CreatePayment stores this as payments.idempotency_key.
	// Migration 111 also UNIQUE(recurring_instance_id) so customer POST /payments
	// with a different key still soft-replays the same PI (no dual authorization).
	idemKey := "recurring-instance-pay:" + instanceID
	createReq := &paymentv1.CreatePaymentRequest{
		ContractId:          contractID,
		RecurringInstanceId: instanceID,
		CustomerId:          customerID,
		AmountCents:         amountCents,
		IdempotencyKey:      idemKey,
	}
	payResp, payErr := h.paymentClient.CreatePayment(ctx, createReq)
	if payErr != nil {
		// Dual-PI defense: CreatePayment soft-replays unique conflicts. If this
		// RPC still failed (mesh blip after insert, or soft-replay refused), try
		// load-by-instance via a second CreatePayment (same sticky key + instance
		// → soft-replay returns existing payment + real client_secret). Never
		// invent payment_id or client_secret.
		if replay, replayErr := h.paymentClient.CreatePayment(ctx, createReq); replayErr == nil {
			payResp, payErr = replay, nil
			slog.InfoContext(ctx, "recurring instance: CreatePayment soft-replay on retry",
				"source", source,
				"instance_id", instanceID,
				"contract_id", contractID,
			)
		} else if existing := h.findPaymentByRecurringInstance(ctx, customerID, instanceID); existing != nil {
			// Real payment_id only — secret unavailable without Stripe re-read at
			// gateway. Fail closed on secret; do not pause if money already exists.
			if existing.GetId() != "" {
				result["payment_id"] = existing.GetId()
				result["payment"] = protoPaymentToJSON(existing)
			}
			// Already-funded visit (e.g. prior off-session success): no secret needed.
			if recurringPaymentIsFunded(existing) {
				result["off_session_charged"] = true
				h.resetRecurringPaymentRetryAfterSuccess(ctx, contractID, instanceID, source)
				return
			}
			slog.WarnContext(ctx, "recurring instance: existing payment found but client_secret unavailable (fail closed)",
				"source", source,
				"instance_id", instanceID,
				"payment_id", existing.GetId(),
				"create_error", payErr,
				"replay_error", replayErr,
			)
			result["payment_residual"] = "client_secret_missing"
			result["payment_error"] = "A payment already exists for this visit but client_secret could not be issued. Retry pay via POST /payments with recurring_instance_id."
			return
		} else {
			// Status already committed — surface residual, never fake a payment.
			// FR-16.7 partial: count setup failures; pause only at threshold.
			slog.WarnContext(ctx, "recurring instance: CreatePayment failed (status kept; FR-16.7 retry count)",
				"source", source,
				"instance_id", instanceID,
				"contract_id", contractID,
				"amount_cents", amountCents,
				"error", payErr,
			)
			result["payment_residual"] = "create_payment_failed"
			result["payment_error"] = "Could not create escrow PaymentIntent for this visit. Visit is approved; pay via POST /payments with recurring_instance_id when ready."
			// No PI was minted, so off-session was never attempted. FR-16.7
			// day-0/3/7 scheduled charge retries remain residual (not this path).
			result["off_session_charge_residual"] = "not_attempted_create_failed"
			h.recordRecurringPaymentSetupFailure(ctx, result, contractID, instanceID, customerID, source)
			return
		}
	}

	if p := payResp.GetPayment(); p != nil && p.GetId() != "" {
		result["payment_id"] = p.GetId()
		result["payment"] = protoPaymentToJSON(p)
	}
	if secret := payResp.GetClientSecret(); secret != "" {
		// Real Stripe (or dev-stack) secret for PaymentSheet — not invented.
		// Present when off-session was skipped (no default PM) or failed
		// (decline/SCA) — one safe attempt already ran inside CreatePayment.
		result["client_secret"] = secret
		result["off_session_charge_residual"] = "on_session_residual"
	} else if p := payResp.GetPayment(); p != nil && recurringPaymentIsFunded(p) {
		// Off-session confirm+capture succeeded (or soft-replay of funded row).
		// Never invent a secret; client does not need PaymentSheet.
		result["off_session_charged"] = true
	} else {
		// PI row may exist without a confirmable secret (misconfig / already held
		// without status echo). Honest residual — never invent a secret.
		result["payment_residual"] = "client_secret_missing"
	}
	// Successful visit PI setup (or funded capture) clears FR-16.7 partial strike count.
	h.resetRecurringPaymentRetryAfterSuccess(ctx, contractID, instanceID, source)
}

// recurringPaymentIsFunded reports whether a visit payment no longer needs
// PaymentSheet / client_secret (funds held or past escrow).
func recurringPaymentIsFunded(p *paymentv1.Payment) bool {
	if p == nil {
		return false
	}
	switch p.GetStatus() {
	case paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW,
		paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED,
		paymentv1.PaymentStatus_PAYMENT_STATUS_COMPLETED,
		paymentv1.PaymentStatus_PAYMENT_STATUS_PROCESSING:
		return true
	default:
		return false
	}
}

// findPaymentByRecurringInstance best-effort loads an existing payment for a
// visit via ListPayments. Used only when CreatePayment soft-replay failed so we
// can still surface a real payment_id — never invents client_secret.
func (h *ContractHandler) findPaymentByRecurringInstance(ctx context.Context, customerID, instanceID string) *paymentv1.Payment {
	if h.paymentClient == nil || customerID == "" || instanceID == "" {
		return nil
	}
	resp, err := h.paymentClient.ListPayments(ctx, &paymentv1.ListPaymentsRequest{
		UserId: customerID,
		Pagination: &commonv1.PaginationRequest{
			Page:     1,
			PageSize: 50,
		},
	})
	if err != nil {
		slog.WarnContext(ctx, "recurring instance: ListPayments for soft-load failed",
			"instance_id", instanceID,
			"error", err,
		)
		return nil
	}
	for _, p := range resp.GetPayments() {
		if p != nil && p.GetRecurringInstanceId() == instanceID {
			return p
		}
	}
	return nil
}

// recordRecurringPaymentSetupFailure implements FR-16.7 partial + FR-18.8:
// on CreatePayment failure for a visit, increment payment_retry_count and only
// PauseRecurring when count >= recurringPaymentRetryPauseThreshold. Never
// cancels the contract or the recurring config. Fail-soft: counter/pause errors
// only add residual fields — approval/completion already stands.
//
// When the counter cannot be tracked (nil db, migration 112 not applied, SQL
// error), we document residual and do NOT pause on the first failure — pausing
// without a durable count would re-introduce the old "pause immediately"
// behavior without the 3-strike gate. Ops still has payment_residual logs.
func (h *ContractHandler) recordRecurringPaymentSetupFailure(
	ctx context.Context,
	result map[string]interface{},
	contractID, instanceID, customerID, source string,
) {
	if h.contractClient == nil {
		result["recurring_pause_residual"] = "contract_service_unwired"
		return
	}
	if customerID == "" {
		result["recurring_pause_residual"] = "customer_unresolved"
		slog.WarnContext(ctx, "FR-16.7: cannot record payment setup failure (no customer id; contract not cancelled)",
			"source", source,
			"instance_id", instanceID,
			"contract_id", contractID,
		)
		return
	}

	cfgResp, err := h.contractClient.GetRecurringConfig(ctx, &contractv1.GetRecurringConfigRequest{
		ContractId: contractID,
	})
	if err != nil {
		slog.WarnContext(ctx, "FR-16.7: GetRecurringConfig failed after payment setup failure (contract not cancelled)",
			"source", source,
			"instance_id", instanceID,
			"contract_id", contractID,
			"error", err,
		)
		result["recurring_pause_residual"] = "config_lookup_failed"
		return
	}
	cfg := cfgResp.GetConfig()
	if cfg == nil || cfg.GetId() == "" {
		slog.WarnContext(ctx, "FR-16.7: no recurring config after payment setup failure (contract not cancelled)",
			"source", source,
			"instance_id", instanceID,
			"contract_id", contractID,
		)
		result["recurring_pause_residual"] = "config_missing"
		return
	}

	status := cfg.GetStatus()
	result["recurring_id"] = cfg.GetId()
	if status == "paused" {
		// Already paused — still surface FR-18.8 intent; no further pause.
		result["recurring_paused"] = true
		result["recurring_status"] = "paused"
		slog.InfoContext(ctx, "FR-16.7: recurring already paused after payment setup failure (contract not cancelled)",
			"source", source,
			"instance_id", instanceID,
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
		)
		return
	}
	if status != "active" {
		// cancelled / other — do not cancel further; leave alone.
		result["recurring_status"] = status
		result["recurring_pause_residual"] = "not_active"
		slog.InfoContext(ctx, "FR-16.7: skip after payment setup failure — config not active (contract not cancelled)",
			"source", source,
			"instance_id", instanceID,
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
			"status", status,
		)
		return
	}

	// FR-16.7 partial: durable strike count + next_retry_at before pause.
	count, nextRetryAt, incrErr := h.incrementPaymentRetry(ctx, cfg.GetId())
	if incrErr != nil {
		// Schema/db missing: document, do not invent a pause without a counter.
		slog.WarnContext(ctx, "FR-16.7: payment_retry_count increment failed (not pausing without durable count)",
			"source", source,
			"instance_id", instanceID,
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
			"error", incrErr,
		)
		result["payment_retry_residual"] = "retry_count_untracked"
		result["recurring_status"] = status
		result["recurring_pause_residual"] = "retry_count_unavailable"
		return
	}
	result["payment_retry_count"] = count
	result["payment_retry_threshold"] = recurringPaymentRetryPauseThreshold
	result["recurring_status"] = status
	if nextRetryAt != nil {
		result["next_retry_at"] = nextRetryAt.UTC().Format(time.RFC3339)
	}

	if count < recurringPaymentRetryPauseThreshold {
		// Below threshold: leave schedule active; stamp next_retry_at for the
		// day-3 / day-7 worker scan. Customer can still pay the visit manually.
		// Automatic off-session charge on that schedule is residual (job cron
		// processRecurringPaymentRetries currently logs only).
		result["recurring_paused"] = false
		logAttrs := []any{
			"source", source,
			"instance_id", instanceID,
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
			"payment_retry_count", count,
			"threshold", recurringPaymentRetryPauseThreshold,
		}
		if nextRetryAt != nil {
			logAttrs = append(logAttrs, "next_retry_at", nextRetryAt.UTC().Format(time.RFC3339))
		}
		slog.InfoContext(ctx, "FR-16.7: CreatePayment failure counted; schedule still active; next_retry_at stored",
			logAttrs...,
		)
		return
	}

	// Threshold reached — FR-18.8 pause (never cancel contract).
	pauseResp, pauseErr := h.contractClient.PauseRecurring(ctx, &contractv1.PauseRecurringRequest{
		RecurringId: cfg.GetId(),
		UserId:      customerID,
	})
	if pauseErr != nil {
		slog.WarnContext(ctx, "FR-18.8: PauseRecurring failed after retry threshold (contract not cancelled; visit status kept)",
			"source", source,
			"instance_id", instanceID,
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
			"payment_retry_count", count,
			"error", pauseErr,
		)
		result["recurring_pause_residual"] = "pause_failed"
		return
	}

	pausedCfg := pauseResp.GetConfig()
	result["recurring_paused"] = true
	result["recurring_status"] = "paused"
	if pausedCfg != nil {
		result["recurring_config"] = protoRecurringConfigToJSON(pausedCfg)
		if st := pausedCfg.GetStatus(); st != "" {
			result["recurring_status"] = st
		}
	}
	slog.InfoContext(ctx, "FR-16.7/FR-18.8: recurring paused after CreatePayment failures reached threshold (contract not cancelled)",
		"source", source,
		"instance_id", instanceID,
		"contract_id", contractID,
		"recurring_id", cfg.GetId(),
		"customer_id", customerID,
		"payment_retry_count", count,
	)
}

// incrementPaymentRetry uses the test hook when set; otherwise SQL via h.db.
// Returns the new strike count and optional next_retry_at (nil at/above pause threshold).
func (h *ContractHandler) incrementPaymentRetry(ctx context.Context, recurringID string) (int, *time.Time, error) {
	if h.incrPaymentRetryFn != nil {
		return h.incrPaymentRetryFn(ctx, recurringID)
	}
	return incrRecurringPaymentRetryCount(ctx, h.db, recurringID)
}

// resetRecurringPaymentRetryAfterSuccess clears payment_retry_count after a
// successful visit PI create. Fail-soft: lookup/reset errors are logged only.
func (h *ContractHandler) resetRecurringPaymentRetryAfterSuccess(
	ctx context.Context,
	contractID, instanceID, source string,
) {
	if contractID == "" || h.contractClient == nil {
		return
	}
	cfgResp, err := h.contractClient.GetRecurringConfig(ctx, &contractv1.GetRecurringConfigRequest{
		ContractId: contractID,
	})
	if err != nil || cfgResp.GetConfig() == nil || cfgResp.GetConfig().GetId() == "" {
		if err != nil {
			slog.WarnContext(ctx, "FR-16.7: GetRecurringConfig failed when resetting payment_retry_count (PI kept)",
				"source", source,
				"instance_id", instanceID,
				"contract_id", contractID,
				"error", err,
			)
		}
		return
	}
	recurringID := cfgResp.GetConfig().GetId()
	if resetErr := h.resetPaymentRetry(ctx, recurringID); resetErr != nil {
		slog.WarnContext(ctx, "FR-16.7: payment_retry_count reset failed after successful CreatePayment (PI kept)",
			"source", source,
			"instance_id", instanceID,
			"contract_id", contractID,
			"recurring_id", recurringID,
			"error", resetErr,
		)
		return
	}
	slog.DebugContext(ctx, "FR-16.7: payment_retry_count reset after successful CreatePayment",
		"source", source,
		"instance_id", instanceID,
		"recurring_id", recurringID,
	)
}

func (h *ContractHandler) resetPaymentRetry(ctx context.Context, recurringID string) error {
	if h.resetPaymentRetryFn != nil {
		return h.resetPaymentRetryFn(ctx, recurringID)
	}
	return resetRecurringPaymentRetryCount(ctx, h.db, recurringID)
}

func (h *ContractHandler) resolveRecurringConfig(r *http.Request, contractID string) (*contractv1.RecurringConfig, error) {
	resp, err := h.contractClient.GetRecurringConfig(r.Context(), &contractv1.GetRecurringConfigRequest{
		ContractId: contractID,
	})
	if err != nil {
		return nil, err
	}
	return resp.GetConfig(), nil
}

func protoRecurringConfigToJSON(cfg *contractv1.RecurringConfig) map[string]interface{} {
	if cfg == nil {
		return map[string]interface{}{}
	}
	result := map[string]interface{}{
		"id":           cfg.GetId(),
		"contract_id":  cfg.GetContractId(),
		"frequency":    recurrenceFrequencyToString(cfg.GetFrequency()),
		"rate_cents":   cfg.GetRateCents(),
		"auto_approve": cfg.GetAutoApprove(),
		"status":       cfg.GetStatus(),
	}
	if cfg.GetNextOccurrence() != nil {
		result["next_occurrence"] = formatTimestamp(cfg.GetNextOccurrence())
	}
	return result
}

func protoRecurringInstanceToJSON(inst *contractv1.RecurringInstance) map[string]interface{} {
	if inst == nil {
		return map[string]interface{}{}
	}
	result := map[string]interface{}{
		"id":            inst.GetId(),
		"recurring_id":  inst.GetRecurringId(),
		"status":        inst.GetStatus(),
		"amount_cents":  inst.GetAmountCents(),
		"auto_approved": inst.GetAutoApproved(),
	}
	if inst.GetOccurrenceDate() != nil {
		result["occurrence_date"] = formatTimestamp(inst.GetOccurrenceDate())
	}
	if inst.GetCompletedAt() != nil {
		result["completed_at"] = formatTimestamp(inst.GetCompletedAt())
	}
	return result
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
		"status":              effectiveContractStatus(contractStatusToString(c.GetStatus()), c.GetAcceptanceDeadline()),
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

	if rec := c.GetRecurring(); rec != nil && rec.GetId() != "" {
		result["recurring"] = protoRecurringConfigToJSON(rec)
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

// effectiveContractStatus lazily transitions a contract still awaiting
// acceptance past its acceptance_deadline to 'abandoned'. The acceptance
// window is enforced on the write path (ContractService.AcceptContract returns
// ErrDeadlineExpired once the deadline passes), but no worker flips the stored
// status, so the contract keeps displaying 'pending_acceptance' — a stale,
// contradictory "awaiting acceptance" on a window that has already lapsed.
//
// 'abandoned' is an existing allowed status meaning the acceptance window
// lapsed; this is display-only and does not mutate the contract or move funds.
func effectiveContractStatus(rawStatus string, acceptanceDeadline *timestamppb.Timestamp) string {
	if rawStatus == "pending_acceptance" && acceptanceDeadline != nil && acceptanceDeadline.AsTime().Before(time.Now()) {
		return "abandoned"
	}
	return rawStatus
}

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
