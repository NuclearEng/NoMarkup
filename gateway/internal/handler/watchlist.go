package handler

// Watchlist + saved-searches handlers — the goods-marketplace retention loop.
//
// Mounted under the auth-protected /api/v1 block. Routes:
//
//   POST   /api/v1/listings/{id}/watch       Watch
//   DELETE /api/v1/listings/{id}/watch       Unwatch
//   GET    /api/v1/me/watchlist              MyWatchlist
//   POST   /api/v1/me/saved-searches         CreateSavedSearch
//   GET    /api/v1/me/saved-searches         ListSavedSearches
//   DELETE /api/v1/me/saved-searches/{id}    DeleteSavedSearch
//
// Why a thin pgx-backed handler: the goods-marketplace surface is
// pgx-direct in v1 (see listings.go for rationale). The closing-soon /
// outbid notification scheduler in services/notification reads
// `listing_watchlist` directly to fan notifications out to every watcher.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// WatchlistHandler exposes the buyer-side retention surface.
type WatchlistHandler struct {
	db    *pgxpool.Pool
	cache *cache.Client
}

// NewWatchlistHandler returns a WatchlistHandler. A nil db short-circuits
// every endpoint to a 503 (the gateway already returns 503 elsewhere when
// DATABASE_URL is unset). A nil cache is fine — it just means the watcher
// count comes back as 0.
func NewWatchlistHandler(db *pgxpool.Pool, cacheClient *cache.Client) *WatchlistHandler {
	return &WatchlistHandler{db: db, cache: cacheClient}
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes
// ─────────────────────────────────────────────────────────────────────────

type savedSearchJSON struct {
	ID             string          `json:"id"`
	UserID         string          `json:"user_id"`
	Name           string          `json:"name"`
	Query          json.RawMessage `json:"query"`
	AlertFrequency string          `json:"alert_frequency"`
	LastRunAt      *time.Time      `json:"last_run_at"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

type createSavedSearchRequest struct {
	Name           string          `json:"name"`
	Query          json.RawMessage `json:"query"`
	AlertFrequency string          `json:"alert_frequency"`
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/listings/{id}/watch — add to watchlist
// ─────────────────────────────────────────────────────────────────────────

// Watch adds the authenticated user to the listing_watchlist. Idempotent
// via the (user_id, listing_id) UNIQUE constraint — a duplicate insert is
// a no-op.
//
// Returns: { watching: true, watcher_count: int } where watcher_count is
// the persistent number of users watching this listing, recomputed from
// listing_watchlist after the insert so the caller sees their own watch
// reflected immediately (the live spectator set in Redis does not include
// a user who has not pinged the viewer endpoint).
func (h *WatchlistHandler) Watch(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	// Verify the listing exists. Cheap lookup — keeps the FK violation
	// from leaking out as a 500.
	var exists bool
	if err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM listings WHERE id = $1)`, id,
	).Scan(&exists); err != nil {
		slog.ErrorContext(r.Context(), "watch listing: existence check failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to verify listing")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}

	if _, err := h.db.Exec(r.Context(), `
		INSERT INTO listing_watchlist (user_id, listing_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, listing_id) DO NOTHING`,
		claims.UserID, id,
	); err != nil {
		slog.ErrorContext(r.Context(), "watch listing: insert failed", "error", err, "user_id", claims.UserID, "listing_id", id)
		writeError(w, http.StatusInternalServerError, "failed to save watch")
		return
	}

	// Recompute the persistent watcher count after the insert so the caller
	// sees their own watch reflected immediately.
	var watcherCount int
	if err := h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM listing_watchlist WHERE listing_id = $1`, id,
	).Scan(&watcherCount); err != nil {
		slog.ErrorContext(r.Context(), "watch listing: count failed", "error", err, "listing_id", id)
		writeError(w, http.StatusInternalServerError, "failed to count watchers")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"watching":      true,
		"watcher_count": watcherCount,
	})
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/listings/{id}/watch — remove from watchlist
// ─────────────────────────────────────────────────────────────────────────

func (h *WatchlistHandler) Unwatch(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	if _, err := h.db.Exec(r.Context(),
		`DELETE FROM listing_watchlist WHERE user_id = $1 AND listing_id = $2`,
		claims.UserID, id,
	); err != nil {
		slog.ErrorContext(r.Context(), "unwatch listing: delete failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to remove watch")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"watching": false})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/watchlist — paginated list of watched listings
// ─────────────────────────────────────────────────────────────────────────

// MyWatchlist returns the authenticated user's watched listings, hydrated
// to the same shape as the public /listings surface (see listings.go).
func (h *WatchlistHandler) MyWatchlist(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"listings":   []listingJSON{},
			"pagination": pageMeta(1, 0, 0),
		})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 20, 100)

	var total int
	if err := h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM listing_watchlist WHERE user_id = $1`,
		claims.UserID,
	).Scan(&total); err != nil {
		slog.ErrorContext(r.Context(), "watchlist count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count watchlist")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT l.id, l.seller_id, l.category_id,
			COALESCE(c.name, ''), COALESCE(c.slug, ''),
			l.title, COALESCE(l.description, ''),
			l.status, l.pickup_zip_code,
			NULL::text, NULL::text, NULL::text,
			ST_Y(l.location), ST_X(l.location),
			l.starting_price_cents,
			COALESCE(l.current_bid_cents, l.starting_price_cents),
			100::bigint,
			COALESCE((SELECT COUNT(DISTINCT bidder_id) FROM listing_bids WHERE listing_id = l.id), 0),
			COALESCE(l.bid_count, 0),
			l.auction_duration_hours, l.auction_ends_at,
			COALESCE(l.snipe_extension_count, 0),
			l.created_at, l.updated_at,
			lw.created_at AS watched_at
		  FROM listing_watchlist lw
		  JOIN listings l ON l.id = lw.listing_id
		  LEFT JOIN service_categories c ON c.id = l.category_id
		 WHERE lw.user_id = $1
		 ORDER BY lw.created_at DESC
		 LIMIT $2 OFFSET $3`,
		claims.UserID, pageSize, (page-1)*pageSize)
	if err != nil {
		slog.ErrorContext(r.Context(), "watchlist query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load watchlist")
		return
	}
	defer rows.Close()

	results := make([]listingJSON, 0)
	ids := make([]string, 0)
	for rows.Next() {
		var l listingJSON
		var lat, lng pgtype.Float8
		var endsAt pgtype.Timestamptz
		var watchedAt pgtype.Timestamptz
		if err := rows.Scan(&l.ID, &l.SellerID, &l.CategoryID,
			&l.CategoryName, &l.CategorySlug,
			&l.Title, &l.Description,
			&l.Status, &l.PickupZip,
			&l.PickupCity, &l.PickupState, &l.PickupAddress,
			&lat, &lng,
			&l.StartingPriceCents, &l.CurrentBidCents, &l.MinIncrementCents,
			&l.BidderCount, &l.BidCount,
			&l.AuctionDurationHours, &endsAt,
			&l.SnipeExtensionCount,
			&l.CreatedAt, &l.UpdatedAt,
			&watchedAt,
		); err != nil {
			slog.ErrorContext(r.Context(), "watchlist scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		if lat.Valid {
			v := lat.Float64
			l.PickupLat = &v
		}
		if lng.Valid {
			v := lng.Float64
			l.PickupLng = &v
		}
		if endsAt.Valid {
			t := endsAt.Time
			l.AuctionEndsAt = &t
		}
		l.Photos = []listingPhotoJSON{}
		results = append(results, l)
		ids = append(ids, l.ID)
	}

	// Hydrate photos in a single round-trip.
	if len(ids) > 0 {
		photoRows, perr := h.db.Query(r.Context(), `
			SELECT id, listing_id, url, sort_order, blur_hash
			  FROM listing_photos
			 WHERE listing_id = ANY($1)
			 ORDER BY listing_id, sort_order`, ids)
		if perr == nil {
			photoMap := make(map[string][]listingPhotoJSON, len(ids))
			for photoRows.Next() {
				var pid, lid, purl string
				var sortOrder int
				var blur sql.NullString
				if err := photoRows.Scan(&pid, &lid, &purl, &sortOrder, &blur); err != nil {
					continue
				}
				ph := listingPhotoJSON{ID: pid, URL: purl, SortOrder: sortOrder}
				if blur.Valid {
					s := blur.String
					ph.BlurHash = &s
				}
				photoMap[lid] = append(photoMap[lid], ph)
			}
			photoRows.Close()
			for i := range results {
				if ph, ok := photoMap[results[i].ID]; ok {
					results[i].Photos = ph
				}
			}
		}
		// Overlay live spectator counts.
		for i := range results {
			results[i].WatcherCount = h.spectatorCount(r.Context(), results[i].ID)
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"listings":   results,
		"pagination": pageMeta(page, pageSize, total),
	})
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/me/saved-searches — create
// ─────────────────────────────────────────────────────────────────────────

func (h *WatchlistHandler) CreateSavedSearch(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	var req createSavedSearchRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if len(req.Query) == 0 {
		// Default to an empty object so callers can save "all listings".
		req.Query = json.RawMessage(`{}`)
	} else if !json.Valid(req.Query) {
		writeError(w, http.StatusBadRequest, "query must be valid JSON")
		return
	}
	freq := strings.TrimSpace(req.AlertFrequency)
	if freq == "" {
		freq = "daily"
	}
	if !isAllowedFrequency(freq) {
		writeError(w, http.StatusBadRequest, "alert_frequency must be one of: instant, daily, weekly, off")
		return
	}

	var row savedSearchJSON
	var queryJSON []byte
	var lastRunAt pgtype.Timestamptz
	err := h.db.QueryRow(r.Context(), `
		INSERT INTO saved_searches (user_id, name, query_json, alert_frequency)
		VALUES ($1, $2, $3::jsonb, $4)
		RETURNING id, user_id, name, query_json, alert_frequency,
		          last_run_at, created_at, updated_at`,
		claims.UserID, name, []byte(req.Query), freq,
	).Scan(&row.ID, &row.UserID, &row.Name, &queryJSON, &row.AlertFrequency,
		&lastRunAt, &row.CreatedAt, &row.UpdatedAt)
	if err != nil {
		slog.ErrorContext(r.Context(), "create saved search failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save search")
		return
	}
	row.Query = json.RawMessage(queryJSON)
	if lastRunAt.Valid {
		t := lastRunAt.Time
		row.LastRunAt = &t
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{"saved_search": row})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/saved-searches — list
// ─────────────────────────────────────────────────────────────────────────

func (h *WatchlistHandler) ListSavedSearches(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"saved_searches": []savedSearchJSON{},
		})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id, user_id, name, query_json, alert_frequency,
		       last_run_at, created_at, updated_at
		  FROM saved_searches
		 WHERE user_id = $1
		 ORDER BY created_at DESC`, claims.UserID)
	if err != nil {
		slog.ErrorContext(r.Context(), "list saved searches failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list saved searches")
		return
	}
	defer rows.Close()

	out := make([]savedSearchJSON, 0)
	for rows.Next() {
		var s savedSearchJSON
		var queryJSON []byte
		var lastRunAt pgtype.Timestamptz
		if err := rows.Scan(&s.ID, &s.UserID, &s.Name, &queryJSON, &s.AlertFrequency,
			&lastRunAt, &s.CreatedAt, &s.UpdatedAt); err != nil {
			slog.ErrorContext(r.Context(), "saved search scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		s.Query = json.RawMessage(queryJSON)
		if lastRunAt.Valid {
			t := lastRunAt.Time
			s.LastRunAt = &t
		}
		out = append(out, s)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"saved_searches": out})
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/me/saved-searches/{id}
// ─────────────────────────────────────────────────────────────────────────

func (h *WatchlistHandler) DeleteSavedSearch(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid saved search id")
		return
	}

	// Ownership-check + delete in one statement: the WHERE clause includes
	// user_id so we get a clean 404 (rather than a 500 on FK leak) when the
	// caller targets someone else's saved search.
	var ownerID string
	err := h.db.QueryRow(r.Context(),
		`DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING user_id`,
		id, claims.UserID,
	).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "saved search not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "delete saved search failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete saved search")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

func isAllowedFrequency(f string) bool {
	switch f {
	case "instant", "daily", "weekly", "off":
		return true
	}
	return false
}

// spectatorCount mirrors the helper in listings.go — returns the live
// watcher count from Redis (ZCARD over the listing_viewers set), or 0 when
// the cache is unreachable.
func (h *WatchlistHandler) spectatorCount(ctx context.Context, listingID string) int {
	if h.cache == nil {
		return 0
	}
	rdb := h.cache.Redis()
	if rdb == nil {
		return 0
	}
	key := cache.Key("listing_viewers", listingID)
	count, err := rdb.ZCard(ctx, key).Result()
	if err != nil {
		return 0
	}
	return int(count)
}

