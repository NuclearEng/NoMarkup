package handler

// Regression guards for the money-bound validation fix (commit 65f60f9).
// validateMoneyCents bounds every user-supplied money amount (bids / offers /
// counters): positive integer cents, <= $10,000,000.00. Before this fix a client
// could POST amount_cents=1e15 ($10T) and corrupt auction state at the boundary.
//
// We pin BOTH the pure function (boundary table) AND that the guard actually
// fires at the request boundary BEFORE the downstream gRPC client is touched
// (the nil bid client is the proof: if validation did not short-circuit first,
// the handler would panic / 500 instead of returning a clean 400).

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestValidateMoneyCents(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		amount  int64
		wantOK  bool // true => valid (empty message)
	}{
		{"zero_rejected", 0, false},
		{"negative_rejected", -1, false},
		{"normal_amount_ok", 4500, true},                    // $45.00
		{"one_cent_ok", 1, true},                            // lower boundary
		{"cap_boundary_10M_ok", maxMoneyCents, true},        // exactly $10,000,000.00
		{"just_over_cap_rejected", maxMoneyCents + 1, false},
		{"ten_trillion_rejected", 1_000_000_000_000_000, false}, // the original exploit value
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			msg := validateMoneyCents("amount_cents", tt.amount)
			if tt.wantOK && msg != "" {
				t.Errorf("amount %d: want valid, got error %q", tt.amount, msg)
			}
			if !tt.wantOK && msg == "" {
				t.Errorf("amount %d: want rejection, got valid", tt.amount)
			}
		})
	}
}

// TestPlaceBidRejectsAbsurdAmount proves the bound is enforced at the bid
// endpoint boundary: a $10T bid is a clean 400 and never reaches the (nil) bid
// client. If the guard regressed, the nil client would be dereferenced and the
// test would panic / 500 instead.
func TestPlaceBidRejectsAbsurdAmount(t *testing.T) {
	t.Parallel()
	h := NewBidHandler(nil, nil, nil) // nil bid client: validation must fire first

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)

	body := bytes.NewReader([]byte(`{"amount_cents":1000000000000000}`)) // $10T
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs/11111111-1111-1111-1111-111111111111/bids", body)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (body=%s)", rec.Code, rec.Body.String())
	}
}

// TestPlaceBidRejectsZeroAmount pins the lower bound at the boundary too.
func TestPlaceBidRejectsZeroAmount(t *testing.T) {
	t.Parallel()
	h := NewBidHandler(nil, nil, nil)

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)

	body := bytes.NewReader([]byte(`{"amount_cents":0}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs/11111111-1111-1111-1111-111111111111/bids", body)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (body=%s)", rec.Code, rec.Body.String())
	}
}
