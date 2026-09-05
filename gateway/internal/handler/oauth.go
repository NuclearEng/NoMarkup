package handler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	keyfunc "github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"github.com/nomarkup/nomarkup/gateway/internal/sessionflag"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	oauthStateCookieName   = "oauth_state"
	oauthStateCookieMaxAge = 600 // 10 minutes
	oauthNextCookieName    = "oauth_next"
	oauthNextCookieMaxAge  = 600
)

// safeOAuthNext returns a same-origin relative path, or "" if raw is empty or unsafe.
func safeOAuthNext(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.Contains(raw, "://") {
		return ""
	}
	return raw
}

func oauthNextFromQuery(r *http.Request) string {
	if next := safeOAuthNext(r.URL.Query().Get("next")); next != "" {
		return next
	}
	return safeOAuthNext(r.URL.Query().Get("returnTo"))
}

func oauthNextFromCookie(r *http.Request) string {
	c, err := r.Cookie(oauthNextCookieName)
	if err != nil {
		return ""
	}
	return safeOAuthNext(c.Value)
}

func (h *OAuthHandler) setOAuthNextCookie(w http.ResponseWriter, r *http.Request) {
	next := oauthNextFromQuery(r)
	if next == "" {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthNextCookieName,
		Value:    next,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   oauthNextCookieMaxAge,
	})
}

func (h *OAuthHandler) clearOAuthNextCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     oauthNextCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// OAuthHandler handles OAuth authentication flows.
type OAuthHandler struct {
	userClient    userv1.UserServiceClient
	secureCookie  bool
	sessionSecret []byte
	frontendURL   string
	authMW        *middleware.AuthMiddleware
}

// NewOAuthHandler creates a new OAuthHandler.
// sessionSecret signs the has_session soft-gate cookie (SEC-07); see AuthHandler.
func NewOAuthHandler(userClient userv1.UserServiceClient, secureCookie bool, sessionSecret string) *OAuthHandler {
	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		frontendURL = "http://localhost:3000"
	}
	return &OAuthHandler{
		userClient:    userClient,
		secureCookie:  secureCookie,
		sessionSecret: []byte(sessionSecret),
		frontendURL:   frontendURL,
	}
}

// WithIdleSession wires idle-session seeding on OAuth success (same contract as
// AuthHandler.completeSessionLogin). Additive; nil leaves seeding skipped.
func (h *OAuthHandler) WithIdleSession(authMW *middleware.AuthMiddleware) *OAuthHandler {
	h.authMW = authMW
	return h
}

func (h *OAuthHandler) seedIdleSession(ctx context.Context, accessToken, fallbackUserID string) {
	if h.authMW == nil {
		return
	}
	userID := fallbackUserID
	var roles []string
	if accessToken != "" {
		if claims, err := h.authMW.ValidateToken(accessToken); err == nil {
			if claims.UserID != "" {
				userID = claims.UserID
			}
			roles = claims.Roles
		}
	}
	h.authMW.TouchIdleSession(ctx, userID, roles)
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
// When GOOGLE_CLIENT_ID is unset we redirect to /login?error=google_not_configured
// rather than sending the browser to Google with an empty client_id (which
// surfaces Google's "Missing required parameter: client_id" 400 page).
func (h *OAuthHandler) InitGoogleOAuth(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")) == "" {
		http.Redirect(w, r, h.frontendURL+"/login?error=google_not_configured", http.StatusTemporaryRedirect)
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
		if h.writeOAuthMFARedirect(w, r, err) {
			return
		}
		slog.Error("failed to find or create oauth user", "provider", "google", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=auth_failed", http.StatusTemporaryRedirect)
		return
	}

	h.completeOAuthLogin(w, r, result)
}

// InitAppleOAuth redirects the user to Apple's OAuth consent page.
// When APPLE_CLIENT_ID is unset we redirect to /login?error=apple_not_configured
// rather than sending the browser to Apple with an empty client_id.
func (h *OAuthHandler) InitAppleOAuth(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(os.Getenv("APPLE_CLIENT_ID")) == "" {
		http.Redirect(w, r, h.frontendURL+"/login?error=apple_not_configured", http.StatusTemporaryRedirect)
		return
	}

	h.setOAuthNextCookie(w, r)

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
		if h.writeOAuthMFARedirect(w, r, err) {
			return
		}
		slog.Error("failed to find or create oauth user", "provider", "apple", "error", err)
		http.Redirect(w, r, h.frontendURL+"/login?error=auth_failed", http.StatusTemporaryRedirect)
		return
	}

	h.completeOAuthLogin(w, r, result)
}

