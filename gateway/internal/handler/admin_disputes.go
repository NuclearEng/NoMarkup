package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminDisputesHandler handles admin dispute management endpoints.
//
// db is the gateway pool, used ONLY to resolve a resolved dispute's two contract
// parties (customer_id/provider_id) so BOTH are notified that their dispute was
// resolved. nil-safe: a nil pool degrades to "no notification".
type AdminDisputesHandler struct {
	contractClient contractv1.ContractServiceClient
	db             *pgxpool.Pool
}

// NewAdminDisputesHandler creates a new AdminDisputesHandler.
func NewAdminDisputesHandler(contractClient contractv1.ContractServiceClient, db *pgxpool.Pool) *AdminDisputesHandler {
	return &AdminDisputesHandler{contractClient: contractClient, db: db}
}

// notifyDisputeResolved tells BOTH contract parties (customer + provider) that
// the admin resolved their dispute. The admin is the actor, so neither party is
// the actor and both receive it (emitNotification's self-notify guard is a
// no-op here). Fully fail-soft: a party lookup failure skips the notification
// and never affects the (already-committed) resolution.
func (h *AdminDisputesHandler) notifyDisputeResolved(ctx context.Context, adminID, contractID string) {
	if h.db == nil || contractID == "" {
		return
	}
	var customerID, providerID string
	if err := h.db.QueryRow(ctx,
		`SELECT customer_id::text, provider_id::text FROM contracts WHERE id = $1`, contractID,
	).Scan(&customerID, &providerID); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.ErrorContext(ctx, "dispute resolved notification: contract party lookup failed",
				"error", err, "contract_id", contractID)
		}
		return
	}
	const (
		title = "Your dispute was resolved"
		body  = "An admin reviewed and resolved the dispute on your contract. See the outcome."
	)
	url := "/contracts/" + contractID
	emitNotification(ctx, h.db, adminID, customerID, "dispute_resolved", title, body, url, "contract", contractID)
	emitNotification(ctx, h.db, adminID, providerID, "dispute_resolved", title, body, url, "contract", contractID)
}

// ListDisputes handles GET /api/v1/admin/disputes.
// Query params: status, is_guarantee_claim, page, page_size.
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

	// Parse optional is_guarantee_claim filter.
	if gc := q.Get("is_guarantee_claim"); gc != "" {
		val := gc == "true" || gc == "1"
		grpcReq.IsGuaranteeClaim = &val
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
	if !isValidUUID(disputeID) {
		writeError(w, http.StatusBadRequest, "invalid dispute id")
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
	if !isValidUUID(disputeID) {
		writeError(w, http.StatusBadRequest, "invalid dispute id")
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
	if !decodeJSON(w, r, &body) {
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

	// Notify BOTH contract parties that their dispute was resolved. Fail-soft.
	h.notifyDisputeResolved(r.Context(), claims.UserID, resp.GetDispute().GetContractId())

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"dispute": disputeToJSON(resp.GetDispute()),
	})
}

// --- Guarantee Claims ---

// ListGuaranteeClaims handles GET /api/v1/admin/guarantee-claims.
// Query params: status, page, page_size.
func (h *AdminDisputesHandler) ListGuaranteeClaims(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	isGuaranteeClaim := true
	grpcReq := &contractv1.ListDisputesRequest{
		IsGuaranteeClaim: &isGuaranteeClaim,
	}

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

	claims := make([]map[string]interface{}, 0, len(resp.GetDisputes()))
	for _, d := range resp.GetDisputes() {
		claims = append(claims, disputeToJSON(d))
	}

	result := map[string]interface{}{
		"guarantee_claims": claims,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

// ReviewGuaranteeClaim handles PUT /api/v1/admin/guarantee-claims/{id}/review.
// Admin approves or rejects a guarantee claim.
func (h *AdminDisputesHandler) ReviewGuaranteeClaim(w http.ResponseWriter, r *http.Request) {
	claimID := chi.URLParam(r, "id")
	if !isValidUUID(claimID) {
		writeError(w, http.StatusBadRequest, "invalid claim id")
		return
	}

	adminClaims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Approved        bool   `json:"approved"`
		ResolutionNotes string `json:"resolution_notes"`
		PayoutCents     int64  `json:"payout_cents"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}

	if body.ResolutionNotes == "" {
		writeError(w, http.StatusBadRequest, "resolution_notes is required")
		return
	}

	resolutionType := "dismissed"
	guaranteeOutcome := "denied"
	refundCents := int64(0)
	if body.Approved {
		resolutionType = "guarantee_invoked"
		guaranteeOutcome = "refund"
		refundCents = body.PayoutCents

		// Money guard (CLAUDE.md §6 — server-side price calc, fail closed).
		// The payout is untrusted admin input. Reject a negative payout and a
		// payout exceeding the covered contract amount with a clean,
		// admin-actionable 400 BEFORE the gRPC call. The contract service
		// re-enforces both invariants authoritatively; this is the front-line
		// check that surfaces the contract cap in the error message.
		if refundCents < 0 {
			writeError(w, http.StatusBadRequest, "payout amount must not be negative")
			return
		}
		if refundCents > 0 && h.db != nil {
			var capCents int64
			err := h.db.QueryRow(r.Context(), `
				SELECT c.amount_cents
				  FROM disputes d
				  JOIN contracts c ON c.id = d.contract_id
				 WHERE d.id = $1`, claimID,
			).Scan(&capCents)
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				// Fall through — the service layer maps a missing dispute to 404.
			case err != nil:
				slog.ErrorContext(r.Context(), "guarantee review: payout-cap lookup failed",
					"error", err, "claim_id", claimID)
				writeError(w, http.StatusInternalServerError, "failed to verify payout cap")
				return
			case refundCents > capCents:
				writeError(w, http.StatusBadRequest,
					"payout exceeds the covered contract amount ("+formatCentsUSD(capCents)+")")
				return
			}
		}
	}

	resp, err := h.contractClient.AdminResolveDispute(r.Context(), &contractv1.AdminResolveDisputeRequest{
		DisputeId:         claimID,
		AdminId:           adminClaims.UserID,
		ResolutionType:    resolutionType,
		ResolutionNotes:   body.ResolutionNotes,
		RefundAmountCents: refundCents,
		GuaranteeOutcome:  guaranteeOutcome,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"guarantee_claim": disputeToJSON(resp.GetDispute()),
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
		"dispute_type":      protoEnumToString(d.GetDisputeType().String(), "DISPUTE_TYPE_"),
		"description":       d.GetDescription(),
		"status":            protoEnumToString(d.GetStatus().String(), "DISPUTE_STATUS_"),
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

// formatCentsUSD renders an integer cent amount as a "$X.YY" string for
// admin-facing error messages. Always two decimals; handles negatives.
func formatCentsUSD(cents int64) string {
	neg := ""
	if cents < 0 {
		neg = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s$%d.%02d", neg, cents/100, cents%100)
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
