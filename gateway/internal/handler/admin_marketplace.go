package handler

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminMarketplaceHandler exposes admin moderation endpoints for the
// goods marketplace (listings + reports).
//
// The marketplace is a thin pgx-backed surface — no dedicated gRPC
// service in v1. We follow the same pattern as AuctionReplayHandler /
// FeatureFlagHandler / PricingHandler: take *pgxpool.Pool directly,
// query the DB, return JSON.
//
// Mounted at /api/v1/admin/listings and /api/v1/admin/goods-reports.
// All routes require RequireAdmin middleware (set by the router).
type AdminMarketplaceHandler struct {
	db *pgxpool.Pool
}

// NewAdminMarketplaceHandler returns a new AdminMarketplaceHandler. If db
// is nil (e.g. DATABASE_URL unset in tests), every endpoint returns an
// empty response instead of a 500.
func NewAdminMarketplaceHandler(db *pgxpool.Pool) *AdminMarketplaceHandler {
	return &AdminMarketplaceHandler{db: db}
}

// ─────────────────────────────────────────────────────────────────────────
// Listings
// ─────────────────────────────────────────────────────────────────────────

type adminListing struct {
	ID                string     `json:"id"`
	Title             string     `json:"title"`
	SellerID          string     `json:"seller_id"`
	SellerEmail       string     `json:"seller_email"`
	Status            string     `json:"status"`
	IsHidden          bool       `json:"is_hidden"`
	HiddenReason      *string    `json:"hidden_reason,omitempty"`
	StartingCents     int64      `json:"starting_price_cents"`
	CurrentBidCents   *int64     `json:"current_bid_cents,omitempty"`
	BidCount          int        `json:"bid_count"`
	OpenReportCount   int        `json:"open_report_count"`
	AuctionEndsAt     time.Time  `json:"auction_ends_at"`
	CreatedAt         time.Time  `json:"created_at"`
}

// ListListings GET /api/v1/admin/listings
// Query params: q (title contains), status, seller_id, hidden, page, page_size.
func (h *AdminMarketplaceHandler) ListListings(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"listings": []interface{}{}})
		return
	}

	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 20, 100)

	filter := q.Get("q")
	statusF := q.Get("status")
	sellerF := q.Get("seller_id")
	hiddenF := q.Get("hidden") // "true" | "false" | ""

	args := []interface{}{}
	where := "1=1"
	if filter != "" {
		args = append(args, "%"+filter+"%")
		where += " AND l.title ILIKE $" + strconv.Itoa(len(args))
	}
	if statusF != "" {
		args = append(args, statusF)
		where += " AND l.status = $" + strconv.Itoa(len(args))
	}
	if sellerF != "" && isValidUUID(sellerF) {
		args = append(args, sellerF)
		where += " AND l.seller_id = $" + strconv.Itoa(len(args))
	}
	if hiddenF == "true" {
		where += " AND l.is_hidden = true"
	} else if hiddenF == "false" {
		where += " AND l.is_hidden = false"
	}

	// Count for pagination.
	var total int
	countSQL := "SELECT COUNT(*) FROM listings l WHERE " + where
	if err := h.db.QueryRow(r.Context(), countSQL, args...).Scan(&total); err != nil {
		slog.Error("admin marketplace count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count listings")
		return
	}

	args = append(args, pageSize, (page-1)*pageSize)
	limitArg := strconv.Itoa(len(args) - 1)
	offsetArg := strconv.Itoa(len(args))

	rows, err := h.db.Query(r.Context(), `
		SELECT l.id, l.title, l.seller_id, COALESCE(u.email, ''),
			l.status, l.is_hidden, l.hidden_reason,
			l.starting_price_cents, l.current_bid_cents, l.bid_count,
			(SELECT COUNT(*) FROM listing_reports lr
				WHERE lr.listing_id = l.id AND lr.status = 'open') AS open_reports,
			l.auction_ends_at, l.created_at
		  FROM listings l
		  LEFT JOIN users u ON u.id = l.seller_id
		 WHERE `+where+`
		 ORDER BY l.created_at DESC
		 LIMIT $`+limitArg+` OFFSET $`+offsetArg, args...)
	if err != nil {
		slog.Error("admin marketplace query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list listings")
		return
	}
	defer rows.Close()

	results := make([]adminListing, 0)
	for rows.Next() {
		var l adminListing
		if err := rows.Scan(&l.ID, &l.Title, &l.SellerID, &l.SellerEmail,
			&l.Status, &l.IsHidden, &l.HiddenReason,
			&l.StartingCents, &l.CurrentBidCents, &l.BidCount,
			&l.OpenReportCount, &l.AuctionEndsAt, &l.CreatedAt); err != nil {
			slog.Error("admin marketplace scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		results = append(results, l)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"listings": results,
		"pagination": map[string]interface{}{
			"page":      page,
			"page_size": pageSize,
			"total":     total,
		},
	})
}

