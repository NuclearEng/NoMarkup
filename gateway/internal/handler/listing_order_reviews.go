package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// Goods order reviews (FE-14 MVP).
//
// Separate from services contract reviews (job service + double-blind dims).
// Gateway SQL only — same primary path as listing_orders. Published immediately
// (not double-blind). Overall rating 1–5 required; optional free-text comment.

const listingOrderReviewWindow = 14 * 24 * time.Hour

const listingOrderReviewTextMax = 2000

type createListingOrderReviewRequest struct {
	OverallRating int32  `json:"overall_rating"`
	Comment       string `json:"comment"`
}

// CreateListingOrderReview handles POST /api/v1/orders/{id}/reviews.
//
// Eligibility: caller is buyer or seller; escrow released; within 14 days of
// released_at; one review per (order, reviewer).
func (h *ListingOrdersHandler) CreateListingOrderReview(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	orderID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(orderID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid order id")
		return
	}

	var body createListingOrderReviewRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.OverallRating < 1 || body.OverallRating > 5 {
		writeError(w, http.StatusBadRequest, "overall_rating must be between 1 and 5")
		return
	}
	comment := strings.TrimSpace(body.Comment)
	if utf8.RuneCountInString(comment) > listingOrderReviewTextMax {
		writeError(w, http.StatusBadRequest, "comment must be at most 2000 characters")
		return
	}
	if comment != "" && rejectProhibitedUGC(w, r, comment) {
		return
	}

	var (
		listingID, buyerID, sellerID, escrowStatus string
		releasedAt                                 *time.Time
	)
	err := h.db.QueryRow(r.Context(), `
		SELECT listing_id::text, buyer_id::text, seller_id::text, escrow_status, released_at
		  FROM listing_orders
		 WHERE id = $1`, orderID).
		Scan(&listingID, &buyerID, &sellerID, &escrowStatus, &releasedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "order not found")
			return
		}
		slog.ErrorContext(r.Context(), "listing order review: load order", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	var role string
	var revieweeID string
	switch claims.UserID {
	case buyerID:
		role = "buyer"
		revieweeID = sellerID
	case sellerID:
		role = "seller"
		revieweeID = buyerID
	default:
		writeError(w, http.StatusForbidden, "only the buyer or seller may review this order")
		return
	}

	if escrowStatus != "released" {
		writeError(w, http.StatusConflict, "order must be completed (escrow released) before reviewing")
		return
	}
	if releasedAt == nil {
		writeError(w, http.StatusConflict, "order release timestamp missing; cannot open review window")
		return
	}

	windowEnds := releasedAt.UTC().Add(listingOrderReviewWindow)
	if time.Now().UTC().After(windowEnds) {
		writeError(w, http.StatusConflict, "review window has closed")
		return
	}

	var (
		id, status string
		createdAt  time.Time
		reviewText *string
	)
	if comment != "" {
		reviewText = &comment
	}

	err = h.db.QueryRow(r.Context(), `
		INSERT INTO listing_order_reviews (
			order_id, listing_id, reviewer_id, reviewee_id, reviewer_role,
			overall_rating, review_text, status, review_window_ends
		) VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8)
		RETURNING id::text, status, created_at`,
		orderID, listingID, claims.UserID, revieweeID, role,
		body.OverallRating, reviewText, windowEnds,
	).Scan(&id, &status, &createdAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, "already reviewed this order")
			return
		}
		slog.ErrorContext(r.Context(), "listing order review: insert", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Content-neutral ping to the reviewee (fail-soft). Actor is the reviewer.
	emitNotification(r.Context(), h.db,
		claims.UserID, revieweeID,
		"review_received",
		"A review was submitted",
		"Someone left a review on your completed marketplace order.",
		"/orders/"+orderID,
		"listing_order", orderID,
	)

	slog.InfoContext(r.Context(), "listing order review created",
		"order_id", orderID,
		"review_id", id,
		"reviewer_id", claims.UserID,
		"reviewee_id", revieweeID,
		"role", role,
		"overall_rating", body.OverallRating,
	)

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":                    id,
		"order_id":              orderID,
		"listing_id":            listingID,
		"reviewer_id":           claims.UserID,
		"reviewee_id":           revieweeID,
		"reviewer_role":         role,
		"overall_rating":        body.OverallRating,
		"comment":               comment,
		"status":                status,
		"review_window_ends_at": windowEnds.UTC().Format(time.RFC3339),
		"created_at":            createdAt.UTC().Format(time.RFC3339),
	})
}

