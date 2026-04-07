package handler

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const (
	instantMatchTTL     = 20 * time.Minute
	instantMatchOfferTTL = 15 * time.Minute
)

// instantMatchRecord is stored in Redis under instant_match:{jobId}.
type instantMatchRecord struct {
	Status      string `json:"status"`
	ProviderID  string `json:"provider_id"`
	OfferSentAt string `json:"offer_sent_at"`
	ExpiresAt   string `json:"expires_at"`
	JobTitle    string `json:"job_title,omitempty"`
	AmountCents int64  `json:"amount_cents,omitempty"`
}

// InstantMatchHandler handles instant match endpoints.
type InstantMatchHandler struct {
	jobClient jobv1.JobServiceClient
	cache     *cache.Client
}

// NewInstantMatchHandler creates a new InstantMatchHandler.
func NewInstantMatchHandler(jobClient jobv1.JobServiceClient, cacheClient *cache.Client) *InstantMatchHandler {
	return &InstantMatchHandler{jobClient: jobClient, cache: cacheClient}
}

// CreateInstantMatch handles POST /api/v1/jobs/{id}/instant-match.
// Requires auth — customer only. Creates a pending instant match record in Redis.
func (h *InstantMatchHandler) CreateInstantMatch(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if !hasRole(claims, "customer") {
		writeError(w, http.StatusForbidden, "customer role required")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	// Fetch job details to verify ownership and get metadata.
	jobResp, err := h.jobClient.GetJob(r.Context(), &jobv1.GetJobRequest{
		JobId:            jobID,
		RequestingUserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	job := jobResp.GetJob().GetJob()
	if job == nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	// Verify the requesting user owns the job.
	if job.GetCustomerId() != claims.UserID {
		writeError(w, http.StatusForbidden, "you do not own this job")
		return
	}

	now := time.Now().UTC()
	expiresAt := now.Add(instantMatchOfferTTL)

	rec := instantMatchRecord{
		Status:      "pending",
		ProviderID:  "",
		OfferSentAt: now.Format(time.RFC3339),
		ExpiresAt:   expiresAt.Format(time.RFC3339),
		JobTitle:    job.GetTitle(),
	}

	if job.StartingBidCents != nil {
		rec.AmountCents = job.GetStartingBidCents()
	}

	redisKey := fmt.Sprintf("instant_match:%s", jobID)
	h.cache.SetJSON(r.Context(), redisKey, rec, instantMatchTTL)

	slog.Info("instant match created",
		"job_id", jobID,
		"customer_id", claims.UserID,
		"expires_at", expiresAt,
	)

	writeJSON(w, http.StatusOK, map[string]string{
		"status":     "offer_sent",
		"expires_at": expiresAt.Format(time.RFC3339),
	})
}

// ListProviderOffers handles GET /api/v1/provider/offers.
// Requires auth — provider only. Scans Redis for all pending instant_match:* keys.
func (h *InstantMatchHandler) ListProviderOffers(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	// Use the underlying Redis client to scan for matching keys.
	if h.cache == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"offers": []interface{}{}})
		return
	}

	rdb := h.cache.Redis()
	if rdb == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"offers": []interface{}{}})
		return
	}

	ctx := r.Context()
	var keys []string
	var cursor uint64
	for {
		batch, nextCursor, err := rdb.Scan(ctx, cursor, "instant_match:*", 100).Result()
		if err != nil {
			slog.Warn("instant match scan error", "error", err)
			break
		}
		keys = append(keys, batch...)
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	offers := make([]map[string]interface{}, 0, len(keys))
	for _, key := range keys {
		data, err := rdb.Get(ctx, key).Bytes()
		if err != nil {
			continue
		}

		var rec instantMatchRecord
		if err := json.Unmarshal(data, &rec); err != nil {
			continue
		}

		if rec.Status != "pending" {
			continue
		}

		// Extract jobID from key (format: instant_match:{jobId}).
		jobID := ""
		if len(key) > len("instant_match:") {
			jobID = key[len("instant_match:"):]
		}

		offers = append(offers, map[string]interface{}{
			"job_id":     jobID,
			"job_title":  rec.JobTitle,
			"expires_at": rec.ExpiresAt,
			"amount_cents": rec.AmountCents,
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"offers": offers})
}

// AcceptOffer handles POST /api/v1/provider/offers/{jobId}/accept.
// Requires auth — provider only.
func (h *InstantMatchHandler) AcceptOffer(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if !hasRole(claims, "provider") {
		writeError(w, http.StatusForbidden, "provider role required")
		return
	}

	jobID := chi.URLParam(r, "jobId")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	redisKey := fmt.Sprintf("instant_match:%s", jobID)

	var rec instantMatchRecord
	if !h.cache.GetJSON(r.Context(), redisKey, &rec) {
		writeError(w, http.StatusNotFound, "offer not found")
		return
	}

	if rec.Status != "pending" {
		writeError(w, http.StatusConflict, "offer is no longer pending")
		return
	}

	// Check if expired.
	expiresAt, err := time.Parse(time.RFC3339, rec.ExpiresAt)
	if err == nil && time.Now().UTC().After(expiresAt) {
		writeError(w, http.StatusGone, "offer has expired")
		return
	}

	rec.Status = "accepted"
	rec.ProviderID = claims.UserID
	h.cache.SetJSON(r.Context(), redisKey, rec, instantMatchTTL)

	slog.Info("instant match offer accepted",
		"job_id", jobID,
		"provider_id", claims.UserID,
	)

	writeJSON(w, http.StatusOK, map[string]string{"status": "accepted"})
}

// DeclineOffer handles POST /api/v1/provider/offers/{jobId}/decline.
// Requires auth — provider only.
func (h *InstantMatchHandler) DeclineOffer(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if !hasRole(claims, "provider") {
		writeError(w, http.StatusForbidden, "provider role required")
		return
	}

	jobID := chi.URLParam(r, "jobId")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	redisKey := fmt.Sprintf("instant_match:%s", jobID)

	var rec instantMatchRecord
	if !h.cache.GetJSON(r.Context(), redisKey, &rec) {
		writeError(w, http.StatusNotFound, "offer not found")
		return
	}

	if rec.Status != "pending" {
		writeError(w, http.StatusConflict, "offer is no longer pending")
		return
	}

	rec.Status = "declined"
	h.cache.SetJSON(r.Context(), redisKey, rec, instantMatchTTL)

	slog.Info("instant match offer declined",
		"job_id", jobID,
		"provider_id", claims.UserID,
	)

	writeJSON(w, http.StatusOK, map[string]string{"status": "declined"})
}

