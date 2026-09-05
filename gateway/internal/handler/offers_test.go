package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// TestOfferParticipantsForDepth pins the counter-offer authorization
// parity: who the offer awaits (may accept/reject/counter) and who
// authored it (may withdraw) at each depth of the counter chain.
//
// This is the core of the BUG-5 fix — a seller's counter (depth 1) must
// await the BUYER, so the buyer can finally close the seller's counter.
func TestOfferParticipantsForDepth(t *testing.T) {
	t.Parallel()
	const buyer = "buyer-uuid"
	const seller = "seller-uuid"

	cases := []struct {
		name          string
		depth         int
		wantAwaiting  string
		wantAuthor    string
	}{
		{"root buyer offer awaits seller", 0, seller, buyer},
		{"seller counter awaits buyer", 1, buyer, seller},
		{"buyer counter awaits seller", 2, seller, buyer},
		{"seller counter-counter awaits buyer", 3, buyer, seller},
		{"deep buyer counter awaits seller", 4, seller, buyer},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			gotAwaiting, gotAuthor := offerParticipantsForDepth(tc.depth, buyer, seller)
			if gotAwaiting != tc.wantAwaiting {
				t.Errorf("depth %d awaiting = %q, want %q", tc.depth, gotAwaiting, tc.wantAwaiting)
			}
			if gotAuthor != tc.wantAuthor {
				t.Errorf("depth %d author = %q, want %q", tc.depth, gotAuthor, tc.wantAuthor)
			}
			// The awaiting party and the author must always be the two
			// distinct participants — never the same person, never a third.
			if gotAwaiting == gotAuthor {
				t.Errorf("depth %d: awaiting == author (%q)", tc.depth, gotAwaiting)
			}
		})
	}
}

// TestUpdateOfferRoutingDBNil verifies the route + URL param resolve and
// the db-nil short-circuit returns 503 (matches the rest of the
// marketplace surface). Full authz/state-machine exercise needs a Postgres
// testcontainer — covered in integration tests.
func TestUpdateOfferRoutingDBNil(t *testing.T) {
	t.Parallel()
	h := NewOffersHandler(nil)

	r := chi.NewRouter()
	r.Patch("/api/v1/offers/{id}", h.UpdateOffer)

	offerID := "11111111-1111-1111-1111-111111111111"
	body := bytes.NewReader([]byte(`{"action":"accept"}`))
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/offers/"+offerID, body)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "buyer@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("got %d, want %d (body=%s)", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
}

// TestCreateOfferRoutingDBNil verifies auth + route wiring and the db-nil
// short-circuit (503). Full bond-gate exercise needs Postgres.
func TestCreateOfferRoutingDBNil(t *testing.T) {
	t.Parallel()
	h := NewOffersHandler(nil)

	r := chi.NewRouter()
	r.Post("/api/v1/listings/{id}/offers", h.CreateOffer)

	listingID := "11111111-1111-1111-1111-111111111111"
	body := bytes.NewReader([]byte(`{"amount_cents": 10000}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/listings/"+listingID+"/offers", body)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "buyer@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("got %d, want %d (body=%s)", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
}

// TestCreateOfferBondGatePayloadParity locks the 402 shape CreateOffer
// shares with place-bid so the client bond flow stays identical.
func TestCreateOfferBondGatePayloadParity(t *testing.T) {
	t.Parallel()
	// Place-bid and CreateOffer both call bidBondRequiredPayload with the
	// same keys; only the error noun differs.
	bid := bidBondRequiredPayload(500, "bid")
	offer := bidBondRequiredPayload(500, "offer")
	for _, key := range []string{"requires_bid_bond", "bond_amount_cents"} {
		if bid[key] != offer[key] {
			t.Errorf("key %q diverged: bid=%v offer=%v", key, bid[key], offer[key])
		}
	}
	if bid["requires_bid_bond"] != true {
		t.Error("requires_bid_bond must be true")
	}
	if offer["error"] == bid["error"] {
		t.Error("error message should differ for offer vs bid")
	}
}

