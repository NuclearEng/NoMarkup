//go:build integration

// Tier 1 production-readiness — auth bypass test.
//
// Verifies that:
//   1. A customer JWT cannot read admin-only routes (-> 401 or 403).
//   2. Anonymous (no Authorization header) is rejected on protected routes (-> 401).
//   3. A JWT signed with a foreign RSA key is rejected (-> 401).
//   4. A JWT with `exp` in the past is rejected (-> 401).
//
// Run:
//   cd tests/integration && go test -tags=integration -run TestAuthBypass

package integration

import (
	"net/http"
	"strings"
	"testing"
)

// protectedRoutes is the table of (method, path) pairs we want to confirm
// reject anonymous requests with 401. Each must be a route that the global
// auth middleware should be guarding.
var protectedRoutes = []struct {
	method string
	path   string
}{
	{http.MethodGet, "/api/v1/users/me"},
	{http.MethodGet, "/api/v1/jobs/mine"},
	{http.MethodGet, "/api/v1/contracts"},
	{http.MethodGet, "/api/v1/admin/users"},
	{http.MethodGet, "/api/v1/admin/platform/metrics"},
	{http.MethodGet, "/api/v1/bids/mine"},
	{http.MethodGet, "/api/v1/channels"},
	{http.MethodPost, "/api/v1/payments"},
}

func TestAuthBypass_CustomerCannotReachAdmin(t *testing.T) {
	customerTok := loginAccessToken(t, "customer@nomarkup.com")

	cases := []string{
		"/api/v1/admin/users",
		"/api/v1/admin/platform/metrics",
		"/api/v1/admin/jobs",
		"/api/v1/admin/payments",
	}
	for _, p := range cases {
		t.Run(p, func(t *testing.T) {
			req := authedRequest(t, http.MethodGet, p, customerTok, nil)
			status, body := doRead(t, req)
			if status != http.StatusUnauthorized && status != http.StatusForbidden {
				t.Fatalf("customer hitting %s expected 401/403, got %d body=%s", p, status, body)
			}
		})
	}
}

func TestAuthBypass_AnonymousIsRejected(t *testing.T) {
	for _, route := range protectedRoutes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			req := authedRequest(t, route.method, route.path, "", nil)
			// Payment requires Idempotency-Key header before auth check;
			// since the auth middleware runs first in the protected
			// /api/v1 group, anonymous should still get 401 here.
			if route.method == http.MethodPost {
				req.Header.Set("Idempotency-Key", "anon-test-key-1")
			}
			status, body := doRead(t, req)
			if status != http.StatusUnauthorized {
				t.Fatalf("anon %s %s expected 401, got %d body=%s",
					route.method, route.path, status, body)
			}
		})
	}
}

func TestAuthBypass_WrongKeySignatureRejected(t *testing.T) {
	bogus := signWrongKeyJWT(t, "00000000-0000-0000-0000-000000000099", "wrong-key@example.com")
	req := authedRequest(t, http.MethodGet, "/api/v1/users/me", bogus, nil)
	status, body := doRead(t, req)
	if status != http.StatusUnauthorized {
		t.Fatalf("wrong-key jwt expected 401, got %d body=%s", status, body)
	}
	if strings.Contains(string(body), "wrong-key@example.com") {
		t.Fatalf("body should not echo the bogus email: %s", body)
	}
}

func TestAuthBypass_ExpiredJWTRejected(t *testing.T) {
	expired := signExpiredJWT(t, "00000000-0000-0000-0000-000000000002", "customer@nomarkup.com")
	req := authedRequest(t, http.MethodGet, "/api/v1/users/me", expired, nil)
	status, body := doRead(t, req)
	if status != http.StatusUnauthorized {
		t.Fatalf("expired jwt expected 401, got %d body=%s", status, body)
	}
}
