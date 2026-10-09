package handler

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSpectatorEventDelayIsThreeSeconds(t *testing.T) {
	t.Parallel()
	if spectatorEventDelay != 3*time.Second {
		t.Fatalf("spectatorEventDelay=%v want 3s (anti front-run contract)", spectatorEventDelay)
	}
}

func TestAnonymizeEvent_stripsPII(t *testing.T) {
	t.Parallel()
	raw := `{
		"type":"bid_event",
		"amount_cents": 12000,
		"provider_id": "prov-uuid",
		"provider_name": "Acme Plumbing",
		"provider_business_name": "Acme LLC",
		"provider_avatar_url": "https://example.com/a.png",
		"user_id": "user-uuid",
		"bidder_id": "bid-uuid",
		"email": "secret@example.com",
		"phone": "+15551212",
		"job_id": "job-1"
	}`
	out := anonymizeEvent(raw)
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, out)
	}
	for _, f := range piiFields {
		if _, ok := m[f]; ok {
			t.Errorf("pii field %q still present: %s", f, out)
		}
	}
	if m["amount_cents"] == nil {
		t.Error("public amount_cents must remain")
	}
	if m["type"] != "bid_event" {
		t.Errorf("type=%v", m["type"])
	}
	// Belt-and-suspenders: raw strings must not leak
	for _, leak := range []string{"Acme", "secret@", "+1555", "prov-uuid"} {
		if strings.Contains(out, leak) {
			t.Errorf("anonymized payload still contains %q: %s", leak, out)
		}
	}
}

func TestAnonymizeEvent_invalidJSONSafe(t *testing.T) {
	t.Parallel()
	out := anonymizeEvent("not-json{{{")
	if out != `{"type":"bid_event"}` {
		t.Fatalf("want minimal safe event, got %s", out)
	}
}

func TestAnonymizeListingEvent_stripsPII(t *testing.T) {
	t.Parallel()
	raw := `{
		"type":"bid_event",
		"amount_cents": 9900,
		"bidder_id": "buyer-1",
		"buyer_id": "buyer-1",
		"seller_id": "seller-1",
		"display_name": "Jane Doe",
		"avatar_url": "https://example.com/a.png",
		"email": "j@example.com",
		"phone": "555",
		"listing_id": "list-1"
	}`
	out := anonymizeListingEvent(raw)
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, f := range listingPiiFields {
		if _, ok := m[f]; ok {
			t.Errorf("listing pii field %q still present", f)
		}
	}
	if m["amount_cents"] == nil {
		t.Error("amount_cents must remain")
	}
	if strings.Contains(out, "Jane") || strings.Contains(out, "j@example") {
		t.Errorf("PII leaked in listing spectate payload: %s", out)
	}
}
