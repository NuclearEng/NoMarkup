// Package service — listing (goods marketplace) Meilisearch indexer.
//
// Brings the goods marketplace to parity with jobs on full-text search.
// Mirrors the contract of search.go's SearchEngine but indexes the
// `listings` documents under a separate Meilisearch index UID.
//
// The job-side and listing-side indexers are deliberately *separate*
// types so we can wire them independently into JobService /
// ListingService without forcing a single coupled "search hub" object.
//
// Lifecycle hooks are fired by ListingService:
//
//	create          → status='active' && Publish=true → IndexListing
//	update          → only re-indexes when status='active'
//	cancel          → RemoveListing
//	close (sold)    → RemoveListing  (sold listings shouldn't show up
//	                                  in browse/autocomplete)
//	close (no bids) → RemoveListing  (status flips to 'expired')
//
// The retry pattern (3-attempt exponential backoff, fire-and-forget
// goroutine) is identical to JobService.indexJobWithRetry — see
// job.go:398. We use the same structured-log levels so the alerting
// pipeline picks up failures uniformly across both index types.
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/meilisearch/meilisearch-go"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/observability"
)

const listingsIndexUID = "listings"

// ListingSearchEngine wraps Meilisearch for listing search indexing.
type ListingSearchEngine struct {
	client meilisearch.ServiceManager
	// trustRanking gates the trust-tiered ranking signal (MOVE B2). When false
	// (the default / fail-closed state) the `trust_rank` attribute is omitted
	// from documents and the `trust_rank:desc` ranking rule is not configured,
	// so ordering is identical to the legacy behavior.
	trustRanking bool
}

// NewListingSearchEngine creates a new Meilisearch search engine for listings.
// Returns an error if Meilisearch is unreachable or index configuration fails.
func NewListingSearchEngine(host, apiKey string) (*ListingSearchEngine, error) {
	client := meilisearch.New(host,
		meilisearch.WithAPIKey(apiKey),
		// Traced transport: Meilisearch has no OTel integration of its own,
		// so without this a slow search is an unexplained gap in the trace.
		meilisearch.WithCustomClient(observability.NewTracedHTTPClient("meilisearch")),
	)

	se := &ListingSearchEngine{client: client}
	if err := se.ConfigureIndex(); err != nil {
		return nil, fmt.Errorf("configure listing search index: %w", err)
	}
	return se, nil
}

// SetTrustRanking toggles the trust-tiered ranking signal. Must be called
// BEFORE ConfigureIndex (or trigger a re-configure) so the ranking rules /
// sortable attributes reflect the chosen mode. Wired from TRUST_RANKING at
// startup; defaults off (fail closed).
func (se *ListingSearchEngine) SetTrustRanking(enabled bool) {
	se.trustRanking = enabled
}

// TrustRankingEnabled reports whether the trust ranking signal is on. Exported
// so the hydrator wiring can avoid the (cheap) trust lookup when it's off.
func (se *ListingSearchEngine) TrustRankingEnabled() bool {
	if se == nil {
		return false
	}
	return se.trustRanking
}

// ConfigureIndex sets up the Meilisearch `listings` index with searchable,
// filterable, and sortable attributes.
func (se *ListingSearchEngine) ConfigureIndex() error {
	_, err := se.client.CreateIndex(&meilisearch.IndexConfig{
		Uid:        listingsIndexUID,
		PrimaryKey: "id",
	})
	if err != nil {
		// Index may already exist. Meilisearch returns 4xx but we tolerate.
		slog.Warn("listings search index may already exist", "error", err)
	}

	index := se.client.Index(listingsIndexUID)

	_, err = index.UpdateSearchableAttributes(&[]string{
		"title", "description", "category_name", "pickup_city",
	})
	if err != nil {
		return fmt.Errorf("update searchable attributes: %w", err)
	}

	filterableAttrs := []interface{}{
		"status", "category_slug", "category_id",
		"condition", "pickup_zip", "pickup_state",
		"seller_id",
	}
	if _, err = index.UpdateFilterableAttributes(&filterableAttrs); err != nil {
		return fmt.Errorf("update filterable attributes: %w", err)
	}

	sortable := []string{
		"auction_ends_at", "current_bid_cents", "starting_price_cents",
		"bid_count", "watcher_count",
	}
	if se.trustRanking {
		sortable = append(sortable, "trust_rank")
	}
	if _, err = index.UpdateSortableAttributes(&sortable); err != nil {
		return fmt.Errorf("update sortable attributes: %w", err)
	}

	// Trust-tiered ranking (MOVE B2): append `trust_rank:desc` AFTER the default
	// relevancy rules so text relevance always dominates and trust only breaks
	// ties among comparable hits — a modest, explainable nudge, never a
	// dominant factor. When the flag is off we RESET to the Meilisearch default
	// rules so toggling off restores legacy ordering exactly (fail closed).
	rankingRules := defaultMeiliRankingRules()
	if se.trustRanking {
		rankingRules = append(rankingRules, "trust_rank:desc")
	}
	if _, err = index.UpdateRankingRules(&rankingRules); err != nil {
		return fmt.Errorf("update ranking rules: %w", err)
	}

	return nil
}

