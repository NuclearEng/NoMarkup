// Public-facing handlers for goods marketplace search-as-you-type and
// "similar items" rails. Brings the listings surface to feature-parity
// with /jobs's Meilisearch-backed search.
//
// Routes:
//   GET /api/v1/listings/autocomplete         — typeahead suggestions
//   GET /api/v1/listings/{id}/similar         — same-category relevance rail
//
// Why a dedicated handler file:
//   listings.go is large and locked by Agent H this wave (Condition column
//   work). Mounting both new endpoints here keeps the diff surgical and
//   makes the Meilisearch dependency explicit at the type level — the
//   ListingsHandler's dependencies stay pgx + cache only.
//
// Meilisearch failure-mode policy:
//   When the meili client is nil or returns an error, both endpoints
//   gracefully degrade to empty results. Autocomplete is non-critical
//   UX; we do not want a search outage to crash the marketplace page.

package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/meilisearch/meilisearch-go"
)

// listingsSearchIndexUID is the Meilisearch index the goods marketplace reads
// and writes. Must stay in sync with listingsIndexUID in
// services/job/internal/service/listing_search_indexer.go — the job service
// owns writes, the gateway reads and evicts.
const listingsSearchIndexUID = "listings"

// ListingsSearchHandler exposes the autocomplete and similar-listings endpoints.
//
// listingsHandler is reused so we can call its loadListingJSON helper to
// fully hydrate the similar-items payload (photos, seller name, etc).
type ListingsSearchHandler struct {
	db              *pgxpool.Pool
	meili           meilisearch.ServiceManager
	listingsHandler *ListingsHandler
}

// NewListingsSearchHandler constructs the handler. meili and listingsHandler
// may both be nil — endpoints degrade to empty payloads when search is
// not configured, which is the expected sandbox/dev state.
//
// Side effect: the meili client is also handed to the ListingsHandler so its
// hard-delete path can evict the search document (see
// ListingsHandler.deleteListingDocument). The gateway constructs exactly one
// ListingsHandler and passes that same pointer here
// (gateway/cmd/server/main.go), so back-wiring at this seam keeps the search
// dependency in one file and needs no change to the composition root. A nil
// meili leaves the ListingsHandler exactly as it was.
func NewListingsSearchHandler(db *pgxpool.Pool, meili meilisearch.ServiceManager, lh *ListingsHandler) *ListingsSearchHandler {
	if lh != nil && meili != nil {
		lh.meili = meili
	}
	return &ListingsSearchHandler{db: db, meili: meili, listingsHandler: lh}
}

// ─────────────────────────────────────────────────────────────────────────
// JSON response shapes
// ─────────────────────────────────────────────────────────────────────────

type autocompleteSuggestionJSON struct {
	Type               string `json:"type"`                            // "listing" | "category"
	ID                 string `json:"id,omitempty"`                    // listing UUID
	Title              string `json:"title,omitempty"`                 // listing title
	CategorySlug       string `json:"category_slug,omitempty"`         // both kinds
	Label              string `json:"label,omitempty"`                 // category display label
	StartingPriceCents int64  `json:"starting_price_cents,omitempty"`  // listing only
}

type autocompleteResponse struct {
	Suggestions []autocompleteSuggestionJSON `json:"suggestions"`
}

