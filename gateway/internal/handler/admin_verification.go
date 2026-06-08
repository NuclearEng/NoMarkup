package handler

import (
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
// It returns verification documents in the 'pending' state across all users,
// oldest first, each enriched with the owning user's identity so the admin
// review queue is actionable. Query params: page, page_size.
func (h *AdminVerificationHandler) ListPendingDocuments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	pagination := parsePagination(q)

	resp, err := h.userClient.AdminListPendingDocuments(r.Context(), &userv1.AdminListPendingDocumentsRequest{
		Pagination: pagination,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	documents := make([]map[string]interface{}, 0, len(resp.GetDocuments()))
	for _, d := range resp.GetDocuments() {
		doc := map[string]interface{}{
			"id":                d.GetId(),
			"user_id":           d.GetUserId(),
			"user_email":        d.GetUserEmail(),
			"user_display_name": d.GetUserDisplayName(),
			"document_type":     d.GetDocumentType(),
			"status":            protoEnumToString(d.GetStatus().String(), "VERIFICATION_STATUS_"),
			"file_name":         d.GetFileName(),
			"file_url":          d.GetFileUrl(),
		}
		if ts := d.GetCreatedAt(); ts != nil {
			doc["created_at"] = ts.AsTime()
		}
		documents = append(documents, doc)
	}

	result := map[string]interface{}{
		"documents": documents,
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
	if !decodeJSON(w, r, &body) {
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
		"status": protoEnumToString(resp.GetStatus().String(), "VERIFICATION_STATUS_"),
	})
}
