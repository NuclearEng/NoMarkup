package handler

// Followable-seller handlers — the goods-marketplace retention mechanic
// flagged MISSING by the security audit (Section A: Whatnot's signature
// retention surface). Pairs with migration 041 + the notification
// scheduler's seller_new_listing pubsub fan-out.
//
// Mounted under the auth-protected /api/v1 block (the public followers
// list is a sibling but does not require auth — buyers can browse a
// seller's social proof without logging in). Routes:
//
//   POST   /api/v1/users/{id}/follow      Follow      (auth)
//   DELETE /api/v1/users/{id}/follow      Unfollow    (auth)
//   GET    /api/v1/users/{id}/followers   ListFollowers
//   GET    /api/v1/me/follows             MyFollows   (auth)
//   GET    /api/v1/me/feed                MyFeed      (auth)
//
// Pattern follows watchlist.go and admin_marketplace.go: pgx-direct,
// nil-safe DB pool (503 when DATABASE_URL is unset), structured slog
// errors, `pageMeta` for pagination envelopes.

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// FollowsHandler exposes the follower-seller surface.
type FollowsHandler struct {
	db *pgxpool.Pool
}

// NewFollowsHandler returns a FollowsHandler. A nil db short-circuits
// every endpoint to a 503 (matches the rest of the marketplace surface).
func NewFollowsHandler(db *pgxpool.Pool) *FollowsHandler {
	return &FollowsHandler{db: db}
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes
// ─────────────────────────────────────────────────────────────────────────

type followerJSON struct {
	UserID      string    `json:"user_id"`
	DisplayName string    `json:"display_name"`
	AvatarURL   *string   `json:"avatar_url"`
	FollowedAt  time.Time `json:"followed_at"`
}

type followedSellerJSON struct {
	SellerID    string    `json:"seller_id"`
	DisplayName string    `json:"display_name"`
	AvatarURL   *string   `json:"avatar_url"`
	FollowedAt  time.Time `json:"followed_at"`
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/users/{id}/follow — follow a seller
// ─────────────────────────────────────────────────────────────────────────

// Follow is idempotent on the (follower_id, seller_id) UNIQUE constraint —
// repeated calls just no-op. Self-follow is rejected with 400.
//
// Returns: { following: true, follower_count: int }.
func (h *FollowsHandler) Follow(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	sellerID := chi.URLParam(r, "id")
	if !isValidUUID(sellerID) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if sellerID == claims.UserID {
		writeError(w, http.StatusBadRequest, "cannot follow yourself")
		return
	}

	// Verify seller exists. Cheap lookup keeps the FK violation from
	// leaking out as a 500.
	var sellerExists bool
	if err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, sellerID,
	).Scan(&sellerExists); err != nil {
		slog.ErrorContext(r.Context(), "follow: seller existence check failed", "error", err, "seller_id", sellerID)
		writeError(w, http.StatusInternalServerError, "failed to verify user")
		return
	}
	if !sellerExists {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	if _, err := h.db.Exec(r.Context(), `
		INSERT INTO seller_follows (follower_id, seller_id)
		VALUES ($1, $2)
		ON CONFLICT (follower_id, seller_id) DO NOTHING`,
		claims.UserID, sellerID,
	); err != nil {
		slog.ErrorContext(r.Context(), "follow: insert failed", "error", err, "follower_id", claims.UserID, "seller_id", sellerID)
		writeError(w, http.StatusInternalServerError, "failed to follow")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"following":      true,
		"follower_count": h.followerCount(r.Context(), sellerID),
	})
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/users/{id}/follow — unfollow a seller
// ─────────────────────────────────────────────────────────────────────────

// Unfollow is idempotent — DELETE on a non-existent row is a no-op and
// returns the same 200 envelope as a real unfollow.
func (h *FollowsHandler) Unfollow(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	sellerID := chi.URLParam(r, "id")
	if !isValidUUID(sellerID) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	if _, err := h.db.Exec(r.Context(),
		`DELETE FROM seller_follows WHERE follower_id = $1 AND seller_id = $2`,
		claims.UserID, sellerID,
	); err != nil {
		slog.ErrorContext(r.Context(), "unfollow: delete failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to unfollow")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"following": false})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/users/{id}/followers — public followers list
// ─────────────────────────────────────────────────────────────────────────

// ListFollowers returns paginated followers for a user. Public — anyone
// can see who follows whom (mirrors Whatnot/Twitter). Page size capped at
// 100 to keep payloads bounded.
func (h *FollowsHandler) ListFollowers(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"followers":  []followerJSON{},
			"pagination": pageMeta(1, 0, 0),
		})
		return
	}
	sellerID := chi.URLParam(r, "id")
	if !isValidUUID(sellerID) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 20, 100)

	var total int
	if err := h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM seller_follows WHERE seller_id = $1`, sellerID,
	).Scan(&total); err != nil {
		slog.ErrorContext(r.Context(), "followers count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count followers")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT u.id, COALESCE(u.display_name, ''), u.avatar_url, sf.created_at
		  FROM seller_follows sf
		  JOIN users u ON u.id = sf.follower_id
		 WHERE sf.seller_id = $1
		 ORDER BY sf.created_at DESC
		 LIMIT $2 OFFSET $3`,
		sellerID, pageSize, (page-1)*pageSize)
	if err != nil {
		slog.ErrorContext(r.Context(), "followers query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list followers")
		return
	}
	defer rows.Close()

	out := make([]followerJSON, 0)
	for rows.Next() {
		var f followerJSON
		var avatar sql.NullString
		if err := rows.Scan(&f.UserID, &f.DisplayName, &avatar, &f.FollowedAt); err != nil {
			slog.ErrorContext(r.Context(), "followers scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		if avatar.Valid {
			s := avatar.String
			f.AvatarURL = &s
		}
		out = append(out, f)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"followers":  out,
		"pagination": pageMeta(page, pageSize, total),
	})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/follows — sellers the authenticated user follows
