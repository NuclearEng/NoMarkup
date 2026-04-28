package handler

// Public-facing handlers for the goods marketplace listings surface.
// Mounted at /api/v1/listings (read-only) and /api/v1/listings/{id}/bid
// (auth required). Mirrors the admin handler's pgxpool-direct pattern.
//
// Routes:
//   GET    /api/v1/listings                       — search/list active listings
//   GET    /api/v1/listings/{id}                  — single listing detail
//   GET    /api/v1/listings/{id}/bids             — bid history (highest-first)
//   POST   /api/v1/listings/{id}/bid              — place a bid (auth required)
//   POST   /api/v1/listings/{id}/ping-viewer      — bump spectator count (anonymous)
//
// Why a thin gateway-side handler instead of a job-service gRPC call:
// the job service does not expose a gRPC listing surface in v1. Both
// surfaces share the same Postgres schema (migration 034), so a direct
// pgx query is the simplest path that keeps the demo functional.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ListingsHandler exposes the public goods-marketplace endpoints.
type ListingsHandler struct {
	db    *pgxpool.Pool
	cache *cache.Client
}

// NewListingsHandler returns a ListingsHandler. Both deps may be nil:
// a nil DB returns empty payloads; a nil cache disables ping-viewer
// counts and bid-event publishing (handlers degrade gracefully).
func NewListingsHandler(db *pgxpool.Pool, cacheClient *cache.Client) *ListingsHandler {
	return &ListingsHandler{db: db, cache: cacheClient}
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes — must match web/src/types/index.ts {Listing, ListingDetail,
// ListingBidHistory, PlaceListingBidResponse, ListingsResponse}.
// ─────────────────────────────────────────────────────────────────────────

type listingPhotoJSON struct {
	ID        string  `json:"id"`
	URL       string  `json:"url"`
	SortOrder int     `json:"sort_order"`
	BlurHash  *string `json:"blur_hash"`
}

type listingJSON struct {
	ID                   string             `json:"id"`
	SellerID             string             `json:"seller_id"`
	CategoryID           string             `json:"category_id"`
	CategoryName         string             `json:"category_name"`
	CategorySlug         string             `json:"category_slug"`
	Title                string             `json:"title"`
	Description          string             `json:"description"`
	Status               string             `json:"status"`
	Photos               []listingPhotoJSON `json:"photos"`
	PickupZip            string             `json:"pickup_zip"`
	PickupCity           *string            `json:"pickup_city"`
	PickupState          *string            `json:"pickup_state"`
	PickupAddress        *string            `json:"pickup_address"`
	PickupLat            *float64           `json:"pickup_lat"`
	PickupLng            *float64           `json:"pickup_lng"`
	StartingPriceCents   int64              `json:"starting_price_cents"`
	CurrentBidCents      int64              `json:"current_bid_cents"`
	MinIncrementCents    int64              `json:"min_increment_cents"`
	BidderCount          int                `json:"bidder_count"`
	BidCount             int                `json:"bid_count"`
	AuctionDurationHours int                `json:"auction_duration_hours"`
	AuctionEndsAt        *time.Time         `json:"auction_ends_at"`
	SnipeExtensionCount  int                `json:"snipe_extension_count"`
	DistanceKm           *float64           `json:"distance_km"`
	IsUserWinning        bool               `json:"is_user_winning"`
	WasOutbid            bool               `json:"was_outbid"`
	WatcherCount         int                `json:"watcher_count"`
	CreatedAt            time.Time          `json:"created_at"`
	UpdatedAt            time.Time          `json:"updated_at"`
}

type listingDetailJSON struct {
	listingJSON
	SellerDisplayName   string  `json:"seller_display_name"`
	SellerMemberSince   string  `json:"seller_member_since"`
	SellerListingsCount int     `json:"seller_listings_count"`
	SellerTrustTier     *string `json:"seller_trust_tier"`
	SellerTrustScore    *int    `json:"seller_trust_score"`
}

type listingBidJSON struct {
	ID                string    `json:"id"`
	ListingID         string    `json:"listing_id"`
	BidderID          string    `json:"bidder_id"`
	BidderDisplayName string    `json:"bidder_display_name"`
	AmountCents       int64     `json:"amount_cents"`
	IsWinning         bool      `json:"is_winning"`
	CreatedAt         time.Time `json:"created_at"`
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/listings — search/filter active listings
// ─────────────────────────────────────────────────────────────────────────

func (h *ListingsHandler) ListListings(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"listings":   []listingJSON{},
			"pagination": pageMeta(1, 0, 0),
		})
		return
	}

	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 60, 100)

	var clauses []string
	var args []interface{}
	clauses = append(clauses, "l.status = 'active'", "l.is_hidden = false")

	if cat := q.Get("category_id"); cat != "" && isValidUUID(cat) {
		args = append(args, cat)
		clauses = append(clauses, "l.category_id = $"+strconv.Itoa(len(args)))
	}

	// ── 25-mile pickup-radius filter ───────────────────────────────────────
	// Resolve a search center from (lat,lng), or look up pickup_zip in the
	// zip_codes table if it exists. The radius is capped at 40km (~25mi)
	// regardless of caller input — the pitch.md guarantees local-only.
	//
	// Schema note: a `zip_codes` table is referenced by the audit roadmap
	// but does not yet exist in /database/migrations. When a caller passes
	// only `pickup_zip`, we fall back to the legacy exact-match filter and
	// log a hint so the front-end isn't silently broken.
	centerLat, centerLng, hasCenter := h.resolveSearchCenter(r.Context(), q)
	radiusKm, hasRadius := resolveRadiusKm(q)
	applyGeo := hasCenter && hasRadius

	if zip := q.Get("pickup_zip"); zip != "" && !applyGeo {
		// Legacy fallback when we couldn't geocode the ZIP.
		args = append(args, zip)
		clauses = append(clauses, "l.pickup_zip_code = $"+strconv.Itoa(len(args)))
	}
	if applyGeo {
		args = append(args, centerLng) // ST_MakePoint takes (lng, lat)
		lngArg := strconv.Itoa(len(args))
		args = append(args, centerLat)
		latArg := strconv.Itoa(len(args))
		args = append(args, radiusKm*1000.0)
		metersArg := strconv.Itoa(len(args))
		clauses = append(clauses,
			"ST_DWithin(l.location::geography, ST_MakePoint($"+lngArg+", $"+latArg+")::geography, $"+metersArg+")")
	}

	if minP := q.Get("min_price_cents"); minP != "" {
		if n, err := strconv.ParseInt(minP, 10, 64); err == nil && n >= 0 {
			args = append(args, n)
			clauses = append(clauses, "COALESCE(l.current_bid_cents, l.starting_price_cents) >= $"+strconv.Itoa(len(args)))
		}
	}
	if maxP := q.Get("max_price_cents"); maxP != "" {
		if n, err := strconv.ParseInt(maxP, 10, 64); err == nil && n >= 0 {
			args = append(args, n)
			clauses = append(clauses, "COALESCE(l.current_bid_cents, l.starting_price_cents) <= $"+strconv.Itoa(len(args)))
		}
	}
	if q.Get("ending_soon") == "true" {
		clauses = append(clauses, "l.auction_ends_at IS NOT NULL AND l.auction_ends_at <= now() + interval '1 hour'")
	}
	if needle := strings.TrimSpace(q.Get("q")); needle != "" {
		args = append(args, "%"+needle+"%")
		clauses = append(clauses, "(l.title ILIKE $"+strconv.Itoa(len(args))+" OR l.description ILIKE $"+strconv.Itoa(len(args))+")")
	}

	orderBy := "l.auction_ends_at ASC NULLS LAST"
	switch q.Get("sort_by") {
	case "newest":
		orderBy = "l.created_at DESC"
	case "lowest_price":
		orderBy = "COALESCE(l.current_bid_cents, l.starting_price_cents) ASC"
	case "highest_price":
		orderBy = "COALESCE(l.current_bid_cents, l.starting_price_cents) DESC"
	case "distance":
		if hasCenter {
			orderBy = "distance_km ASC NULLS LAST"
		}
	case "ending_soon":
		// default
	}

	where := strings.Join(clauses, " AND ")

	var total int
	if err := h.db.QueryRow(r.Context(),
		"SELECT COUNT(*) FROM listings l WHERE "+where, args...).Scan(&total); err != nil {
		slog.Error("listings count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count listings")
		return
	}

	// Distance projection: when a center is resolved, project ST_Distance/1000
	// (km) into the SELECT and expose it as `distance_km` so callers can sort
	// by it and we can populate the JSON field. Otherwise project NULL so the
	// scan target is uniform.
	distanceExpr := "NULL::float8"
	if hasCenter {
		args = append(args, centerLng)
		dLngArg := strconv.Itoa(len(args))
		args = append(args, centerLat)
		dLatArg := strconv.Itoa(len(args))
		distanceExpr = "ST_Distance(l.location::geography, ST_MakePoint($" + dLngArg + ", $" + dLatArg + ")::geography) / 1000.0"
	}

	args = append(args, pageSize, (page-1)*pageSize)
	limitArg := strconv.Itoa(len(args) - 1)
	offsetArg := strconv.Itoa(len(args))

	rows, err := h.db.Query(r.Context(), `
		SELECT l.id, l.seller_id, l.category_id,
			COALESCE(c.name, '')                  AS category_name,
			COALESCE(c.slug, '')                  AS category_slug,
			l.title, COALESCE(l.description, ''),
			l.status,
			l.pickup_zip_code,
			NULL::text                            AS pickup_city,
			NULL::text                            AS pickup_state,
			NULL::text                            AS pickup_address,
			ST_Y(l.location)                      AS pickup_lat,
			ST_X(l.location)                      AS pickup_lng,
			l.starting_price_cents,
			COALESCE(l.current_bid_cents, l.starting_price_cents) AS current_bid_cents,
			100::bigint                           AS min_increment_cents,
			COALESCE(
				(SELECT COUNT(DISTINCT bidder_id) FROM listing_bids WHERE listing_id = l.id), 0
			) AS bidder_count,
			COALESCE(l.bid_count, 0),
			l.auction_duration_hours,
			l.auction_ends_at,
			COALESCE(l.snipe_extension_count, 0),
			`+distanceExpr+`                      AS distance_km,
			l.created_at, l.updated_at
		  FROM listings l
		  LEFT JOIN service_categories c ON c.id = l.category_id
		 WHERE `+where+`
		 ORDER BY `+orderBy+`
		 LIMIT $`+limitArg+` OFFSET $`+offsetArg, args...)
	if err != nil {
		slog.Error("listings query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list listings")
		return
	}
	defer rows.Close()

	results := make([]listingJSON, 0)
	ids := make([]string, 0)
	for rows.Next() {
		var l listingJSON
		var lat, lng pgtype.Float8
		var distanceKm pgtype.Float8
		var endsAt pgtype.Timestamptz
		if err := rows.Scan(&l.ID, &l.SellerID, &l.CategoryID,
			&l.CategoryName, &l.CategorySlug,
			&l.Title, &l.Description,
			&l.Status,
			&l.PickupZip, &l.PickupCity, &l.PickupState, &l.PickupAddress,
			&lat, &lng,
			&l.StartingPriceCents, &l.CurrentBidCents, &l.MinIncrementCents,
			&l.BidderCount, &l.BidCount,
			&l.AuctionDurationHours, &endsAt,
			&l.SnipeExtensionCount,
			&distanceKm,
			&l.CreatedAt, &l.UpdatedAt); err != nil {
			slog.Error("listings scan failed", "error", err)
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
		if distanceKm.Valid {
			v := distanceKm.Float64
			l.DistanceKm = &v
		}
		if endsAt.Valid {
			t := endsAt.Time
			l.AuctionEndsAt = &t
		}
		l.Photos = []listingPhotoJSON{}
		results = append(results, l)
		ids = append(ids, l.ID)
	}

	// Single-shot photo fetch for the listings we loaded.
	if len(ids) > 0 {
		photoMap, perr := h.fetchPhotosForListings(r.Context(), ids)
		if perr == nil {
			for i := range results {
				if ph, ok := photoMap[results[i].ID]; ok {
					results[i].Photos = ph
				}
			}
		}
		// Also overlay live spectator counts from Redis (best-effort).
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
// GET /api/v1/listings/{id} — single detail
// ─────────────────────────────────────────────────────────────────────────

func (h *ListingsHandler) GetListing(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	id := chi.URLParam(r, "id")
	// Path collision: /api/v1/listings/mine is registered as an auth-protected
	// route BUT chi matches `/listings/{id}` first (different mount points).
	// Delegate to MyListings, which enforces the auth check itself.
	if id == "mine" {
		h.MyListings(w, r)
		return
	}
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	var d listingDetailJSON
	var lat, lng pgtype.Float8
	var endsAt pgtype.Timestamptz
	var memberSince time.Time
	var trustTier sql.NullString
	var trustScore sql.NullInt32
	err := h.db.QueryRow(r.Context(), `
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
			COALESCE(u.display_name, ''), u.created_at,
			(SELECT COUNT(*) FROM listings WHERE seller_id = l.seller_id AND status IN ('active','sold')),
			NULL::text, NULL::int
		  FROM listings l
		  LEFT JOIN service_categories c ON c.id = l.category_id
		  LEFT JOIN users u ON u.id = l.seller_id
		 WHERE l.id = $1`,
		id,
	).Scan(
		&d.ID, &d.SellerID, &d.CategoryID,
		&d.CategoryName, &d.CategorySlug,
		&d.Title, &d.Description,
		&d.Status, &d.PickupZip,
		&d.PickupCity, &d.PickupState, &d.PickupAddress,
		&lat, &lng,
		&d.StartingPriceCents, &d.CurrentBidCents, &d.MinIncrementCents,
		&d.BidderCount, &d.BidCount,
		&d.AuctionDurationHours, &endsAt,
		&d.SnipeExtensionCount,
		&d.CreatedAt, &d.UpdatedAt,
		&d.SellerDisplayName, &memberSince, &d.SellerListingsCount,
		&trustTier, &trustScore,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.Error("get listing failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to load listing")
		return
	}
	if lat.Valid {
		v := lat.Float64
		d.PickupLat = &v
	}
	if lng.Valid {
		v := lng.Float64
		d.PickupLng = &v
	}
	if endsAt.Valid {
		t := endsAt.Time
		d.AuctionEndsAt = &t
	}
	if trustTier.Valid {
		s := trustTier.String
		d.SellerTrustTier = &s
	}
	if trustScore.Valid {
		v := int(trustScore.Int32)
		d.SellerTrustScore = &v
	}
	d.SellerMemberSince = memberSince.UTC().Format(time.RFC3339)

	if photoMap, perr := h.fetchPhotosForListings(r.Context(), []string{id}); perr == nil {
		d.Photos = photoMap[id]
	}
	if d.Photos == nil {
		d.Photos = []listingPhotoJSON{}
	}
	d.WatcherCount = h.spectatorCount(r.Context(), id)

	writeJSON(w, http.StatusOK, map[string]interface{}{"listing": d})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/listings/{id}/bids — bid history (highest-first)
// ─────────────────────────────────────────────────────────────────────────

func (h *ListingsHandler) GetListingBids(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"bids":              []listingBidJSON{},
			"current_bid_cents": 0,
			"bidder_count":      0,
		})
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT b.id, b.listing_id, b.bidder_id,
			COALESCE(u.display_name, 'Bidder'),
			b.amount_cents, (b.status = 'active'),
			b.created_at
		  FROM listing_bids b
		  LEFT JOIN users u ON u.id = b.bidder_id
		 WHERE b.listing_id = $1
		 ORDER BY b.amount_cents DESC, b.created_at DESC
		 LIMIT 50`, id)
	if err != nil {
		slog.Error("listing bids query failed", "error", err, "listing_id", id)
		writeError(w, http.StatusInternalServerError, "failed to load bids")
		return
	}
	defer rows.Close()

	bids := make([]listingBidJSON, 0)
	bidders := make(map[string]struct{})
	for rows.Next() {
		var b listingBidJSON
		if err := rows.Scan(&b.ID, &b.ListingID, &b.BidderID,
			&b.BidderDisplayName, &b.AmountCents, &b.IsWinning,
			&b.CreatedAt); err != nil {
			slog.Error("listing bid scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		bidders[b.BidderID] = struct{}{}
		bids = append(bids, b)
	}

	var currentCents int64
	if len(bids) > 0 {
		currentCents = bids[0].AmountCents
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"bids":              bids,
		"current_bid_cents": currentCents,
		"bidder_count":      len(bidders),
	})
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/listings/{id}/ping-viewer — anonymous spectator heartbeat
//
// Used by the scoreboard to bump the watcher count for a listing the
// user is currently viewing. Increments a Redis sorted-set keyed by
// session ID, decaying after 30 seconds of inactivity. Returns the
// current count so the UI can update without a separate WebSocket
// connection.
// ─────────────────────────────────────────────────────────────────────────

func (h *ListingsHandler) PingViewer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	rdb := h.redisClient()
	if rdb == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"listing_id":    id,
			"watcher_count": 0,
		})
		return
	}

	// Anonymous viewer ID — a per-IP+UA fingerprint is enough for demo
	// purposes. Sessions roll forward as long as the client keeps pinging.
	viewerID := fmt.Sprintf("%s|%s",
		middleware.ClientIP(r),
		r.UserAgent(),
	)

	ctx := r.Context()
	key := cache.Key("listing_viewers", id)
	now := float64(time.Now().UnixMilli())

	// ZADD with current timestamp, then ZREMRANGEBYSCORE to evict viewers
	// older than 30 seconds. The remaining set size is the watcher count.
	rdb.ZAdd(ctx, key, redis.Z{Score: now, Member: viewerID})
	rdb.ZRemRangeByScore(ctx, key,
		"-inf",
		fmt.Sprintf("%f", now-30_000),
	)
	rdb.Expire(ctx, key, 5*time.Minute) // janitor
	count, _ := rdb.ZCard(ctx, key).Result()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"listing_id":    id,
		"watcher_count": count,
	})
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

func (h *ListingsHandler) redisClient() *redis.Client {
	if h.cache == nil {
		return nil
	}
	return h.cache.Redis()
}

// spectatorCount returns the live watcher count for a listing, or 0.
// Best-effort: Redis errors return 0 rather than failing the parent request.
func (h *ListingsHandler) spectatorCount(ctx context.Context, listingID string) int {
	rdb := h.redisClient()
	if rdb == nil {
		return 0
	}
	key := cache.Key("listing_viewers", listingID)
	now := float64(time.Now().UnixMilli())
	n, err := rdb.ZCount(ctx, key,
		fmt.Sprintf("%f", now-30_000),
		"+inf",
	).Result()
	if err != nil {
		return 0
	}
	return int(n)
}

func (h *ListingsHandler) fetchPhotosForListings(ctx context.Context, ids []string) (map[string][]listingPhotoJSON, error) {
	rows, err := h.db.Query(ctx, `
		SELECT id, listing_id, url, sort_order, blur_hash
		  FROM listing_photos
		 WHERE listing_id = ANY($1)
		 ORDER BY listing_id, sort_order`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string][]listingPhotoJSON, len(ids))
	for rows.Next() {
		var id, lid, url string
		var sortOrder int
		var blur sql.NullString
		if err := rows.Scan(&id, &lid, &url, &sortOrder, &blur); err != nil {
			return nil, err
		}
		ph := listingPhotoJSON{ID: id, URL: url, SortOrder: sortOrder}
		if blur.Valid {
			s := blur.String
			ph.BlurHash = &s
		}
		out[lid] = append(out[lid], ph)
	}
	return out, nil
}

func pageMeta(page, pageSize, total int) map[string]interface{} {
	totalPages := 0
	if pageSize > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	return map[string]interface{}{
		"page":        page,
		"page_size":   pageSize,
		"total":       total,
		"total_pages": totalPages,
		"has_next":    page < totalPages,
		"has_prev":    page > 1,
		"totalCount":  total,
		"totalPages":  totalPages,
		"hasNext":     page < totalPages,
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Geo-radius helpers
// ─────────────────────────────────────────────────────────────────────────

// maxRadiusKm is the cap enforced on every radius query. The pitch.md
// (and PRD) repeatedly promises "local pickup only inside 25 miles" —
// 40km is the rounded ceiling that honors that promise (25mi ≈ 40.23km)
// while letting the front-end pass a slightly higher number from URL
// shorthand without us silently widening the search.
const maxRadiusKm = 40.0

// resolveRadiusKm picks a radius from `radius_km` or `radius_miles`,
// caps it at maxRadiusKm, and returns whether a radius was supplied.
// Negative or non-numeric values are treated as absent.
func resolveRadiusKm(q map[string][]string) (float64, bool) {
	if mi := getFirst(q, "radius_miles"); mi != "" {
		if n, err := strconv.ParseFloat(mi, 64); err == nil && n > 0 {
			km := n * 1.609344
			if km > maxRadiusKm {
				km = maxRadiusKm
			}
			return km, true
		}
	}
	if km := getFirst(q, "radius_km"); km != "" {
		if n, err := strconv.ParseFloat(km, 64); err == nil && n > 0 {
			if n > maxRadiusKm {
				n = maxRadiusKm
			}
			return n, true
		}
	}
	return 0, false
}

// resolveSearchCenter returns (lat, lng, ok). Priority:
//  1. explicit ?lat=&lng= query params
//  2. ?pickup_zip= looked up via the zip_codes table (if it exists)
//
// The zip_codes table is referenced by the marketplace roadmap but has not
// yet been migrated. When the lookup table is missing or the ZIP is
// unknown we return ok=false; the caller falls back to legacy exact-match
// ZIP filtering and the radius clause is skipped.
func (h *ListingsHandler) resolveSearchCenter(ctx context.Context, q map[string][]string) (float64, float64, bool) {
	latStr := getFirst(q, "lat")
	lngStr := getFirst(q, "lng")
	if latStr != "" && lngStr != "" {
		lat, errLat := strconv.ParseFloat(latStr, 64)
		lng, errLng := strconv.ParseFloat(lngStr, 64)
		if errLat == nil && errLng == nil &&
			lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 {
			return lat, lng, true
		}
	}

	zip := getFirst(q, "pickup_zip")
	if zip == "" || h.db == nil {
		return 0, 0, false
	}
	var lat, lng float64
	err := h.db.QueryRow(ctx,
		`SELECT lat, lng FROM zip_codes WHERE zip = $1`, zip,
	).Scan(&lat, &lng)
	if err != nil {
		// Common: relation does not exist (table not migrated yet) or no row.
		// Fall back to legacy exact-zip filter; UI still gets results.
		slog.Warn("zip_codes lookup unavailable; radius filter skipped",
			"zip", zip, "error", err)
		return 0, 0, false
	}
	return lat, lng, true
}

// getFirst returns the first value for a query key, or "" if absent.
// Mirrors url.Values.Get without forcing the caller to import net/url.
func getFirst(q map[string][]string, key string) string {
	if v, ok := q[key]; ok && len(v) > 0 {
		return strings.TrimSpace(v[0])
	}
	return ""
}

// jsonRawOrNull returns a JSON-marshalled value or null if v is nil.
// Unused right now but kept here for future detail-page enrichments.
func jsonRawOrNull(v interface{}) json.RawMessage {
	if v == nil {
		return json.RawMessage("null")
	}
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("null")
	}
	return b
}

var _ = jsonRawOrNull // silence unused
