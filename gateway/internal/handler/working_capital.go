package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// WorkingCapitalHandler handles HTTP endpoints for working capital advances.
// Since the gRPC service does not exist yet, handlers return structured mock
// responses so the frontend can render realistic UI.
type WorkingCapitalHandler struct{}

// NewWorkingCapitalHandler creates a new WorkingCapitalHandler.
func NewWorkingCapitalHandler() *WorkingCapitalHandler {
	return &WorkingCapitalHandler{}
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

	now := time.Now().UTC().Format(time.RFC3339)
	feeCents := int64(float64(req.AmountCents) * 0.03) // 3% fee estimate

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"advance": map[string]interface{}{
			"id":                   uuid.New().String(),
			"provider_id":          claims.UserID,
			"contract_id":          req.ContractID,
			"advance_amount_cents": req.AmountCents,
			"fee_cents":            feeCents,
			"repaid_cents":         0,
			"status":               "requested",
			"reviewed_by":          nil,
			"reviewed_at":          nil,
			"rejection_reason":     nil,
			"disbursed_at":         nil,
			"repaid_at":            nil,
			"created_at":           now,
			"updated_at":           now,
		},
	})
}

// ListMyAdvances handles GET /api/v1/providers/me/advances.
func (h *WorkingCapitalHandler) ListMyAdvances(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advances": []interface{}{},
		"pagination": map[string]interface{}{
			"total_count": 0,
			"page":        1,
			"page_size":   20,
			"total_pages": 0,
			"has_next":    false,
		},
	})
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

	now := time.Now().UTC().Format(time.RFC3339)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advance": map[string]interface{}{
			"id":                   advanceID,
			"provider_id":          claims.UserID,
			"contract_id":          uuid.New().String(),
			"advance_amount_cents": 50000,
			"fee_cents":            1500,
			"repaid_cents":         0,
			"status":               "requested",
			"reviewed_by":          nil,
			"reviewed_at":          nil,
			"rejection_reason":     nil,
			"disbursed_at":         nil,
			"repaid_at":            nil,
			"created_at":           now,
			"updated_at":           now,
		},
	})
}

// AdminListAdvances handles GET /api/v1/admin/advances.
func (h *WorkingCapitalHandler) AdminListAdvances(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advances": []interface{}{},
		"pagination": map[string]interface{}{
			"total_count": 0,
			"page":        1,
			"page_size":   20,
			"total_pages": 0,
			"has_next":    false,
		},
	})
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

	now := time.Now().UTC().Format(time.RFC3339)

	status := "approved"
	if req.Action == "reject" {
		status = "rejected"
	}

	result := map[string]interface{}{
		"advance": map[string]interface{}{
			"id":                   advanceID,
			"provider_id":          uuid.New().String(),
			"contract_id":          uuid.New().String(),
			"advance_amount_cents": 50000,
			"fee_cents":            1500,
			"repaid_cents":         0,
			"status":               status,
			"reviewed_by":          claims.UserID,
			"reviewed_at":          now,
			"rejection_reason":     nil,
			"disbursed_at":         nil,
			"repaid_at":            nil,
			"created_at":           now,
			"updated_at":           now,
		},
	}

	if req.Action == "reject" && req.Reason != "" {
		result["advance"].(map[string]interface{})["rejection_reason"] = req.Reason
	}

	writeJSON(w, http.StatusOK, result)
}
