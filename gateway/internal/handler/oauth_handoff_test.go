package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

// The web OAuth callback must never hand the access token to page scripts.
// Only HttpOnly cookies may carry credentials; legacy handoff cookies are cleared.
func TestCompleteOAuthLogin_NoJSReadableAccessToken(t *testing.T) {
	t.Setenv("FRONTEND_URL", "http://localhost:3000")
	h := NewOAuthHandler(nil, true, "test-session-secret")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback/google", nil)
	rec := httptest.NewRecorder()

	h.completeOAuthLogin(rec, req, &userv1.FindOrCreateByOAuthResponse{
		AccessToken:  "access-SECRET",
		RefreshToken: "refresh-SECRET",
		UserId:       "u1",
	})

	var sawRefresh bool
	for _, c := range rec.Result().Cookies() {
		if strings.Contains(c.Value, "access-SECRET") {
			t.Fatalf("access token leaked in cookie %q", c.Name)
		}
		if strings.Contains(c.Value, "refresh-SECRET") {
			sawRefresh = true
			if !c.HttpOnly || !c.Secure {
				t.Fatalf("refresh cookie %q must be HttpOnly+Secure", c.Name)
			}
		}
		if (c.Name == legacyOAuthAccessTokenCookie || c.Name == legacyOAuthTokenExpiresCookie) && c.MaxAge != -1 {
			t.Fatalf("legacy cookie %q must be cleared, MaxAge=%d", c.Name, c.MaxAge)
		}
	}
	if !sawRefresh {
		t.Fatal("expected HttpOnly refresh cookie as the handoff credential")
	}
	if loc := rec.Header().Get("Location"); strings.Contains(loc, "SECRET") {
		t.Fatalf("token leaked into redirect URL: %s", loc)
	}
}
