package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// UserHandler handles HTTP endpoints for user profiles.
type UserHandler struct {
	userClient userv1.UserServiceClient
}

// NewUserHandler creates a new UserHandler.
func NewUserHandler(userClient userv1.UserServiceClient) *UserHandler {
	return &UserHandler{userClient: userClient}
}

type updateUserRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	Phone       *string `json:"phone,omitempty"`
	AvatarURL   *string `json:"avatar_url,omitempty"`
	Timezone    *string `json:"timezone,omitempty"`
}

type enableRoleRequest struct {
	Role string `json:"role"`
}

// GetMe handles GET /api/v1/users/me.
func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.userClient.GetUser(r.Context(), &userv1.GetUserRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoUserToJSON(resp.GetUser()))
}

// UpdateMe handles PATCH /api/v1/users/me.
func (h *UserHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req updateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	grpcReq := &userv1.UpdateUserRequest{
		UserId:      claims.UserID,
		DisplayName: req.DisplayName,
		Phone:       req.Phone,
		AvatarUrl:   req.AvatarURL,
		Timezone:    req.Timezone,
	}

	resp, err := h.userClient.UpdateUser(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoUserToJSON(resp.GetUser()))
}

// EnableRole handles POST /api/v1/users/me/roles.
func (h *UserHandler) EnableRole(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req enableRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	role := parseUserRole(req.Role)
	if role == commonv1.UserRole_USER_ROLE_UNSPECIFIED {
		writeError(w, http.StatusBadRequest, "invalid role")
		return
	}

	resp, err := h.userClient.EnableRole(r.Context(), &userv1.EnableRoleRequest{
		UserId: claims.UserID,
		Role:   role,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoUserToJSON(resp.GetUser()))
}

// GetUser handles GET /api/v1/users/{id}.
func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	resp, err := h.userClient.GetUser(r.Context(), &userv1.GetUserRequest{
		UserId: userID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoUserToJSON(resp.GetUser()))
}

func parseUserRole(r string) commonv1.UserRole {
	switch r {
	case "customer":
		return commonv1.UserRole_USER_ROLE_CUSTOMER
	case "provider":
		return commonv1.UserRole_USER_ROLE_PROVIDER
	case "admin":
		return commonv1.UserRole_USER_ROLE_ADMIN
	default:
		return commonv1.UserRole_USER_ROLE_UNSPECIFIED
	}
}

func protoUserToJSON(u *userv1.User) map[string]interface{} {
	if u == nil {
		return nil
	}
	roles := make([]string, 0, len(u.GetRoles()))
	for _, r := range u.GetRoles() {
		if r != commonv1.UserRole_USER_ROLE_UNSPECIFIED {
			roles = append(roles, protoRoleString(r))
		}
	}
	result := map[string]interface{}{
		"id":             u.GetId(),
		"email":          u.GetEmail(),
		"email_verified": u.GetEmailVerified(),
		"phone":          u.GetPhone(),
		"phone_verified": u.GetPhoneVerified(),
		"display_name":   u.GetDisplayName(),
		"avatar_url":     u.GetAvatarUrl(),
		"roles":          roles,
		"status":         protoUserStatusString(u.GetStatus()),
		"mfa_enabled":    u.GetMfaEnabled(),
		"created_at":     formatTimestamp(u.GetCreatedAt()),
	}
	if u.GetLastActiveAt() != nil {
		result["last_active_at"] = formatTimestamp(u.GetLastActiveAt())
	}
	return result
}

func protoRoleString(r commonv1.UserRole) string {
	switch r {
	case commonv1.UserRole_USER_ROLE_CUSTOMER:
		return "customer"
	case commonv1.UserRole_USER_ROLE_PROVIDER:
		return "provider"
	case commonv1.UserRole_USER_ROLE_ADMIN:
		return "admin"
	default:
		return "unknown"
	}
}

func protoUserStatusString(s commonv1.UserStatus) string {
	switch s {
	case commonv1.UserStatus_USER_STATUS_ACTIVE:
		return "active"
	case commonv1.UserStatus_USER_STATUS_SUSPENDED:
		return "suspended"
	case commonv1.UserStatus_USER_STATUS_BANNED:
		return "banned"
	case commonv1.UserStatus_USER_STATUS_DEACTIVATED:
		return "deactivated"
	default:
		return "unknown"
	}
}