// completeOAuthLogin sets the refresh token cookie and redirects to the frontend.
func (h *OAuthHandler) completeOAuthLogin(w http.ResponseWriter, r *http.Request, result *userv1.FindOrCreateByOAuthResponse) {
	h.seedIdleSession(r.Context(), result.GetAccessToken(), result.GetUserId())
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
	if flag, err := sessionflag.SignWithMaxAge(h.sessionSecret, result.GetUserId(), refreshMaxAge); err != nil {
		slog.Warn("has_session cookie not issued on oauth login: sign failed", "error", err)
	} else {
		http.SetCookie(w, &http.Cookie{
			Name:     sessionFlagCookieName,
			Value:    flag,
			Path:     "/",
			HttpOnly: false,
			Secure:   h.secureCookie,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   refreshMaxAge,
		})
	}

	// Redirect to the frontend with the access token as a fragment (not query param)
	// to avoid it being logged in server access logs.
	redirectPath := "/dashboard"
	if result.GetIsNewUser() {
		redirectPath = "/onboarding"
	} else if next := oauthNextFromCookie(r); next != "" {
		redirectPath = next
	}
	h.clearOAuthNextCookie(w)

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

// appleKeyfuncProvider indirects appleJWKS so tests can substitute a locally
// generated JWKS instead of fetching Apple's over the network. Production
// always uses appleJWKS.
var appleKeyfuncProvider = appleJWKS

// sha256Hex returns the lowercase hex encoding of SHA-256(s) — the exact
// transformation AuthenticationServices clients apply to the raw SIWA nonce
// before placing it in ASAuthorizationAppleIDRequest.nonce, and therefore the
// exact value Apple embeds in the id_token `nonce` claim.
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// appleAudienceClientIDs returns allowed id_token `aud` values.
// Web SIWA uses APPLE_CLIENT_ID (Services ID). Native SIWA uses the app bundle
// id via APPLE_NATIVE_CLIENT_ID (or APPLE_CLIENT_ID when they share one).
func appleAudienceClientIDs() []string {
	seen := map[string]struct{}{}
	var out []string
	for _, raw := range []string{
		os.Getenv("APPLE_CLIENT_ID"),
		os.Getenv("APPLE_NATIVE_CLIENT_ID"),
	} {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// verifyAppleIDToken validates the signature, issuer, audience, and expiry of
// an Apple ID token. It fetches Apple's JWKS (cached + auto-refreshed) and
// validates `kid` + RS256 signature. On any validation failure it returns an
// error — callers MUST NOT trust any claim from an Apple ID token that has
// not been through this function.
//
// If expectedNonce is non-empty, the nonce claim on the token must match
// (binds the token to the original authorization request). Callers hold the
// RAW client nonce and must pass sha256Hex(raw) here, because Apple embeds the
// HASHED nonce the client put on the authorization request — never compare the
// claim against a client-supplied value directly (IOS-SEC.1: a client sending
// the hash would make the check a tautology). Pass "" to skip (legacy web
// redirect flow, which has no nonce).
func verifyAppleIDToken(ctx context.Context, rawToken, expectedNonce string) (*appleIDTokenClaims, error) {
	audiences := appleAudienceClientIDs()
	if len(audiences) == 0 {
		return nil, errors.New("APPLE_CLIENT_ID not configured")
	}

	jwks, err := appleKeyfuncProvider(ctx)
	if err != nil {
		return nil, err
	}

	var lastErr error
	for _, clientID := range audiences {
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
			lastErr = err
			continue
		}
		if !token.Valid {
			lastErr = errors.New("apple id_token invalid")
			continue
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
	if lastErr != nil {
		return nil, fmt.Errorf("verify apple id_token: %w", lastErr)
	}
	return nil, errors.New("apple id_token audience mismatch")
}

// nativeAppleSignInRequest is the body for POST /api/v1/auth/apple/native
// (AuthenticationServices identityToken exchange).
type nativeAppleSignInRequest struct {
	IdentityToken string `json:"identity_token"`
	// FullName is optional — Apple only provides it on first authorization.
	FullName string `json:"full_name"`
	// Nonce is the RAW nonce the client generated for this sign-in attempt
	// (the client puts SHA256hex(nonce) on the ASAuthorization request, so
	// the id_token carries the hash). REQUIRED on the native exchange
	// (IOS-SEC.1): without it a captured Apple id_token could be replayed
	// against this endpoint from any device.
	Nonce string `json:"nonce"`
}

// NativeAppleSignIn exchanges a Sign in with Apple identity token from a
// native iOS client for the standard access/refresh token pair (JSON, not
// cookies/redirect). Used by Stage B1 AuthenticationServices.
func (h *OAuthHandler) NativeAppleSignIn(w http.ResponseWriter, r *http.Request) {
	var req nativeAppleSignInRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	idToken := strings.TrimSpace(req.IdentityToken)
	if idToken == "" {
		writeError(w, http.StatusBadRequest, "identity_token is required")
		return
	}

	// IOS-SEC.1: the native exchange REQUIRES the raw nonce. The client sends
	// the raw value; Apple's id_token carries SHA256hex(raw) in its nonce
	// claim, so we re-hash server-side before comparing. Comparing the
	// client's value verbatim would let the client send the hash it read out
	// of the token itself — a tautology with no replay binding. The web
	// redirect flow (AppleOAuthCallback) legitimately has no nonce and is
	// unaffected; the requirement is scoped to this handler.
	rawNonce := strings.TrimSpace(req.Nonce)
	if rawNonce == "" {
		writeError(w, http.StatusBadRequest, "nonce is required: send the raw nonce generated for this Sign in with Apple attempt")
		return
	}

	claims, err := verifyAppleIDToken(r.Context(), idToken, sha256Hex(rawNonce))
	if err != nil {
		slog.Warn("native apple sign-in: id_token verification failed",
			"error", err,
			"code", "oauth_invalid_signature",
		)
		writeError(w, http.StatusUnauthorized, "invalid apple identity token")
		return
	}

	name := strings.TrimSpace(req.FullName)
	if name == "" {
		name = claims.Email
		for i := 0; i < len(name); i++ {
			if name[i] == '@' {
				name = name[:i]
				break
			}
		}
	}

	result, err := h.userClient.FindOrCreateByOAuth(r.Context(), &userv1.FindOrCreateByOAuthRequest{
		Provider:   "apple",
		ProviderId: claims.Subject,
		Email:      claims.Email,
		Name:       name,
		AvatarUrl:  "",
	})
	if err != nil {
		if writeOAuthMFAJSON(w, err) {
			return
		}
		slog.Error("native apple sign-in: find or create user failed", "error", err)
		writeGRPCError(w, err)
		return
	}

	// Mobile clients need the refresh token in the JSON body (no cookie jar
	// reliance). Still set cookies for any hybrid webview callers.
	h.completeOAuthLoginJSON(w, r, result)
}

// completeOAuthLoginJSON returns the token pair as JSON (native clients).
func (h *OAuthHandler) completeOAuthLoginJSON(w http.ResponseWriter, r *http.Request, result *userv1.FindOrCreateByOAuthResponse) {
	h.seedIdleSession(r.Context(), result.GetAccessToken(), result.GetUserId())
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

	expiresAt := ""
	if result.GetAccessTokenExpiresAt() != nil {
		expiresAt = result.GetAccessTokenExpiresAt().AsTime().UTC().Format(time.RFC3339)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"access_token":            result.GetAccessToken(),
		"refresh_token":           result.GetRefreshToken(),
		"access_token_expires_at": expiresAt,
		"is_new_user":             result.GetIsNewUser(),
		"user_id":                 result.GetUserId(),
	})
}

func oauthMFAFromError(err error) *userv1.LoginResponse {
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.FailedPrecondition {
		return nil
	}
	for _, d := range st.Details() {
		lr, ok := d.(*userv1.LoginResponse)
		if ok && lr.GetMfaRequired() {
			return lr
		}
	}
	return nil
}

func writeOAuthMFAJSON(w http.ResponseWriter, err error) bool {
	lr := oauthMFAFromError(err)
	if lr == nil {
		return false
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user_id":             lr.GetUserId(),
		"mfa_required":        true,
		"mfa_challenge_token": lr.GetMfaChallengeToken(),
	})
	return true
}

func (h *OAuthHandler) writeOAuthMFARedirect(w http.ResponseWriter, r *http.Request, err error) bool {
	lr := oauthMFAFromError(err)
	if lr == nil {
		return false
	}
	// Cookie, not query: the challenge is a bearer secret and must not land in
	// access logs. Same 60s JS-readable pattern as oauth_access_token.
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_mfa_challenge",
		Value:    lr.GetMfaChallengeToken(),
		Path:     "/",
		HttpOnly: false,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   60,
	})
	loginURL := h.frontendURL + "/login"
	if next := oauthNextFromCookie(r); next != "" {
		loginURL += "?next=" + url.QueryEscape(next)
	}
	http.Redirect(w, r, loginURL, http.StatusTemporaryRedirect)
	return true
}

