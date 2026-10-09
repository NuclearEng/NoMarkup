package main

import (
	"testing"
	"time"
)

// Static-fixture validation. Catches bad copy-paste edits to
// buildDemoListings without needing a database — the seed binary
// can otherwise only fail at INSERT time.

func TestDemoListings_NoDuplicateUUIDs(t *testing.T) {
	t.Parallel()
	seen := make(map[string]bool)
	for _, l := range buildDemoListings() {
		if seen[l.id] {
			t.Errorf("duplicate UUID in demo seed: %s (%s)", l.id, l.title)
		}
		seen[l.id] = true
	}
}

func TestDemoListings_BucketDistribution(t *testing.T) {
	t.Parallel()
	var critical, urgent, normal int
	for _, l := range buildDemoListings() {
		switch {
		case l.closesIn <= 10*time.Minute:
			critical++
		case l.closesIn <= time.Hour:
			urgent++
		case l.closesIn <= 24*time.Hour:
			normal++
		default:
			t.Errorf("listing %s closes in %v — outside the 24h demo window", l.id, l.closesIn)
		}
	}
	if critical < 6 {
		t.Errorf("critical bucket has %d listings, want >= 6", critical)
	}
	if urgent < 8 {
		t.Errorf("urgent bucket has %d listings, want >= 8", urgent)
	}
	if normal < 15 {
		t.Errorf("normal bucket has %d listings, want >= 15", normal)
	}
}

func TestDemoListings_ValidCategorySlugs(t *testing.T) {
	t.Parallel()
	allowed := map[string]bool{
		"goods-furniture":    true,
		"goods-electronics":  true,
		"goods-tools":        true,
		"goods-sporting":     true,
		"goods-vehicles":     true,
		"goods-home-garden":  true,
		"goods-books-media":  true,
		"goods-collectibles": true,
		"goods-clothing":     true,
		"goods-other":        true,
	}
	for _, l := range buildDemoListings() {
		if !allowed[l.slug] {
			t.Errorf("listing %s has unknown slug %q", l.id, l.slug)
		}
	}
}

func TestDemoListings_PriceConsistency(t *testing.T) {
	t.Parallel()
	for _, l := range buildDemoListings() {
		if l.startCents <= 0 {
			t.Errorf("listing %s has non-positive start price %d", l.id, l.startCents)
		}
		if l.currentCents < l.startCents {
			t.Errorf("listing %s currentCents %d < startCents %d", l.id, l.currentCents, l.startCents)
		}
		if l.bidCount < 0 {
			t.Errorf("listing %s has negative bid count %d", l.id, l.bidCount)
		}
		// If there are bids, the current must exceed the start.
		if l.bidCount > 0 && l.currentCents == l.startCents {
			t.Errorf("listing %s has %d bids but currentCents == startCents", l.id, l.bidCount)
		}
		if l.snipeExtensions < 0 {
			t.Errorf("listing %s has negative snipe extensions %d", l.id, l.snipeExtensions)
		}
	}
}

func TestDemoListings_AllHavePhotos(t *testing.T) {
	t.Parallel()
	for _, l := range buildDemoListings() {
		if l.photo == "" {
			t.Errorf("listing %s (%s) has no photo URL", l.id, l.title)
		}
	}
}