// SuspendListing POST /api/v1/admin/listings/{id}/suspend
// Body: { "reason": "..." }
// Sets is_hidden=true, hidden_reason. Refunds (status flip) any active bids.
func (h *AdminMarketplaceHandler) SuspendListing(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "marketplace not available")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	var body struct{ Reason string `json:"reason"` }
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason is required")
		return
	}

	if err := suspendListingTx(r.Context(), h.db, id, claims.UserID, body.Reason); err != nil {
		if errors.Is(err, errListingNotFound) {
			writeError(w, http.StatusNotFound, "listing not found")
			return
		}
		slog.Error("admin marketplace suspend failed", "error", err, "listing_id", id)
		writeError(w, http.StatusInternalServerError, "failed to suspend listing")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"listing_id": id,
		"status":     "suspended",
		"hidden":     true,
	})
}

// ReactivateListing POST /api/v1/admin/listings/{id}/reactivate
// Clears is_hidden / hidden_reason. Active reports are NOT auto-dismissed.
func (h *AdminMarketplaceHandler) ReactivateListing(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "marketplace not available")
		return
	}

	tag, err := h.db.Exec(r.Context(), `
		UPDATE listings
		   SET is_hidden = false, hidden_reason = NULL, updated_at = now()
		 WHERE id = $1`, id)
	if err != nil {
		slog.Error("admin marketplace reactivate failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to reactivate")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"listing_id": id,
		"hidden":     false,
	})
}

// CancelListing POST /api/v1/admin/listings/{id}/cancel
// Forced cancel for prohibited-items policy violations. Marks status=cancelled
// and refunds (sets bid status='outbid' so the bidder UI shows them as not winning).
func (h *AdminMarketplaceHandler) CancelListing(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "marketplace not available")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	var body struct{ Reason string `json:"reason"` }
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason is required")
		return
	}

	if err := cancelListingTx(r.Context(), h.db, id, claims.UserID, body.Reason); err != nil {
		if errors.Is(err, errListingNotFound) {
			writeError(w, http.StatusNotFound, "listing not found")
			return
		}
		slog.Error("admin marketplace cancel failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to cancel listing")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"listing_id": id,
		"status":     "cancelled",
	})
}

// ─────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────

