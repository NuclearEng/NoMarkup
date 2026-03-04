package handler

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	trustv1 "github.com/nomarkup/nomarkup/proto/trust/v1"
)

const trustScoreCacheTTL = 5 * time.Minute

// TrustHandler handles HTTP endpoints for trust scores.
type TrustHandler struct {
	trustClient trustv1.TrustServiceClient
	cache       *cache.Client
}

// NewTrustHandler creates a new TrustHandler.
func NewTrustHandler(trustClient trustv1.TrustServiceClient, cacheClient *cache.Client) *TrustHandler {
	return &TrustHandler{trustClient: trustClient, cache: cacheClient}
}

// GetTrustScore handles GET /api/v1/users/{id}/trust-score.
func (h *TrustHandler) GetTrustScore(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	cacheKey := cache.Key("trust", "score", userID)

	// Try cache first.
	var cached map[string]interface{}
	if h.cache.GetJSON(r.Context(), cacheKey, &cached) {
		slog.Debug("cache hit", "key", cacheKey)
		writeJSON(w, http.StatusOK, cached)
		return
	}

	resp, err := h.trustClient.GetTrustScore(r.Context(), &trustv1.GetTrustScoreRequest{
		UserId: userID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := protoTrustScoreToJSON(resp.GetScore())

	// Store in cache.
	h.cache.SetJSON(r.Context(), cacheKey, result, trustScoreCacheTTL)

	writeJSON(w, http.StatusOK, result)
}

// GetTrustScoreHistory handles GET /api/v1/users/{id}/trust-history.
func (h *TrustHandler) GetTrustScoreHistory(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	q := r.URL.Query()

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

	resp, err := h.trustClient.GetTrustScoreHistory(r.Context(), &trustv1.GetTrustScoreHistoryRequest{
		UserId: userID,
		Pagination: &commonv1.PaginationRequest{
			Page:     page,
			PageSize: pageSize,
		},
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	snapshots := make([]map[string]interface{}, 0, len(resp.GetSnapshots()))
	for _, s := range resp.GetSnapshots() {
		entry := map[string]interface{}{
			"change_reason": s.GetChangeReason(),
			"recorded_at":   formatTimestamp(s.GetRecordedAt()),
		}
		if s.GetScore() != nil {
			entry["score"] = protoTrustScoreToJSON(s.GetScore())
		}
		if s.GetPreviousOverall() > 0 {
			entry["previous_overall"] = s.GetPreviousOverall()
		}
		if s.GetPreviousTier() != commonv1.TrustTier_TRUST_TIER_UNSPECIFIED {
			entry["previous_tier"] = trustTierToString(s.GetPreviousTier())
		}
		snapshots = append(snapshots, entry)
	}

	result := map[string]interface{}{
		"snapshots": snapshots,
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

// GetTierRequirements handles GET /api/v1/trust/tiers.
func (h *TrustHandler) GetTierRequirements(w http.ResponseWriter, r *http.Request) {
	resp, err := h.trustClient.GetTierRequirements(r.Context(), &trustv1.GetTierRequirementsRequest{})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	tiers := make([]map[string]interface{}, 0, len(resp.GetTiers()))
	for _, t := range resp.GetTiers() {
		tiers = append(tiers, map[string]interface{}{
			"tier":                  trustTierToString(t.GetTier()),
			"min_overall_score":     t.GetMinOverallScore(),
			"min_completed_jobs":    t.GetMinCompletedJobs(),
			"min_reviews":           t.GetMinReviews(),
			"min_rating":            t.GetMinRating(),
			"requires_verification": t.GetRequiresVerification(),
			"description":           t.GetDescription(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tiers": tiers,
	})
}

// --- Proto to JSON conversion helpers ---

func protoTrustScoreToJSON(s *trustv1.TrustScore) map[string]interface{} {
	if s == nil {
		return map[string]interface{}{}
	}

	return map[string]interface{}{
		"user_id":        s.GetUserId(),
		"overall_score":  s.GetOverallScore(),
		"tier":           trustTierToString(s.GetTier()),
		"feedback_score": s.GetFeedbackScore(),
		"volume_score":   s.GetVolumeScore(),
		"risk_score":     s.GetRiskScore(),
		"fraud_score":    s.GetFraudScore(),
		"data_points":    s.GetDataPoints(),
		"computed_at":    formatTimestamp(s.GetComputedAt()),
	}
}

// --- Enum conversions ---

func trustTierToString(t commonv1.TrustTier) string {
	switch t {
	case commonv1.TrustTier_TRUST_TIER_UNDER_REVIEW:
		return "under_review"
	case commonv1.TrustTier_TRUST_TIER_NEW:
		return "new"
	case commonv1.TrustTier_TRUST_TIER_RISING:
		return "rising"
	case commonv1.TrustTier_TRUST_TIER_TRUSTED:
		return "trusted"
	case commonv1.TrustTier_TRUST_TIER_TOP_RATED:
		return "top_rated"
	default:
		return "unspecified"
	}
}
