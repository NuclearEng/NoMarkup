package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
		SameSite: http.SameSiteStrictMode,
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

func (h *AuthHandler) setRefreshTokenCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshTokenCookieName,
		Value:    token,
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteStrictMode,
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

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to encode response", "error", err)
	}
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func writeGRPCError(w http.ResponseWriter, err error) {
	st, ok := status.FromError(err)
	if !ok {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	switch st.Code() {
	case codes.AlreadyExists:
		writeError(w, http.StatusConflict, st.Message())
	case codes.Unauthenticated:
		writeError(w, http.StatusUnauthorized, st.Message())
	case codes.NotFound:
		writeError(w, http.StatusNotFound, st.Message())
	case codes.PermissionDenied:
		writeError(w, http.StatusForbidden, st.Message())
	case codes.InvalidArgument:
		writeError(w, http.StatusBadRequest, st.Message())
	default:
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}

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
	// Strip port from RemoteAddr.
	addr := r.RemoteAddr
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			return addr[:i]
		}
	}
	return addr
}

func formatTimestamp(ts *timestamppb.Timestamp) string {
	if ts == nil {
		return ""
	}
	return ts.AsTime().Format("2006-01-02T15:04:05Z")
}
