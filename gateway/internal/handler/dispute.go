package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const disputeTTL = 30 * 24 * time.Hour

// disputeRecord is stored in Redis under dispute:{id}.
type disputeRecord struct {
	ID           string   `json:"dispute_id"`
	ContractID   string   `json:"contract_id"`
	Reason       string   `json:"reason"`
	Description  string   `json:"description"`
	EvidenceURLs []string `json:"evidence_urls"`
	CreatedBy    string   `json:"created_by"`
	Status       string   `json:"status"`
	CreatedAt    string   `json:"created_at"`
}

// DisputeHandler handles dispute filing endpoints.
type DisputeHandler struct {
	cache *cache.Client
}

// NewDisputeHandler creates a new DisputeHandler.
func NewDisputeHandler(cacheClient *cache.Client) *DisputeHandler {
	return &DisputeHandler{cache: cacheClient}
}

// FileDispute handles POST /api/v1/disputes.
// Requires auth. Stores dispute in Redis with a 30-day TTL.
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

	// Validate reason is one of the allowed values.
	allowed := map[string]bool{
		"quality_issue":    true,
		"incomplete_work":  true,
		"no_show":          true,
		"property_damage":  true,
		"other":            true,
	}
	if !allowed[body.Reason] {
		writeError(w, http.StatusBadRequest, "invalid reason; must be one of: quality_issue, incomplete_work, no_show, property_damage, other")
		return
	}

	disputeID := uuid.New().String()
	now := time.Now().UTC().Format(time.RFC3339)

	evidenceURLs := body.EvidenceURLs
	if evidenceURLs == nil {
		evidenceURLs = []string{}
	}

	rec := disputeRecord{
		ID:           disputeID,
		ContractID:   body.ContractID,
		Reason:       body.Reason,
		Description:  body.Description,
		EvidenceURLs: evidenceURLs,
		CreatedBy:    claims.UserID,
		Status:       "filed",
		CreatedAt:    now,
	}

	redisKey := fmt.Sprintf("dispute:%s", disputeID)
	h.cache.SetJSON(r.Context(), redisKey, rec, disputeTTL)

	slog.Info("dispute filed",
		"dispute_id", disputeID,
		"contract_id", body.ContractID,
		"user_id", claims.UserID,
	)

	writeJSON(w, http.StatusCreated, map[string]string{
		"dispute_id": disputeID,
		"status":     "filed",
	})
}

// GetDispute handles GET /api/v1/disputes/{id}.
// Requires auth. Returns dispute from Redis.
func (h *DisputeHandler) GetDispute(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	disputeID := chi.URLParam(r, "id")
	if disputeID == "" {
		writeError(w, http.StatusBadRequest, "dispute id required")
		return
	}

	redisKey := fmt.Sprintf("dispute:%s", disputeID)

	var rec disputeRecord
	if !h.cache.GetJSON(r.Context(), redisKey, &rec) {
		writeError(w, http.StatusNotFound, "dispute not found")
		return
	}

	// Only the creator may view the dispute (admins handled via admin endpoints).
	if rec.CreatedBy != claims.UserID {
		writeError(w, http.StatusForbidden, "access denied")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"dispute": rec,
	})
}
