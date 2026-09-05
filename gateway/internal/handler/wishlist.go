package handler

// Wishlist + price-alert handlers — the buyer's "dream item" loop.
//
// A wishlist item is a standing want: a free-text keyword (e.g. "4 wheeler"),
// an optional category, and a max-price ceiling. When a marketplace listing
// goes ACTIVE and matches a wishlist item (keyword in title, price <=
// max_price_cents, optional category), NotifyWishlistMatches fans a
// notification out to the wishlist owner. That match check is wired into the
// listing-create path (ListingsHandler.CreateListing) — see CreateListing's
// call to h.NotifyWishlistMatches.
//
// Mounted under the auth-protected /api/v1 block. Routes:
//
//   POST   /api/v1/me/wishlist        CreateWishlistItem
//   GET    /api/v1/me/wishlist        ListWishlist
//   DELETE /api/v1/me/wishlist/{id}   DeleteWishlistItem
//
// Like the rest of the goods-marketplace surface this is pgx-direct
// (no gRPC hop). Notifications are written straight into the shared
// `notifications` table that the notification service reads from
// (services/notification/internal/repository/postgres.go) — the gateway
// already owns the connection, and this keeps the alert working even when
// the notification gRPC service is offline.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// wishlistKeywordMaxLen caps the stored keyword so an oversized free-text
// value can't bloat the table or the LIKE scan.
const wishlistKeywordMaxLen = 120

// WishlistHandler exposes the buyer wishlist + price-alert surface.
type WishlistHandler struct {
	db *pgxpool.Pool
}

// NewWishlistHandler returns a WishlistHandler. A nil db short-circuits the
// write endpoints to 503 and the read endpoint to an empty list (mirrors the
// watchlist handler's graceful-degradation contract).
func NewWishlistHandler(db *pgxpool.Pool) *WishlistHandler {
	return &WishlistHandler{db: db}
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes
// ─────────────────────────────────────────────────────────────────────────

type wishlistItemJSON struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	Keyword       string    `json:"keyword"`
	CategoryID    *string   `json:"category_id"`
	CategoryName  *string   `json:"category_name"`
	MaxPriceCents int64     `json:"max_price_cents"`
	CreatedAt     time.Time `json:"created_at"`
}

