package handler

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	refreshTokenCookieName = "refresh_token"
	// sessionFlagCookieName is a non-httpOnly sentinel the web client reads to
	// decide whether to attempt a token refresh on mount. Its presence does not
	// authorize anything — the server always validates the real refresh cookie.
	sessionFlagCookieName = "has_session"
)

// AuthHandler handles HTTP auth endpoints by proxying to the User gRPC service.
type AuthHandler struct {
	userClient   userv1.UserServiceClient
	secureCookie bool
	// authMW backs the role-based idle-session timeout (CLAUDE.md §6): it owns
	// the Redis cache client and the JWT decode used to read the refreshed
	// token's userID/roles. nil disables idle tracking/enforcement (fail open).
	authMW *middleware.AuthMiddleware
}

// NewAuthHandler creates a new AuthHandler.
func NewAuthHandler(userClient userv1.UserServiceClient, secureCookie bool) *AuthHandler {
	return &AuthHandler{
		userClient:   userClient,
		secureCookie: secureCookie,
	}
}

// WithIdleSession wires the idle-session timeout (CLAUDE.md §6) into the handler.
// Additive: when not called (e.g. in tests) idle tracking/enforcement is simply
// skipped (fail open). Returns the handler for chaining.
func (h *AuthHandler) WithIdleSession(authMW *middleware.AuthMiddleware) *AuthHandler {
	h.authMW = authMW
	return h
}