type similarListingsResponse struct {
	Listings []listingJSON `json:"listings"`
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/listings/autocomplete?q=eames&limit=10
// ─────────────────────────────────────────────────────────────────────────

// Autocomplete returns up to N typeahead matches: listings via Meilisearch
// + a small fixed set of category suggestions whose name/slug starts with
// the prefix. The endpoint is public (no auth) and intentionally cheap.
func (h *ListingsSearchHandler) Autocomplete(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := parseAutocompleteLimit(r.URL.Query().Get("limit"))

	if q == "" {
		writeJSON(w, http.StatusOK, autocompleteResponse{Suggestions: []autocompleteSuggestionJSON{}})
		return
	}

	// Categories: small fixed corpus we can match against the prefix.
	// We use the live service_categories table so admin-added goods cats
	// show up too. Cheap query, no JOIN.
	categorySuggestions := h.matchCategories(r.Context(), q, 4)

	// Listings: Meilisearch hit. When meili is nil, skip silently.
	// Over-fetch so the Postgres liveness filter below can drop stale hits
	// without shrinking the visible suggestion count.
	listingSuggestions := h.matchListingsViaMeili(r.Context(), q, int64(limit)*2)
	listingSuggestions = h.keepLiveListings(r.Context(), listingSuggestions)
	if len(listingSuggestions) > limit {
		listingSuggestions = listingSuggestions[:limit]
	}

	combined := make([]autocompleteSuggestionJSON, 0, len(categorySuggestions)+len(listingSuggestions))
	// Categories first — they're navigation-aiding hints.
	combined = append(combined, categorySuggestions...)
	combined = append(combined, listingSuggestions...)
	if len(combined) > limit {
		combined = combined[:limit]
	}

	// Public search suggestions, keyed by ?q= at the edge. Stable enough for a
	// 60s CDN TTL + 5m stale-while-revalidate — absorbs search-as-you-type
	// bursts. No auth, no per-user data.
	writeCachedJSON(w, r, http.StatusOK, autocompleteResponse{Suggestions: combined}, 60, 300)
}

func parseAutocompleteLimit(s string) int {
	if s == "" {
		return 10
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return 10
	}
	if n > 25 {
		return 25
	}
	return n
}

// matchCategories returns up to `n` service_categories whose name or slug
// matches the prefix (case-insensitive). Fallback empty slice on any error.
func (h *ListingsSearchHandler) matchCategories(ctx context.Context, q string, n int) []autocompleteSuggestionJSON {
	if h.db == nil {
		return nil
	}
	prefix := strings.ToLower(q) + "%"
	rows, err := h.db.Query(ctx, `
		SELECT slug, name FROM service_categories
		 WHERE LOWER(name) LIKE $1 OR LOWER(slug) LIKE $1
		 ORDER BY name ASC
		 LIMIT $2`, prefix, n)
	if err != nil {
		slog.Warn("autocomplete: category lookup failed", "error", err)
		return nil
	}
	defer rows.Close()
	out := make([]autocompleteSuggestionJSON, 0, n)
	for rows.Next() {
		var slug, name string
		if err := rows.Scan(&slug, &name); err != nil {
			continue
		}
		out = append(out, autocompleteSuggestionJSON{
			Type:         "category",
			CategorySlug: slug,
			Label:        name,
		})
	}
	return out
}

// matchListingsViaMeili runs a Meilisearch query restricted to active
// listings and returns up to `limit` suggestion docs.
func (h *ListingsSearchHandler) matchListingsViaMeili(ctx context.Context, q string, limit int64) []autocompleteSuggestionJSON {
	if h.meili == nil {
		return nil
	}
	resp, err := h.meili.Index(listingsSearchIndexUID).SearchWithContext(ctx, q, &meilisearch.SearchRequest{
		Limit:  limit,
		Filter: "status = active",
		AttributesToRetrieve: []string{
			"id", "title", "category_slug", "starting_price_cents",
		},
	})
	if err != nil {
		slog.Warn("autocomplete: meili listings search failed", "error", err)
		return nil
	}
	out := make([]autocompleteSuggestionJSON, 0, len(resp.Hits))
	for _, hit := range resp.Hits {
		var s autocompleteSuggestionJSON
		s.Type = "listing"
		if v, ok := hit["id"]; ok {
			_ = json.Unmarshal(v, &s.ID)
		}
		if v, ok := hit["title"]; ok {
			_ = json.Unmarshal(v, &s.Title)
		}
		if v, ok := hit["category_slug"]; ok {
			_ = json.Unmarshal(v, &s.CategorySlug)
		}
		if v, ok := hit["starting_price_cents"]; ok {
			_ = json.Unmarshal(v, &s.StartingPriceCents)
		}
		if s.ID == "" {
			continue
		}
		out = append(out, s)
	}
	return out
}

// keepLiveListings drops suggestions whose listing is no longer an active row
// in Postgres, preserving Meilisearch's relevance order for the survivors.
//
// ── Why verify at all, given the delete path now evicts documents ──────────
// Eviction is best-effort and only covers the one code path that hard-deletes.
// The index also drifts whenever a status leaves 'active' (sold, cancelled,
// expired — the auction-close worker writes those straight to Postgres), when
// a Meili write fails, and for every document written before the eviction fix
// shipped. Postgres is the authority; the index is a hint.
//
// ── Why filter instead of fully hydrating ─────────────────────────────────
// Autocomplete only renders id/title/category_slug/starting_price_cents, all
// of which Meili already returns, so hydration would buy nothing but latency.
// Verification costs ONE primary-key `= ANY` lookup over at most 50 UUIDs —
// index-only, sub-millisecond — against an endpoint whose alternative is
// serving dead links out of a 60s/300s CDN cache, where each phantom is a
// guaranteed 404 click and stays wrong for the whole TTL. The latency is worth
// it; that trade is the entire reason for the extra round trip.
//
// Fails CLOSED: with no DB handle, or on a query error, listing suggestions are
// dropped rather than served unverified. Category suggestions are unaffected,
// so the typeahead still helps the user navigate — consistent with this file's
// stated policy that autocomplete degrades rather than errors.
func (h *ListingsSearchHandler) keepLiveListings(ctx context.Context, in []autocompleteSuggestionJSON) []autocompleteSuggestionJSON {
	if len(in) == 0 {
		return in
	}
	if h.db == nil {
		slog.WarnContext(ctx, "autocomplete: no db handle, dropping unverified listing suggestions",
			"dropped", len(in))
		return nil
	}

	ids := make([]string, 0, len(in))
	for _, s := range in {
		ids = append(ids, s.ID)
	}

	rows, err := h.db.Query(ctx, `
		SELECT id::text FROM listings
		 WHERE id = ANY($1::uuid[]) AND status = 'active'`, ids)
	if err != nil {
		slog.WarnContext(ctx, "autocomplete: listing liveness check failed, dropping listing suggestions",
			"error", err, "candidates", len(in))
		return nil
	}
	defer rows.Close()

	live := make(map[string]struct{}, len(in))
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			slog.WarnContext(ctx, "autocomplete: liveness scan failed", "error", err)
			return nil
		}
		live[id] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		slog.WarnContext(ctx, "autocomplete: liveness iterate failed", "error", err)
		return nil
	}

	out := make([]autocompleteSuggestionJSON, 0, len(in))
	for _, s := range in {
		if _, ok := live[s.ID]; ok {
			out = append(out, s)
		}
	}
	if stale := len(in) - len(out); stale > 0 {
		slog.InfoContext(ctx, "autocomplete: dropped stale meilisearch hits",
			"stale", stale, "kept", len(out))
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/listings/{id}/similar?limit=12
// ─────────────────────────────────────────────────────────────────────────

// Similar returns up to `limit` listings (default 12) ranked by relevance
// against the source listing's title+description, restricted to the same
// category and status='active'. Excludes the source listing itself.
func (h *ListingsSearchHandler) Similar(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}
	if h.db == nil {
		writeJSON(w, http.StatusOK, similarListingsResponse{Listings: []listingJSON{}})
		return
	}

	limit := parseSimilarLimit(r.URL.Query().Get("limit"))

	// Read the source listing's title, description, and category so we
	// have something to query against.
	var (
		title, description, categorySlug, categoryID string
	)
	err := h.db.QueryRow(r.Context(), `
		SELECT l.title, COALESCE(l.description,''),
			COALESCE(c.slug,''), l.category_id
		  FROM listings l
		  LEFT JOIN service_categories c ON c.id = l.category_id
		 WHERE l.id = $1`, id).Scan(&title, &description, &categorySlug, &categoryID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.Error("similar: source listing read failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to load listing")
		return
	}

	ids := h.findSimilarIDs(r.Context(), id, title, description, categorySlug, limit)

	// Fall back to a same-category SQL pull when Meilisearch returned
	// nothing (e.g. uninitialized index in dev / sandbox).
	if len(ids) == 0 {
		ids = h.fallbackSimilarIDs(r.Context(), id, categoryID, limit)
	}

	listings := make([]listingJSON, 0, len(ids))
	if h.listingsHandler != nil {
		for _, lid := range ids {
			lj, err := h.listingsHandler.loadListingJSON(r.Context(), lid)
			if err != nil {
				slog.Warn("similar: hydrate failed", "id", lid, "error", err)
				continue
			}
			listings = append(listings, *lj)
		}
	}
	// Public "similar listings" rail for a listing — relatively stable, so a
	// 60s CDN TTL + 5m stale-while-revalidate is safe. No auth, no per-user data.
	writeCachedJSON(w, r, http.StatusOK, similarListingsResponse{Listings: listings}, 60, 300)
}

