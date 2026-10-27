package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

func cookieNamed(t *testing.T, rec *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func TestSafeOAuthNext(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"   ", ""},
		{"/jobs", "/jobs"},
		{"/marketplace/abc?tab=pay", "/marketplace/abc?tab=pay"},
		{"//evil.example/phish", ""},
		{"https://evil.com", ""},
		{"http://evil.com/jobs", ""},
		{"javascript:alert(1)", ""},
	}
	for _, tc := range cases {
		if got := safeOAuthNext(tc.in); got != tc.want {
			t.Errorf("safeOAuthNext(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestInitGoogleOAuth_SetsNextCookie(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "test-web.apps.googleusercontent.com")
	t.Setenv("GOOGLE_CLIENT_SECRET", "test-secret")
	t.Setenv("OAUTH_REDIRECT_BASE", "http://localhost:8080")
	t.Setenv("FRONTEND_URL", "http://localhost:3000")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/google?next=/jobs", nil)
	rec := httptest.NewRecorder()

	h.InitGoogleOAuth(rec, req)

	c := cookieNamed(t, rec, oauthNextCookieName)
	if c == nil {
		t.Fatal("expected oauth_next cookie")
	}
	if c.Value != "/jobs" {
		t.Fatalf("oauth_next = %q, want /jobs", c.Value)
	}
	if !c.HttpOnly {
		t.Fatal("oauth_next must be HttpOnly")
	}
	if c.Path != "/" {
		t.Fatalf("oauth_next Path = %q, want /", c.Path)
	}
	if c.MaxAge != oauthNextCookieMaxAge {
		t.Fatalf("oauth_next MaxAge = %d, want %d", c.MaxAge, oauthNextCookieMaxAge)
	}
	if c.SameSite != http.SameSiteLaxMode {
		t.Fatalf("oauth_next SameSite = %v, want Lax", c.SameSite)
	}
	if c.Secure {
		t.Fatal("oauth_next Secure should follow h.secureCookie=false")
	}
}

func TestInitGoogleOAuth_RejectsExternalNext(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "test-web.apps.googleusercontent.com")
	t.Setenv("GOOGLE_CLIENT_SECRET", "test-secret")
	t.Setenv("OAUTH_REDIRECT_BASE", "http://localhost:8080")
	t.Setenv("FRONTEND_URL", "http://localhost:3000")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/google?next=https://evil.com", nil)
	rec := httptest.NewRecorder()

	h.InitGoogleOAuth(rec, req)

	if c := cookieNamed(t, rec, oauthNextCookieName); c != nil {
		t.Fatalf("oauth_next must not be set for external next, got %q", c.Value)
	}
	if cookieNamed(t, rec, oauthStateCookieName) == nil {
		t.Fatal("expected oauth_state cookie")
	}
}

func TestCompleteOAuthLogin_UsesNextCookieForExistingUser(t *testing.T) {
	t.Setenv("FRONTEND_URL", "http://localhost:3000")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback/google", nil)
	req.AddCookie(&http.Cookie{Name: oauthNextCookieName, Value: "/jobs"})
	rec := httptest.NewRecorder()

	h.completeOAuthLogin(rec, req, &userv1.FindOrCreateByOAuthResponse{
		AccessToken:  "tok",
		RefreshToken: "ref",
		UserId:       "u1",
		IsNewUser:    false,
	})

	if rec.Code != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusTemporaryRedirect)
	}
	if loc := rec.Header().Get("Location"); loc != "http://localhost:3000/jobs" {
		t.Fatalf("Location = %q, want http://localhost:3000/jobs", loc)
	}
	cleared := cookieNamed(t, rec, oauthNextCookieName)
	if cleared == nil || cleared.MaxAge != -1 {
		t.Fatal("expected oauth_next to be cleared")
	}
}

func TestCompleteOAuthLogin_NewUserIgnoresNextCookie(t *testing.T) {
	t.Setenv("FRONTEND_URL", "http://localhost:3000")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback/google", nil)
	req.AddCookie(&http.Cookie{Name: oauthNextCookieName, Value: "/jobs"})
	rec := httptest.NewRecorder()

	h.completeOAuthLogin(rec, req, &userv1.FindOrCreateByOAuthResponse{
		AccessToken:  "tok",
		RefreshToken: "ref",
		UserId:       "u1",
		IsNewUser:    true,
	})

	if loc := rec.Header().Get("Location"); loc != "http://localhost:3000/onboarding" {
		t.Fatalf("Location = %q, want http://localhost:3000/onboarding", loc)
	}
}

func TestWriteOAuthMFARedirect_PreservesNextQuery(t *testing.T) {
	t.Setenv("FRONTEND_URL", "http://localhost:3000")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback/google", nil)
	req.AddCookie(&http.Cookie{Name: oauthNextCookieName, Value: "/jobs"})
	rec := httptest.NewRecorder()

	st := status.New(codes.FailedPrecondition, "mfa required")
	st, err := st.WithDetails(&userv1.LoginResponse{
		UserId:            "u1",
		MfaRequired:       true,
		MfaChallengeToken: "chal",
	})
	if err != nil {
		t.Fatalf("WithDetails: %v", err)
	}

	if !h.writeOAuthMFARedirect(rec, req, st.Err()) {
		t.Fatal("expected MFA redirect")
	}
	loc := rec.Header().Get("Location")
	if loc != "http://localhost:3000/login?next=%2Fjobs" {
		t.Fatalf("Location = %q, want login?next=%%2Fjobs", loc)
	}
	if strings.Contains(loc, "chal") || strings.Contains(loc, "mfa") {
		t.Fatalf("challenge must not appear in query: %q", loc)
	}
	c := cookieNamed(t, rec, "oauth_mfa_challenge")
	if c == nil {
		t.Fatal("expected oauth_mfa_challenge cookie")
	}
	if !c.HttpOnly || c.Path != "/api/v1/auth" {
		t.Fatalf("challenge cookie must be HttpOnly and scoped to /api/v1/auth: %+v", c)
	}
	if p := cookieNamed(t, rec, "oauth_mfa_pending"); p == nil || p.HttpOnly || p.Value != "1" {
		t.Fatalf("expected non-secret JS-readable oauth_mfa_pending=1 flag, got %+v", p)
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

func TestExchangeOAuthMFAChallenge(t *testing.T) {
	h := NewOAuthHandler(nil, true, "test-session-secret")

	t.Run("redeems once and clears cookies", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/oauth/mfa-challenge", nil)
		req.AddCookie(&http.Cookie{Name: "oauth_mfa_challenge", Value: "chal-123"})
		rec := httptest.NewRecorder()
		h.ExchangeOAuthMFAChallenge(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), `"mfa_challenge_token":"chal-123"`) {
			t.Fatalf("body = %s", rec.Body.String())
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("Cache-Control = %q, want no-store", got)
		}
		c := cookieNamed(t, rec, "oauth_mfa_challenge")
		if c == nil || c.MaxAge >= 0 || !c.HttpOnly || c.Path != "/api/v1/auth" {
			t.Fatalf("challenge cookie not cleared correctly: %+v", c)
		}
		if p := cookieNamed(t, rec, "oauth_mfa_pending"); p == nil || p.MaxAge >= 0 {
			t.Fatalf("pending flag not cleared: %+v", p)
		}
	})

	t.Run("no cookie is 404", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/oauth/mfa-challenge", nil)
		rec := httptest.NewRecorder()
		h.ExchangeOAuthMFAChallenge(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
		if strings.Contains(rec.Body.String(), "mfa_challenge_token") {
			t.Fatalf("unexpected token in body: %s", rec.Body.String())
		}
	})
}
