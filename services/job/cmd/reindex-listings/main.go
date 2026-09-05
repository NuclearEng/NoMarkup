// reindex-listings — one-shot CLI to backfill the Meilisearch `listings`
// index from the Postgres source of truth.
//
// Usage:
//   cd services/job
//   DATABASE_URL=... MEILISEARCH_URL=... MEILISEARCH_API_KEY=... \
//     go run ./cmd/reindex-listings
//
// MEILISEARCH_URL is canonical; MEILISEARCH_HOST is accepted as a deprecated
// fallback (see internal/config).
//
// Exit codes:
//   0 — success
//   1 — DATABASE_URL or MEILISEARCH_URL not set
//   2 — DB connection or query error
//   3 — Meilisearch index configuration / write error
//
// The CLI walks every status='active' listing and rebuilds the index from
// them. Designed to run in CI/CD as a post-deploy step or on demand when the
// index drifts.
//
// ── Convergence ───────────────────────────────────────────────────────────
// This tool used to only call AddDocuments. Meilisearch upserts by primary
// key, so that could ADD and UPDATE but never REMOVE: a listing hard-deleted
// from Postgres, or one that left status='active' (sold / cancelled /
// expired), kept its document forever. The index was a strict superset of
// reality and /listings/autocomplete served those phantoms — from behind a
// 60s/300s CDN cache, so they stayed clickable long after the row was gone.
//
// The run now builds a staging index, fills it, and atomically SWAPS it into
// place (ListingSearchEngine.BeginRebuild / AddRebuildBatch / CommitRebuild).
// The post-swap index equals the active-listing set exactly — stale documents
// are dropped by construction rather than hunted down. Readers keep hitting
// the live index the whole time and flip over in a single atomic step; if any
// step before the swap fails, the run aborts and the live index is untouched.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/job/internal/config"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/observability"
	"github.com/nomarkup/nomarkup/services/job/internal/service"
)

