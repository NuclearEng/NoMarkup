package handler

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// DisputeHandler handles the standalone, contract-agnostic dispute endpoints
// (POST /api/v1/disputes, GET /api/v1/disputes/{id}). These are a thin wrapper
// over the contract service's dispute RPCs so that disputes filed here land in
// the same Postgres-backed store the admin queue and the contract-scoped
// endpoints read from.
type DisputeHandler struct {
	contractClient contractv1.ContractServiceClient
}

// NewDisputeHandler creates a new DisputeHandler.
func NewDisputeHandler(contractClient contractv1.ContractServiceClient) *DisputeHandler {
	return &DisputeHandler{contractClient: contractClient}
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
		"dispute": protoDisputeToJSON(resp.GetDispute()),
	})
}
