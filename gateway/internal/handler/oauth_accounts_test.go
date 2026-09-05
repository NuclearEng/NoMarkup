package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func TestCanUnlinkOAuth(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		hasPassword bool
		oauthCount  int
		want        bool
	}{
		{"password only path still needs a row", true, 0, false},
		{"password + one oauth", true, 1, true},
		{"password + many oauth", true, 3, true},
		{"oauth-only single — lockout", false, 1, false},
		{"oauth-only two — ok", false, 2, true},
		{"no methods", false, 0, false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := canUnlinkOAuth(tc.hasPassword, tc.oauthCount)
			if got != tc.want {
				t.Errorf("canUnlinkOAuth(%v, %d) = %v, want %v",
					tc.hasPassword, tc.oauthCount, got, tc.want)
			}
		})
	}
}

func newOAuthAccountsRouter(h *UserHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/api/v1/users/me/oauth-accounts", h.ListOAuthAccounts)
	r.Delete("/api/v1/users/me/oauth-accounts/{provider}", h.UnlinkOAuthAccount)
	return r
}

func TestOAuthAccountsNilDB(t *testing.T) {
	t.Parallel()
	h := NewUserHandler(nil, nil)
	r := newOAuthAccountsRouter(h)

	// List without auth → 401 (claims checked after nil-db… actually nil db first → 503)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/oauth-accounts", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("list nil-db: got %d want 503", rec.Code)
	}

	// Unlink nil-db → 503
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/users/me/oauth-accounts/google", nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unlink nil-db: got %d want 503", rec.Code)
	}
}

func TestOAuthAccountsUnsupportedProvider(t *testing.T) {
	t.Parallel()
	// db non-nil path needs a pool for the early provider check… provider is
	// validated after claims + before DB reads. Use a fake non-nil pool via
	// live skip, or unit-test only the allowed map by hitting with claims and
	// a nil db which 503s first.
	//
	// Instead: construct with a real pool when available; otherwise validate
	// allowedOAuthProviders map membership here.
	if _, ok := allowedOAuthProviders["twitter"]; ok {
		t.Fatal("twitter must not be an allowed provider")
	}
	for _, p := range []string{"google", "apple", "facebook"} {
		if _, ok := allowedOAuthProviders[p]; !ok {
			t.Fatalf("%s must be allowed", p)
		}
	}
}

func TestOAuthAccountsLiveDB_LockoutPrevention(t *testing.T) {
	pool := liveTestPool(t)
	h := NewUserHandler(nil, pool)
	r := newOAuthAccountsRouter(h)

	suffix := uuid.NewString()[:8]
	ctx := context.Background()

	// OAuth-only user (no password) with a single google link.
	var oauthOnlyID string
	err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, roles, status)
		VALUES ($1, NULL, 'OAuth Only', ARRAY['customer'], 'active')
		RETURNING id`,
		"oauth-only-"+suffix+"@test.invalid",
	).Scan(&oauthOnlyID)
	if err != nil {
		t.Fatalf("seed oauth-only user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, oauthOnlyID)
	})

	_, err = pool.Exec(ctx, `
		INSERT INTO oauth_accounts (user_id, provider, provider_id, email)
		VALUES ($1, 'google', $2, $3)`,
		oauthOnlyID, "g-sub-"+suffix, "oauth-only-"+suffix+"@test.invalid",
	)
	if err != nil {
		t.Fatalf("seed google link: %v", err)
	}

	// Unlink sole method → 409
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/users/me/oauth-accounts/google", nil)
	req = authReq(req, oauthOnlyID)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("unlink sole oauth: got %d want 409 (body=%s)", rec.Code, rec.Body.String())
	}

	// Add a second provider; unlink google → 200
	_, err = pool.Exec(ctx, `
		INSERT INTO oauth_accounts (user_id, provider, provider_id, email)
		VALUES ($1, 'apple', $2, $3)`,
		oauthOnlyID, "a-sub-"+suffix, "oauth-only-"+suffix+"@test.invalid",
	)
	if err != nil {
		t.Fatalf("seed apple link: %v", err)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/users/me/oauth-accounts/google", nil)
	req = authReq(req, oauthOnlyID)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("unlink with second oauth: got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	// Password user with single google — may unlink.
	var pwdUserID string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, roles, status)
		VALUES ($1, 'argon2id$fake', 'Pwd User', ARRAY['customer'], 'active')
		RETURNING id`,
		"oauth-pwd-"+suffix+"@test.invalid",
	).Scan(&pwdUserID)
	if err != nil {
		t.Fatalf("seed pwd user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, pwdUserID)
	})
	_, err = pool.Exec(ctx, `
		INSERT INTO oauth_accounts (user_id, provider, provider_id, email)
		VALUES ($1, 'google', $2, $3)`,
		pwdUserID, "g2-sub-"+suffix, "oauth-pwd-"+suffix+"@test.invalid",
	)
	if err != nil {
		t.Fatalf("seed pwd user google: %v", err)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/users/me/oauth-accounts/google", nil)
	req = authReq(req, pwdUserID)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("unlink with password: got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	// List for oauth-only (should still have apple)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/users/me/oauth-accounts", nil)
	req = authReq(req, oauthOnlyID)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var list struct {
		Accounts []struct {
			Provider string `json:"provider"`
		} `json:"accounts"`
	}
	if err := json.NewDecoder(bytes.NewReader(rec.Body.Bytes())).Decode(&list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list.Accounts) != 1 || list.Accounts[0].Provider != "apple" {
		t.Fatalf("list after unlink: got %+v, want single apple", list.Accounts)
	}
}