type adminReport struct {
	ID            string     `json:"id"`
	ListingID     string     `json:"listing_id"`
	ListingTitle  string     `json:"listing_title"`
	ReporterID    *string    `json:"reporter_id,omitempty"`
	ReporterEmail *string    `json:"reporter_email,omitempty"`
	Reason        string     `json:"reason"`
	Description   string     `json:"description"`
	Status        string     `json:"status"`
	Resolution    *string    `json:"resolution,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	ReviewedAt    *time.Time `json:"reviewed_at,omitempty"`
}

// ListReports GET /api/v1/admin/goods-reports
// Query params: status (open|reviewed|actioned|dismissed), listing_id, page, page_size.
func (h *AdminMarketplaceHandler) ListReports(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"reports": []interface{}{}})
		return
	}

	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 20, 100)

	statusF := q.Get("status")
	listingF := q.Get("listing_id")

	args := []interface{}{}
	where := "1=1"
	if statusF != "" {
		args = append(args, statusF)
		where += " AND lr.status = $" + strconv.Itoa(len(args))
	}
	if listingF != "" && isValidUUID(listingF) {
		args = append(args, listingF)
		where += " AND lr.listing_id = $" + strconv.Itoa(len(args))
	}

	var total int
	countSQL := "SELECT COUNT(*) FROM listing_reports lr WHERE " + where
	if err := h.db.QueryRow(r.Context(), countSQL, args...).Scan(&total); err != nil {
		slog.Error("admin reports count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count reports")
		return
	}

	args = append(args, pageSize, (page-1)*pageSize)
	limitArg := strconv.Itoa(len(args) - 1)
	offsetArg := strconv.Itoa(len(args))

	rows, err := h.db.Query(r.Context(), `
		SELECT lr.id, lr.listing_id, l.title,
			lr.reporter_id, u.email,
			lr.reason, lr.description, lr.status, lr.resolution,
			lr.created_at, lr.reviewed_at
		  FROM listing_reports lr
		  LEFT JOIN listings l ON l.id = lr.listing_id
		  LEFT JOIN users u ON u.id = lr.reporter_id
		 WHERE `+where+`
		 ORDER BY lr.created_at DESC
		 LIMIT $`+limitArg+` OFFSET $`+offsetArg, args...)
	if err != nil {
		slog.Error("admin reports query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list reports")
		return
	}
	defer rows.Close()

	out := make([]adminReport, 0)
	for rows.Next() {
		var rpt adminReport
		if err := rows.Scan(&rpt.ID, &rpt.ListingID, &rpt.ListingTitle,
			&rpt.ReporterID, &rpt.ReporterEmail,
			&rpt.Reason, &rpt.Description, &rpt.Status, &rpt.Resolution,
			&rpt.CreatedAt, &rpt.ReviewedAt); err != nil {
			slog.Error("admin reports scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, rpt)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"reports": out,
		"pagination": map[string]interface{}{
			"page":      page,
			"page_size": pageSize,
			"total":     total,
		},
	})
}

// ─────────────────────────────────────────────────────────────────────────
// Goods disputes (marketplace_disputes table — migration 035)
// ─────────────────────────────────────────────────────────────────────────
//
// Service disputes live in `disputes` and are surfaced by the contract
// service's gRPC ListDisputes. Goods disputes live in `marketplace_disputes`
// (added by the parallel marketplace-escrow migration). The two tables have
// different shapes so the admin UI lists them separately.

type adminGoodsDispute struct {
	ID                  string     `json:"id"`
	ListingOrder        string     `json:"listing_order_id"`
	ListingID           string     `json:"listing_id"`
	ListingTitle        string     `json:"listing_title"`
	OpenedBy            string     `json:"opened_by"`
	OpenedByEmail       string     `json:"opened_by_email"`
	DisputeType         string     `json:"dispute_type"`
	Description         string     `json:"description"`
	Status              string     `json:"status"`
	AmountCents         int64      `json:"amount_cents"`
	RefundToBuyerCents  *int64     `json:"refund_to_buyer_cents,omitempty"`
	TransferToSellerCts *int64     `json:"transfer_to_seller_cents,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	ResolvedAt          *time.Time `json:"resolved_at,omitempty"`
}

