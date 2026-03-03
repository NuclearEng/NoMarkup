package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminUsersHandler handles admin user management endpoints.
type AdminUsersHandler struct {
	userClient userv1.UserServiceClient
}

// NewAdminUsersHandler creates a new AdminUsersHandler.
func NewAdminUsersHandler(userClient userv1.UserServiceClient) *AdminUsersHandler {
	return &AdminUsersHandler{userClient: userClient}
}

// SearchUsers handles GET /api/v1/admin/users.
// Query params: query, status, role, page, page_size.
func (h *AdminUsersHandler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &userv1.AdminSearchUsersRequest{}

	grpcReq.Query = q.Get("query")

	// Parse optional status filter.
	if s := q.Get("status"); s != "" {
		status := parseUserStatus(s)
		if status != commonv1.UserStatus_USER_STATUS_UNSPECIFIED {
			grpcReq.StatusFilter = &status
		}
	}

	// Parse optional role filter.
	if rl := q.Get("role"); rl != "" {
		role := parseAdminUserRole(rl)
		if role != commonv1.UserRole_USER_ROLE_UNSPECIFIED {
			grpcReq.RoleFilter = &role
		}
	}

	// Parse pagination.
	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 {
			pageSize = int32(v)
		}
	}
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     page,
		PageSize: pageSize,
	}

	resp, err := h.userClient.AdminSearchUsers(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	users := make([]map[string]interface{}, 0, len(resp.GetUsers()))
	for _, u := range resp.GetUsers() {
		users = append(users, adminUserToJSON(u))
	}

	result := map[string]interface{}{
		"users": users,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

// GetUser handles GET /api/v1/admin/users/{id}.
func (h *AdminUsersHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	resp, err := h.userClient.AdminGetUser(r.Context(), &userv1.AdminGetUserRequest{
		UserId: userID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := map[string]interface{}{
		"user": adminUserToJSON(resp.GetUser()),
	}
	if pp := resp.GetProviderProfile(); pp != nil {
		result["provider_profile"] = map[string]interface{}{
			"id":                pp.GetId(),
			"business_name":    pp.GetBusinessName(),
			"bio":              pp.GetBio(),
			"jobs_completed":   pp.GetJobsCompleted(),
			"instant_enabled":  pp.GetInstantEnabled(),
		}
	}
	if resp.GetTrustScore() != nil {
		result["trust_score"] = map[string]interface{}{
			"overall_score": resp.GetTrustScore().GetOverallScore(),
			"tier":          resp.GetTrustScore().GetTier(),
		}
	}
	if docs := resp.GetDocuments(); len(docs) > 0 {
		docList := make([]map[string]interface{}, 0, len(docs))
		for _, d := range docs {
			docList = append(docList, map[string]interface{}{
				"document_type": d.GetDocumentType(),
				"status":        d.GetStatus().String(),
			})
		}
		result["documents"] = docList
	}

	writeJSON(w, http.StatusOK, result)
}

// SuspendUser handles POST /api/v1/admin/users/{id}/suspend.
func (h *AdminUsersHandler) SuspendUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason is required")
		return
	}

	resp, err := h.userClient.AdminSuspendUser(r.Context(), &userv1.AdminSuspendUserRequest{
		UserId:  userID,
		Reason:  body.Reason,
		AdminId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": adminUserToJSON(resp.GetUser()),
	})
}

// BanUser handles POST /api/v1/admin/users/{id}/ban.
func (h *AdminUsersHandler) BanUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason is required")
		return
	}

	resp, err := h.userClient.AdminBanUser(r.Context(), &userv1.AdminBanUserRequest{
		UserId:  userID,
		Reason:  body.Reason,
		AdminId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": adminUserToJSON(resp.GetUser()),
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func adminUserToJSON(u *userv1.User) map[string]interface{} {
	if u == nil {
		return map[string]interface{}{}
	}

	roles := make([]string, 0, len(u.GetRoles()))
	for _, r := range u.GetRoles() {
		roles = append(roles, r.String())
	}

	result := map[string]interface{}{
		"id":           u.GetId(),
		"email":        u.GetEmail(),
		"display_name": u.GetDisplayName(),
		"phone":        u.GetPhone(),
		"status":       u.GetStatus().String(),
		"roles":        roles,
		"avatar_url":   u.GetAvatarUrl(),
		"created_at":   formatTimestamp(u.GetCreatedAt()),
	}
	if u.GetLastActiveAt() != nil {
		result["last_active_at"] = formatTimestamp(u.GetLastActiveAt())
	}
	return result
}

func parseUserStatus(s string) commonv1.UserStatus {
	switch s {
	case "active":
		return commonv1.UserStatus_USER_STATUS_ACTIVE
	case "suspended":
		return commonv1.UserStatus_USER_STATUS_SUSPENDED
	case "banned":
		return commonv1.UserStatus_USER_STATUS_BANNED
	case "deactivated":
		return commonv1.UserStatus_USER_STATUS_DEACTIVATED
	default:
		return commonv1.UserStatus_USER_STATUS_UNSPECIFIED
	}
}

func parseAdminUserRole(s string) commonv1.UserRole {
	switch s {
	case "customer":
		return commonv1.UserRole_USER_ROLE_CUSTOMER
	case "provider":
		return commonv1.UserRole_USER_ROLE_PROVIDER
	case "admin":
		return commonv1.UserRole_USER_ROLE_ADMIN
	case "support":
		return commonv1.UserRole_USER_ROLE_SUPPORT
	case "analyst":
		return commonv1.UserRole_USER_ROLE_ANALYST
	default:
		return commonv1.UserRole_USER_ROLE_UNSPECIFIED
	}
}

func parsePagination(q url.Values) *commonv1.PaginationRequest {
	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 {
			pageSize = int32(v)
		}
	}
	return &commonv1.PaginationRequest{
		Page:     page,
		PageSize: pageSize,
	}
}

func paginationToJSON(pg *commonv1.PaginationResponse) map[string]interface{} {
	if pg == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"total_count": pg.GetTotalCount(),
		"page":        pg.GetPage(),
		"page_size":   pg.GetPageSize(),
		"total_pages": pg.GetTotalPages(),
		"has_next":    pg.GetHasNext(),
	}
}