func parseSimilarLimit(s string) int {
	if s == "" {
		return 12
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return 12
	}
	if n > 24 {
		return 24
	}
	return n
}

// findSimilarIDs queries Meilisearch for IDs of listings related to the
// source by title+description text. nil-safe when meili isn't wired.
func (h *ListingsSearchHandler) findSimilarIDs(ctx context.Context, sourceID, title, description, categorySlug string, limit int) []string {
	if h.meili == nil {
		return nil
	}
	q := strings.TrimSpace(title + " " + description)
	if q == "" {
		return nil
	}
	filter := "status = active"
	if categorySlug != "" {
		filter = fmt.Sprintf("status = active AND category_slug = %q", categorySlug)
	}
	resp, err := h.meili.Index(listingsSearchIndexUID).SearchWithContext(ctx, q, &meilisearch.SearchRequest{
		Limit:                int64(limit) + 1, // +1 to drop the source
		Filter:               filter,
		AttributesToRetrieve: []string{"id"},
	})
	if err != nil {
		slog.Warn("similar: meili search failed", "error", err)
		return nil
	}
	out := make([]string, 0, len(resp.Hits))
	for _, hit := range resp.Hits {
		var id string
		if v, ok := hit["id"]; ok {
			_ = json.Unmarshal(v, &id)
		}
		if id == "" || id == sourceID {
			continue
		}
		out = append(out, id)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// fallbackSimilarIDs pulls same-category active listings (excluding the
// source) directly from Postgres, ordered by recency. Used when the
// Meilisearch index is unreachable, empty, or hasn't been backfilled.
func (h *ListingsSearchHandler) fallbackSimilarIDs(ctx context.Context, sourceID, categoryID string, limit int) []string {
	if h.db == nil || categoryID == "" {
		return nil
	}
	rows, err := h.db.Query(ctx, `
		SELECT id FROM listings
		 WHERE category_id = $1
		   AND status = 'active'
		   AND is_hidden = false
		   AND id <> $2
		 ORDER BY created_at DESC
		 LIMIT $3`, categoryID, sourceID, limit)
	if err != nil {
		slog.Warn("similar: fallback query failed", "error", err)
		return nil
	}
	defer rows.Close()
	out := make([]string, 0, limit)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			out = append(out, id)
		}
	}
	return out
}