// ListGoodsDisputes GET /api/v1/admin/disputes/goods
func (h *AdminMarketplaceHandler) ListGoodsDisputes(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"disputes": []interface{}{}})
		return
	}

	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 20, 100)
	statusF := q.Get("status")

	args := []interface{}{}
	where := "1=1"
	if statusF != "" {
		args = append(args, statusF)
		where += " AND d.status = $" + strconv.Itoa(len(args))
	}

	var total int
	if err := h.db.QueryRow(r.Context(),
		"SELECT COUNT(*) FROM marketplace_disputes d WHERE "+where, args...).Scan(&total); err != nil {
		slog.Error("admin goods disputes count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count")
		return
	}

	args = append(args, pageSize, (page-1)*pageSize)
	limitArg := strconv.Itoa(len(args) - 1)
	offsetArg := strconv.Itoa(len(args))

	rows, err := h.db.Query(r.Context(), `
		SELECT d.id, d.listing_order_id, l.id, l.title,
			d.opened_by, COALESCE(u.email, ''),
			d.reason, d.description, d.status,
			COALESCE(lo.amount_cents, 0),
			d.refund_to_buyer_cents, d.transfer_to_seller_cents,
			d.created_at, d.resolved_at
		  FROM marketplace_disputes d
		  LEFT JOIN listing_orders lo ON lo.id = d.listing_order_id
		  LEFT JOIN listings l ON l.id = lo.listing_id
		  LEFT JOIN users u ON u.id = d.opened_by
		 WHERE `+where+`
		 ORDER BY d.created_at DESC
		 LIMIT $`+limitArg+` OFFSET $`+offsetArg, args...)
	if err != nil {
		slog.Error("admin goods disputes query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list")
		return
	}
	defer rows.Close()

	out := make([]adminGoodsDispute, 0)
	for rows.Next() {
		var d adminGoodsDispute
		var listingID, listingTitle *string
		if err := rows.Scan(&d.ID, &d.ListingOrder, &listingID, &listingTitle,
			&d.OpenedBy, &d.OpenedByEmail,
			&d.DisputeType, &d.Description, &d.Status,
			&d.AmountCents, &d.RefundToBuyerCents, &d.TransferToSellerCts,
			&d.CreatedAt, &d.ResolvedAt); err != nil {
			slog.Error("admin goods disputes scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		if listingID != nil {
			d.ListingID = *listingID
		}
		if listingTitle != nil {
			d.ListingTitle = *listingTitle
		}
		out = append(out, d)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"disputes": out,
		"pagination": map[string]interface{}{
			"page":      page,
			"page_size": pageSize,
			"total":     total,
		},
	})
}

