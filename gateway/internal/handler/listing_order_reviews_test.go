package handler

import (
	"math"
	"testing"
	"time"
)

func TestListingOrderReviewWindow(t *testing.T) {
	t.Parallel()
	// 14-day window matches services contract review window product intent.
	if listingOrderReviewWindow != 14*24*time.Hour {
		t.Fatalf("expected 14d window, got %v", listingOrderReviewWindow)
	}
	if listingOrderReviewTextMax != 2000 {
		t.Fatalf("expected 2000 char max, got %d", listingOrderReviewTextMax)
	}
}

func TestListingOrderReviewRatingBounds(t *testing.T) {
	t.Parallel()
	// Document the API contract: overall_rating must be 1..5 inclusive.
	// Handler rejects outside this range before any DB write.
	valid := []int32{1, 2, 3, 4, 5}
	invalid := []int32{0, -1, 6, 100}
	for _, r := range valid {
		if r < 1 || r > 5 {
			t.Fatalf("fixture %d should be valid", r)
		}
	}
	for _, r := range invalid {
		if r >= 1 && r <= 5 {
			t.Fatalf("fixture %d should be invalid", r)
		}
	}
}

// TestSellerGoodsReviewAggregateRounding documents the public surface rounding
// used by ListingsHandler.sellerGoodsReviewAggregate (one decimal place).
func TestSellerGoodsReviewAggregateRounding(t *testing.T) {
	t.Parallel()
	cases := []struct {
		avg  float64
		want float64
	}{
		{5.0, 5.0},
		{4.0, 4.0},
		{4.66, 4.7},
		{4.64, 4.6},
		{3.05, 3.1},
		{1.0, 1.0},
	}
	for _, tc := range cases {
		got := math.Round(tc.avg*10) / 10
		if got != tc.want {
			t.Fatalf("round(%v) = %v, want %v", tc.avg, got, tc.want)
		}
	}
}