type createWishlistItemRequest struct {
	Keyword       string  `json:"keyword"`
	CategoryID    *string `json:"category_id"`
	MaxPriceCents int64   `json:"max_price_cents"`
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/me/wishlist — create
// ─────────────────────────────────────────────────────────────────────────

// CreateWishlistItem inserts a new wishlist item for the authenticated user.
//
// Validation:
//   - keyword non-empty, <= 120 runes
//   - max_price_cents > 0 (integer cents — "notify if available at or below")
//   - category_id, when supplied, must resolve to a known category (slug or
//     UUID accepted; a clean 400 beats an FK 500)
func (h *WishlistHandler) CreateWishlistItem(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req createWishlistItemRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	keyword := strings.TrimSpace(req.Keyword)
	if keyword == "" {
		writeError(w, http.StatusBadRequest, "keyword is required")
		return
	}
	if len([]rune(keyword)) > wishlistKeywordMaxLen {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("keyword must be at most %d characters", wishlistKeywordMaxLen))
		return
	}
	if req.MaxPriceCents <= 0 {
		writeError(w, http.StatusBadRequest, "max_price_cents must be positive")
		return
	}

	// Resolve the optional category (slug-or-UUID) to its canonical UUID.
	var categoryArg interface{}
	if req.CategoryID != nil && strings.TrimSpace(*req.CategoryID) != "" {
		raw := strings.TrimSpace(*req.CategoryID)
		var resolved string
		var catErr error
		if isValidUUID(raw) {
			catErr = h.db.QueryRow(r.Context(),
				`SELECT id::text FROM service_categories WHERE id = $1`, raw,
			).Scan(&resolved)
		} else {
			catErr = h.db.QueryRow(r.Context(),
				`SELECT id::text FROM service_categories WHERE slug = $1`, raw,
			).Scan(&resolved)
		}
		if errors.Is(catErr, pgx.ErrNoRows) {
			writeError(w, http.StatusBadRequest, "unknown category_id")
			return
		}
		if catErr != nil {
			slog.ErrorContext(r.Context(), "wishlist create: category lookup failed", "error", catErr)
			writeError(w, http.StatusInternalServerError, "category lookup failed")
			return
		}
		categoryArg = resolved
	}

	var item wishlistItemJSON
	var categoryID pgtype.Text
	if err := h.db.QueryRow(r.Context(), `
		INSERT INTO wishlist_items (user_id, keyword, category_id, max_price_cents)
		VALUES ($1, $2, $3, $4)
		RETURNING id, user_id, keyword, category_id::text, max_price_cents, created_at`,
		claims.UserID, keyword, categoryArg, req.MaxPriceCents,
	).Scan(&item.ID, &item.UserID, &item.Keyword, &categoryID, &item.MaxPriceCents, &item.CreatedAt); err != nil {
		slog.ErrorContext(r.Context(), "wishlist create: insert failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create wishlist item")
		return
	}
	if categoryID.Valid {
		v := categoryID.String
		item.CategoryID = &v
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{"wishlist_item": item})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/wishlist — list (owner-scoped)
// ─────────────────────────────────────────────────────────────────────────

// wishlistPageDefault / wishlistPageMax bound the list response.
//
// Nothing caps how many wishlist items a user may insert, so an unpaginated
// SELECT returns however many rows the account holds — a user with 100K items
// gets a 100K-row response. The default is deliberately larger than the
// package's usual 20: a wishlist is a personal standing-wants list that is
// small in practice and the current web client (web/src/hooks/useWishlist.ts)
// has no pager, so a small default would silently truncate real lists. 100
// keeps every realistic account whole while removing the unbounded tail.
const (
	wishlistPageDefault = 100
	wishlistPageMax     = 200
)

// ListWishlist returns the authenticated user's live (non-deleted) wishlist
// items, newest first, with the category name joined for display.
//
// Paginated via the package-standard page/page_size params (see
// parseDirectPagination). The response gains a "pagination" block alongside the
// existing "wishlist_items" array; "wishlist_items" keeps its exact shape, so
// clients reading only that key are unaffected.
func (h *WishlistHandler) ListWishlist(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"wishlist_items": []wishlistItemJSON{},
			"pagination":     pageMeta(1, 0, 0),
		})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	page, pageSize := parseDirectPagination(r.URL.Query(), 1, wishlistPageDefault, wishlistPageMax)

	var total int
	if err := h.db.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM wishlist_items
		 WHERE user_id = $1 AND deleted_at IS NULL`,
		claims.UserID,
	).Scan(&total); err != nil {
		slog.ErrorContext(r.Context(), "wishlist list: count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load wishlist")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT wi.id, wi.user_id, wi.keyword,
		       wi.category_id::text, c.name,
		       wi.max_price_cents, wi.created_at
		  FROM wishlist_items wi
		  LEFT JOIN service_categories c ON c.id = wi.category_id
		 WHERE wi.user_id = $1 AND wi.deleted_at IS NULL
		 ORDER BY wi.created_at DESC
		 LIMIT $2 OFFSET $3`,
		claims.UserID, pageSize, (page-1)*pageSize)
	if err != nil {
		slog.ErrorContext(r.Context(), "wishlist list: query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load wishlist")
		return
	}
	defer rows.Close()

	out := make([]wishlistItemJSON, 0)
	for rows.Next() {
		var item wishlistItemJSON
		var categoryID, categoryName pgtype.Text
		if err := rows.Scan(&item.ID, &item.UserID, &item.Keyword,
			&categoryID, &categoryName, &item.MaxPriceCents, &item.CreatedAt); err != nil {
			slog.ErrorContext(r.Context(), "wishlist list: scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		if categoryID.Valid {
			v := categoryID.String
			item.CategoryID = &v
		}
		if categoryName.Valid {
			v := categoryName.String
			item.CategoryName = &v
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		slog.ErrorContext(r.Context(), "wishlist list: iterate failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load wishlist")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"wishlist_items": out,
		"pagination":     pageMeta(page, pageSize, total),
	})
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/me/wishlist/{id} — soft-delete (owner-scoped)
// ─────────────────────────────────────────────────────────────────────────

// DeleteWishlistItem soft-deletes a wishlist item. The WHERE clause pins the
// caller's user_id so targeting someone else's item returns a clean 404
// rather than leaking its existence.
func (h *WishlistHandler) DeleteWishlistItem(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid wishlist item id")
		return
	}

	var deletedID string
	err := h.db.QueryRow(r.Context(),
		`UPDATE wishlist_items SET deleted_at = now()
		  WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		 RETURNING id`,
		id, claims.UserID,
	).Scan(&deletedID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "wishlist item not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "wishlist delete failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete wishlist item")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─────────────────────────────────────────────────────────────────────────
// Match → notify trigger
// ─────────────────────────────────────────────────────────────────────────

// wishlistQuerier is the minimal DB surface NotifyWishlistMatches needs. Both
// *pgxpool.Pool and pgx.Tx satisfy it, and it's trivial to fake in a test.
type wishlistQuerier interface {
	Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
}

// NotifyWishlistMatches finds every wishlist item that a freshly-active
// listing satisfies and writes an in-app notification to each matching owner.
// Matching is intentionally simple + correct (CLAUDE.md: keep it simple, no
// over-engineering):
//
//   - case-insensitive keyword contained in the listing title
//   - listing price <= the item's max_price_cents ceiling
//   - the wishlist category, if set, equals the listing's category
//   - the owner is not the seller (don't alert yourself about your own item)
//
// It runs synchronously after the listing is committed and active. Errors are
// logged and swallowed — a notification miss must never fail the listing-create
// request (graceful degradation, CLAUDE.md §15). Notifications are written
// straight into the shared `notifications` table the notification service
// reads from, so the bell surfaces them via ListNotifications.
func (h *WishlistHandler) NotifyWishlistMatches(
	ctx context.Context,
	listingID, sellerID, title, categoryID string,
	priceCents int64,
) {
	if h.db == nil {
		return
	}
	NotifyWishlistMatches(ctx, h.db, listingID, sellerID, title, categoryID, priceCents)
}

// NotifyWishlistMatches is the querier-decoupled implementation, so it can be
// unit-tested with a fake and called from the listing-create path with the
// live pool.
func NotifyWishlistMatches(
	ctx context.Context,
	db wishlistQuerier,
	listingID, sellerID, title, categoryID string,
	priceCents int64,
) {
	// Single query: keyword (case-insensitive) contained in the title, price
	// ceiling satisfied, optional category match, owner is not the seller,
	// item is live.
	rows, err := db.Query(ctx, `
		SELECT user_id, keyword
		  FROM wishlist_items
		 WHERE deleted_at IS NULL
		   AND user_id <> $1
		   AND max_price_cents >= $2
		   AND position(lower(keyword) in lower($3)) > 0
		   AND (category_id IS NULL OR category_id = $4)`,
		sellerID, priceCents, title, nullableUUID(categoryID),
	)
	if err != nil {
		slog.ErrorContext(ctx, "wishlist match: query failed", "error", err, "listing_id", listingID)
		return
	}
	defer rows.Close()

	type match struct {
		userID  string
		keyword string
	}
	matches := make([]match, 0)
	for rows.Next() {
		var userID, keyword string
		if err := rows.Scan(&userID, &keyword); err != nil {
			slog.ErrorContext(ctx, "wishlist match: scan failed", "error", err)
			continue
		}
		matches = append(matches, match{userID: userID, keyword: keyword})
	}
	if err := rows.Err(); err != nil {
		slog.ErrorContext(ctx, "wishlist match: rows err", "error", err)
	}

	dollars := fmt.Sprintf("$%d", priceCents/100)
	actionURL := "/marketplace/" + listingID
	for _, m := range matches {
		notifTitle := fmt.Sprintf("A %s is available for %s", m.keyword, dollars)
		body := fmt.Sprintf(
			"A listing matching \"%s\" just went live at %s — bid now before it's gone.",
			m.keyword, dollars)
		if _, err := db.Exec(ctx, `
			INSERT INTO notifications
			    (user_id, notification_type, title, body, action_url, entity_type, entity_id, channels)
			VALUES ($1, 'wishlist_match', $2, $3, $4, 'listing', $5, ARRAY['in_app'])`,
			m.userID, notifTitle, body, actionURL, listingID,
		); err != nil {
			slog.ErrorContext(ctx, "wishlist match: notification insert failed",
				"error", err, "user_id", m.userID, "listing_id", listingID)
			continue
		}
		slog.InfoContext(ctx, "wishlist match: notified owner",
			"user_id", m.userID, "listing_id", listingID, "keyword", m.keyword)
	}
}

// nullableUUID returns the raw string as a query arg, or nil when empty, so the
// `category_id = $4` predicate degrades to "always allowed" for keyword-only
// wishlist items (guarded by the `category_id IS NULL` branch).
func nullableUUID(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