type registerRequest struct {
	Email       string   `json:"email"`
	Password    string   `json:"password"`
	DisplayName string   `json:"display_name"`
	Roles       []string `json:"roles"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type logoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type verifyEmailRequest struct {
	Token string `json:"token"`
}

type authResponse struct {
	UserID               string `json:"user_id,omitempty"`
	AccessToken          string `json:"access_token,omitempty"`
	AccessTokenExpiresAt string `json:"access_token_expires_at,omitempty"`
	MFARequired          bool   `json:"mfa_required,omitempty"`
	MFAChallengeToken    string `json:"mfa_challenge_token,omitempty"`
}

// registerPhoneOnlyRequest is the body for the phone-only signup flow.
type registerPhoneOnlyRequest struct {
	Phone   string `json:"phone"`
	OTPCode string `json:"otp_code"`
}

// phoneE164Pattern is a permissive E.164 check: "+" followed by 8-15 digits.
var phoneE164Pattern = regexp.MustCompile(`^\+[1-9]\d{7,14}$`)

// RegisterPhoneOnly creates a user with a placeholder email and
// phone_verified=true once the supplied OTP validates.
//
// Architecture note: phone-only signup currently bridges the legacy
// email-required Register RPC and the SMS OTP verify path by
// synthesizing a placeholder email of the form
// `+15551234567@phone.nomarkup` (RFC-5321 valid; non-routable). The
// user-service treats this as a non-routable email and email_verified
// stays false. Once the user-service exposes a dedicated
// RegisterByPhone RPC (proto change), swap this for a direct call.
//
// Display name defaults to "Member-{last4}" pending profile completion.
// This endpoint MUST remain unauthenticated — there is no session yet.
func (h *AuthHandler) RegisterPhoneOnly(w http.ResponseWriter, r *http.Request) {
	var req registerPhoneOnlyRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	req.Phone = strings.TrimSpace(req.Phone)
	if !phoneE164Pattern.MatchString(req.Phone) {
		writeError(w, http.StatusBadRequest, "phone must be in E.164 format (e.g. +15551234567)")
		return
	}
	if strings.TrimSpace(req.OTPCode) == "" {
		writeError(w, http.StatusBadRequest, "otp_code is required")
		return
	}

	syntheticEmail := req.Phone + "@phone.nomarkup"
	password, err := generatePhonePassword()
	if err != nil {
		slog.Error("register_phone_only: random password generation failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	suffix := req.Phone
	if len(suffix) > 4 {
		suffix = suffix[len(suffix)-4:]
	}
	displayName := "Member-" + suffix

	regResp, err := h.userClient.Register(r.Context(), &userv1.RegisterRequest{
		Email:       syntheticEmail,
		Password:    password,
		DisplayName: displayName,
		Roles:       parseRoles([]string{"customer"}),
	})
	if err != nil {
		if st, ok := status.FromError(err); !ok || st.Code() != codes.AlreadyExists {
			writeGRPCError(w, err)
			return
		}
		writeError(w, http.StatusConflict, "an account with this phone already exists — please sign in")
		return
	}

	if _, err := h.userClient.VerifyPhone(r.Context(), &userv1.VerifyPhoneRequest{
		UserId:  regResp.GetUserId(),
		OtpCode: req.OTPCode,
	}); err != nil {
		writeGRPCError(w, err)
		return
	}

	h.setRefreshTokenCookie(w, regResp.GetRefreshToken())

	writeJSON(w, http.StatusCreated, authResponse{
		UserID:               regResp.GetUserId(),
		AccessToken:          regResp.GetAccessToken(),
		AccessTokenExpiresAt: formatTimestamp(regResp.GetAccessTokenExpiresAt()),
	})
}

// generatePhonePassword returns a 32-byte URL-safe base64 string. The
// user never sees this — phone-only accounts log in via OTP-issued
// tokens or via a password-reset flow tied to phone.
func generatePhonePassword() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// Register handles POST /api/v1/auth/register.
// isStrongPassword applies a basic password-strength check beyond length:
// the password must contain at least one letter AND at least one non-letter
// (digit or symbol). This rejects trivially weak passwords like "12345678"
// or "aaaaaaaa" while keeping mixed passwords such as "Password123!" valid.
func isStrongPassword(pw string) bool {
	hasLetter := false
	hasNonLetter := false
	for _, c := range pw {
		switch {
		case (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'):
			hasLetter = true
		default:
			hasNonLetter = true
		}
	}
	return hasLetter && hasNonLetter
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate email: non-empty and basic format check.
	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" || !strings.Contains(req.Email, "@") || !strings.Contains(req.Email, ".") {
		writeError(w, http.StatusBadRequest, "email must be a valid email address")
		return
	}

	// Validate password: minimum length plus a basic strength check.
	// Length alone (e.g. "12345678") is trivially guessable, so require a
	// mix of character classes rather than letting a numeric-only string pass.
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if !isStrongPassword(req.Password) {
		writeError(w, http.StatusBadRequest, "password must include letters and at least one number or symbol")
		return
	}

	// Sanitize display_name: strip HTML tags to prevent XSS.
	req.DisplayName = stripHTMLTags(req.DisplayName)

	resp, err := h.userClient.Register(r.Context(), &userv1.RegisterRequest{
		Email:       req.Email,
		Password:    req.Password,
		DisplayName: req.DisplayName,
		Roles:       parseRoles(req.Roles),
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	h.setRefreshTokenCookie(w, resp.GetRefreshToken())

	writeJSON(w, http.StatusCreated, authResponse{
		UserID:               resp.GetUserId(),
		AccessToken:          resp.GetAccessToken(),
		AccessTokenExpiresAt: formatTimestamp(resp.GetAccessTokenExpiresAt()),
	})
}

// Login handles POST /api/v1/auth/login.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.userClient.Login(r.Context(), &userv1.LoginRequest{
		Email:      req.Email,
		Password:   req.Password,
		DeviceInfo: r.UserAgent(),
		IpAddress:  extractIP(r),
	})
	if err != nil {
		if st, ok := status.FromError(err); ok && st.Code() == codes.FailedPrecondition && st.Message() == "email not verified" {
			writeError(w, http.StatusForbidden, "Please verify your email before signing in")
			return
		}
		writeGRPCError(w, err)
		return
	}

	if resp.GetRefreshToken() != "" {
		h.setRefreshTokenCookie(w, resp.GetRefreshToken())
	}

	// Seed the idle-session sliding window so a freshly logged-in session has
	// its idle key immediately (CLAUDE.md §6). Only when MFA is NOT pending —
	// an MFA challenge has no real session yet; that path seeds on VerifyMFA's
	// refresh via the normal request flow. Fail-open / no-op without authMW.
	if !resp.GetMfaRequired() {
		h.touchIdleFromAccessToken(r.Context(), resp.GetAccessToken(), resp.GetUserId())
	}

	writeJSON(w, http.StatusOK, authResponse{
		UserID:               resp.GetUserId(),
		AccessToken:          resp.GetAccessToken(),
		AccessTokenExpiresAt: formatTimestamp(resp.GetAccessTokenExpiresAt()),
		MFARequired:          resp.GetMfaRequired(),
		MFAChallengeToken:    resp.GetMfaChallengeToken(),
	})
}

// touchIdleFromAccessToken decodes the given access token to extract the user's
// roles and (re)sets their idle-session key with the role-derived TTL. The
// fallbackUserID is used when the token lacks/fails to yield a subject. It is a
// no-op when idle tracking is not wired (authMW nil) or the cache is down
// (fail open — see middleware.TouchIdleSession).
func (h *AuthHandler) touchIdleFromAccessToken(ctx context.Context, accessToken, fallbackUserID string) {
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

// Refresh handles POST /api/v1/auth/refresh.
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	refreshToken := ""
	if cookie, err := r.Cookie(refreshTokenCookieName); err == nil {
		refreshToken = cookie.Value
	}

	if refreshToken == "" {
		var req refreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			refreshToken = req.RefreshToken
		}
	}

	if refreshToken == "" {
		// Clear any stale has_session sentinel so the client stops retrying.
		h.clearSessionFlagCookie(w)
		writeError(w, http.StatusBadRequest, "refresh token required")
		return
	}

	resp, err := h.userClient.RefreshToken(r.Context(), &userv1.RefreshTokenRequest{
		RefreshToken: refreshToken,
	})
	if err != nil {
		h.clearSessionFlagCookie(w)
		writeGRPCError(w, err)
		return
	}

	// Idle-session enforcement (CLAUDE.md §6). The user-service already rotated
	// the refresh token and minted a new access token. Before we hand them back
	// to the client, check the role-based idle window: if the user has made no
	// authenticated request / WS heartbeat for longer than their role's timeout,
	// their idle key has expired in Redis and we reject the refresh — they must
	// sign in again. The rotated refresh token is acceptable collateral (they
	// re-login). FAIL OPEN: if the cache is down or the token can't be decoded,
	// `ok` is false and we skip enforcement entirely — the idle timeout is a
	// defense-in-depth layer, never the primary gate.
	if h.authMW != nil {
		if userID, roles, decoded := h.decodeAccessToken(resp.GetAccessToken()); decoded {
			if active, ok := h.authMW.IdleSessionActive(r.Context(), userID); ok && !active {
				// Idle past the role window — do NOT set the access cookie or
				// return the new token. Clear the session sentinel so the client
				// stops auto-retrying and routes the user to sign-in.
				h.clearSessionFlagCookie(w)
				slog.InfoContext(r.Context(), "refresh rejected: idle session timed out", "user_id", userID)
				writeError(w, http.StatusUnauthorized, "Your session timed out due to inactivity. Please sign in again.")
				return
			}
			// Active (or fail-open): reset the sliding idle window with the
			// possibly-updated role TTL so the next window starts now.
			h.authMW.TouchIdleSession(r.Context(), userID, roles)
		}
	}

	h.setRefreshTokenCookie(w, resp.GetRefreshToken())

	writeJSON(w, http.StatusOK, authResponse{
		AccessToken:          resp.GetAccessToken(),
		AccessTokenExpiresAt: formatTimestamp(resp.GetAccessTokenExpiresAt()),
	})
}

// decodeAccessToken validates the given access token and returns its userID and
// roles. decoded is false when the token is empty or fails validation — callers
// must then skip idle enforcement (fail open) since they cannot identify the
// session.
func (h *AuthHandler) decodeAccessToken(accessToken string) (userID string, roles []string, decoded bool) {
	if h.authMW == nil || accessToken == "" {
		return "", nil, false
	}
	claims, err := h.authMW.ValidateToken(accessToken)
	if err != nil || claims.UserID == "" {
		return "", nil, false
	}
	return claims.UserID, claims.Roles, true
}

// Logout handles POST /api/v1/auth/logout.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	refreshToken := ""
	if cookie, err := r.Cookie(refreshTokenCookieName); err == nil {
		refreshToken = cookie.Value
	}

	if refreshToken == "" {
		var req logoutRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			refreshToken = req.RefreshToken
		}
	}

	// Logout is best-effort: a token-only client (valid Bearer, no refresh
	// cookie) must still be able to log out. When we DO have a refresh token,
	// revoke it server-side. When we don't, skip the revoke and just clear the
	// client-side cookies — there is nothing to revoke and erroring would trap
	// the client in a logged-in-looking state it can't escape.
	if refreshToken != "" {
		if _, err := h.userClient.Logout(r.Context(), &userv1.LogoutRequest{
			RefreshToken: refreshToken,
		}); err != nil {
			writeGRPCError(w, err)
			return
		}
	}

	http.SetCookie(w, &http.Cookie{
		Name:     refreshTokenCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
	h.clearSessionFlagCookie(w)

	w.WriteHeader(http.StatusNoContent)
}

// VerifyEmail handles POST /api/v1/auth/verify-email.
func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req verifyEmailRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.userClient.VerifyEmail(r.Context(), &userv1.VerifyEmailRequest{
		Token: req.Token,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"verified": resp.GetVerified()})
}

type resendVerificationRequest struct {
	Email string `json:"email"`
}

// ResendVerification handles POST /api/v1/auth/resend-verification.
func (h *AuthHandler) ResendVerification(w http.ResponseWriter, r *http.Request) {
	var req resendVerificationRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	// Call user service to regenerate token and send email.
	_, err := h.userClient.ResendVerification(r.Context(), &userv1.ResendVerificationRequest{
		Email: req.Email,
	})
	if err != nil {
		// Don't reveal whether the email exists.
		slog.Info("resend verification attempted", "email", req.Email, "error", err)
	}

	// Always return success to prevent email enumeration.
	writeJSON(w, http.StatusOK, map[string]string{
		"message": "If an account exists with this email, a verification link has been sent",
	})
}

// --- Phone verification ---

type verifyPhoneRequest struct {
	OTPCode string `json:"otp_code"`
}

// VerifyPhone handles POST /api/v1/auth/verify-phone.
func (h *AuthHandler) VerifyPhone(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req verifyPhoneRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.userClient.VerifyPhone(r.Context(), &userv1.VerifyPhoneRequest{
		UserId:  claims.UserID,
		OtpCode: req.OTPCode,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"verified": resp.GetVerified()})
}

type sendPhoneOTPRequest struct {
	Phone string `json:"phone"`
}

// SendPhoneOTP handles POST /api/v1/auth/send-phone-otp.
func (h *AuthHandler) SendPhoneOTP(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req sendPhoneOTPRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.userClient.SendPhoneOTP(r.Context(), &userv1.SendPhoneOTPRequest{
		UserId: claims.UserID,
		Phone:  req.Phone,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"sent": resp.GetSent()})
}

// --- Password reset ---

type requestPasswordResetRequest struct {
	Email string `json:"email"`
}

// RequestPasswordReset handles POST /api/v1/auth/request-password-reset.
func (h *AuthHandler) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req requestPasswordResetRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	_, err := h.userClient.RequestPasswordReset(r.Context(), &userv1.RequestPasswordResetRequest{
		Email: req.Email,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	// Always return 200 to avoid email enumeration.
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type resetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// ResetPassword handles POST /api/v1/auth/reset-password.
func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.userClient.ResetPassword(r.Context(), &userv1.ResetPasswordRequest{
		Token:       req.Token,
		NewPassword: req.NewPassword,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": resp.GetSuccess()})
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ChangePassword handles POST /api/v1/auth/change-password. This is the
// AUTHENTICATED self-service password change (distinct from the token-driven
// reset-password flow): the route is mounted behind the auth middleware, the
// user is taken from the verified JWT claims (never the body), and the
// current password is required as a re-auth gate (CLAUDE.md §6 — a stolen
// access token alone must not be enough to change the password). The
// user-service rotates all sessions on success.
func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req changePasswordRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if strings.TrimSpace(req.CurrentPassword) == "" {
		writeError(w, http.StatusBadRequest, "current_password is required")
		return
	}
	// Apply the same strength rules as registration so a change can't weaken
	// the account below the signup bar.
	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}
	if !isStrongPassword(req.NewPassword) {
		writeError(w, http.StatusBadRequest, "new password must include letters and at least one number or symbol")
		return
	}
	if req.NewPassword == req.CurrentPassword {
		writeError(w, http.StatusBadRequest, "new password must be different from your current password")
		return
	}

	resp, err := h.userClient.ChangePassword(r.Context(), &userv1.ChangePasswordRequest{
		UserId:          claims.UserID,
		CurrentPassword: req.CurrentPassword,
		NewPassword:     req.NewPassword,
	})
	if err != nil {
		// A wrong current password comes back as Unauthenticated from the
		// service; surface it as a 401 with an intuitive message rather than a
		// generic 500 (CLAUDE.md §15 — a predictable condition is never a 500).
		if st, ok := status.FromError(err); ok && st.Code() == codes.Unauthenticated {
			writeError(w, http.StatusUnauthorized, "Current password is incorrect")
			return
		}
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": resp.GetSuccess()})
}

// --- MFA ---

// EnableMFA handles POST /api/v1/auth/mfa/enable.
func (h *AuthHandler) EnableMFA(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.userClient.EnableMFA(r.Context(), &userv1.EnableMFARequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"secret":       resp.GetSecret(),
		"qr_code_url":  resp.GetQrCodeUrl(),
		"backup_codes": resp.GetBackupCodes(),
	})
}

type confirmMFASetupRequest struct {
	TOTPCode    string   `json:"totp_code"`
	BackupCodes []string `json:"backup_codes"`
}

// ConfirmMFASetup handles POST /api/v1/auth/mfa/verify-setup.
func (h *AuthHandler) ConfirmMFASetup(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req confirmMFASetupRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.userClient.ConfirmMFASetup(r.Context(), &userv1.ConfirmMFASetupRequest{
		UserId:      claims.UserID,
		TotpCode:    req.TOTPCode,
		BackupCodes: req.BackupCodes,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": resp.GetSuccess()})
}

type verifyMFARequest struct {
	MFAChallengeToken string `json:"mfa_challenge_token"`
	TOTPCode          string `json:"totp_code"`
}

// VerifyMFA handles POST /api/v1/auth/mfa/verify.
func (h *AuthHandler) VerifyMFA(w http.ResponseWriter, r *http.Request) {
	var req verifyMFARequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.userClient.VerifyMFA(r.Context(), &userv1.VerifyMFARequest{
		MfaChallengeToken: req.MFAChallengeToken,
		TotpCode:          req.TOTPCode,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	if resp.GetRefreshToken() != "" {
		h.setRefreshTokenCookie(w, resp.GetRefreshToken())
	}

	writeJSON(w, http.StatusOK, authResponse{
		AccessToken:          resp.GetAccessToken(),
		AccessTokenExpiresAt: formatTimestamp(resp.GetAccessTokenExpiresAt()),
	})
}

type disableMFARequest struct {
	TOTPCode string `json:"totp_code"`
}

// DisableMFA handles DELETE /api/v1/auth/mfa/disable.
func (h *AuthHandler) DisableMFA(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req disableMFARequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.userClient.DisableMFA(r.Context(), &userv1.DisableMFARequest{
		UserId:   claims.UserID,
		TotpCode: req.TOTPCode,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"success": resp.GetSuccess()})
}

func (h *AuthHandler) setRefreshTokenCookie(w http.ResponseWriter, token string) {
	maxAge := 7 * 24 * 60 * 60
	http.SetCookie(w, &http.Cookie{
		Name:     refreshTokenCookieName,
		Value:    token,
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
	h.setSessionFlagCookie(w, maxAge)
}

func (h *AuthHandler) setSessionFlagCookie(w http.ResponseWriter, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionFlagCookieName,
		Value:    "1",
		Path:     "/",
		HttpOnly: false,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

func (h *AuthHandler) clearSessionFlagCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionFlagCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: false,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func parseRoles(roles []string) []commonv1.UserRole {
	result := make([]commonv1.UserRole, 0, len(roles))
	for _, r := range roles {
		switch r {
		case "customer":
			result = append(result, commonv1.UserRole_USER_ROLE_CUSTOMER)
		case "provider":
			result = append(result, commonv1.UserRole_USER_ROLE_PROVIDER)
		// "admin" intentionally excluded — self-registration cannot grant admin role.
		}
	}
	return result
}

// writeJSON, writeError, writeGRPCError are defined in response.go

// extractIP returns the best-effort client IP, honoring trusted-proxy headers
// only when the direct peer is a trusted proxy per middleware.ClientIP.
func extractIP(r *http.Request) string {
	return middleware.ClientIP(r)
}

func formatTimestamp(ts *timestamppb.Timestamp) string {
	if ts == nil {
		return ""
	}
	return ts.AsTime().Format("2006-01-02T15:04:05Z")
}

// htmlTagPattern matches HTML/XML tags for sanitization.
var htmlTagPattern = regexp.MustCompile(`<[^>]*>`)

// stripHTMLTags removes all HTML tags from a string.
func stripHTMLTags(s string) string {
	return strings.TrimSpace(htmlTagPattern.ReplaceAllString(s, ""))
}