// defaultMeiliRankingRules returns Meilisearch's built-in ranking rules in
// their canonical order. We set them explicitly so the trust rule can be
// appended deterministically (and so disabling the flag restores the exact
// default chain rather than whatever was previously persisted on the index).
func defaultMeiliRankingRules() []string {
	return []string{"words", "typo", "proximity", "attribute", "sort", "exactness"}
}

// ListingIndexDocument is the canonical shape stored in Meilisearch for a
// listing. The repository layer doesn't currently denormalize all of these
// fields (e.g. category_name, pickup_city, condition), so the indexer is
// responsible for hydrating them. When fields are unknown at indexing time
// they are omitted from the document — Meilisearch tolerates absent fields.
type ListingIndexDocument struct {
	ID                  string `json:"id"`
	SellerID            string `json:"seller_id"`
	CategoryID          string `json:"category_id"`
	CategoryName        string `json:"category_name,omitempty"`
	CategorySlug        string `json:"category_slug,omitempty"`
	Title               string `json:"title"`
	Description         string `json:"description,omitempty"`
	StartingPriceCents  int64  `json:"starting_price_cents"`
	CurrentBidCents     int64  `json:"current_bid_cents"`
	PickupZip           string `json:"pickup_zip,omitempty"`
	PickupCity          string `json:"pickup_city,omitempty"`
	PickupState         string `json:"pickup_state,omitempty"`
	BidCount            int32  `json:"bid_count"`
	SnipeExtensionCount int32  `json:"snipe_extension_count"`
	WatcherCount        int32  `json:"watcher_count,omitempty"`
	Status              string `json:"status"`
	Condition           string `json:"condition,omitempty"`
	AuctionEndsAt       int64  `json:"auction_ends_at,omitempty"` // epoch seconds
	// _geo is the magic field name Meilisearch reads for geosearch.
	Geo *MeiliGeo `json:"_geo,omitempty"`
}

// MeiliGeo is the embedded coordinate object Meilisearch expects.
type MeiliGeo struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// IndexListing adds or updates a listing in the search index.
func (se *ListingSearchEngine) IndexListing(ctx context.Context, l *domain.Listing, hydrate ListingHydrator) error {
	doc := buildListingDoc(l, hydrate, se.trustRanking)
	if _, err := se.client.Index(listingsIndexUID).AddDocuments([]map[string]interface{}{doc}, nil); err != nil {
		return fmt.Errorf("index listing: %w", err)
	}
	return nil
}

// RemoveListing removes a listing from the search index.
func (se *ListingSearchEngine) RemoveListing(ctx context.Context, listingID string) error {
	if _, err := se.client.Index(listingsIndexUID).DeleteDocument(listingID, nil); err != nil {
		return fmt.Errorf("remove listing from index: %w", err)
	}
	return nil
}

// SearchListings runs a Meilisearch full-text query restricted to active
// listings. Returns the IDs in relevance order plus the total estimated
// hits (Meilisearch returns this as a hint, not a precise count).
func (se *ListingSearchEngine) SearchListings(ctx context.Context, query string, limit, offset int64) ([]string, int64, error) {
	resp, err := se.client.Index(listingsIndexUID).Search(query, &meilisearch.SearchRequest{
		Limit:  limit,
		Offset: offset,
		Filter: "status = active",
	})
	if err != nil {
		return nil, 0, fmt.Errorf("meilisearch listings search: %w", err)
	}
	ids := make([]string, 0, len(resp.Hits))
	for _, hit := range resp.Hits {
		if raw, ok := hit["id"]; ok {
			var id string
			if err := json.Unmarshal(raw, &id); err == nil {
				ids = append(ids, id)
			}
		}
	}
	return ids, resp.EstimatedTotalHits, nil
}

// ListingHydrator is an optional callback that fills in fields not present
// on the domain.Listing struct — currently category_name/category_slug
// (joined from service_categories) and condition (added by Agent H in
// migration 040). nil-safe: when nil, those fields are omitted.
type ListingHydrator func(ctx context.Context, l *domain.Listing) ListingExtraFields

// ListingExtraFields holds denormalized data needed at index time.
type ListingExtraFields struct {
	CategoryName string
	CategorySlug string
	PickupCity   string
	PickupState  string
	Condition    string
	// TrustTier is the seller's trust tier (new|rising|trusted|top_rated|
	// under_review), read from trust_scores at index time. Only consulted when
	// the trust-ranking flag is on; empty otherwise. The indexer converts it to
	// the numeric `trust_rank` attribute via trustRankForTier.
	TrustTier string
}

