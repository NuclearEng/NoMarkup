package service

import (
	"context"
	"testing"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// --- trustRankForTier (pure tier → rank table) ---

func TestTrustRankForTier(t *testing.T) {
	t.Parallel()

	cases := []struct {
		tier string
		want int
	}{
		{"top_rated", 4},
		{"trusted", 3},
		{"rising", 2},
		{"new", 1},
		{"under_review", 0},
		{"", 0},
		{"bogus", 0},
		{"TOP_RATED", 0}, // case-sensitive: trust engine emits lowercase
	}
	for _, tt := range cases {
		tt := tt
		t.Run(tt.tier, func(t *testing.T) {
			t.Parallel()
			if got := trustRankForTier(tt.tier); got != tt.want {
				t.Fatalf("trustRankForTier(%q) = %d, want %d", tt.tier, got, tt.want)
			}
		})
	}
}

// Monotonicity: ranks strictly order the tiers, and trust never produces a
// negative rank — so a higher tier is always weakly favored, never penalized.
func TestTrustRankForTier_Monotonic(t *testing.T) {
	t.Parallel()
	order := []string{"under_review", "new", "rising", "trusted", "top_rated"}
	prev := -1
	for _, tier := range order {
		got := trustRankForTier(tier)
		if got < 0 {
			t.Fatalf("trustRankForTier(%q) = %d, must be non-negative", tier, got)
		}
		if got < prev {
			t.Fatalf("trustRankForTier non-monotonic at %q: %d < %d", tier, got, prev)
		}
		prev = got
	}
}

// --- buildListingDoc trust_rank emission (flag-gated, fail-closed) ---

func testListing() *domain.Listing {
	return &domain.Listing{
		ID:                 "l1",
		SellerID:           "seller1",
		CategoryID:         "cat1",
		Title:              "Eames chair",
		Description:        "vintage",
		StartingPriceCents: 10000,
		Status:             "active",
	}
}

func hydratorWithTier(tier string) ListingHydrator {
	return func(_ context.Context, _ *domain.Listing) ListingExtraFields {
		return ListingExtraFields{CategoryName: "Furniture", TrustTier: tier}
	}
}

func TestBuildListingDoc_TrustRank(t *testing.T) {
	t.Parallel()

	t.Run("flag_off_omits_trust_rank", func(t *testing.T) {
		t.Parallel()
		doc := buildListingDoc(testListing(), hydratorWithTier("top_rated"), false)
		if _, ok := doc["trust_rank"]; ok {
			t.Fatalf("trust_rank must be absent when flag is off, got %v", doc["trust_rank"])
		}
	})

	t.Run("flag_on_writes_rank_for_top_rated", func(t *testing.T) {
		t.Parallel()
		doc := buildListingDoc(testListing(), hydratorWithTier("top_rated"), true)
		if got := doc["trust_rank"]; got != 4 {
			t.Fatalf("trust_rank = %v, want 4", got)
		}
	})

	t.Run("flag_on_unknown_tier_writes_zero", func(t *testing.T) {
		t.Parallel()
		doc := buildListingDoc(testListing(), hydratorWithTier(""), true)
		if got := doc["trust_rank"]; got != 0 {
			t.Fatalf("trust_rank = %v, want 0 for empty tier", got)
		}
	})

	t.Run("flag_on_nil_hydrator_still_writes_zero", func(t *testing.T) {
		t.Parallel()
		// No hydrator at all: trust_rank must still be present (consistent
		// sortable attribute) and default to 0.
		doc := buildListingDoc(testListing(), nil, true)
		if got, ok := doc["trust_rank"]; !ok || got != 0 {
			t.Fatalf("trust_rank = %v (present=%v), want 0 present", got, ok)
		}
	})
}
