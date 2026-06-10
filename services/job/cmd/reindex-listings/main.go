// reindex-listings — one-shot CLI to backfill the Meilisearch `listings`
// index from the Postgres source of truth.
//
// Usage:
//   cd services/job
//   DATABASE_URL=... MEILISEARCH_HOST=... MEILISEARCH_API_KEY=... \
//     go run ./cmd/reindex-listings
//
// Exit codes:
//   0 — success
//   1 — DATABASE_URL or MEILISEARCH_HOST not set
//   2 — DB connection or query error
//   3 — Meilisearch index configuration / write error
//
// The CLI walks every status='active' listing and indexes it directly
// (no goroutine retry). Designed to run in CI/CD as a post-deploy step
// or on demand when the index drifts.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/service"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	meiliHost := os.Getenv("MEILISEARCH_HOST")
	if meiliHost == "" {
		slog.Error("MEILISEARCH_HOST is required")
		os.Exit(1)
	}
	meiliKey := os.Getenv("MEILISEARCH_API_KEY")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		slog.Error("connect to database", "error", err)
		os.Exit(2)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("database ping", "error", err)
		os.Exit(2)
	}

	se, err := service.NewListingSearchEngine(meiliHost, meiliKey)
	if err != nil {
		slog.Error("initialize listing search engine", "error", err)
		os.Exit(3)
	}

	// Trust-tiered ranking (MOVE B2): mirror the running service's mode so a
	// backfill produces consistent trust_rank attributes + ranking rules. Off by
	// default (fail closed).
	trustRanking := envBool("TRUST_RANKING", false)
	se.SetTrustRanking(trustRanking)
	if trustRanking {
		if err := se.ConfigureIndex(); err != nil {
			slog.Error("re-configure listings index for trust ranking", "error", err)
			os.Exit(3)
		}
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

	indexed := 0
	failed := 0
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
		// Trust-tiered ranking: read the seller's provider tier so IndexListing
		// emits trust_rank. Only when the flag is on; fail-soft on missing row.
		if trustRanking && l.SellerID != "" {
			var tier string
			if err := pool.QueryRow(ctx, `
				SELECT tier FROM trust_scores
				 WHERE user_id = $1 AND role = 'provider'`, l.SellerID,
			).Scan(&tier); err == nil {
				extras.TrustTier = tier
			}
		}
		hydrate := func(_ context.Context, _ *domain.Listing) service.ListingExtraFields {
			return extras
		}
		if err := se.IndexListing(ctx, &l, hydrate); err != nil {
			slog.Error("index listing", "id", l.ID, "error", err)
			failed++
			continue
		}
		indexed++
		if indexed%100 == 0 {
			slog.Info("backfill progress", "indexed", indexed, "failed", failed)
		}
	}

	slog.Info("backfill complete", "indexed", indexed, "failed", failed)
	if failed > 0 {
		os.Exit(3)
	}
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
