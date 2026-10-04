package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestLiveActivityNotifyDataIncludesAmountAndEnd(t *testing.T) {
	t.Parallel()

	ends := time.Date(2026, 6, 1, 18, 0, 0, 0, time.UTC)
	data := liveActivityNotifyData("listing", "lst-9", 1500, ends.Format(time.RFC3339))
	if data["leading_bid_cents"] != "1500" {
		t.Fatalf("leading_bid_cents = %q", data["leading_bid_cents"])
	}
	if data["ends_at"] != "2026-06-01T18:00:00Z" {
		t.Fatalf("ends_at = %q", data["ends_at"])
	}
	if data["entity_type"] != "listing" || data["entity_id"] != "lst-9" {
		t.Fatalf("entity = %v", data)
	}
}

func TestLiveActivityNotifyDataOmitsMissing(t *testing.T) {
	t.Parallel()

	data := liveActivityNotifyData("listing", "lst-9", 0, "")
	if _, ok := data["leading_bid_cents"]; ok {
		t.Fatal("amount must be omitted when the scheduler has none")
	}
	if _, ok := data["ends_at"]; ok {
		t.Fatal("end must be omitted when the scheduler has none")
	}
	if _, ok := data["new_auction_ends_at"]; ok {
		t.Fatal("must not invent a second end key")
	}
}

func TestOutbidPayloadFeedsLiveActivityData(t *testing.T) {
	t.Parallel()

	raw := []byte(`{"type":"outbid","listing_id":"lst-1","prev_bidder_id":"u1","new_bidder_id":"u2","amount_cents":4200,"new_auction_ends_at":"2026-06-01T18:00:00Z"}`)
	var payload outbidPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	entityType, entityID, actionURL := outbidEntity(payload)
	if entityType != "listing" || entityID != "lst-1" || actionURL != "/marketplace/lst-1" {
		t.Fatalf("entity = %s %s %s", entityType, entityID, actionURL)
	}
	data := liveActivityNotifyData(entityType, entityID, payload.AmountCents, payload.NewAuctionEndsAt)
	if data["leading_bid_cents"] != "4200" {
		t.Fatalf("leading_bid_cents = %q", data["leading_bid_cents"])
	}
	if data["ends_at"] != "2026-06-01T18:00:00Z" {
		t.Fatalf("ends_at = %q", data["ends_at"])
	}
}

func TestJobOutbidPayloadFeedsLiveActivityData(t *testing.T) {
	t.Parallel()

	raw := []byte(`{"type":"outbid","job_id":"job-7","prev_bidder_id":"u1","amount_cents":8800,"new_auction_ends_at":"2026-07-02T12:30:00Z"}`)
	var payload outbidPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	entityType, entityID, actionURL := outbidEntity(payload)
	if entityType != "job" || entityID != "job-7" || actionURL != "/jobs/job-7" {
		t.Fatalf("entity = %s %s %s", entityType, entityID, actionURL)
	}
	data := liveActivityNotifyData(entityType, entityID, payload.AmountCents, payload.NewAuctionEndsAt)
	if data["leading_bid_cents"] != "8800" || data["ends_at"] != "2026-07-02T12:30:00Z" {
		t.Fatalf("data = %v", data)
	}
}
