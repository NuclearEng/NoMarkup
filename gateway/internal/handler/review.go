package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	reviewv1 "github.com/nomarkup/nomarkup/proto/review/v1"
	trustv1 "github.com/nomarkup/nomarkup/proto/trust/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ReviewHandler handles HTTP endpoints for reviews.
type ReviewHandler struct {
	reviewClient reviewv1.ReviewServiceClient
	trustClient  trustv1.TrustServiceClient
	db           *pgxpool.Pool
}

// NewReviewHandler creates a new ReviewHandler.
//
// trustClient is used to recompute the reviewee's trust score after a review is
// created (the double-blind publish path lives in the review service; the trust
// engine reads only published reviews, so a recompute is always safe and only
// moves the score once both parties have submitted and the reviews go live).
//
// db is the gateway pool, passed only so the emitNotification seam can write the
// reviewee's "a review was submitted" in-app row (and gate it on their prefs).
// nil-safe.
func NewReviewHandler(reviewClient reviewv1.ReviewServiceClient, trustClient trustv1.TrustServiceClient, db *pgxpool.Pool) *ReviewHandler {
	return &ReviewHandler{reviewClient: reviewClient, trustClient: trustClient, db: db}
}

// createReviewRequest is the JSON request body for creating a review.
type createReviewRequest struct {
	OverallRating       int32    `json:"overall_rating"`
	QualityRating       *int32   `json:"quality_rating,omitempty"`
	CommunicationRating *int32   `json:"communication_rating,omitempty"`
	TimelinessRating    *int32   `json:"timeliness_rating,omitempty"`
	ValueRating         *int32   `json:"value_rating,omitempty"`
	Comment             string   `json:"comment"`
	PhotoURLs           []string `json:"photo_urls,omitempty"`
}

// CreateReview handles POST /api/v1/contracts/{id}/reviews.
func (h *ReviewHandler) CreateReview(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	var req createReviewRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	grpcReq := &reviewv1.CreateReviewRequest{
		ContractId:    contractID,
		ReviewerId:    claims.UserID,
		OverallRating: req.OverallRating,
		Comment:       req.Comment,
		PhotoUrls:     req.PhotoURLs,
	}
	if req.QualityRating != nil {
		grpcReq.QualityRating = req.QualityRating
	}
	if req.CommunicationRating != nil {
		grpcReq.CommunicationRating = req.CommunicationRating
	}
	if req.TimelinessRating != nil {
		grpcReq.TimelinessRating = req.TimelinessRating
	}
	if req.ValueRating != nil {
		grpcReq.ValueRating = req.ValueRating
	}

	resp, err := h.reviewClient.CreateReview(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	review := resp.GetReview()

	// Feed the new review into the trust score. The review service publishes the
	// double-blind pair once both sides submit; the trust engine only counts
	// published reviews, so this recompute reflects the reviewee's true rating as
	// soon as the pair goes live. Fire-and-forget: a recompute failure must not
	// fail the review write.
	h.recomputeTrustScore(review.GetRevieweeId())

	// Notify the reviewee that they were reviewed — but stay CONTENT-NEUTRAL.
	// Reviews are double-blind: the rating/comment must not leak before the pair
	// is published, and the gateway does not see the publish state. A neutral
	// "a review was submitted" is safe in BOTH the pending and published states
	// and never reveals the score. Recipient is the reviewee; the reviewer is
	// the actor (self-notify guard covers the same-user edge). Fail-soft.
	emitNotification(r.Context(), h.db,
		review.GetReviewerId(), review.GetRevieweeId(),
		"review_received",
		"A review was submitted",
		"Someone submitted a review for your completed work. It becomes visible once both sides review.",
		"/profile/reviews",
		"contract", review.GetContractId(),
	)

	writeJSON(w, http.StatusCreated, protoReviewToJSON(review))
}

// recomputeTrustScore asynchronously triggers a trust-score recomputation for a
// user. Used after review writes so a published review actually moves the
// reviewee's trust score. Errors are logged, never surfaced — trust scoring is a
// derived signal and must degrade gracefully (§15: fail soft).
func (h *ReviewHandler) recomputeTrustScore(userID string) {
	if h.trustClient == nil || userID == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := h.trustClient.ComputeTrustScore(ctx, &trustv1.ComputeTrustScoreRequest{
			UserId:        userID,
			TriggerReason: "review_received",
		}); err != nil {
			slog.Warn("trust score recompute after review failed", "user_id", userID, "error", err)
		}
	}()
}

