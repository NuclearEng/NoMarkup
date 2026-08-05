package service

import (
	"testing"
)

func TestBuildLiveActivityContentStateUpdateRequiresLeadAndEnds(t *testing.T) {
	t.Parallel()
	_, ok := buildLiveActivityContentState(map[string]string{
		"leading_bid_cents": "1000",
	}, "new_bid", false)
	if ok {
		t.Fatal("expected ok=false without ends_at")
	}
	cs, ok := buildLiveActivityContentState(map[string]string{
		"leading_bid_cents": "1000",
		"ends_at":           "1700003600",
	}, "new_bid", false)
	if !ok {
		t.Fatal("expected ok=true with lead+ends")
	}
	if cs["leadingBidCents"] != int64(1000) {
		t.Fatalf("leadingBidCents = %v", cs["leadingBidCents"])
	}
	if cs["endsAt"] != int64(1700003600) {
		t.Fatalf("endsAt = %v", cs["endsAt"])
	}
}

func TestBuildLiveActivityContentStateEndAlwaysOK(t *testing.T) {
	t.Parallel()
	cs, ok := buildLiveActivityContentState(nil, "auction_closed", true)
	if !ok {
		t.Fatal("end event should always build")
	}
	if cs["outcome"] != "ended" {
		t.Fatalf("outcome = %v, want ended", cs["outcome"])
	}
}

func TestLiveActivityOutcome(t *testing.T) {
	t.Parallel()
	if liveActivityOutcome("bid_awarded", nil) != "won" {
		t.Fatal("bid_awarded")
	}
	if liveActivityOutcome("bid_not_selected", nil) != "lost" {
		t.Fatal("bid_not_selected")
	}
	if liveActivityOutcome("new_bid", map[string]string{"outcome": "custom"}) != "custom" {
		t.Fatal("data override")
	}
}
