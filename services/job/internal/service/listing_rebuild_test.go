//go:build integration

// Integration tests for the converging listings-index rebuild.
//
// Bug: cmd/reindex-listings only ever called AddDocuments. Meilisearch upserts
// by primary key, so the backfill could add and update but never REMOVE. A
// listing hard-deleted from Postgres (gateway DeleteListingDraft), or one that
// left status='active', kept its document forever — and /listings/autocomplete
// served those phantoms from behind a 60s/300s CDN cache.
//
// These tests run against a REAL Meilisearch. Start one with:
//
//	meilisearch --http-addr 127.0.0.1:7788 --master-key <key> --db-path ./data.ms
//
// Run:
//
//	MEILISEARCH_URL=http://127.0.0.1:7788 MEILISEARCH_API_KEY=<key> \
//	  go test -tags=integration -count=1 -run TestListingRebuild ./internal/service/...
//
// Skipped when MEILISEARCH_URL is unset.
package service

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

func rebuildTestEngine(t *testing.T) *ListingSearchEngine {
	t.Helper()
	url := os.Getenv("MEILISEARCH_URL")
	if url == "" {
		t.Skip("MEILISEARCH_URL not set; skipping real-Meilisearch rebuild test")
	}
	se, err := NewListingSearchEngine(url, os.Getenv("MEILISEARCH_API_KEY"))
	require.NoError(t, err, "connect to meilisearch at %s", url)
	return se
}

func rebuildFixture(id, title string) *domain.Listing {
	return &domain.Listing{
		ID:                 id,
		SellerID:           "00000000-0000-0000-0000-0000000000aa",
		CategoryID:         "00000000-0000-0000-0000-0000000000bb",
		Title:              title,
		Description:        "rebuild fixture",
		StartingPriceCents: 1000,
		Status:             "active",
		AuctionEndsAt:      time.Now().Add(24 * time.Hour),
	}
}

func noExtras(_ context.Context, _ *domain.Listing) ListingExtraFields {
	return ListingExtraFields{CategorySlug: "rebuild-fixture"}
}

// liveDocIDs returns the ids currently searchable in the live listings index.
func liveDocIDs(t *testing.T, se *ListingSearchEngine) map[string]struct{} {
	t.Helper()
	ids, _, err := se.SearchListings(context.Background(), "", 100, 0)
	require.NoError(t, err)
	out := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		out[id] = struct{}{}
	}
	return out
}

// TestListingRebuild_DropsStaleDocuments is the regression test. A document
// that exists in the live index but is NOT written during the rebuild must be
// gone after the swap. Under the old add-only backfill it survived forever.
func TestListingRebuild_DropsStaleDocuments(t *testing.T) {
	se := rebuildTestEngine(t)
	ctx := context.Background()

	const (
		keepID  = "11111111-1111-4111-8111-111111111111"
		staleID = "22222222-2222-4222-8222-222222222222"
	)

	// Seed the live index the way the old backfill would have: both listings
	// present. `staleID` then "disappears" from Postgres.
	require.NoError(t, se.IndexListing(ctx, rebuildFixture(keepID, "keeper armchair"), noExtras))
	require.NoError(t, se.IndexListing(ctx, rebuildFixture(staleID, "phantom armchair"), noExtras))
	require.Eventually(t, func() bool {
		live := liveDocIDs(t, se)
		_, a := live[keepID]
		_, b := live[staleID]
		return a && b
	}, 10*time.Second, 200*time.Millisecond, "both fixtures must be indexed before the rebuild")

	// Rebuild from a source of truth that contains ONLY keepID.
	require.NoError(t, se.BeginRebuild(ctx))
	require.NoError(t, se.AddRebuildBatch(ctx, []*domain.Listing{rebuildFixture(keepID, "keeper armchair")}, noExtras))
	require.NoError(t, se.CommitRebuild(ctx))

	live := liveDocIDs(t, se)
	require.Contains(t, live, keepID, "a live listing must survive the rebuild")
	require.NotContains(t, live, staleID,
		"a listing absent from the source of truth must be gone after the rebuild "+
			"(this is the phantom-listing bug)")

	t.Cleanup(func() {
		_ = se.RemoveListing(context.Background(), keepID)
	})
}

// TestListingRebuild_IsIdempotent asserts a second rebuild over the same source
// data converges to the same set — the tool is safe to re-run, which is the
// whole point of a post-deploy backfill step.
func TestListingRebuild_IsIdempotent(t *testing.T) {
	se := rebuildTestEngine(t)
	ctx := context.Background()

	ids := []string{
		"33333333-3333-4333-8333-333333333333",
		"44444444-4444-4444-8444-444444444444",
	}
	batch := []*domain.Listing{
		rebuildFixture(ids[0], "idempotent desk"),
		rebuildFixture(ids[1], "idempotent lamp"),
	}

	for run := 0; run < 2; run++ {
		require.NoError(t, se.BeginRebuild(ctx), "run %d", run)
		require.NoError(t, se.AddRebuildBatch(ctx, batch, noExtras), "run %d", run)
		require.NoError(t, se.CommitRebuild(ctx), "run %d", run)

		live := liveDocIDs(t, se)
		require.Len(t, live, len(ids), "run %d: index must hold exactly the source set", run)
		for _, id := range ids {
			require.Contains(t, live, id, "run %d", run)
		}
	}
}

// TestListingRebuild_RemoveListingEvictsDocument covers the single-document
// delete the gateway's hard-delete path now calls (via its own Meili client).
// Same index, same primary key, so proving it here proves that path's premise.
func TestListingRebuild_RemoveListingEvictsDocument(t *testing.T) {
	se := rebuildTestEngine(t)
	ctx := context.Background()

	const id = "55555555-5555-4555-8555-555555555555"
	require.NoError(t, se.IndexListing(ctx, rebuildFixture(id, "deletable sideboard"), noExtras))
	require.Eventually(t, func() bool {
		_, ok := liveDocIDs(t, se)[id]
		return ok
	}, 10*time.Second, 200*time.Millisecond, "fixture must be indexed first")

	require.NoError(t, se.RemoveListing(ctx, id))
	require.Eventually(t, func() bool {
		_, ok := liveDocIDs(t, se)[id]
		return !ok
	}, 10*time.Second, 200*time.Millisecond,
		"a deleted listing must stop being searchable")
}
