package handler

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const (
	oauthStateCookieName = "oauth_state"
	oauthStateCookieMaxAge = 600 // 10 minutes
)

// OAuthHandler handles OAuth authentication flows.
type OAuthHandler struct {
	userClient   userv1.UserServiceClient
	secureCookie bool
	frontendURL  string
}

// NewOAuthHandler creates a new OAuthHandler.
func NewOAuthHandler(userClient userv1.UserServiceClient, secureCookie bool) *OAuthHandler {
	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		frontendURL = "http://localhost:3000"
	}
	return &OAuthHandler{
		userClient:   userClient,
		secureCookie: secureCookie,
		frontendURL:  frontendURL,
	}
}

func googleOAuthConfig() *oauth2.Config {
	redirectBase := os.Getenv("OAUTH_REDIRECT_BASE")
	if redirectBase == "" {
		redirectBase = "http://localhost:8080"
	}
	return &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		RedirectURL:  redirectBase + "/api/v1/auth/callback/google",
		Scopes:       []string{"openid", "email", "profile"},
		Endpoint:     google.Endpoint,
	}
}

func appleOAuthConfig() *oauth2.Config {
	redirectBase := os.Getenv("OAUTH_REDIRECT_BASE")
	if redirectBase == "" {
		redirectBase = "http://localhost:8080"
	}
	return &oauth2.Config{
		ClientID:     os.Getenv("APPLE_CLIENT_ID"),
		ClientSecret: os.Getenv("APPLE_CLIENT_SECRET"),
		RedirectURL:  redirectBase + "/api/v1/auth/callback/apple",
		Scopes:       []string{"name", "email"},
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://appleid.apple.com/auth/authorize",
			TokenURL: "https://appleid.apple.com/auth/token",
		},
	}
}

