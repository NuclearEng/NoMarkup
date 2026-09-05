package handler

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// VerificationHandler handles HTTP endpoints for provider verification documents.
type VerificationHandler struct {
	userClient userv1.UserServiceClient
}

// NewVerificationHandler creates a new VerificationHandler.
func NewVerificationHandler(userClient userv1.UserServiceClient) *VerificationHandler {
	return &VerificationHandler{userClient: userClient}
}

type uploadDocumentRequest struct {
	DocumentType string `json:"document_type"`
	FileURL      string `json:"file_url"`
	FileName     string `json:"file_name"`
	MimeType     string `json:"mime_type"`
	SizeBytes    int32  `json:"size_bytes"`
	ExpiresAt    string `json:"expires_at,omitempty"`
}

// UploadDocument handles POST /api/v1/providers/me/documents.
func (h *VerificationHandler) UploadDocument(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req uploadDocumentRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.DocumentType == "" {
		writeError(w, http.StatusBadRequest, "document_type is required")
		return
	}
	if req.FileURL == "" {
		writeError(w, http.StatusBadRequest, "file_url is required")
		return
	}
	// The file_url must point at an object the caller uploaded to our storage
	// (documents/{userID}/...). Without this, a verification document could be
	// registered against an arbitrary external URL or another user's object —
	// the client-supplied mime_type/size_bytes are untrusted metadata; the only
	// thing that anchors the record to real, owned content is the key namespace.
	// An external URL has no {context}/{userID} shape and fails closed.
	if !requireOwnedObject(w, req.FileURL, claims.UserID) {
		return
	}

	grpcReq := &userv1.UploadDocumentRequest{
		UserId:       claims.UserID,
		DocumentType: req.DocumentType,
		File: &commonv1.FileReference{
			Url:       req.FileURL,
			Name:      req.FileName,
			MimeType:  req.MimeType,
			SizeBytes: req.SizeBytes,
		},
	}

	if req.ExpiresAt != "" {
		if ts, err := parseTimestamp(req.ExpiresAt); err == nil {
			grpcReq.ExpiresAt = ts
		}
	}

	resp, err := h.userClient.UploadDocument(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	slog.Info("verification document uploaded",
		"user_id", claims.UserID,
		"document_id", resp.GetDocumentId(),
		"document_type", req.DocumentType,
	)

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"document_id": resp.GetDocumentId(),
		"status":      verificationStatusToString(resp.GetStatus()),
	})
}

// ListDocuments handles GET /api/v1/providers/me/documents.
func (h *VerificationHandler) ListDocuments(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.userClient.ListDocuments(r.Context(), &userv1.ListDocumentsRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	documents := make([]map[string]interface{}, 0, len(resp.GetDocuments()))
	for _, d := range resp.GetDocuments() {
		documents = append(documents, protoDocumentStatusToJSON(d))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"documents": documents,
	})
}

// GetDocumentStatus handles GET /api/v1/providers/me/documents/{type}/status.
func (h *VerificationHandler) GetDocumentStatus(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	docType := chi.URLParam(r, "type")
	if docType == "" {
		writeError(w, http.StatusBadRequest, "document type required")
		return
	}

	// List all documents and filter by type to find the latest.
	resp, err := h.userClient.ListDocuments(r.Context(), &userv1.ListDocumentsRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	var found *userv1.GetDocumentStatusResponse
	for _, d := range resp.GetDocuments() {
		if d.GetDocumentType() == docType {
			found = d
			break
		}
	}

	if found == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"document_type": docType,
			"status":        "not_uploaded",
		})
		return
	}

	writeJSON(w, http.StatusOK, protoDocumentStatusToJSON(found))
}

// --- Proto to JSON helpers ---

func protoDocumentStatusToJSON(d *userv1.GetDocumentStatusResponse) map[string]interface{} {
	if d == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":                 d.GetId(),
		"document_type":      d.GetDocumentType(),
		"status":             verificationStatusToString(d.GetStatus()),
		"resubmission_count": d.GetResubmissionCount(),
	}

	if d.GetRejectionReason() != "" {
		result["rejection_reason"] = d.GetRejectionReason()
	}
	if d.GetExpiresAt() != nil {
		result["expires_at"] = formatTimestamp(d.GetExpiresAt())
	}

	return result
}

func verificationStatusToString(s commonv1.VerificationStatus) string {
	switch s {
	case commonv1.VerificationStatus_VERIFICATION_STATUS_NOT_UPLOADED:
		return "not_uploaded"
	case commonv1.VerificationStatus_VERIFICATION_STATUS_PENDING:
		return "pending"
	case commonv1.VerificationStatus_VERIFICATION_STATUS_VERIFIED:
		return "verified"
	case commonv1.VerificationStatus_VERIFICATION_STATUS_REJECTED:
		return "rejected"
	case commonv1.VerificationStatus_VERIFICATION_STATUS_EXPIRED:
		return "expired"
	default:
		return "unspecified"
	}
}

// parseTimestamp is already defined in job.go — available via the package scope.
