package handler

import (
	"math/rand"
	"testing"
)

// Tests for computeAutoBidCascade — the pure-function core of the
// eBay-style proxy bidding loop in placeBidTx.

func ptrInt64(v int64) *int64 { return &v }

func TestCascade_NoCompetingMax_JustVisibleBid(t *testing.T) {
	t.Parallel()
	out := computeAutoBidCascade(
		1000,             // currentTop = $10.00
		100,              // increment = $1.00
		"new",            // newBidderID
		1500,             // newBidAmount = $15.00
		nil,              // newBidderMax
		"",               // competingBidderID — none
		nil,              // competingMax
		50,
	)
	if len(out.Steps) != 1 {
		t.Fatalf("expected 1 step, got %d", len(out.Steps))
	}
	if out.FinalBidder != "new" || out.FinalAmount != 1500 {
		t.Fatalf("expected new winning at 1500, got %s @ %d", out.FinalBidder, out.FinalAmount)
	}
	if out.Steps[0].MaxBidCents != nil {
		t.Fatalf("expected nil max on visible-only bid, got %v", out.Steps[0].MaxBidCents)
	}
}

func TestCascade_EBayCanonical_AAt100Max200_BBids150Max300(t *testing.T) {
	t.Parallel()
	// Increment is $10 (1000 cents) for this canonical case so the
	// final settles at A.max + 1 increment = $210.
	out := computeAutoBidCascade(
		10_000,            // currentTop: A is at $100.00
		1_000,             // increment: $10
		"B",               // newBidderID
		15_000,            // B's visible bid: $150
		ptrInt64(30_000),  // B's max: $300
		"A",               // competing bidder = A
		ptrInt64(20_000),  // A's max: $200
		50,
	)
	if out.FinalBidder != "B" {
		t.Fatalf("expected B to win, got %s", out.FinalBidder)
	}
	// eBay rule: winning price = min(higherMax, lowerMax + increment)
	//                          = min($300, $200 + $10) = $210
	if out.FinalAmount != 21_000 {
		t.Fatalf("expected final $210 (21000 cents), got %d", out.FinalAmount)
	}
	if len(out.Steps) < 2 {
		t.Fatalf("expected multiple cascade steps, got %d", len(out.Steps))
	}
	// First step is always B's visible bid.
	if out.Steps[0].BidderID != "B" || out.Steps[0].AmountCents != 15_000 {
		t.Fatalf("expected first step B@15000, got %+v", out.Steps[0])
	}
}

func TestCascade_NewBidderHasNoMax_CompetingHasHugeMax_CompetingWins(t *testing.T) {
	t.Parallel()
	// B places exactly $150 with no max. A has max $300. A should
	// counter to $151 (with $1 increment) and win.
	out := computeAutoBidCascade(
		10_000,
		100, // $1 increment
		"B",
		15_000,
		nil,
		"A",
		ptrInt64(30_000),
		50,
	)
	if out.FinalBidder != "A" {
		t.Fatalf("expected A to win, got %s", out.FinalBidder)
	}
	if out.FinalAmount != 15_100 {
		t.Fatalf("expected A at $151.00 (15100 cents), got %d", out.FinalAmount)
	}
}

func TestCascade_NewBidderHigherMaxThanCompeting_NewBidderWins(t *testing.T) {
	t.Parallel()
	// A standing at $100 max=$120. B bids $110 max=$500. B wins at
	// min($500, $120+$1) = $121.
	out := computeAutoBidCascade(
		10_000,
		100,
		"B",
		11_000,
		ptrInt64(50_000),
		"A",
		ptrInt64(12_000),
		50,
	)
	if out.FinalBidder != "B" {
		t.Fatalf("expected B to win, got %s", out.FinalBidder)
	}
	if out.FinalAmount != 12_100 {
		t.Fatalf("expected B at $121.00 (12100 cents), got %d", out.FinalAmount)
	}
}