// GetReview handles GET /api/v1/reviews/{id}.
func (h *ReviewHandler) GetReview(w http.ResponseWriter, r *http.Request) {
	reviewID := chi.URLParam(r, "id")
	if reviewID == "" {
		writeError(w, http.StatusBadRequest, "review id required")
		return
	}

	resp, err := h.reviewClient.GetReview(r.Context(), &reviewv1.GetReviewRequest{
		ReviewId: reviewID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoReviewToJSON(resp.GetReview()))
}

// ListReviewsForUser handles GET /api/v1/users/{id}/reviews.
func (h *ReviewHandler) ListReviewsForUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}
	if !isValidUUID(userID) {
		writeError(w, http.StatusBadRequest, "user id must be a valid UUID")
		return
	}

	q := r.URL.Query()

	grpcReq := &reviewv1.ListReviewsForUserRequest{
		UserId: userID,
	}

	if direction := q.Get("direction"); direction != "" {
		d := stringToReviewDirection(direction)
		grpcReq.DirectionFilter = &d
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

	resp, err := h.reviewClient.ListReviewsForUser(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	reviews := make([]map[string]interface{}, 0, len(resp.GetReviews()))
	for _, rev := range resp.GetReviews() {
		reviews = append(reviews, protoReviewToJSON(rev))
	}

	result := map[string]interface{}{
		"reviews":        reviews,
		"average_rating": resp.GetAverageRating(),
		"total_reviews":  resp.GetTotalReviews(),
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

type respondToReviewRequest struct {
	Comment string `json:"comment"`
}

// RespondToReview handles POST /api/v1/reviews/{id}/respond.
func (h *ReviewHandler) RespondToReview(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	reviewID := chi.URLParam(r, "id")
	if reviewID == "" {
		writeError(w, http.StatusBadRequest, "review id required")
		return
	}

	var req respondToReviewRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.reviewClient.RespondToReview(r.Context(), &reviewv1.RespondToReviewRequest{
		ReviewId:    reviewID,
		ResponderId: claims.UserID,
		Comment:     req.Comment,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, protoReviewResponseToJSON(resp.GetResponse()))
}

type flagReviewRequest struct {
	Reason  string `json:"reason"`
	Details string `json:"details"`
}

// FlagReview handles POST /api/v1/reviews/{id}/flag.
func (h *ReviewHandler) FlagReview(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	reviewID := chi.URLParam(r, "id")
	if reviewID == "" {
		writeError(w, http.StatusBadRequest, "review id required")
		return
	}

	var req flagReviewRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.reviewClient.FlagReview(r.Context(), &reviewv1.FlagReviewRequest{
		ReviewId:  reviewID,
		FlaggedBy: claims.UserID,
		Reason:    stringToFlagReason(req.Reason),
		Details:   req.Details,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"flag_id": resp.GetFlagId(),
	})
}

// GetReviewEligibility handles GET /api/v1/contracts/{id}/reviews/eligibility.
func (h *ReviewHandler) GetReviewEligibility(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	resp, err := h.reviewClient.GetReviewEligibility(r.Context(), &reviewv1.GetReviewEligibilityRequest{
		ContractId: contractID,
		UserId:     claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := map[string]interface{}{
		"eligible":         resp.GetEligible(),
		"already_reviewed": resp.GetAlreadyReviewed(),
	}
	if resp.GetReviewWindowClosesAt() != nil {
		result["review_window_closes_at"] = formatTimestamp(resp.GetReviewWindowClosesAt())
	}

	writeJSON(w, http.StatusOK, result)
}

// --- Proto to JSON conversion helpers ---

func protoReviewToJSON(r *reviewv1.Review) map[string]interface{} {
	if r == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":             r.GetId(),
		"contract_id":    r.GetContractId(),
		"reviewer_id":    r.GetReviewerId(),
		"reviewee_id":    r.GetRevieweeId(),
		"direction":      reviewDirectionToString(r.GetDirection()),
		"overall_rating": r.GetOverallRating(),
		"comment":        r.GetComment(),
		"is_flagged":     r.GetIsFlagged(),
		"created_at":     formatTimestamp(r.GetCreatedAt()),
	}

	if r.GetQualityRating() > 0 {
		result["quality_rating"] = r.GetQualityRating()
	}
	if r.GetCommunicationRating() > 0 {
		result["communication_rating"] = r.GetCommunicationRating()
	}
	if r.GetTimelinessRating() > 0 {
		result["timeliness_rating"] = r.GetTimelinessRating()
	}
	if r.GetValueRating() > 0 {
		result["value_rating"] = r.GetValueRating()
	}

	if len(r.GetPhotoUrls()) > 0 {
		result["photo_urls"] = r.GetPhotoUrls()
	}

	if r.GetResponse() != nil {
		result["response"] = protoReviewResponseToJSON(r.GetResponse())
	}

	return result
}

func protoReviewResponseToJSON(r *reviewv1.ReviewResponse) map[string]interface{} {
	if r == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"id":           r.GetId(),
		"review_id":    r.GetReviewId(),
		"responder_id": r.GetResponderId(),
		"comment":      r.GetComment(),
		"created_at":   formatTimestamp(r.GetCreatedAt()),
	}
}

// --- Enum conversions ---

func reviewDirectionToString(d reviewv1.ReviewDirection) string {
	switch d {
	case reviewv1.ReviewDirection_REVIEW_DIRECTION_CUSTOMER_TO_PROVIDER:
		return "customer_to_provider"
	case reviewv1.ReviewDirection_REVIEW_DIRECTION_PROVIDER_TO_CUSTOMER:
		return "provider_to_customer"
	default:
		return "unspecified"
	}
}

func stringToReviewDirection(s string) reviewv1.ReviewDirection {
	switch s {
	case "customer_to_provider":
		return reviewv1.ReviewDirection_REVIEW_DIRECTION_CUSTOMER_TO_PROVIDER
	case "provider_to_customer":
		return reviewv1.ReviewDirection_REVIEW_DIRECTION_PROVIDER_TO_CUSTOMER
	default:
		return reviewv1.ReviewDirection_REVIEW_DIRECTION_UNSPECIFIED
	}
}

func stringToFlagReason(s string) reviewv1.FlagReason {
	switch s {
	case "inappropriate":
		return reviewv1.FlagReason_FLAG_REASON_INAPPROPRIATE
	case "fake":
		return reviewv1.FlagReason_FLAG_REASON_FAKE
	case "harassment":
		return reviewv1.FlagReason_FLAG_REASON_HARASSMENT
	case "spam":
		return reviewv1.FlagReason_FLAG_REASON_SPAM
	case "irrelevant":
		return reviewv1.FlagReason_FLAG_REASON_IRRELEVANT
	default:
		return reviewv1.FlagReason_FLAG_REASON_UNSPECIFIED
	}
}
