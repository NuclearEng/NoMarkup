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

// TestMalformedUUIDPathGuardsAre400 is the hardening-sweep table: every handler
// below previously passed a malformed path UUID straight to its gRPC client /
// pgx query, where the bad UUID surfaced as codes.Internal → HTTP 500. Each now
// validates the id at the gateway boundary and returns a clean 400 BEFORE the
// downstream call, so a nil client/db never gets dereferenced (the nil here is
// the proof: if the guard did not short-circuit first, the handler would panic
// or 500). Mirrors the change-tier / mark-read / insurance fixes from earlier in
// this audit round.
func TestMalformedUUIDPathGuardsAre400(t *testing.T) {
	t.Parallel()

	// adminCtx and custCtx attach claims with the role each handler requires
	// to reach its UUID guard (handlers that role-check before the id guard).
	const bad = "not-a-uuid"

	tests := []struct {
		name    string
		method  string
		pattern string // chi route pattern
		path    string // concrete request path (with malformed id)
		role    string
		body    string
		handler http.HandlerFunc
	}{
		{
			name:    "admin GetUser",
			method:  http.MethodGet,
			pattern: "/api/v1/admin/users/{id}",
			path:    "/api/v1/admin/users/" + bad,
			role:    "admin",
			handler: NewAdminUsersHandler(nil).GetUser,
		},
		{
			name:    "admin SuspendUser",
			method:  http.MethodPost,
			pattern: "/api/v1/admin/users/{id}/suspend",
			path:    "/api/v1/admin/users/" + bad + "/suspend",
			role:    "admin",
			body:    `{"reason":"x"}`,
			handler: NewAdminUsersHandler(nil).SuspendUser,
		},
		{
			name:    "admin BanUser",
			method:  http.MethodPost,
			pattern: "/api/v1/admin/users/{id}/ban",
			path:    "/api/v1/admin/users/" + bad + "/ban",
			role:    "admin",
			body:    `{"reason":"x"}`,
			handler: NewAdminUsersHandler(nil).BanUser,
		},
		{
			name:    "admin ReactivateUser",
			method:  http.MethodPost,
			pattern: "/api/v1/admin/users/{id}/reactivate",
			path:    "/api/v1/admin/users/" + bad + "/reactivate",
			role:    "admin",
			handler: NewAdminUsersHandler(nil).ReactivateUser,
		},
		{
			name:    "admin SuspendJob",
			method:  http.MethodPost,
			pattern: "/api/v1/admin/jobs/{id}/suspend",
			path:    "/api/v1/admin/jobs/" + bad + "/suspend",
			role:    "admin",
			body:    `{"reason":"x"}`,
			handler: NewAdminJobsHandler(nil).SuspendJob,
		},
		{
			name:    "admin RemoveJob",
			method:  http.MethodPost,
			pattern: "/api/v1/admin/jobs/{id}/remove",
			path:    "/api/v1/admin/jobs/" + bad + "/remove",
			role:    "admin",
			body:    `{"reason":"x"}`,
			handler: NewAdminJobsHandler(nil).RemoveJob,
		},
		{
			name:    "admin GetDispute",
			method:  http.MethodGet,
			pattern: "/api/v1/admin/disputes/{id}",
			path:    "/api/v1/admin/disputes/" + bad,
			role:    "admin",
			handler: NewAdminDisputesHandler(nil, nil).GetDispute,
		},
		{
			name:    "admin ReviewDocument",
			method:  http.MethodPost,
			pattern: "/api/v1/admin/verification/{id}/review",
			path:    "/api/v1/admin/verification/" + bad + "/review",
			role:    "admin",
			body:    `{"approved":true}`,
			handler: NewAdminVerificationHandler(nil).ReviewDocument,
		},
		{
			name:    "admin ResolveFlag",
			method:  http.MethodPost,
			pattern: "/api/v1/admin/reviews/flags/{id}/resolve",
			path:    "/api/v1/admin/reviews/flags/" + bad + "/resolve",
			role:    "admin",
			body:    `{"uphold":true}`,
			handler: NewAdminReviewsHandler(nil).ResolveFlag,
		},
		{
			name:    "admin GetPaymentDetails",
			method:  http.MethodGet,
			pattern: "/api/v1/admin/payments/{id}",
			path:    "/api/v1/admin/payments/" + bad,
			role:    "admin",
			handler: NewAdminPaymentsHandler(nil).GetPaymentDetails,
		},
		{
			name:    "admin DeletePlatformBankAccount",
			method:  http.MethodDelete,
			pattern: "/api/v1/admin/banking/{id}",
			path:    "/api/v1/admin/banking/" + bad,
			role:    "admin",
			handler: NewAdminBankingHandler(nil).DeletePlatformBankAccount,
		},
		{
			name:    "admin AdminDisburseAdvance",
			method:  http.MethodPost,
			pattern: "/api/v1/admin/advances/{id}/disburse",
			path:    "/api/v1/admin/advances/" + bad + "/disburse",
			role:    "admin",
			handler: NewWorkingCapitalHandler(nil, nil).AdminDisburseAdvance,
		},
		{
			name:    "admin AdminReviewAdvance",
			method:  http.MethodPost,
			pattern: "/api/v1/admin/advances/{id}/review",
			path:    "/api/v1/admin/advances/" + bad + "/review",
			role:    "admin",
			body:    `{"action":"approve"}`,
			handler: NewWorkingCapitalHandler(nil, nil).AdminReviewAdvance,
		},
		{
			name:    "contract SubmitMilestone",
			method:  http.MethodPost,
			pattern: "/api/v1/milestones/{id}/submit",
			path:    "/api/v1/milestones/" + bad + "/submit",
			role:    "provider",
			handler: NewContractHandler(nil, nil).SubmitMilestone,
		},
		{
			name:    "contract ApproveMilestone",
			method:  http.MethodPost,
			pattern: "/api/v1/milestones/{id}/approve",
			path:    "/api/v1/milestones/" + bad + "/approve",
			role:    "customer",
			handler: NewContractHandler(nil, nil).ApproveMilestone,
		},
		{
			name:    "contract RequestRevision",
			method:  http.MethodPost,
			pattern: "/api/v1/milestones/{id}/revision",
			path:    "/api/v1/milestones/" + bad + "/revision",
			role:    "customer",
			body:    `{"revision_notes":"x"}`,
			handler: NewContractHandler(nil, nil).RequestRevision,
		},
		{
			name:    "contract GetContract",
			method:  http.MethodGet,
			pattern: "/api/v1/contracts/{id}",
			path:    "/api/v1/contracts/" + bad,
			role:    "customer",
			handler: NewContractHandler(nil, nil).GetContract,
		},
		{
			name:    "instant-match CreateInstantMatch",
			method:  http.MethodPost,
			pattern: "/api/v1/jobs/{id}/instant-match",
			path:    "/api/v1/jobs/" + bad + "/instant-match",
			role:    "customer",
			body:    `{}`,
			handler: NewInstantMatchHandler(nil, nil, nil, nil).CreateInstantMatch,
		},
		{
			name:    "provider GetProvider",
			method:  http.MethodGet,
			pattern: "/api/v1/providers/{id}",
			path:    "/api/v1/providers/" + bad,
			role:    "customer",
			handler: NewProviderHandler(nil, nil, nil).GetProvider,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r := chi.NewRouter()
			r.Method(tc.method, tc.pattern, tc.handler)

			var body *bytes.Reader
			if tc.body != "" {
				body = bytes.NewReader([]byte(tc.body))
			} else {
				body = bytes.NewReader(nil)
			}
			req := httptest.NewRequest(tc.method, tc.path, body)
			req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "u@example.com", []string{tc.role})
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("%s %s: got %d, want 400 (body=%s)", tc.method, tc.path, rec.Code, rec.Body.String())
			}
		})
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