// generateOAuthState creates a cryptographically secure random state parameter.
func generateOAuthState() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate oauth state: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// InitGoogleOAuth redirects the user to Google's OAuth consent page.
func (h *OAuthHandler) InitGoogleOAuth(w http.ResponseWriter, r *http.Request) {
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

	config := googleOAuthConfig()
	url := config.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// GoogleOAuthCallback handles the OAuth callback from Google.
func (h *OAuthHandler) GoogleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	// Validate state to prevent CSRF.
	stateCookie, err := r.Cookie(oauthStateCookieName)
	if err != nil {
		slog.Warn("oauth callback missing state cookie")
		http.Redirect(w, r, h.frontendURL+"/login?error=invalid_state", http.StatusTemporaryRedirect)
		return
	}

	if r.URL.Query().Get("state") != stateCookie.Value {
		slog.Warn("oauth callback state mismatch")
		http.Redirect(w, r, h.frontendURL+"/login?error=invalid_state", http.StatusTemporaryRedirect)
		return
	}

	// Clear the state cookie.
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	// Check for error from provider.
	if errParam := r.URL.Query().Get("error"); errParam != "" {
		slog.Warn("oauth provider returned error", "error", errParam)
		http.Redirect(w, r, h.frontendURL+"/login?error="+errParam, http.StatusTemporaryRedirect)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		slog.Warn("oauth callback missing authorization code")
		http.Redirect(w, r, h.frontendURL+"/login?error=missing_code", http.StatusTemporaryRedirect)
		return
	}

	config := googleOAuthConfig()
	token, err := config.Exchange(r.Context(), code)
	if err != nil {
		slog.Error("failed to exchange google oauth token", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=exchange_failed", http.StatusTemporaryRedirect)
		return
	}

	// Get user info from Google.
	client := config.Client(r.Context(), token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		slog.Error("failed to get google user info", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=userinfo_failed", http.StatusTemporaryRedirect)
		return
	}
	defer resp.Body.Close()

	var googleUser struct {
		ID            string `json:"id"`
		Email         string `json:"email"`
		VerifiedEmail bool   `json:"verified_email"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&googleUser); err != nil {
		slog.Error("failed to decode google user info", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=decode_failed", http.StatusTemporaryRedirect)
		return
	}

	if !googleUser.VerifiedEmail {
		slog.Warn("google user email not verified", "email", googleUser.Email)
		http.Redirect(w, r, h.frontendURL+"/login?error=email_not_verified", http.StatusTemporaryRedirect)
		return
	}

	// Call user service to find or create user.
	result, err := h.userClient.FindOrCreateByOAuth(r.Context(), &userv1.FindOrCreateByOAuthRequest{
		Provider:   "google",
		ProviderId: googleUser.ID,
		Email:      googleUser.Email,
		Name:       googleUser.Name,
		AvatarUrl:  googleUser.Picture,
	})
	if err != nil {
		slog.Error("failed to find or create oauth user", "provider", "google", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=auth_failed", http.StatusTemporaryRedirect)
		return
	}

	h.completeOAuthLogin(w, r, result)
}

// InitAppleOAuth redirects the user to Apple's OAuth consent page.
func (h *OAuthHandler) InitAppleOAuth(w http.ResponseWriter, r *http.Request) {
	state, err := generateOAuthState()
	if err != nil {
		slog.Error("failed to generate oauth state", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Apple uses response_mode=form_post, so the callback is a cross-site POST.
	// SameSite=Lax cookies are NOT sent on cross-site POST requests, so we must
	// use SameSite=None. This requires Secure=true (browsers enforce this; Chrome
	// exempts localhost over HTTP).
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    state,
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
		MaxAge:   oauthStateCookieMaxAge,
	})

	config := appleOAuthConfig()
	// Apple requires response_mode=form_post for the callback.
	url := config.AuthCodeURL(state, oauth2.AccessTypeOffline) + "&response_mode=form_post"
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// AppleOAuthCallback handles the OAuth callback from Apple (POST with form data).
func (h *OAuthHandler) AppleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		slog.Warn("apple oauth callback: failed to parse form", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=invalid_request", http.StatusTemporaryRedirect)
		return
	}

	// Validate state to prevent CSRF.
	stateCookie, err := r.Cookie(oauthStateCookieName)
	if err != nil {
		slog.Warn("apple oauth callback missing state cookie")
		http.Redirect(w, r, h.frontendURL+"/login?error=invalid_state", http.StatusTemporaryRedirect)
		return
	}

	if r.FormValue("state") != stateCookie.Value {
		slog.Warn("apple oauth callback state mismatch")
		http.Redirect(w, r, h.frontendURL+"/login?error=invalid_state", http.StatusTemporaryRedirect)
		return
	}

	// Clear the state cookie.
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	// Check for error from provider.
	if errParam := r.FormValue("error"); errParam != "" {
		slog.Warn("apple oauth provider returned error", "error", errParam)
		http.Redirect(w, r, h.frontendURL+"/login?error="+errParam, http.StatusTemporaryRedirect)
		return
	}

	code := r.FormValue("code")
	if code == "" {
		slog.Warn("apple oauth callback missing authorization code")
		http.Redirect(w, r, h.frontendURL+"/login?error=missing_code", http.StatusTemporaryRedirect)
		return
	}

	config := appleOAuthConfig()
	token, err := config.Exchange(r.Context(), code)
	if err != nil {
		slog.Error("failed to exchange apple oauth token", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=exchange_failed", http.StatusTemporaryRedirect)
		return
	}

	// Apple sends the ID token in the token response.
	idTokenStr, ok := token.Extra("id_token").(string)
	if !ok || idTokenStr == "" {
		slog.Error("apple oauth: missing id_token in token response")
		http.Redirect(w, r, h.frontendURL+"/login?error=missing_id_token", http.StatusTemporaryRedirect)
		return
	}

	// Decode the JWT claims (Apple ID token is a JWT).
	// We parse claims without full verification here because the token was received
	// directly from Apple over TLS via the token exchange. In production, you should
	// verify the JWT signature against Apple's public keys.
	claims, err := decodeAppleIDToken(idTokenStr)
	if err != nil {
		slog.Error("apple oauth: failed to decode id_token", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=decode_failed", http.StatusTemporaryRedirect)
		return
	}

	// Apple sends user info in the form body only on first authorization.
	name := ""
	if userJSON := r.FormValue("user"); userJSON != "" {
		var appleUser struct {
			Name struct {
				FirstName string `json:"firstName"`
				LastName  string `json:"lastName"`
			} `json:"name"`
		}
		if err := json.Unmarshal([]byte(userJSON), &appleUser); err == nil {
			name = appleUser.Name.FirstName
			if appleUser.Name.LastName != "" {
				if name != "" {
					name += " "
				}
				name += appleUser.Name.LastName
			}
		}
	}

	if name == "" {
		// Fallback: use email prefix if no name provided.
		name = claims.Email
		for i := 0; i < len(name); i++ {
			if name[i] == '@' {
				name = name[:i]
				break
			}
		}
	}

	// Call user service to find or create user.
	result, err := h.userClient.FindOrCreateByOAuth(r.Context(), &userv1.FindOrCreateByOAuthRequest{
		Provider:   "apple",
		ProviderId: claims.Sub,
		Email:      claims.Email,
		Name:       name,
		AvatarUrl:  "", // Apple does not provide avatar URLs.
	})
	if err != nil {
		slog.Error("failed to find or create oauth user", "provider", "apple", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=auth_failed", http.StatusTemporaryRedirect)
		return
	}

	h.completeOAuthLogin(w, r, result)
}

// completeOAuthLogin sets the refresh token cookie and redirects to the frontend.
func (h *OAuthHandler) completeOAuthLogin(w http.ResponseWriter, r *http.Request, result *userv1.FindOrCreateByOAuthResponse) {
	refreshMaxAge := 7 * 24 * 60 * 60
	http.SetCookie(w, &http.Cookie{
		Name:     refreshTokenCookieName,
		Value:    result.GetRefreshToken(),
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   refreshMaxAge,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     sessionFlagCookieName,
		Value:    "1",
		Path:     "/",
		HttpOnly: false,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   refreshMaxAge,
	})

	// Redirect to the frontend with the access token as a fragment (not query param)
	// to avoid it being logged in server access logs.
	redirectPath := "/dashboard"
	if result.GetIsNewUser() {
		redirectPath = "/onboarding"
	}

	// Use a short-lived cookie to pass the token to the frontend SPA,
	// which is safer than putting it in the URL.
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_access_token",
		Value:    result.GetAccessToken(),
		Path:     "/",
		HttpOnly: false, // Must be readable by JavaScript
		Secure:   h.secureCookie,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   60, // 1 minute — frontend should read and clear immediately
	})

	expiresAt := ""
	if result.GetAccessTokenExpiresAt() != nil {
		expiresAt = result.GetAccessTokenExpiresAt().AsTime().Format(time.RFC3339)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_token_expires",
		Value:    expiresAt,
		Path:     "/",
		HttpOnly: false,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   60,
	})

	http.Redirect(w, r, h.frontendURL+redirectPath, http.StatusTemporaryRedirect)
}

// appleIDTokenClaims holds the subset of Apple ID token JWT claims we need.
type appleIDTokenClaims struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
}

// decodeAppleIDToken decodes the payload of an Apple ID token JWT without
// signature verification (the token was received directly from Apple over TLS).
func decodeAppleIDToken(tokenStr string) (*appleIDTokenClaims, error) {
	// JWT is header.payload.signature — we want the payload.
	parts := splitJWT(tokenStr)
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid jwt format")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decode jwt payload: %w", err)
	}

	var claims appleIDTokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("unmarshal jwt claims: %w", err)
	}

	if claims.Sub == "" {
		return nil, fmt.Errorf("missing sub claim")
	}
	if claims.Email == "" {
		return nil, fmt.Errorf("missing email claim")
	}

	return &claims, nil
}

// splitJWT splits a JWT token string into its three parts.
func splitJWT(token string) []string {
	parts := make([]string, 0, 3)
	start := 0
	for i := 0; i < len(token); i++ {
		if token[i] == '.' {
			parts = append(parts, token[start:i])
			start = i + 1
		}
	}
	parts = append(parts, token[start:])
	return parts
}
