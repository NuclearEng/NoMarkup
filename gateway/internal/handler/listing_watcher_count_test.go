package handler

import "testing"

func TestMaxInt64ToInt(t *testing.T) {
	t.Parallel()
	if got := maxInt64ToInt(3, 7); got != 7 {
		t.Fatalf("max(3,7)=%d", got)
	}
	if got := maxInt64ToInt(9, 2); got != 9 {
		t.Fatalf("max(9,2)=%d", got)
	}
	if got := maxInt64ToInt(0, 0); got != 0 {
		t.Fatalf("max(0,0)=%d", got)
	}
}

func TestLiveListingWatcherCount_nilRedis(t *testing.T) {
	t.Parallel()
	if got := liveListingWatcherCount(t.Context(), nil, "any"); got != 0 {
		t.Fatalf("nil redis want 0 got %d", got)
	}
	if got := liveListingWatcherCount(t.Context(), nil, ""); got != 0 {
		t.Fatalf("empty id want 0 got %d", got)
	}
}

func TestLiveListingWatcherCount_contractDoc(t *testing.T) {
	t.Parallel()
	// Documented contract: social proof is max(page pings, WS sockets), never a
	// blind sum (would double-count a tab that both pings and spectates).
	// Redis-backed path is covered by live stack / integration; unit path is
	// nil-redis + pure max helper above.
	if listingViewerActiveWindowMs != 30_000 {
		t.Fatalf("active window ms=%d want 30000", listingViewerActiveWindowMs)
	}
}