// ─────────────────────────────────────────────────────────────────────────

// MyFollows returns the paginated list of sellers the requesting user
// follows, hydrated with display name + avatar.
func (h *FollowsHandler) MyFollows(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"follows":    []followedSellerJSON{},
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
		`SELECT COUNT(*) FROM seller_follows WHERE follower_id = $1`, claims.UserID,
	).Scan(&total); err != nil {
		slog.ErrorContext(r.Context(), "my follows count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count follows")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT u.id, COALESCE(u.display_name, ''), u.avatar_url, sf.created_at
		  FROM seller_follows sf
		  JOIN users u ON u.id = sf.seller_id
		 WHERE sf.follower_id = $1
		 ORDER BY sf.created_at DESC
		 LIMIT $2 OFFSET $3`,
		claims.UserID, pageSize, (page-1)*pageSize)
	if err != nil {
		slog.ErrorContext(r.Context(), "my follows query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list follows")
		return
	}
	defer rows.Close()

	out := make([]followedSellerJSON, 0)
	for rows.Next() {
		var f followedSellerJSON
		var avatar sql.NullString
		if err := rows.Scan(&f.SellerID, &f.DisplayName, &avatar, &f.FollowedAt); err != nil {
			slog.ErrorContext(r.Context(), "my follows scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		if avatar.Valid {
			s := avatar.String
			f.AvatarURL = &s
		}
		out = append(out, f)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"follows":    out,
		"pagination": pageMeta(page, pageSize, total),
	})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/feed — activity feed of followed sellers' active listings
// ─────────────────────────────────────────────────────────────────────────

// MyFeed returns the active listings posted by sellers the user follows,
// sorted by auction_ends_at ASC (closing-soonest first). This is the
// retention surface — opening the app surfaces what your followed sellers
// are auctioning right now.
//
// Photo hydration matches the watchlist endpoint pattern (one round-trip
// for all listing IDs, then merged into the result set).
func (h *FollowsHandler) MyFeed(w http.ResponseWriter, r *http.Request) {
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

	// Count first — separate query is cheaper than a window function for
	// the small fan-out we expect (a buyer follows tens of sellers).
	var total int
	if err := h.db.QueryRow(r.Context(), `
		SELECT COUNT(*)
		  FROM listings l
		  JOIN seller_follows sf ON sf.seller_id = l.seller_id
		 WHERE sf.follower_id = $1
		   AND l.status = 'active'
		   AND l.is_hidden = false`,
		claims.UserID,
	).Scan(&total); err != nil {
		slog.ErrorContext(r.Context(), "feed count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count feed")
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
			l.created_at, l.updated_at
		  FROM listings l
		  JOIN seller_follows sf ON sf.seller_id = l.seller_id
		  LEFT JOIN service_categories c ON c.id = l.category_id
		 WHERE sf.follower_id = $1
		   AND l.status = 'active'
		   AND l.is_hidden = false
		 ORDER BY l.auction_ends_at ASC NULLS LAST
		 LIMIT $2 OFFSET $3`,
		claims.UserID, pageSize, (page-1)*pageSize)
	if err != nil {
		slog.ErrorContext(r.Context(), "feed query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load feed")
		return
	}
	defer rows.Close()

	results := make([]listingJSON, 0)
	ids := make([]string, 0)
	for rows.Next() {
		var l listingJSON
		var lat, lng pgtype.Float8
		var endsAt pgtype.Timestamptz
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
		); err != nil {
			slog.ErrorContext(r.Context(), "feed scan failed", "error", err)
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

	// Photo hydration in one round-trip.
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
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"listings":   results,
		"pagination": pageMeta(page, pageSize, total),
	})
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

// followerCount returns the live count of followers for a seller. Errors
// degrade to 0 — the response still goes out, just without a count.
func (h *FollowsHandler) followerCount(ctx context.Context, sellerID string) int {
	if h.db == nil {
		return 0
	}
	var n int
	if err := h.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM seller_follows WHERE seller_id = $1`, sellerID,
	).Scan(&n); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0
		}
		slog.WarnContext(ctx, "follower count failed", "error", err, "seller_id", sellerID)
		return 0
	}
	return n
}