// nativeGoogleSignInRequest is the body for POST /api/v1/auth/google/native
// (ASWebAuthenticationSession / AppAuth id_token exchange — not Google SDK).
type nativeGoogleSignInRequest struct {
	IdentityToken string `json:"identity_token"`
	// FullName is optional; when empty we use the id_token `name` claim.
	FullName string `json:"full_name"`
}

// NativeGoogleSignIn exchanges a Google OIDC id_token from a native iOS client
// for the standard access/refresh token pair (JSON). The client obtains the
// id_token via Authorization Code + PKCE (ASWebAuthenticationSession), never
// via fabricated/self-signed tokens. Signature, aud, iss, and exp are verified
// against Google's JWKS (same path as the web callback).
func (h *OAuthHandler) NativeGoogleSignIn(w http.ResponseWriter, r *http.Request) {
	var req nativeGoogleSignInRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	idToken := strings.TrimSpace(req.IdentityToken)
	if idToken == "" {
		writeError(w, http.StatusBadRequest, "identity_token is required")
		return
	}

	claims, err := verifyGoogleIDToken(r.Context(), idToken)
	if err != nil {
		slog.Warn("native google sign-in: id_token verification failed",
			"error", err,
			"code", "oauth_invalid_signature",
		)
		writeError(w, http.StatusUnauthorized, "invalid google identity token")
		return
	}

	if !claims.EmailVerified {
		slog.Warn("native google sign-in: email not verified", "email", claims.Email)
		writeError(w, http.StatusUnauthorized, "google email is not verified")
		return
	}

	name := strings.TrimSpace(req.FullName)
	if name == "" {
		name = strings.TrimSpace(claims.Name)
	}
	if name == "" {
		name = claims.Email
		for i := 0; i < len(name); i++ {
			if name[i] == '@' {
				name = name[:i]
				break
			}
		}
	}

	result, err := h.userClient.FindOrCreateByOAuth(r.Context(), &userv1.FindOrCreateByOAuthRequest{
		Provider:   "google",
		ProviderId: claims.Subject,
		Email:      claims.Email,
		Name:       name,
		AvatarUrl:  claims.Picture,
	})
	if err != nil {
		if writeOAuthMFAJSON(w, err) {
			return
		}
		slog.Error("native google sign-in: find or create user failed", "error", err)
		writeGRPCError(w, err)
		return
	}

	h.completeOAuthLoginJSON(w, r, result)
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
	Name          string `json:"name"`
	Picture       string `json:"picture"`
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

// googleAudienceClientIDs returns allowed id_token `aud` values.
// Web OAuth uses GOOGLE_CLIENT_ID. Native iOS ASWebAuthenticationSession /
// AppAuth uses GOOGLE_IOS_CLIENT_ID (iOS OAuth client in Google Cloud Console).
// When only one is set, both web and native must share that audience.
func googleAudienceClientIDs() []string {
	seen := map[string]struct{}{}
	var out []string
	for _, raw := range []string{
		os.Getenv("GOOGLE_CLIENT_ID"),
		os.Getenv("GOOGLE_IOS_CLIENT_ID"),
	} {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// verifyGoogleIDToken validates the signature, issuer, audience, and expiry of
// a Google ID token. Callers MUST NOT trust any claim from a Google ID token
// that has not been through this function.
//
// Google accepts both "https://accounts.google.com" and "accounts.google.com"
// as the issuer (the spec says the former; many of Google's own libraries
// accept the latter for legacy reasons), so we check both. Audience may be the
// web client ID and/or the iOS client ID.
func verifyGoogleIDToken(ctx context.Context, rawToken string) (*googleIDTokenClaims, error) {
	audiences := googleAudienceClientIDs()
	if len(audiences) == 0 {
		return nil, errors.New("GOOGLE_CLIENT_ID not configured")
	}

	jwks, err := googleJWKS(ctx)
	if err != nil {
		return nil, err
	}

	var lastErr error
	for _, clientID := range audiences {
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
			lastErr = err
			continue
		}
		if !token.Valid {
			lastErr = errors.New("google id_token invalid")
			continue
		}
		if claims.Issuer != googleIDTokenIssuer && claims.Issuer != googleIDTokenIssuerAlt {
			lastErr = fmt.Errorf("google id_token unexpected issuer: %s", claims.Issuer)
			continue
		}
		if claims.Subject == "" {
			return nil, errors.New("google id_token missing sub claim")
		}
		if claims.Email == "" {
			return nil, errors.New("google id_token missing email claim")
		}
		return claims, nil
	}
	if lastErr != nil {
		return nil, fmt.Errorf("verify google id_token: %w", lastErr)
	}
	return nil, errors.New("google id_token audience mismatch")
}