func TestCascade_TiedMax_CompetingKeepsLead(t *testing.T) {
	t.Parallel()
	// Both A and B have max = $200. The competitor (A — already
	// standing) should keep the lead at $200; B can't outbid.
	out := computeAutoBidCascade(
		10_000,
		100,
		"B",
		11_000,
		ptrInt64(20_000),
		"A",
		ptrInt64(20_000),
		50,
	)
	if out.FinalBidder != "A" {
		t.Fatalf("expected A (competitor) to keep lead on tied max, got %s", out.FinalBidder)
	}
	if out.FinalAmount != 20_000 {
		t.Fatalf("expected final at A's max of 20000, got %d", out.FinalAmount)
	}
}

func TestCascade_IterationsCapped(t *testing.T) {
	t.Parallel()
	// 1c increment with $1M maxes — without the cap this would loop
	// 100M times. We cap at maxIterations and just stop.
	out := computeAutoBidCascade(
		100_000,
		1, // 1 cent increment
		"B",
		200_000,
		ptrInt64(100_000_000),
		"A",
		ptrInt64(100_000_000),
		20, // small cap for the test
	)
	if len(out.Steps) > 21 {
		t.Fatalf("expected cap to bound steps, got %d", len(out.Steps))
	}
}

// Property test: for arbitrary (a_max, b_max, increment, b_visible)
// pairs, the higher max wins at min(higher_max, lower_max + increment).
func TestCascade_Property_HigherMaxWinsAtLowerMaxPlusIncrement(t *testing.T) {
	t.Parallel()
	rng := rand.New(rand.NewSource(1)) // deterministic
	for i := 0; i < 200; i++ {
		increment := int64(rng.Intn(500) + 1) // 1..500 cents
		// A is the standing bidder with max aMax >= currentTop.
		currentTop := int64(rng.Intn(10_000) + 1_000) // $10..$110
		aMax := currentTop + int64(rng.Intn(50_000))  // aMax >= currentTop
		// B's visible bid must be > currentTop + increment - increment
		// (i.e., >= currentTop + increment per the increment rule).
		bVisible := currentTop + increment + int64(rng.Intn(1_000))
		bMax := bVisible + int64(rng.Intn(50_000))

		out := computeAutoBidCascade(
			currentTop, increment, "B", bVisible, &bMax, "A", &aMax, 100,
		)

		// eBay rule: higher max wins, at min(higher_max, lower_max + increment).
		// Ties favor the incumbent (A). If A can't even match the visible
		// bid by one increment, B wins outright at their visible bid.
		var expectedWinner string
		var expectedPrice int64
		if bMax > aMax {
			expectedWinner = "B"
			price := aMax + increment
			if price > bMax {
				price = bMax
			}
			// Visible bid is the floor: if visible already beats
			// aMax + increment, B sits at visible.
			if price < bVisible {
				price = bVisible
			}
			expectedPrice = price
		} else {
			// aMax >= bMax → A wins (ties favor incumbent).
			needed := bVisible + increment
			if aMax < needed {
				// A can't outbid visible bid → B wins at visible.
				expectedWinner = "B"
				expectedPrice = bVisible
			} else {
				expectedWinner = "A"
				price := bMax + increment
				if price > aMax {
					price = aMax
				}
				if price < needed {
					price = needed
				}
				expectedPrice = price
			}
		}

		if out.FinalBidder != expectedWinner {
			t.Fatalf("seed=%d aMax=%d bMax=%d inc=%d top=%d bVis=%d: expected winner %s, got %s @ %d",
				i, aMax, bMax, increment, currentTop, bVisible, expectedWinner, out.FinalBidder, out.FinalAmount)
		}
		if out.FinalAmount != expectedPrice {
			t.Fatalf("seed=%d aMax=%d bMax=%d inc=%d top=%d bVis=%d: expected price %d, got %d (winner=%s)",
				i, aMax, bMax, increment, currentTop, bVisible, expectedPrice, out.FinalAmount, out.FinalBidder)
		}
	}
}
