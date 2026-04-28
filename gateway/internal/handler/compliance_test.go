package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// TestMeetsMinimumAge pins the age-gate math, including the birthday-
// rollover boundary (someone whose 18th birthday is tomorrow is NOT 18
// today).
func TestMeetsMinimumAge(t *testing.T) {
	t.Parallel()

	ref := time.Date(2026, 4, 27, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		dob  time.Time
		want bool
	}{
		{"exactly 18 today", time.Date(2008, 4, 27, 0, 0, 0, 0, time.UTC), true},
		{"18th birthday tomorrow", time.Date(2008, 4, 28, 0, 0, 0, 0, time.UTC), false},
		{"17 yo", time.Date(2009, 4, 27, 0, 0, 0, 0, time.UTC), false},
		{"35 yo", time.Date(1991, 1, 1, 0, 0, 0, 0, time.UTC), true},
		{"100 yo", time.Date(1926, 4, 27, 0, 0, 0, 0, time.UTC), true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := meetsMinimumAge(tc.dob, 18, ref)
			if got != tc.want {
				t.Errorf("meetsMinimumAge(%s) = %t, want %t", tc.dob.Format("2006-01-02"), got, tc.want)
			}
		})
	}
}

// TestHashIPDeterministic verifies the SHA-256 wrapper is stable + empty
// input returns "" (we never store the digest of empty bytes).
func TestHashIPDeterministic(t *testing.T) {
	t.Parallel()
	if hashIP("") != "" {
		t.Errorf("empty input must return empty string")
	}
	a := hashIP("203.0.113.42")
	b := hashIP("203.0.113.42")
	if a != b {
		t.Errorf("hash should be deterministic: %s != %s", a, b)
	}
	if a == hashIP("203.0.113.43") {
		t.Errorf("different inputs must hash to different outputs")
	}
	if len(a) != 64 {
		t.Errorf("sha256 hex must be 64 chars, got %d", len(a))
	}
}

// TestRemoteIPXForwardedFor verifies XFF parsing prefers the first hop
// (the client) over the proxy chain.
func TestRemoteIPXForwardedFor(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		xff  string
		want string
	}{
		{"single", "203.0.113.42", "203.0.113.42"},
		{"chain", "203.0.113.42, 10.0.0.1, 10.0.0.2", "203.0.113.42"},
		{"chain with whitespace", "  203.0.113.42  , 10.0.0.1", "203.0.113.42"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodPost, "/", nil)
			req.Header.Set("X-Forwarded-For", tc.xff)
			got := remoteIP(req)
			if got != tc.want {
				t.Errorf("remoteIP got %q, want %q", got, tc.want)
			}
		})
	}
}

// TestRemoteIPFromRemoteAddr falls back to RemoteAddr when XFF is absent.
func TestRemoteIPFromRemoteAddr(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "192.0.2.1:54321"
	got := remoteIP(req)
	if got != "192.0.2.1" {
		t.Errorf("remoteIP got %q, want 192.0.2.1", got)
	}
}

// TestComplianceRoutingDBNil verifies all four compliance endpoints route
// correctly and short-circuit to 503 when the db pool is nil.
func TestComplianceRoutingDBNil(t *testing.T) {
	t.Parallel()
	h := NewComplianceHandler(nil)

	tests := []struct {
		name   string
		method string
		path   string
		body   []byte
		auth   bool
	}{
		{"cookie consent", http.MethodPost, "/api/v1/cookie-consent", []byte(`{"analytics":true}`), false},
		{"current tos", http.MethodGet, "/api/v1/tos/current", nil, false},
		{"accept tos", http.MethodPost, "/api/v1/me/tos-acceptance", []byte(`{"tos_version":"1.0"}`), true},
		{"set dob", http.MethodPut, "/api/v1/me/dob", []byte(`{"dob":"1990-01-01"}`), true},
		{"age status", http.MethodGet, "/api/v1/me/age-status", nil, true},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r := chi.NewRouter()
			r.Post("/api/v1/cookie-consent", h.LogCookieConsent)
			r.Get("/api/v1/tos/current", h.GetCurrentToS)
			r.Post("/api/v1/me/tos-acceptance", h.AcceptToS)
			r.Get("/api/v1/me/tos-acceptance", h.GetMyToSAcceptance)
			r.Put("/api/v1/me/dob", h.SetDOB)
			r.Get("/api/v1/me/age-status", h.GetMyAgeStatus)

			var bodyR *bytes.Reader
			if tc.body != nil {
				bodyR = bytes.NewReader(tc.body)
			} else {
				bodyR = bytes.NewReader(nil)
			}
			req := httptest.NewRequest(tc.method, tc.path, bodyR)
			if tc.auth {
				req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "buyer@example.com", []string{"customer"})
			}
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != http.StatusServiceUnavailable {
				t.Errorf("%s %s: got %d, want %d (body=%s)", tc.method, tc.path, rec.Code, http.StatusServiceUnavailable, rec.Body.String())
			}
		})
	}
}
