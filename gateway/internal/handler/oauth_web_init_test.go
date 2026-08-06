package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInitGoogleOAuth_NotConfigured(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "")
	t.Setenv("FRONTEND_URL", "http://localhost:3000")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/google", nil)
	rec := httptest.NewRecorder()

	h.InitGoogleOAuth(rec, req)

	if rec.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusTemporaryRedirect)
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "error=google_not_configured") {
		t.Fatalf("Location = %q, want google_not_configured redirect", loc)
	}
	if strings.Contains(loc, "accounts.google.com") {
		t.Fatalf("must not redirect to Google without client_id: %q", loc)
	}
}

func TestInitGoogleOAuth_ConfiguredRedirectsToGoogle(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "test-web.apps.googleusercontent.com")
	t.Setenv("GOOGLE_CLIENT_SECRET", "test-secret")
	t.Setenv("OAUTH_REDIRECT_BASE", "http://localhost:8080")
	t.Setenv("FRONTEND_URL", "http://localhost:3000")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/google", nil)
	rec := httptest.NewRecorder()

	h.InitGoogleOAuth(rec, req)

	if rec.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusTemporaryRedirect)
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "accounts.google.com") {
		t.Fatalf("Location = %q, want Google authorize URL", loc)
	}
	if !strings.Contains(loc, "client_id=test-web.apps.googleusercontent.com") {
		t.Fatalf("Location missing client_id: %q", loc)
	}
	if rec.Header().Get("Set-Cookie") == "" {
		t.Fatal("expected oauth_state cookie")
	}
}

func TestInitAppleOAuth_NotConfigured(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "")
	t.Setenv("FRONTEND_URL", "http://localhost:3000")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/apple", nil)
	rec := httptest.NewRecorder()

	h.InitAppleOAuth(rec, req)

	if rec.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusTemporaryRedirect)
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "error=apple_not_configured") {
		t.Fatalf("Location = %q, want apple_not_configured redirect", loc)
	}
}

func TestInitFacebookOAuth_NotConfigured(t *testing.T) {
	t.Setenv("FACEBOOK_CLIENT_ID", "")
	t.Setenv("FRONTEND_URL", "http://localhost:3000")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/facebook", nil)
	rec := httptest.NewRecorder()

	h.InitFacebookOAuth(rec, req)

	if rec.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusTemporaryRedirect)
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "error=facebook_not_configured") {
		t.Fatalf("Location = %q, want facebook_not_configured redirect", loc)
	}
	if strings.Contains(loc, "facebook.com") {
		t.Fatalf("must not redirect to Facebook without client_id: %q", loc)
	}
}
