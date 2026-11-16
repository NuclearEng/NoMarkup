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

	h.setOAuthNextCookie(w, r)

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

	fbUser, err := fetchFacebookProfile(r.Context(), token.AccessToken)
	if err != nil {
		slog.Error("facebook oauth: graph fetch failed", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=userinfo_failed", http.StatusTemporaryRedirect)
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
		AvatarUrl:  fbUser.PictureURL,
	})
	if err != nil {
		if h.writeOAuthMFARedirect(w, r, err) {
			return
		}
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

// --- Native Facebook (iOS ASWebAuthenticationSession) ---

// nativeFacebookSignInRequest is the body for POST /api/v1/auth/facebook/native.
//
// Facebook Login does not mint an OIDC id_token for the basic
// `email + public_profile` scopes (unlike Google). The native client therefore
// either:
//  1. Completes Authorization Code (with optional PKCE) in ASWebAuth and posts
//     `authorization_code` + `redirect_uri` here so the server can exchange
//     with FACEBOOK_CLIENT_SECRET, OR
//  2. Posts a user `access_token` already obtained (e.g. Limited Login SDK)
//     which we validate via debug_token.
//
// Client secret never leaves the server. FACEBOOK_CLIENT_ID is public (App ID).
type nativeFacebookSignInRequest struct {
	AuthorizationCode string `json:"authorization_code"`
	RedirectURI       string `json:"redirect_uri"`
	AccessToken       string `json:"access_token"`
}

// NativeFacebookSignIn exchanges a Facebook authorization code (or verified
// user access token) from a native iOS client for the standard access/refresh
// token pair as JSON. Mirrors NativeGoogleSignIn / NativeAppleSignIn.
func (h *OAuthHandler) NativeFacebookSignIn(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(os.Getenv("FACEBOOK_CLIENT_ID")) == "" ||
		strings.TrimSpace(os.Getenv("FACEBOOK_CLIENT_SECRET")) == "" {
		writeError(w, http.StatusServiceUnavailable, "facebook oauth is not configured")
		return
	}

	var req nativeFacebookSignInRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	accessToken := strings.TrimSpace(req.AccessToken)
	if accessToken == "" {
		code := strings.TrimSpace(req.AuthorizationCode)
		redirectURI := strings.TrimSpace(req.RedirectURI)
		if code == "" {
			writeError(w, http.StatusBadRequest, "authorization_code or access_token is required")
			return
		}
		if redirectURI == "" {
			writeError(w, http.StatusBadRequest, "redirect_uri is required with authorization_code")
			return
		}

		config := facebookOAuthConfig()
		// Override RedirectURL with the client-supplied value so the token
		// exchange matches the authorize request (native custom scheme).
		config.RedirectURL = redirectURI
		token, err := config.Exchange(r.Context(), code)
		if err != nil {
			slog.Warn("native facebook sign-in: code exchange failed", "error", err)
			writeError(w, http.StatusUnauthorized, "invalid facebook authorization code")
			return
		}
		accessToken = token.AccessToken
	}
	if accessToken == "" {
		writeError(w, http.StatusUnauthorized, "facebook access token missing")
		return
	}

	if err := verifyFacebookAppID(r.Context(), accessToken); err != nil {
		slog.Warn("native facebook sign-in: token app_id mismatch", "error", err)
		writeError(w, http.StatusUnauthorized, "invalid facebook access token")
		return
	}

	fbUser, err := fetchFacebookProfile(r.Context(), accessToken)
	if err != nil {
		slog.Error("native facebook sign-in: graph fetch failed", "error", err)
		writeError(w, http.StatusUnauthorized, "failed to load facebook profile")
		return
	}
	if fbUser.ID == "" {
		writeError(w, http.StatusUnauthorized, "facebook profile missing id")
		return
	}

	result, err := h.userClient.FindOrCreateByOAuth(r.Context(), &userv1.FindOrCreateByOAuthRequest{
		Provider:   "facebook",
		ProviderId: fbUser.ID,
		Email:      fbUser.Email,
		Name:       fbUser.Name,
		AvatarUrl:  fbUser.PictureURL,
	})
	if err != nil {
		if writeOAuthMFAJSON(w, err) {
			return
		}
		slog.Error("native facebook sign-in: find or create user failed", "error", err)
		writeGRPCError(w, err)
		return
	}

	h.completeOAuthLoginJSON(w, r, result)
}

// facebookProfile is the Graph /me subset we use for account linking.
type facebookProfile struct {
	ID         string
	Name       string
	Email      string
	PictureURL string
}

// fetchFacebookProfile loads id/name/email/picture for a verified user token.
func fetchFacebookProfile(ctx context.Context, accessToken string) (facebookProfile, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://graph.facebook.com/v18.0/me?fields=id,name,email,picture.type(large)", nil)
	if err != nil {
		return facebookProfile{}, fmt.Errorf("build graph request: %w", err)
	}
	// Prefer Authorization header over query token (less likely to land in logs).
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return facebookProfile{}, fmt.Errorf("graph request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return facebookProfile{}, fmt.Errorf("graph returned %d", resp.StatusCode)
	}

	var body struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Email   string `json:"email"`
		Picture struct {
			Data struct {
				URL string `json:"url"`
			} `json:"data"`
		} `json:"picture"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return facebookProfile{}, fmt.Errorf("decode graph: %w", err)
	}
	return facebookProfile{
		ID:         body.ID,
		Name:       body.Name,
		Email:      body.Email,
		PictureURL: body.Picture.Data.URL,
	}, nil
}
