package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// Smoke test that exercises route + auth wiring on the four new
// listings write handlers. db is nil so handlers return 503 (the
// h.db nil guard is the first thing they hit). This proves:
//   - the routes are registered on the chi router
//   - the URL params resolve
//   - the auth context propagates
// Real DB-backed tests require a Postgres testcontainer.
func TestListingsWriteRouting(t *testing.T) {
	h := NewListingsHandler(nil, nil)

	r := chi.NewRouter()
	r.Post("/api/v1/listings", h.CreateListing)
	r.Patch("/api/v1/listings/{id}", h.UpdateListing)
	r.Post("/api/v1/listings/{id}/cancel", h.CancelListing)
	r.Delete("/api/v1/listings/{id}", h.DeleteListingDraft)

	uuid := "11111111-1111-1111-1111-111111111111"
	authedCtx := func(req *http.Request) *http.Request {
		c := &middleware.Claims{UserID: uuid, Email: "a@b.c", Roles: []string{"customer"}}
		return req.WithContext(context.WithValue(req.Context(), middleware.ClaimsContextKey, c))
	}

	cases := []struct {
		name       string
		method     string
		path       string
		body       []byte
		authed     bool
		wantStatus int
	}{
		// Without claims, our handlers return 401 (no claims in ctx).
		{"create-no-auth", http.MethodPost, "/api/v1/listings", []byte("{}"), false, http.StatusUnauthorized},
		{"update-no-auth", http.MethodPatch, "/api/v1/listings/" + uuid, []byte("{}"), false, http.StatusUnauthorized},
		{"cancel-no-auth", http.MethodPost, "/api/v1/listings/" + uuid + "/cancel", nil, false, http.StatusUnauthorized},
		{"delete-no-auth", http.MethodDelete, "/api/v1/listings/" + uuid, nil, false, http.StatusUnauthorized},

		// With claims but db=nil → 503 from each handler's first guard.
		{"create-503", http.MethodPost, "/api/v1/listings", []byte("{}"), true, http.StatusServiceUnavailable},
		{"update-503", http.MethodPatch, "/api/v1/listings/" + uuid, []byte("{}"), true, http.StatusServiceUnavailable},
		{"cancel-503", http.MethodPost, "/api/v1/listings/" + uuid + "/cancel", nil, true, http.StatusServiceUnavailable},
		{"delete-503", http.MethodDelete, "/api/v1/listings/" + uuid, nil, true, http.StatusServiceUnavailable},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var body *bytes.Reader
			if tc.body != nil {
				body = bytes.NewReader(tc.body)
			} else {
				body = bytes.NewReader(nil)
			}
			req := httptest.NewRequest(tc.method, tc.path, body)
			req.Header.Set("Content-Type", "application/json")
			if tc.authed {
				req = authedCtx(req)
			}
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Errorf("%s %s: got %d, want %d (body=%s)",
					tc.method, tc.path, rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}
