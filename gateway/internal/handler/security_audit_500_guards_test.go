package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// These tests cover the security-audit fixes for one financial-integrity bug
// and two predictable-500s in the gateway handlers:
//
//   BUG 1 (admin_marketplace.go ResolveGoodsDispute): re-resolving an already
//          terminal dispute must NOT re-flip escrow → 409, escrow untouched.
//   BUG 2 (subscription.go ChangeTier): malformed new_tier_id → 400 not 500.
//   BUG 3 (notification.go MarkAsRead): malformed path UUID → 400 not 500.
//
// The full behavioral re-resolve test (proving escrow is unchanged on the
// second resolve) needs a Postgres testcontainer because the guard lives in
// the SQL WHERE clause (`AND status NOT IN ('resolved','closed')`); that path
// is exercised in integration/. These unit tests pin the request-boundary
// behavior we CAN exercise without a database: the malformed-UUID 400s and the
// dispute-resolve routing guards.

// TestChangeTierInvalidUUIDIs400 verifies BUG 2: a non-UUID new_tier_id is
// rejected with 400 at the gateway before any gRPC call (a nil client would
// panic if the validation did not short-circuit first).
func TestChangeTierInvalidUUIDIs400(t *testing.T) {
	t.Parallel()
	h := NewSubscriptionHandler(nil) // nil client: validation must fire first

	r := chi.NewRouter()
	r.Post("/api/v1/subscriptions/change-tier", h.ChangeTier)

	body := bytes.NewReader([]byte(`{"new_tier_id":"not-a-uuid","billing_interval":"monthly"}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/subscriptions/change-tier", body)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "u@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (body=%s)", rec.Code, rec.Body.String())
	}
}

// TestMarkAsReadInvalidUUIDIs400 verifies BUG 3: a non-UUID notification id is
// rejected with 400 before the service call.
func TestMarkAsReadInvalidUUIDIs400(t *testing.T) {
	t.Parallel()
	h := NewNotificationHandler(nil) // nil client: validation must fire first

	r := chi.NewRouter()
	r.Post("/api/v1/notifications/{id}/read", h.MarkAsRead)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications/not-a-uuid/read", nil)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "u@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (body=%s)", rec.Code, rec.Body.String())
	}
}

// TestResolveGoodsDisputeInvalidUUIDIs400 verifies the dispute-resolve handler
// rejects a malformed id with 400 before touching the db (so a bad id never
// reaches the re-resolve / escrow logic at all).
func TestResolveGoodsDisputeInvalidUUIDIs400(t *testing.T) {
	t.Parallel()
	h := NewAdminMarketplaceHandler(nil)

	r := chi.NewRouter()
	r.Post("/api/v1/admin/disputes/goods/{id}/resolve", h.ResolveGoodsDispute)

	body := bytes.NewReader([]byte(`{"resolution":"no_action"}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/disputes/goods/not-a-uuid/resolve", body)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "admin@example.com", []string{"admin"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("got %d, want 400 (body=%s)", rec.Code, rec.Body.String())
	}
}

// TestResolveGoodsDisputeDBNilIs503 verifies the db-nil short-circuit (matches
// the rest of the marketplace surface) for a well-formed id. The re-resolve
// guard that returns 409 on an already-terminal dispute lives in the SQL WHERE
// and is exercised against a real Postgres in integration tests.
func TestResolveGoodsDisputeDBNilIs503(t *testing.T) {
	t.Parallel()
	h := NewAdminMarketplaceHandler(nil)

	r := chi.NewRouter()
	r.Post("/api/v1/admin/disputes/goods/{id}/resolve", h.ResolveGoodsDispute)

	id := "11111111-1111-1111-1111-111111111111"
	body := bytes.NewReader([]byte(`{"resolution":"no_action"}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/disputes/goods/"+id+"/resolve", body)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "admin@example.com", []string{"admin"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("got %d, want 503 (body=%s)", rec.Code, rec.Body.String())
	}
}
