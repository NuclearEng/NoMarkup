package handler

// oauth_facebook.go — Facebook Login provider for OAuthHandler.
//
// Lives in a sibling file to oauth.go to keep the Google/Apple block
// readable and to make this provider easy to disable independently.
// Endpoints (Graph API + dialog/oauth) are documented at
// https://developers.facebook.com/docs/facebook-login.
//
// Facebook does NOT issue an OIDC id_token for our basic
// `email + public_profile` scopes — it issues an opaque user access
// token. We compensate by hitting `debug_token` with the app access
// token (CLIENT_ID|CLIENT_SECRET) to confirm the user-token's `app_id`
// matches our FACEBOOK_CLIENT_ID. This is Facebook's documented advice
// for server-side validation.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"golang.org/x/oauth2"
)

// facebookOAuthConfig returns the OAuth 2.0 config for Facebook Login.
func facebookOAuthConfig() *oauth2.Config {
	redirectBase := os.Getenv("OAUTH_REDIRECT_BASE")
	if redirectBase == "" {
		redirectBase = "http://localhost:8080"
	}
	return &oauth2.Config{
		ClientID:     os.Getenv("FACEBOOK_CLIENT_ID"),
		ClientSecret: os.Getenv("FACEBOOK_CLIENT_SECRET"),
		RedirectURL:  redirectBase + "/api/v1/auth/callback/facebook",
		Scopes:       []string{"email", "public_profile"},
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://www.facebook.com/v18.0/dialog/oauth",
			TokenURL: "https://graph.facebook.com/v18.0/oauth/access_token",
		},
	}
}

// InitFacebookOAuth redirects the user to Facebook's OAuth consent page.
// When FACEBOOK_CLIENT_ID is unset (dev/staging without an app), we
// gracefully redirect to /login?error=facebook_not_configured rather
// than 500'ing.
func (h *OAuthHandler) InitFacebookOAuth(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(os.Getenv("FACEBOOK_CLIENT_ID")) == "" {
		http.Redirect(w, r, h.frontendURL+"/login?error=facebook_not_configured", http.StatusTemporaryRedirect)
		return
	}

	state, err := generateOAuthState()
	if err != nil {
		slog.Error("failed to generate oauth state", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    state,
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   oauthStateCookieMaxAge,
	})

	config := facebookOAuthConfig()
	url := config.AuthCodeURL(state)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// FacebookOAuthCallback handles the OAuth callback from Facebook.
func (h *OAuthHandler) FacebookOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(os.Getenv("FACEBOOK_CLIENT_ID")) == "" {
		http.Redirect(w, r, h.frontendURL+"/login?error=facebook_not_configured", http.StatusTemporaryRedirect)
		return
	}

	stateCookie, err := r.Cookie(oauthStateCookieName)
	if err != nil {
		slog.Warn("facebook oauth callback missing state cookie")
		http.Redirect(w, r, h.frontendURL+"/login?error=invalid_state", http.StatusTemporaryRedirect)
		return
	}
	if r.URL.Query().Get("state") != stateCookie.Value {
		slog.Warn("facebook oauth callback state mismatch")
		http.Redirect(w, r, h.frontendURL+"/login?error=invalid_state", http.StatusTemporaryRedirect)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	if errParam := r.URL.Query().Get("error"); errParam != "" {
		slog.Warn("facebook oauth provider returned error", "error", errParam)
		http.Redirect(w, r, h.frontendURL+"/login?error="+errParam, http.StatusTemporaryRedirect)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Redirect(w, r, h.frontendURL+"/login?error=missing_code", http.StatusTemporaryRedirect)
		return
	}

	config := facebookOAuthConfig()
	token, err := config.Exchange(r.Context(), code)
	if err != nil {
		slog.Error("facebook oauth: token exchange failed", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=exchange_failed", http.StatusTemporaryRedirect)
		return
	}

	if err := verifyFacebookAppID(r.Context(), token.AccessToken); err != nil {
		slog.Error("facebook oauth: token app_id mismatch", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=oauth_invalid_signature", http.StatusTemporaryRedirect)
		return
	}

	client := config.Client(r.Context(), token)
	resp, err := client.Get("https://graph.facebook.com/v18.0/me?fields=id,name,email,picture.type(large)")
	if err != nil {
		slog.Error("facebook oauth: graph fetch failed", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=userinfo_failed", http.StatusTemporaryRedirect)
		return
	}
	defer resp.Body.Close()

	var fbUser struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Email   string `json:"email"`
		Picture struct {
			Data struct {
				URL string `json:"url"`
			} `json:"data"`
		} `json:"picture"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&fbUser); err != nil {
		slog.Error("facebook oauth: decode profile failed", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=decode_failed", http.StatusTemporaryRedirect)
		return
	}
	if fbUser.ID == "" {
		http.Redirect(w, r, h.frontendURL+"/login?error=missing_id", http.StatusTemporaryRedirect)
		return
	}

	result, err := h.userClient.FindOrCreateByOAuth(r.Context(), &userv1.FindOrCreateByOAuthRequest{
		Provider:   "facebook",
		ProviderId: fbUser.ID,
		Email:      fbUser.Email,
		Name:       fbUser.Name,
		AvatarUrl:  fbUser.Picture.Data.URL,
	})
	if err != nil {
		slog.Error("failed to find or create oauth user", "provider", "facebook", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=auth_failed", http.StatusTemporaryRedirect)
		return
	}

	h.completeOAuthLogin(w, r, result)
}

// verifyFacebookAppID confirms the user-token was issued for our app.
func verifyFacebookAppID(ctx context.Context, userToken string) error {
	clientID := strings.TrimSpace(os.Getenv("FACEBOOK_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("FACEBOOK_CLIENT_SECRET"))
	if clientID == "" || clientSecret == "" {
		return errors.New("FACEBOOK_CLIENT_ID/CLIENT_SECRET not configured")
	}

	appAccessToken := clientID + "|" + clientSecret
	url := fmt.Sprintf("https://graph.facebook.com/debug_token?input_token=%s&access_token=%s", userToken, appAccessToken)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build debug_token request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("fetch debug_token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("debug_token returned %d", resp.StatusCode)
	}

	var body struct {
		Data struct {
			AppID   string `json:"app_id"`
			IsValid bool   `json:"is_valid"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("decode debug_token: %w", err)
	}
	if !body.Data.IsValid {
		return errors.New("debug_token: token not valid")
	}
	if body.Data.AppID != clientID {
		return fmt.Errorf("debug_token: app_id mismatch (got %s)", body.Data.AppID)
	}
	return nil
}