// ResolveGoodsDispute POST /api/v1/admin/disputes/goods/{id}/resolve
// Body: { "resolution": "refund_full" | "refund_partial" | "release_to_seller" | "no_action",
//         "refund_to_buyer_cents": int64, "transfer_to_seller_cents": int64,
//         "notes": "..." }
func (h *AdminMarketplaceHandler) ResolveGoodsDispute(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid dispute id")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "marketplace not available")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	var body struct {
		Resolution            string `json:"resolution"`
		RefundToBuyerCents    int64  `json:"refund_to_buyer_cents"`
		TransferToSellerCents int64  `json:"transfer_to_seller_cents"`
		Notes                 string `json:"notes"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	switch body.Resolution {
	case "refund_full", "refund_partial", "release_to_seller", "no_action":
	default:
		writeError(w, http.StatusBadRequest, "invalid resolution")
		return
	}

	// Negative amounts are never valid — reject before opening a tx so a
	// malformed body can't persist nonsense (defensive; the client also bounds).
	if body.RefundToBuyerCents < 0 || body.TransferToSellerCents < 0 {
		writeError(w, http.StatusBadRequest, "refund and transfer amounts must not be negative")
		return
	}

	tx, err := h.db.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		slog.Error("begin tx failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	// Cap the recorded refund at the order's captured amount — server-side, so a
	// client bypass (or a future caller) can't record a refund larger than what
	// was paid. The real Stripe refund is independently capped in the payment
	// service (over-refund guard), but the dispute row drives escrow + audit and
	// must never claim more than the order total. Fail closed on a missing order.
	var orderAmountCents int64
	var disputeOrderID, disputeBuyerID, disputeSellerID string
	if err := tx.QueryRow(r.Context(), `
		SELECT COALESCE(lo.amount_cents, 0), lo.id::text, lo.buyer_id::text, lo.seller_id::text
		  FROM marketplace_disputes md
		  JOIN listing_orders lo ON lo.id = md.listing_order_id
		 WHERE md.id = $1`, id).Scan(&orderAmountCents, &disputeOrderID, &disputeBuyerID, &disputeSellerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "goods dispute not found")
			return
		}
		slog.Error("resolve goods dispute: order amount lookup failed", "dispute_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to resolve")
		return
	}
	if body.RefundToBuyerCents > orderAmountCents {
		writeError(w, http.StatusUnprocessableEntity, "refund cannot exceed the order amount")
		return
	}

	// Update the dispute row — but ONLY if it is not already in a terminal
	// state. Without this guard an already-resolved dispute could be
	// re-resolved, silently re-flipping escrow (e.g. refund_full → 'refunded',
	// then a second no_action flipping it back to 'released'). The escrow
	// UPDATE below is gated on this same transition (same tx), so if the
	// dispute does not transition, escrow is never touched. Mirrors the
	// file-side "dispute already open" guard in listing_orders.go.
	tag, err := tx.Exec(r.Context(), `
		UPDATE marketplace_disputes
		   SET status = 'resolved',
		       resolution = $1,
		       refund_to_buyer_cents = $2,
		       transfer_to_seller_cents = $3,
		       resolution_notes = $4,
		       resolved_by = $5,
		       resolved_at = now(),
		       updated_at = now()
		 WHERE id = $6
		   AND status NOT IN ('resolved', 'closed')`,
		body.Resolution,
		body.RefundToBuyerCents, body.TransferToSellerCents,
		body.Notes, claims.UserID, id)
	if err != nil {
		slog.Error("resolve goods dispute failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to resolve")
		return
	}
	if tag.RowsAffected() == 0 {
		// 0 rows either means the dispute does not exist (404) or it is
		// already terminal (409). Disambiguate so the admin sees the right
		// error. Escrow is NOT touched in either case.
		var existing string
		err := tx.QueryRow(r.Context(),
			`SELECT status FROM marketplace_disputes WHERE id = $1`, id).Scan(&existing)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			writeError(w, http.StatusNotFound, "goods dispute not found")
		case err != nil:
			slog.Error("resolve goods dispute lookup failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to resolve")
		default:
			writeError(w, http.StatusConflict, "dispute already resolved")
		}
		return
	}

	// Flip the listing_order escrow_status accordingly.
	var newEscrow string
	switch body.Resolution {
	case "release_to_seller", "no_action":
		newEscrow = "released"
	case "refund_full", "refund_partial":
		newEscrow = "refunded"
	}
	if newEscrow != "" {
		// On a release_to_seller / no_action resolution we must stamp the
		// release the same way the buyer/seller pickup handshake does:
		//   - released_at = now()  (otherwise the row is a "released with NULL
		//     released_at" zombie that violates the escrow invariant and is
		//     invisible to buyer-facing completed_at/released_at projections)
		//   - seller_payout_cents = amount_cents - fee_cents  (so the row
		//     satisfies amount = fee + payout; without this it stays 0 and the
		//     payout split is wrong)
		// The payment-service auto-release worker still fires the actual Stripe
		// transfer keyed on escrow_status='released' AND stripe_transfer_id IS
		// NULL; this UPDATE only fixes the durable row state. The refunded
		// branch leaves released_at/payout untouched (no payout owed).
		if newEscrow == "released" {
			if _, err := tx.Exec(r.Context(), `
				UPDATE listing_orders lo
				   SET escrow_status = $1,
				       released_at = now(),
				       seller_payout_cents = GREATEST(lo.amount_cents - lo.fee_cents, 0),
				       updated_at = now()
				  FROM marketplace_disputes md
				 WHERE md.id = $2 AND lo.id = md.listing_order_id`, newEscrow, id); err != nil {
				slog.Error("update listing_order escrow failed", "error", err)
				writeError(w, http.StatusInternalServerError, "failed to update escrow")
				return
			}
		} else {
			if _, err := tx.Exec(r.Context(), `
				UPDATE listing_orders lo
				   SET escrow_status = $1, updated_at = now()
				  FROM marketplace_disputes md
				 WHERE md.id = $2 AND lo.id = md.listing_order_id`, newEscrow, id); err != nil {
				slog.Error("update listing_order escrow failed", "error", err)
				writeError(w, http.StatusInternalServerError, "failed to update escrow")
				return
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.Error("commit resolve dispute failed", "error", err)
		writeError(w, http.StatusInternalServerError, "commit failed")
		return
	}

	// Notify BOTH parties (buyer + seller) that the admin resolved the goods
	// dispute. Admin is the actor → both receive it. Fail-soft, post-commit.
	{
		const (
			title = "Your dispute was resolved"
			body  = "An admin reviewed and resolved the dispute on your order. See the outcome."
		)
		url := "/orders/" + disputeOrderID
		emitNotification(r.Context(), h.db, claims.UserID, disputeBuyerID, "dispute_resolved", title, body, url, "listing_order", disputeOrderID)
		emitNotification(r.Context(), h.db, claims.UserID, disputeSellerID, "dispute_resolved", title, body, url, "listing_order", disputeOrderID)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"dispute_id": id,
		"status":     "resolved",
		"resolution": body.Resolution,
	})
}

// ResolveReport POST /api/v1/admin/goods-reports/{id}/resolve
// Body: { "action": "dismiss" | "actioned", "notes": "..." }
func (h *AdminMarketplaceHandler) ResolveReport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid report id")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "marketplace not available")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	var body struct {
		Action string `json:"action"`
		Notes  string `json:"notes"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}

	var newStatus string
	switch body.Action {
	case "dismiss":
		newStatus = "dismissed"
	case "actioned":
		newStatus = "actioned"
	case "review":
		newStatus = "reviewed"
	default:
		writeError(w, http.StatusBadRequest, "action must be dismiss|actioned|review")
		return
	}

	// Only resolve a report that is not already in a terminal state. Without
	// this, a second resolve silently overwrites the prior resolution,
	// reviewed_by, and reviewed_at — letting one admin's verdict be replaced with
	// no audit trail. 'reviewed' is intermediate and may still advance.
	tag, err := h.db.Exec(r.Context(), `
		UPDATE listing_reports
		   SET status = $1, reviewed_by = $2, reviewed_at = now(),
		       resolution = $3, updated_at = now()
		 WHERE id = $4 AND status NOT IN ('dismissed', 'actioned')`,
		newStatus, claims.UserID, body.Notes, id)
	if err != nil {
		slog.Error("admin resolve report failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to resolve")
		return
	}
	if tag.RowsAffected() == 0 {
		// Either the report doesn't exist (404) or it's already terminal (409).
		var exists bool
		if e := h.db.QueryRow(r.Context(),
			`SELECT EXISTS (SELECT 1 FROM listing_reports WHERE id = $1)`, id).Scan(&exists); e != nil {
			slog.Error("admin resolve report existence check failed", "error", e)
			writeError(w, http.StatusInternalServerError, "failed to resolve")
			return
		}
		if !exists {
			writeError(w, http.StatusNotFound, "report not found")
			return
		}
		writeError(w, http.StatusConflict, "report already resolved")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"report_id": id,
		"status":    newStatus,
	})
}

