package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// maxDisplayNameLen bounds the user-facing display name. 80 chars is generous
// for a real name or handle while bounding the column against an unbounded blob.
const maxDisplayNameLen = 80

// UserHandler handles HTTP endpoints for user profiles.
type UserHandler struct {
	userClient userv1.UserServiceClient
	db         *pgxpool.Pool
}

// NewUserHandler creates a new UserHandler.
// The db pool is used for gateway-level queries (e.g. savings) that don't
// have a corresponding gRPC RPC. If db is nil, those endpoints degrade gracefully.
func NewUserHandler(userClient userv1.UserServiceClient, db *pgxpool.Pool) *UserHandler {
	return &UserHandler{userClient: userClient, db: db}
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
	if !decodeJSON(w, r, &req) {
		return
	}

	// Server-side validation: never trust the client's Zod pass. A nil pointer
	// means "field omitted, leave unchanged"; a present pointer must hold a
	// valid value. Previously an empty display_name or a garbage timezone was
	// persisted with a 200 — both are rejected here with an intuitive 400.
	if req.DisplayName != nil {
		trimmed := strings.TrimSpace(*req.DisplayName)
		if trimmed == "" {
			writeError(w, http.StatusBadRequest, "display_name cannot be empty")
			return
		}
		if utf8.RuneCountInString(trimmed) > maxDisplayNameLen {
			writeError(w, http.StatusBadRequest,
				fmt.Sprintf("display_name must be at most %d characters", maxDisplayNameLen))
			return
		}
		req.DisplayName = &trimmed
	}
	if req.Timezone != nil && *req.Timezone != "" {
		// LoadLocation validates against the IANA tz database; an unknown zone
		// (e.g. "Narnia/Nowhere") returns an error rather than being persisted.
		if _, err := time.LoadLocation(*req.Timezone); err != nil {
			writeError(w, http.StatusBadRequest, "timezone must be a valid IANA timezone (e.g. America/New_York)")
			return
		}
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
	if !decodeJSON(w, r, &req) {
		return
	}

	role := parseUserRole(req.Role)
	if role == commonv1.UserRole_USER_ROLE_UNSPECIFIED {
		writeError(w, http.StatusBadRequest, "invalid role")
		return
	}
	// Self-service role enablement may grant ONLY customer/provider. A user
	// must never be able to elevate themselves to admin via this endpoint.
	// The user-service already rejects role=="admin" (defense in depth), but
	// we fail closed at the gateway boundary too so the privilege field a
	// client controls is never forwarded as an admin grant. (§6 authz, §15.)
	if role == commonv1.UserRole_USER_ROLE_ADMIN {
		writeError(w, http.StatusForbidden, "admin role cannot be self-assigned")
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

type requestDeletionRequest struct {
	Reason       string `json:"reason"`
	Confirmation string `json:"confirmation"`
}

// RequestMyDeletion handles DELETE /api/v1/users/me — initiates GDPR/CCPA
// erasure with a 30-day grace window. Returns the grace deadline in 200.
//
// The endpoint is intentionally non-blocking: the cascade itself runs
// asynchronously via the user-service cron. Stripe / S3 cleanup happens at
// finalize time, not request time.
func (h *UserHandler) RequestMyDeletion(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req requestDeletionRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.userClient.RequestAccountDeletion(r.Context(), &userv1.RequestAccountDeletionRequest{
		UserId:       claims.UserID,
		Reason:       req.Reason,
		Confirmation: req.Confirmation,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	slog.Info("gdpr deletion request accepted",
		"user_id", claims.UserID,
		"created", resp.GetCreated(),
		"grace_deadline", resp.GetGraceDeadline().AsTime(),
	)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"created":        resp.GetCreated(),
		"grace_deadline": resp.GetGraceDeadline().AsTime().UTC().Format(time.RFC3339),
		"message":        "Account deletion requested. You can cancel within 30 days by signing in and clicking 'Restore my account'.",
	})
}

// RestoreMyAccount handles POST /api/v1/users/me/restore — cancels a
// pending deletion request within the grace window.
func (h *UserHandler) RestoreMyAccount(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.userClient.CancelAccountDeletion(r.Context(), &userv1.CancelAccountDeletionRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"cancelled": resp.GetCancelled(),
	})
}

// AdminFinalizeDeletion handles POST /api/v1/admin/users/{id}/finalize-deletion.
// Compliance team uses this to expedite a finalize ahead of the 30-day cron.
func (h *UserHandler) AdminFinalizeDeletion(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	resp, err := h.userClient.FinalizeAccountDeletion(r.Context(), &userv1.FinalizeAccountDeletionRequest{
		UserId:  userID,
		Force:   true,
		AdminId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	slog.Warn("gdpr admin override finalize",
		"target_user_id", userID,
		"admin_id", claims.UserID,
		"counts", resp.GetRowsAffected(),
		"stripe_customer_outcome", resp.GetStripeCustomerOutcome(),
		"stripe_account_outcome", resp.GetStripeAccountOutcome(),
	)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"finalized_at":            resp.GetFinalizedAt().AsTime().UTC().Format(time.RFC3339),
		"rows_affected":           resp.GetRowsAffected(),
		"stripe_customer_outcome": resp.GetStripeCustomerOutcome(),
		"stripe_account_outcome":  resp.GetStripeAccountOutcome(),
	})
}

// GetSavings handles GET /api/v1/users/me/savings.
func (h *UserHandler) GetSavings(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	if h.db == nil {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id, user_id, job_id, awarded_cents, market_median_cents, savings_cents, created_at
		FROM user_savings
		WHERE user_id = $1
		ORDER BY created_at DESC`, claims.UserID)
	if err != nil {
		slog.Error("failed to query user savings", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get savings")
		return
	}
	defer rows.Close()

	savings := make([]map[string]interface{}, 0)
	for rows.Next() {
		var (
			id, userID, jobID                          string
			awardedCents, marketMedianCents, savingsCents int64
			createdAt                                    time.Time
		)
		if err := rows.Scan(&id, &userID, &jobID, &awardedCents, &marketMedianCents, &savingsCents, &createdAt); err != nil {
			slog.Error("failed to scan user savings row", "user_id", claims.UserID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read savings")
			return
		}
		savings = append(savings, map[string]interface{}{
			"id":                  id,
			"user_id":             userID,
			"job_id":              jobID,
			"awarded_cents":       awardedCents,
			"market_median_cents": marketMedianCents,
			"savings_cents":       savingsCents,
			"created_at":          createdAt.UTC().Format(time.RFC3339),
		})
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating user savings rows", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get savings")
		return
	}

	writeJSON(w, http.StatusOK, savings)
}

// GetUser handles GET /api/v1/users/{id}.
func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	userID := chi.URLParam(r, "id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}
	if !isValidUUID(userID) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	resp, err := h.userClient.GetUser(r.Context(), &userv1.GetUserRequest{
		UserId: userID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := protoUserToJSON(resp.GetUser())

	// PII strip: only the user themselves or an admin may see contact details
	// and security flags. Other callers get a public projection. (PII, §6)
	if result != nil && userID != claims.UserID && !hasRole(claims, "admin") {
		delete(result, "email")
		delete(result, "email_verified")
		delete(result, "phone")
		delete(result, "phone_verified")
		delete(result, "mfa_enabled")
	}

	writeJSON(w, http.StatusOK, result)
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