// GetListingOrderReviewEligibility handles GET /api/v1/orders/{id}/reviews/eligibility.
func (h *ListingOrdersHandler) GetListingOrderReviewEligibility(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	orderID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(orderID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid order id")
		return
	}

	var (
		buyerID, sellerID, escrowStatus string
		releasedAt                      *time.Time
	)
	err := h.db.QueryRow(r.Context(), `
		SELECT buyer_id::text, seller_id::text, escrow_status, released_at
		  FROM listing_orders
		 WHERE id = $1`, orderID).
		Scan(&buyerID, &sellerID, &escrowStatus, &releasedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "order not found")
			return
		}
		slog.ErrorContext(r.Context(), "listing order review eligibility: load", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if claims.UserID != buyerID && claims.UserID != sellerID {
		writeError(w, http.StatusForbidden, "only the buyer or seller may review this order")
		return
	}

	var already bool
	if err := h.db.QueryRow(r.Context(), `
		SELECT EXISTS (
			SELECT 1 FROM listing_order_reviews
			 WHERE order_id = $1 AND reviewer_id = $2
		)`, orderID, claims.UserID).Scan(&already); err != nil {
		slog.ErrorContext(r.Context(), "listing order review eligibility: exists", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	result := map[string]interface{}{
		"eligible":         false,
		"already_reviewed": already,
	}

	if releasedAt != nil {
		windowEnds := releasedAt.UTC().Add(listingOrderReviewWindow)
		result["review_window_closes_at"] = windowEnds.Format(time.RFC3339)
		windowOpen := !time.Now().UTC().After(windowEnds)
		result["eligible"] = escrowStatus == "released" && windowOpen && !already
	} else {
		result["eligible"] = false
	}

	writeJSON(w, http.StatusOK, result)
}

// ListListingOrderReviews handles GET /api/v1/orders/{id}/reviews.
// Buyer/seller only. Returns published reviews on the order (MVP: immediate publish).
func (h *ListingOrdersHandler) ListListingOrderReviews(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	orderID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(orderID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid order id")
		return
	}

	var buyerID, sellerID string
	err := h.db.QueryRow(r.Context(), `
		SELECT buyer_id::text, seller_id::text
		  FROM listing_orders
		 WHERE id = $1`, orderID).
		Scan(&buyerID, &sellerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "order not found")
			return
		}
		slog.ErrorContext(r.Context(), "listing order reviews list: load order", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if claims.UserID != buyerID && claims.UserID != sellerID {
		writeError(w, http.StatusForbidden, "only the buyer or seller may view reviews for this order")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id::text, order_id::text, listing_id::text,
		       reviewer_id::text, reviewee_id::text, reviewer_role,
		       overall_rating, COALESCE(review_text, ''), status,
		       review_window_ends, created_at
		  FROM listing_order_reviews
		 WHERE order_id = $1 AND status = 'published'
		 ORDER BY created_at ASC`, orderID)
	if err != nil {
		slog.ErrorContext(r.Context(), "listing order reviews list: query", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer rows.Close()

	reviews := make([]map[string]interface{}, 0, 2)
	for rows.Next() {
		var (
			id, oid, lid, reviewerID, revieweeID, role, text, status string
			rating                                                   int32
			windowEnds, createdAt                                    time.Time
		)
		if err := rows.Scan(
			&id, &oid, &lid, &reviewerID, &revieweeID, &role,
			&rating, &text, &status, &windowEnds, &createdAt,
		); err != nil {
			slog.ErrorContext(r.Context(), "listing order reviews list: scan", "order_id", orderID, "error", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		reviews = append(reviews, map[string]interface{}{
			"id":                    id,
			"order_id":              oid,
			"listing_id":            lid,
			"reviewer_id":           reviewerID,
			"reviewee_id":           revieweeID,
			"reviewer_role":         role,
			"overall_rating":        rating,
			"comment":               text,
			"status":                status,
			"review_window_ends_at": windowEnds.UTC().Format(time.RFC3339),
			"created_at":            createdAt.UTC().Format(time.RFC3339),
		})
	}
	if err := rows.Err(); err != nil {
		slog.ErrorContext(r.Context(), "listing order reviews list: rows", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"reviews": reviews,
	})
}
