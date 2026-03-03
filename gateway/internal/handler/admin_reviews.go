package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	reviewv1 "github.com/nomarkup/nomarkup/proto/review/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminReviewsHandler handles admin review moderation endpoints.
type AdminReviewsHandler struct {
	reviewClient reviewv1.ReviewServiceClient
}

// NewAdminReviewsHandler creates a new AdminReviewsHandler.
func NewAdminReviewsHandler(reviewClient reviewv1.ReviewServiceClient) *AdminReviewsHandler {
	return &AdminReviewsHandler{reviewClient: reviewClient}
}

// ListFlaggedReviews handles GET /api/v1/admin/reviews/flagged.
// Query params: status, page, page_size.
func (h *AdminReviewsHandler) ListFlaggedReviews(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &reviewv1.AdminListFlaggedReviewsRequest{}

	// Parse optional status filter.
	if s := q.Get("status"); s != "" {
		status := parseFlagStatus(s)
		if status != reviewv1.FlagStatus_FLAG_STATUS_UNSPECIFIED {
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

	resp, err := h.reviewClient.AdminListFlaggedReviews(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	flagged := make([]map[string]interface{}, 0, len(resp.GetFlaggedReviews()))
	for _, fr := range resp.GetFlaggedReviews() {
		flagged = append(flagged, flaggedReviewToJSON(fr))
	}

	result := map[string]interface{}{
		"flagged_reviews": flagged,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

// ResolveFlag handles POST /api/v1/admin/reviews/flags/{id}/resolve.
func (h *AdminReviewsHandler) ResolveFlag(w http.ResponseWriter, r *http.Request) {
	flagID := chi.URLParam(r, "id")
	if flagID == "" {
		writeError(w, http.StatusBadRequest, "flag id required")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Uphold          bool   `json:"uphold"`
		ResolutionNotes string `json:"resolution_notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	resp, err := h.reviewClient.AdminResolveFlag(r.Context(), &reviewv1.AdminResolveFlagRequest{
		FlagId:          flagID,
		AdminId:         claims.UserID,
		Uphold:          body.Uphold,
		ResolutionNotes: body.ResolutionNotes,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": flagStatusToString(resp.GetStatus()),
	})
}

// RemoveReview handles DELETE /api/v1/admin/reviews/{id}.
func (h *AdminReviewsHandler) RemoveReview(w http.ResponseWriter, r *http.Request) {
	reviewID := chi.URLParam(r, "id")
	if reviewID == "" {
		writeError(w, http.StatusBadRequest, "review id required")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason is required")
		return
	}

	_, err := h.reviewClient.AdminRemoveReview(r.Context(), &reviewv1.AdminRemoveReviewRequest{
		ReviewId: reviewID,
		AdminId:  claims.UserID,
		Reason:   body.Reason,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message": "review removed",
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func flaggedReviewToJSON(fr *reviewv1.FlaggedReview) map[string]interface{} {
	if fr == nil {
		return map[string]interface{}{}
	}
	result := map[string]interface{}{
		"flag_id":    fr.GetFlagId(),
		"flagged_by": fr.GetFlaggedBy(),
		"reason":     flagReasonToString(fr.GetReason()),
		"details":    fr.GetDetails(),
		"status":     flagStatusToString(fr.GetStatus()),
		"flagged_at": formatTimestamp(fr.GetFlaggedAt()),
	}
	if fr.GetReview() != nil {
		result["review"] = adminReviewSummaryToJSON(fr.GetReview())
	}
	return result
}

func adminReviewSummaryToJSON(r *reviewv1.Review) map[string]interface{} {
	if r == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"id":             r.GetId(),
		"contract_id":    r.GetContractId(),
		"reviewer_id":    r.GetReviewerId(),
		"reviewee_id":    r.GetRevieweeId(),
		"overall_rating": r.GetOverallRating(),
		"comment":        r.GetComment(),
		"created_at":     formatTimestamp(r.GetCreatedAt()),
	}
}

func flagStatusToString(s reviewv1.FlagStatus) string {
	switch s {
	case reviewv1.FlagStatus_FLAG_STATUS_PENDING:
		return "pending"
	case reviewv1.FlagStatus_FLAG_STATUS_UPHELD:
		return "upheld"
	case reviewv1.FlagStatus_FLAG_STATUS_DISMISSED:
		return "dismissed"
	default:
		return "unspecified"
	}
}

func parseFlagStatus(s string) reviewv1.FlagStatus {
	switch s {
	case "pending":
		return reviewv1.FlagStatus_FLAG_STATUS_PENDING
	case "upheld":
		return reviewv1.FlagStatus_FLAG_STATUS_UPHELD
	case "dismissed":
		return reviewv1.FlagStatus_FLAG_STATUS_DISMISSED
	default:
		return reviewv1.FlagStatus_FLAG_STATUS_UNSPECIFIED
	}
}

func flagReasonToString(r reviewv1.FlagReason) string {
	switch r {
	case reviewv1.FlagReason_FLAG_REASON_INAPPROPRIATE:
		return "inappropriate"
	case reviewv1.FlagReason_FLAG_REASON_FAKE:
		return "fake"
	case reviewv1.FlagReason_FLAG_REASON_HARASSMENT:
		return "harassment"
	case reviewv1.FlagReason_FLAG_REASON_SPAM:
		return "spam"
	case reviewv1.FlagReason_FLAG_REASON_IRRELEVANT:
		return "irrelevant"
	default:
		return "unspecified"
	}
}