// rebuildBatchSize is how many listing documents are sent per Meilisearch
// write. The previous implementation issued one HTTP round trip per listing.
const rebuildBatchSize = 500

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	meiliURL := config.ResolveMeilisearchURL()
	if meiliURL == "" {
		slog.Error("MEILISEARCH_URL is required")
		os.Exit(1)
	}
	meiliKey := os.Getenv("MEILISEARCH_API_KEY")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Batch settings: this tool streams every active listing in one statement,
	// which legitimately runs far past the request-path statement_timeout the
	// service pools use. The 5-minute context above is the bound instead.
	pool, err := observability.NewPGXPoolWithSettings(ctx, dbURL, observability.BatchPoolSettings())
	if err != nil {
		slog.Error("connect to database", "error", err)
		os.Exit(2)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("database ping", "error", err)
		os.Exit(2)
	}

	se, err := service.NewListingSearchEngine(meiliURL, meiliKey)
	if err != nil {
		slog.Error("initialize listing search engine", "error", err)
		os.Exit(3)
	}

	// Trust-tiered ranking (MOVE B2): mirror the running service's mode so a
	// backfill produces consistent trust_rank attributes + ranking rules. Off by
	// default (fail closed). Set BEFORE BeginRebuild so the staging index is
	// configured with the same ranking rules the live index will get.
	trustRanking := envBool("TRUST_RANKING", false)
	se.SetTrustRanking(trustRanking)
	if trustRanking {
		if err := se.ConfigureIndex(); err != nil {
			slog.Error("re-configure listings index for trust ranking", "error", err)
			os.Exit(3)
		}
	}

	// Stage a fresh, correctly configured index. Everything below fills it;
	// nothing is visible to readers until CommitRebuild swaps it in.
	if err := se.BeginRebuild(ctx); err != nil {
		slog.Error("begin rebuild", "error", err)
		os.Exit(3)
	}

	hasCondition := columnExists(ctx, pool, "listings", "condition")

	rows, err := pool.Query(ctx, fmt.Sprintf(`
		SELECT l.id, l.seller_id, l.title, COALESCE(l.description,''),
			l.category_id,
			ST_Y(l.location), ST_X(l.location),
			COALESCE(l.pickup_zip_code,''),
			l.starting_price_cents, l.current_bid_cents,
			COALESCE(l.bid_count,0),
			COALESCE(l.snipe_extension_count,0),
			l.auction_ends_at, l.status,
			COALESCE(c.name,''), COALESCE(c.slug,''),
			%s
		  FROM listings l
		  LEFT JOIN service_categories c ON c.id = l.category_id
		 WHERE l.status = 'active'`,
		conditionSelect(hasCondition),
	))
	if err != nil {
		slog.Error("query active listings", "error", err)
		os.Exit(2)
	}
	defer rows.Close()

	// Per-listing extras are resolved during the scan and looked up by listing
	// ID at document-build time, so one hydrator can serve a whole batch.
	extrasByID := make(map[string]service.ListingExtraFields, rebuildBatchSize)
	hydrate := func(_ context.Context, l *domain.Listing) service.ListingExtraFields {
		if l == nil {
			return service.ListingExtraFields{}
		}
		return extrasByID[l.ID]
	}

	batch := make([]*domain.Listing, 0, rebuildBatchSize)
	indexed := 0
	failed := 0

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		if err := se.AddRebuildBatch(ctx, batch, hydrate); err != nil {
			return err
		}
		indexed += len(batch)
		slog.Info("rebuild progress", "indexed", indexed, "failed", failed)
		batch = batch[:0]
		clear(extrasByID)
		return nil
	}

	for rows.Next() {
		var (
			l                  domain.Listing
			currentBid         *int64
			endsAt             time.Time
			categoryName, slug string
			condition          string
		)
		if err := rows.Scan(
			&l.ID, &l.SellerID, &l.Title, &l.Description,
			&l.CategoryID, &l.Latitude, &l.Longitude,
			&l.PickupZipCode,
			&l.StartingPriceCents, &currentBid,
			&l.BidCount, &l.SnipeExtensionCount,
			&endsAt, &l.Status,
			&categoryName, &slug, &condition,
		); err != nil {
			slog.Error("scan row", "error", err)
			failed++
			continue
		}
		l.CurrentBidCents = currentBid
		l.AuctionEndsAt = endsAt
		extras := service.ListingExtraFields{
			CategoryName: categoryName,
			CategorySlug: slug,
			Condition:    condition,
		}
		// Trust-tiered ranking: read the seller's provider tier so the document
		// carries trust_rank. Only when the flag is on; fail-soft on missing row.
		if trustRanking && l.SellerID != "" {
			var tier string
			if err := pool.QueryRow(ctx, `
				SELECT tier FROM trust_scores
				 WHERE user_id = $1 AND role = 'provider'`, l.SellerID,
			).Scan(&tier); err == nil {
				extras.TrustTier = tier
			}
		}

		listing := l // copy: batch holds pointers past this iteration
		extrasByID[listing.ID] = extras
		batch = append(batch, &listing)

		if len(batch) >= rebuildBatchSize {
			if err := flush(); err != nil {
				slog.Error("rebuild batch failed; live index left untouched", "error", err)
				os.Exit(3)
			}
		}
	}
	if err := rows.Err(); err != nil {
		slog.Error("iterate active listings", "error", err)
		os.Exit(2)
	}
	if err := flush(); err != nil {
		slog.Error("rebuild final batch failed; live index left untouched", "error", err)
		os.Exit(3)
	}

	// A row that failed to scan means the staging index is missing a listing
	// that Postgres says is active. Swapping it in would DELETE that listing
	// from search. Abort instead and leave the live index alone — a slightly
	// stale index beats a silently truncated one.
	if failed > 0 {
		slog.Error("rebuild aborted: some rows failed to scan; live index left untouched",
			"indexed", indexed, "failed", failed)
		os.Exit(2)
	}

	// Atomic cutover. Everything in the live index that is not in the staging
	// index — deleted, sold, cancelled, expired listings — disappears here.
	if err := se.CommitRebuild(ctx); err != nil {
		slog.Error("commit rebuild (swap); live index left untouched", "error", err)
		os.Exit(3)
	}

	slog.Info("rebuild complete", "indexed", indexed, "failed", failed)
}

func columnExists(ctx context.Context, pool *pgxpool.Pool, table, col string) bool {
	var exists bool
	_ = pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			 WHERE table_name = $1 AND column_name = $2
		)`, table, col).Scan(&exists)
	return exists
}

func conditionSelect(has bool) string {
	if has {
		return "COALESCE(l.condition,'')"
	}
	return "''::text"
}

// envBool reads a boolean env flag: 1/true/t/yes/on → true; else def.
func envBool(key string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	switch v {
	case "":
		return def
	case "1", "true", "t", "yes", "on":
		return true
	default:
		return false
	}
}
