package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// DisputeHandler handles the standalone, contract-agnostic dispute endpoints
// (POST /api/v1/disputes, GET /api/v1/disputes/{id}). These are a thin wrapper
// over the contract service's dispute RPCs so that disputes filed here land in
// the same Postgres-backed store the admin queue and the contract-scoped
// endpoints read from.
//
// db is the gateway pool, used ONLY to resolve a service dispute's counterparty
// (the contracts row carries customer_id/provider_id) so the notification on
// filing reaches the OTHER party, not the filer. It is nil-safe: a nil pool
// degrades to "no notification" (the dispute itself still files).
type DisputeHandler struct {
	contractClient contractv1.ContractServiceClient
	db             *pgxpool.Pool
}

// NewDisputeHandler creates a new DisputeHandler.
func NewDisputeHandler(contractClient contractv1.ContractServiceClient, db *pgxpool.Pool) *DisputeHandler {
	return &DisputeHandler{contractClient: contractClient, db: db}
}

// contractParties resolves the (customer_id, provider_id) for a contract so a
// dispute notification can target the party who is NOT the actor. Returns empty
// strings on any failure — the caller treats that as "skip notification" (the
// emit seam is also no-self-notify + nil-safe, so this only loses enrichment).
func (h *DisputeHandler) contractParties(ctx context.Context, contractID string) (customerID, providerID string) {
	if h.db == nil || contractID == "" {
		return "", ""
	}
	if err := h.db.QueryRow(ctx,
		`SELECT customer_id::text, provider_id::text FROM contracts WHERE id = $1`, contractID,
	).Scan(&customerID, &providerID); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.ErrorContext(ctx, "dispute notification: contract party lookup failed",
				"error", err, "contract_id", contractID)
		}
		return "", ""
	}
	return customerID, providerID
}

// disputeReasonToType maps the reason values the dispute-filing form sends to
// the canonical contract-service dispute type strings (see stringToDisputeType).
func disputeReasonToType(reason string) string {
	switch reason {
	case "quality_issue":
		return "quality"
	case "incomplete_work":
		return "incomplete_work"
	case "no_show":
		return "no_show"
	case "property_damage":
		return "other"
	case "other":
		return "other"
	default:
		return ""
	}
}

// FileDispute handles POST /api/v1/disputes.
//
// It delegates to the contract service's OpenDispute RPC, which (a) validates
// the referenced contract exists (404 if not), (b) verifies the caller is the
// customer or provider on that contract (403 otherwise), and (c) persists the
// dispute to the Postgres `disputes` table so it is readable by its creator via
// GET /disputes/{id} and visible in the admin dispute queue.
func (h *DisputeHandler) FileDispute(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		ContractID   string   `json:"contract_id"`
		Reason       string   `json:"reason"`
		Description  string   `json:"description"`
		EvidenceURLs []string `json:"evidence_urls"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}

	if body.ContractID == "" {
		writeError(w, http.StatusBadRequest, "contract_id is required")
		return
	}
	if body.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason is required")
		return
	}
	if len(body.Description) < 50 {
		writeError(w, http.StatusBadRequest, "description must be at least 50 characters")
		return
	}

	disputeType := disputeReasonToType(body.Reason)
	if disputeType == "" {
		writeError(w, http.StatusBadRequest, "invalid reason; must be one of: quality_issue, incomplete_work, no_show, property_damage, other")
		return
	}

	resp, err := h.contractClient.OpenDispute(r.Context(), &contractv1.OpenDisputeRequest{
		ContractId:       body.ContractID,
		UserId:           claims.UserID,
		DisputeType:      stringToDisputeType(disputeType),
		Description:      body.Description,
		EvidenceUrls:     body.EvidenceURLs,
		IsGuaranteeClaim: false,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	dispute := resp.GetDispute()

	slog.Info("dispute filed",
		"dispute_id", dispute.GetId(),
		"contract_id", body.ContractID,
		"user_id", claims.UserID,
	)

	// Notify the counterparty (the contract party who did NOT file) that a
	// dispute was opened against the contract. Fail-soft: resolves parties from
	// the contracts row; if the lookup fails we skip the notification rather
	// than fail the (already-committed) dispute. emitNotification also guards
	// self-notify, so passing the filer as actor is belt-and-suspenders.
	customerID, providerID := h.contractParties(r.Context(), body.ContractID)
	counterparty := customerID
	if claims.UserID == customerID {
		counterparty = providerID
	}
	emitNotification(r.Context(), h.db,
		claims.UserID, counterparty,
		"dispute_opened",
		"A dispute was opened",
		"The other party opened a dispute on your contract. Review the details and respond.",
		"/contracts/"+body.ContractID,
		"contract", body.ContractID,
	)

	writeJSON(w, http.StatusCreated, map[string]string{
		"dispute_id": dispute.GetId(),
		"status":     disputeStatusToString(dispute.GetStatus()),
	})
}

// GetDispute handles GET /api/v1/disputes/{id}.
//
// Party access is enforced by the RequireJoinedPartyAccess middleware on the
// route (it joins the dispute to its contract and checks customer_id/provider_id).
// The dispute itself is read from the Postgres-backed contract service.
func (h *DisputeHandler) GetDispute(w http.ResponseWriter, r *http.Request) {
	if _, ok := middleware.GetClaims(r.Context()); !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

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
		"dispute": disputeJSONWithLegacyAliases(resp.GetDispute()),
	})
}

// disputeJSONWithLegacyAliases marshals a contract-service Dispute and adds the
// legacy field names the web client still reads. The contract service renamed
// the initiator field to `opened_by` and replaced the free-text `reason` with
// `dispute_type` + `description`; the disputes UI slices `initiated_by` and
// renders `reason`, so we alias them here to keep the existing client contract
// intact (and avoid a `undefined.slice` crash) without changing the shared
// protoDisputeToJSON used elsewhere.
func disputeJSONWithLegacyAliases(d *contractv1.Dispute) map[string]interface{} {
	out := protoDisputeToJSON(d)
	if d == nil {
		return out
	}
	out["initiated_by"] = d.GetOpenedBy()
	if d.GetDescription() != "" {
		out["reason"] = d.GetDescription()
	} else {
		out["reason"] = disputeTypeToString(d.GetDisputeType())
	}
	return out
}
