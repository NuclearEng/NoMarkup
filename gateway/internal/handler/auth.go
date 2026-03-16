package handler

import (
	"encoding/json"
	"net"
	"net/http"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const refreshTokenCookieName = "refresh_token"

// AuthHandler handles HTTP auth endpoints by proxying to the User gRPC service.
type AuthHandler struct {
	userClient   userv1.UserServiceClient
	secureCookie bool
}

// NewAuthHandler creates a new AuthHandler.
func NewAuthHandler(userClient userv1.UserServiceClient, secureCookie bool) *AuthHandler {
	return &AuthHandler{
		userClient:   userClient,
		secureCookie: secureCookie,
	}
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
}

// Register handles POST /api/v1/auth/register.
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	resp, err := h.userClient.Login(r.Context(), &userv1.LoginRequest{
		Email:      req.Email,
		Password:   req.Password,
		DeviceInfo: r.UserAgent(),
		IpAddress:  extractIP(r),
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	if resp.GetRefreshToken() != "" {
		h.setRefreshTokenCookie(w, resp.GetRefreshToken())
	}

	writeJSON(w, http.StatusOK, authResponse{
		UserID:               resp.GetUserId(),
		AccessToken:          resp.GetAccessToken(),
		AccessTokenExpiresAt: formatTimestamp(resp.GetAccessTokenExpiresAt()),
		MFARequired:          resp.GetMfaRequired(),
	})
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
		writeError(w, http.StatusBadRequest, "refresh token required")
		return
	}

	resp, err := h.userClient.RefreshToken(r.Context(), &userv1.RefreshTokenRequest{
		RefreshToken: refreshToken,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	h.setRefreshTokenCookie(w, resp.GetRefreshToken())

	writeJSON(w, http.StatusOK, authResponse{
		AccessToken:          resp.GetAccessToken(),
		AccessTokenExpiresAt: formatTimestamp(resp.GetAccessTokenExpiresAt()),
	})
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

	if refreshToken == "" {
		writeError(w, http.StatusBadRequest, "refresh token required")
		return
	}

	_, err := h.userClient.Logout(r.Context(), &userv1.LogoutRequest{
		RefreshToken: refreshToken,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
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

	w.WriteHeader(http.StatusNoContent)
}

// VerifyEmail handles POST /api/v1/auth/verify-email.
func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req verifyEmailRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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

type verifyMFARequest struct {
	MFAChallengeToken string `json:"mfa_challenge_token"`
	TOTPCode          string `json:"totp_code"`
}

// VerifyMFA handles POST /api/v1/auth/mfa/verify.
func (h *AuthHandler) VerifyMFA(w http.ResponseWriter, r *http.Request) {
	var req verifyMFARequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	http.SetCookie(w, &http.Cookie{
		Name:     refreshTokenCookieName,
		Value:    token,
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   7 * 24 * 60 * 60,
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
		case "admin":
			result = append(result, commonv1.UserRole_USER_ROLE_ADMIN)
		}
	}
	return result
}

// writeJSON, writeError, writeGRPCError are defined in response.go

func extractIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		for i := 0; i < len(forwarded); i++ {
			if forwarded[i] == ',' {
				return forwarded[:i]
			}
		}
		return forwarded
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	// Use net.SplitHostPort to correctly handle IPv6 addresses like [::1]:port.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func formatTimestamp(ts *timestamppb.Timestamp) string {
	if ts == nil {
		return ""
	}
	return ts.AsTime().Format("2006-01-02T15:04:05Z")
}
