package handler

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	keyfunc "github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
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

	// Verify the Google id_token's signature against Google's JWKS and validate
	// iss/aud/exp claims. This is defense-in-depth: while the userinfo endpoint
	// call below is also served over TLS to Google, a verified id_token gives us
	// a cryptographic binding to our GOOGLE_CLIENT_ID (aud claim), preventing
	// any class of bug where token-exchange responses could be tampered with or
	// where the access_token is compromised independently.
	idTokenStr, ok := token.Extra("id_token").(string)
	if !ok || idTokenStr == "" {
		slog.Error("google oauth: missing id_token in token response")
		http.Redirect(w, r, h.frontendURL+"/login?error=missing_id_token", http.StatusTemporaryRedirect)
		return
	}

	idClaims, err := verifyGoogleIDToken(r.Context(), idTokenStr)
	if err != nil {
		slog.Error("google oauth: id_token signature verification failed",
			"error", err,
			"code", "oauth_invalid_signature",
		)
		http.Redirect(w, r, h.frontendURL+"/login?error=oauth_invalid_signature", http.StatusTemporaryRedirect)
		return
	}

	// Get profile info (name, picture) from the userinfo endpoint. The id_token
	// is the trusted source for sub/email; userinfo is only used for display
	// data we don't gate auth decisions on.
	client := config.Client(r.Context(), token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		slog.Error("failed to get google user info", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=userinfo_failed", http.StatusTemporaryRedirect)
		return
	}
	defer resp.Body.Close()

	var googleUser struct {
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&googleUser); err != nil {
		slog.Error("failed to decode google user info", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=decode_failed", http.StatusTemporaryRedirect)
		return
	}

	// Email verification is enforced via the id_token's email_verified claim
	// (cryptographically signed by Google), not via the unauthenticated
	// userinfo response.
	if !idClaims.EmailVerified {
		slog.Warn("google user email not verified", "email", idClaims.Email)
		http.Redirect(w, r, h.frontendURL+"/login?error=email_not_verified", http.StatusTemporaryRedirect)
		return
	}

	// Call user service to find or create user. Provider ID and email come
	// from the verified id_token; display name + avatar come from userinfo.
	result, err := h.userClient.FindOrCreateByOAuth(r.Context(), &userv1.FindOrCreateByOAuthRequest{
		Provider:   "google",
		ProviderId: idClaims.Subject,
		Email:      idClaims.Email,
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

	// Verify the Apple ID token's signature against Apple's JWKS, and validate
	// the iss/aud/exp claims. We intentionally do NOT trust the claims via a
	// plain base64 decode — an attacker who obtains or forges an authorization
	// code could otherwise supply arbitrary sub/email values.
	// The current authorize request does not include a `nonce` parameter, so we
	// pass "" and skip the nonce binding check; the state cookie provides CSRF
	// protection for the callback itself.
	claims, err := verifyAppleIDToken(r.Context(), idTokenStr, "")
	if err != nil {
		slog.Error("apple oauth: id_token signature verification failed",
			"error", err,
			"code", "oauth_invalid_signature",
		)
		http.Redirect(w, r, h.frontendURL+"/login?error=oauth_invalid_signature", http.StatusTemporaryRedirect)
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
		ProviderId: claims.Subject,
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

// --- Apple ID token verification ---

const (
	appleJWKSURL       = "https://appleid.apple.com/auth/keys"
	appleIDTokenIssuer = "https://appleid.apple.com"
)

// appleIDTokenClaims holds the subset of Apple ID token JWT claims we need
// plus the standard claims used for validation (iss, aud, exp, nonce).
type appleIDTokenClaims struct {
	jwt.RegisteredClaims
	Email string `json:"email"`
	Nonce string `json:"nonce"`
}

var (
	appleJWKSOnce     sync.Once
	appleJWKSInstance keyfunc.Keyfunc
	appleJWKSErr      error
)

// appleJWKS returns a cached keyfunc that fetches and periodically refreshes
// Apple's JWKS. The keyfunc library caches keys in-memory and refreshes in the
// background; we initialize it lazily on first use.
func appleJWKS(ctx context.Context) (keyfunc.Keyfunc, error) {
	appleJWKSOnce.Do(func() {
		k, err := keyfunc.NewDefaultCtx(ctx, []string{appleJWKSURL})
		if err != nil {
			appleJWKSErr = fmt.Errorf("load apple jwks: %w", err)
			return
		}
		appleJWKSInstance = k
	})
	return appleJWKSInstance, appleJWKSErr
}

// verifyAppleIDToken validates the signature, issuer, audience, and expiry of
// an Apple ID token. It fetches Apple's JWKS (cached + auto-refreshed) and
// validates `kid` + RS256 signature. On any validation failure it returns an
// error — callers MUST NOT trust any claim from an Apple ID token that has
// not been through this function.
//
// If expectedNonce is non-empty, the nonce claim on the token must match
// (binds the token to the original authorization request). Pass "" to skip.
func verifyAppleIDToken(ctx context.Context, rawToken, expectedNonce string) (*appleIDTokenClaims, error) {
	clientID := strings.TrimSpace(os.Getenv("APPLE_CLIENT_ID"))
	if clientID == "" {
		return nil, errors.New("APPLE_CLIENT_ID not configured")
	}

	jwks, err := appleJWKS(ctx)
	if err != nil {
		return nil, err
	}

	claims := &appleIDTokenClaims{}
	token, err := jwt.ParseWithClaims(
		rawToken,
		claims,
		jwks.Keyfunc,
		jwt.WithIssuer(appleIDTokenIssuer),
		jwt.WithAudience(clientID),
		jwt.WithValidMethods([]string{"RS256"}),
	)
	if err != nil {
		return nil, fmt.Errorf("verify apple id_token: %w", err)
	}
	if !token.Valid {
		return nil, errors.New("apple id_token invalid")
	}
	if claims.Subject == "" {
		return nil, errors.New("apple id_token missing sub claim")
	}
	if expectedNonce != "" && claims.Nonce != expectedNonce {
		return nil, errors.New("apple id_token nonce mismatch")
	}
	// Email can be missing on subsequent sign-ins (Apple only sends it the
	// first time). The caller falls back gracefully when empty.
	return claims, nil
}

// --- Google ID token verification ---

const (
	googleJWKSURL          = "https://www.googleapis.com/oauth2/v3/certs"
	googleIDTokenIssuer    = "https://accounts.google.com"
	googleIDTokenIssuerAlt = "accounts.google.com" // Google sometimes omits scheme
)

// googleIDTokenClaims holds the subset of Google ID token JWT claims we need
// plus the standard claims used for validation (iss, aud, exp).
type googleIDTokenClaims struct {
	jwt.RegisteredClaims
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
}

var (
	googleJWKSOnce     sync.Once
	googleJWKSInstance keyfunc.Keyfunc
	googleJWKSErr      error
)

// googleJWKS returns a cached keyfunc that fetches and periodically refreshes
// Google's JWKS.
func googleJWKS(ctx context.Context) (keyfunc.Keyfunc, error) {
	googleJWKSOnce.Do(func() {
		k, err := keyfunc.NewDefaultCtx(ctx, []string{googleJWKSURL})
		if err != nil {
			googleJWKSErr = fmt.Errorf("load google jwks: %w", err)
			return
		}
		googleJWKSInstance = k
	})
	return googleJWKSInstance, googleJWKSErr
}

// verifyGoogleIDToken validates the signature, issuer, audience, and expiry of
// a Google ID token. Callers MUST NOT trust any claim from a Google ID token
// that has not been through this function.
//
// Google accepts both "https://accounts.google.com" and "accounts.google.com"
// as the issuer (the spec says the former; many of Google's own libraries
// accept the latter for legacy reasons), so we check both.
func verifyGoogleIDToken(ctx context.Context, rawToken string) (*googleIDTokenClaims, error) {
	clientID := strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID"))
	if clientID == "" {
		return nil, errors.New("GOOGLE_CLIENT_ID not configured")
	}

	jwks, err := googleJWKS(ctx)
	if err != nil {
		return nil, err
	}

	claims := &googleIDTokenClaims{}
	token, err := jwt.ParseWithClaims(
		rawToken,
		claims,
		jwks.Keyfunc,
		jwt.WithAudience(clientID),
		jwt.WithValidMethods([]string{"RS256"}),
		// Issuer is checked manually below to support both Google's accepted forms.
	)
	if err != nil {
		return nil, fmt.Errorf("verify google id_token: %w", err)
	}
	if !token.Valid {
		return nil, errors.New("google id_token invalid")
	}
	if claims.Issuer != googleIDTokenIssuer && claims.Issuer != googleIDTokenIssuerAlt {
		return nil, fmt.Errorf("google id_token unexpected issuer: %s", claims.Issuer)
	}
	if claims.Subject == "" {
		return nil, errors.New("google id_token missing sub claim")
	}
	if claims.Email == "" {
		return nil, errors.New("google id_token missing email claim")
	}
	return claims, nil
}