func buildListingDoc(l *domain.Listing, hydrate ListingHydrator, trustRanking bool) map[string]interface{} {
	current := l.StartingPriceCents
	if l.CurrentBidCents != nil {
		current = *l.CurrentBidCents
	}
	doc := map[string]interface{}{
		"id":                    l.ID,
		"seller_id":             l.SellerID,
		"category_id":           l.CategoryID,
		"title":                 l.Title,
		"description":           l.Description,
		"starting_price_cents":  l.StartingPriceCents,
		"current_bid_cents":     current,
		"pickup_zip":            l.PickupZipCode,
		"bid_count":             l.BidCount,
		"snipe_extension_count": l.SnipeExtensionCount,
		"status":                l.Status,
	}
	// auction_ends_at is required (NOT NULL in schema) but treat zero
	// time defensively — Meilisearch sortable attrs hate NaN/Inf.
	if !l.AuctionEndsAt.IsZero() {
		doc["auction_ends_at"] = l.AuctionEndsAt.Unix()
	}
	if l.Latitude != 0 || l.Longitude != 0 {
		doc["_geo"] = map[string]float64{
			"lat": l.Latitude,
			"lng": l.Longitude,
		}
	}
	// Trust-tiered ranking signal (MOVE B2): when the flag is on, every active
	// document carries a numeric trust_rank so the `trust_rank:desc` ranking
	// rule has a consistent attribute to sort on. Default 0 (no boost) so a
	// seller whose tier we can't resolve simply isn't nudged. When the flag is
	// off we never write the attribute (fail closed → legacy ordering).
	var tier string
	if hydrate != nil {
		extras := hydrate(context.Background(), l)
		if extras.CategoryName != "" {
			doc["category_name"] = extras.CategoryName
		}
		if extras.CategorySlug != "" {
			doc["category_slug"] = extras.CategorySlug
		}
		if extras.PickupCity != "" {
			doc["pickup_city"] = extras.PickupCity
		}
		if extras.PickupState != "" {
			doc["pickup_state"] = extras.PickupState
		}
		if extras.Condition != "" {
			doc["condition"] = extras.Condition
		}
		tier = extras.TrustTier
	}
	if trustRanking {
		doc["trust_rank"] = trustRankForTier(tier)
	}
	return doc
}

// indexListingWithRetry mirrors job.go's indexJobWithRetry: 3 attempts
// with exponential backoff (1s, 2s, 4s) inside a goroutine so callers
// don't block. Failures are logged at ERROR after exhaustion.
func indexListingWithRetry(se *ListingSearchEngine, l *domain.Listing, hydrate ListingHydrator, operation string) {
	if se == nil || l == nil {
		return
	}
	listingID := l.ID
	go func() {
		const maxAttempts = 3
		ctx := context.Background()
		for attempt := 1; attempt <= maxAttempts; attempt++ {
			err := se.IndexListing(ctx, l, hydrate)
			if err == nil {
				if attempt > 1 {
					slog.Info("listing search index succeeded after retry",
						"listing_id", listingID,
						"operation", operation,
						"attempt", attempt,
					)
				}
				return
			}
			if attempt == maxAttempts {
				slog.Error("LISTING SEARCH INDEX FAILED — listing will not appear in search results (all retries exhausted)",
					"listing_id", listingID,
					"operation", operation,
					"attempts", maxAttempts,
					"error", err,
				)
				return
			}
			backoff := time.Duration(1<<(attempt-1)) * time.Second
			slog.Warn("listing search index failed, retrying",
				"listing_id", listingID,
				"operation", operation,
				"attempt", attempt,
				"next_retry_in", backoff,
				"error", err,
			)
			time.Sleep(backoff)
		}
	}()
}

// removeListingFromSearchWithRetry mirrors removeJobFromSearchWithRetry.
func removeListingFromSearchWithRetry(se *ListingSearchEngine, listingID, operation string) {
	if se == nil || listingID == "" {
		return
	}
	go func() {
		const maxAttempts = 3
		ctx := context.Background()
		for attempt := 1; attempt <= maxAttempts; attempt++ {
			err := se.RemoveListing(ctx, listingID)
			if err == nil {
				if attempt > 1 {
					slog.Info("listing search remove succeeded after retry",
						"listing_id", listingID,
						"operation", operation,
						"attempt", attempt,
					)
				}
				return
			}
			if attempt == maxAttempts {
				slog.Error("LISTING SEARCH REMOVE FAILED — stale entry may remain (all retries exhausted)",
					"listing_id", listingID,
					"operation", operation,
					"attempts", maxAttempts,
					"error", err,
				)
				return
			}
			backoff := time.Duration(1<<(attempt-1)) * time.Second
			slog.Warn("listing search remove failed, retrying",
				"listing_id", listingID,
				"operation", operation,
				"attempt", attempt,
				"next_retry_in", backoff,
				"error", err,
			)
			time.Sleep(backoff)
		}
	}()
}
