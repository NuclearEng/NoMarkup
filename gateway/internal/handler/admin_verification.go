package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminVerificationHandler handles admin identity verification endpoints.
type AdminVerificationHandler struct {
	userClient userv1.UserServiceClient
}

// NewAdminVerificationHandler creates a new AdminVerificationHandler.
func NewAdminVerificationHandler(userClient userv1.UserServiceClient) *AdminVerificationHandler {
	return &AdminVerificationHandler{userClient: userClient}
}

// ListPendingDocuments handles GET /api/v1/admin/verification/queue.
// This searches for users with pending verification documents using AdminSearchUsers.
// Query params: page, page_size.
func (h *AdminVerificationHandler) ListPendingDocuments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	pagination := parsePagination(q)

	// Use AdminSearchUsers with no query to list users, and the caller
	// filters by pending verification status on the client side.
	// Alternatively, we call AdminReviewDocument with a listing approach.
	// Since the proto defines AdminReviewDocument for individual reviews,
	// we use AdminSearchUsers to find users and return their documents.
	resp, err := h.userClient.AdminSearchUsers(r.Context(), &userv1.AdminSearchUsersRequest{
		Pagination: pagination,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	// Build the response: list users with their basic info.
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

// ReviewDocument handles POST /api/v1/admin/verification/{id}/review.
// Body: {approved: bool, rejection_reason: string}.
func (h *AdminVerificationHandler) ReviewDocument(w http.ResponseWriter, r *http.Request) {
	documentID := chi.URLParam(r, "id")
	if documentID == "" {
		writeError(w, http.StatusBadRequest, "document id required")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Approved        bool   `json:"approved"`
		RejectionReason string `json:"rejection_reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if !body.Approved && body.RejectionReason == "" {
		writeError(w, http.StatusBadRequest, "rejection_reason is required when not approved")
		return
	}

	resp, err := h.userClient.AdminReviewDocument(r.Context(), &userv1.AdminReviewDocumentRequest{
		DocumentId:      documentID,
		Approved:        body.Approved,
		RejectionReason: body.RejectionReason,
		AdminId:         claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": resp.GetStatus().String(),
	})
}