// CreateReport POST /api/v1/listings/{id}/report
// Public-ish endpoint (rate-limited at the gateway). Anyone — including
// unauthenticated visitors — can flag a listing. The trigger on
// listing_reports auto-hides the listing once ≥3 open reports exist.
func (h *AdminMarketplaceHandler) CreateReport(w http.ResponseWriter, r *http.Request) {
	listingID := chi.URLParam(r, "id")
	if !isValidUUID(listingID) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "marketplace not available")
		return
	}

	var body struct {
		Reason      string `json:"reason"`
		Description string `json:"description"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	switch body.Reason {
	case "stolen", "counterfeit", "prohibited", "misleading", "spam", "other":
	default:
		writeError(w, http.StatusBadRequest, "invalid reason")
		return
	}

	// The listing must exist. Without this pre-check a well-formed but unknown id
	// hits the listing_reports FK and the bare error map turns it into a 500 —
	// a predictable "not found" condition must be a 404.
	var listingSellerID string
	if err := h.db.QueryRow(r.Context(),
		`SELECT seller_id::text FROM listings WHERE id = $1`, listingID).Scan(&listingSellerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "listing not found")
			return
		}
		slog.Error("create listing report: existence check failed", "error", err, "id", listingID)
		writeError(w, http.StatusInternalServerError, "failed to create report")
		return
	}

	// reporter_id is optional (anonymous reports allowed). This route is
	// wrapped in optionalAuth, so claims are present for a signed-in caller.
	// Only attributable reports count toward the auto-hide trigger — see
	// migration 074.
	var reporterID *string
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		uid := claims.UserID
		reporterID = &uid

		// Sellers cannot report their own listing. Mirrors the self-report
		// CHECK on user_reports (migration 067) and stops a seller from
		// manufacturing reporter diversity against a competitor's listing
		// using their own account.
		if uid == listingSellerID {
			writeError(w, http.StatusForbidden, "you cannot report your own listing")
			return
		}
	}

	// Prevent the same logged-in user from reporting the same listing
	// twice with status='open' (idempotent flag). This is the fast path;
	// uq_listing_reports_open_reporter (migration 074) is the authority —
	// the read-then-write below is racy on its own, so the INSERT also
	// handles the unique violation.
	if reporterID != nil {
		var exists bool
		err := h.db.QueryRow(r.Context(), `
			SELECT EXISTS (
				SELECT 1 FROM listing_reports
				 WHERE listing_id = $1 AND reporter_id = $2 AND status = 'open'
			)`, listingID, *reporterID).Scan(&exists)
		if err == nil && exists {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status":  "already_reported",
				"message": "you've already flagged this listing",
			})
			return
		}
	}

	var id string
	err := h.db.QueryRow(r.Context(), `
		INSERT INTO listing_reports (listing_id, reporter_id, reason, description, ip_address)
		VALUES ($1, $2, $3, $4, $5::inet)
		RETURNING id`,
		listingID, reporterID, body.Reason, body.Description,
		clientIP(r),
	).Scan(&id)
	if err != nil {
		// uq_listing_reports_open_reporter fired: this reporter already has
		// an open report on this listing. Idempotent success, not a 500.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status":  "already_reported",
				"message": "you've already flagged this listing",
			})
			return
		}
		slog.Error("create listing report failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create report")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":     id,
		"status": "open",
	})
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

var errListingNotFound = errors.New("listing not found")

func suspendListingTx(ctx context.Context, db *pgxpool.Pool, listingID, _adminID, reason string) error {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE listings
		   SET is_hidden = true,
		       hidden_reason = $1,
		       updated_at = now()
		 WHERE id = $2`, "admin: "+reason, listingID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errListingNotFound
	}

	// Mark active bids as outbid so the bidder UI shows them as not
	// winning. This is the "refund any active bids" half — escrow holds
	// (if any) are released by the payment service via webhook in v1.5.
	if _, err := tx.Exec(ctx, `
		UPDATE listing_bids
		   SET status = 'outbid'
		 WHERE listing_id = $1 AND status = 'active'`, listingID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func cancelListingTx(ctx context.Context, db *pgxpool.Pool, listingID, _adminID, reason string) error {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE listings
		   SET status = 'cancelled',
		       is_hidden = true,
		       hidden_reason = $1,
		       updated_at = now()
		 WHERE id = $2`, "admin-cancel: "+reason, listingID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errListingNotFound
	}

	if _, err := tx.Exec(ctx, `
		UPDATE listing_bids
		   SET status = 'outbid'
		 WHERE listing_id = $1 AND status IN ('active','winning')`, listingID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// parseDirectPagination reads page/page_size query params with sane defaults
// and a max ceiling so a runaway client can't exhaust DB rows. Distinct
// from the gRPC-flavored `parsePagination` in admin_users.go (which returns
// a *commonv1.PaginationRequest). Used by handlers that talk to pgx directly.
func parseDirectPagination(q map[string][]string, defaultPage, defaultSize, maxSize int) (int, int) {
	get := func(k string) string {
		if v, ok := q[k]; ok && len(v) > 0 {
			return v[0]
		}
		return ""
	}
	page := defaultPage
	size := defaultSize
	if v, err := strconv.Atoi(get("page")); err == nil && v > 0 {
		page = v
	}
	if v, err := strconv.Atoi(get("page_size")); err == nil && v > 0 {
		size = v
	}
	if size > maxSize {
		size = maxSize
	}
	return page, size
}

// clientIP returns the request remote IP for the fraud-trail, stripped of
// its port. It returns nil (SQL NULL) when the address is empty or not a
// valid IP — listing_reports.ip_address is a nullable inet, and feeding it a
// non-inet string (e.g. the bracketed "[::1]" you get from naive last-colon
// splitting of an IPv6 RemoteAddr) makes the `$n::inet` cast fail with a 500.
//
// net.SplitHostPort handles both "127.0.0.1:54321" and "[::1]:54321",
// returning the host WITHOUT brackets ("::1"), which casts cleanly to inet.
func clientIP(r *http.Request) interface{} {
	addr := r.RemoteAddr
	if addr == "" {
		return nil
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		// No port present — treat the whole value as the host.
		host = addr
	}
	if net.ParseIP(host) == nil {
		// Not a valid IP (e.g. still bracketed, or garbage) — store NULL
		// rather than 500 on the inet cast.
		return nil
	}
	return host
}
