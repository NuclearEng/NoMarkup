package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// Verification implements document verification business logic.
type Verification struct {
	repo domain.UserRepository
}

// NewVerification creates a new Verification service.
func NewVerification(repo domain.UserRepository) *Verification {
	return &Verification{repo: repo}
}

// UploadDocument stores document metadata and uploads the file to storage.
// In practice the raw file data would be uploaded to S3; here we persist the
// metadata record and set the status to pending review.
func (v *Verification) UploadDocument(ctx context.Context, userID string, docType domain.DocumentType, fileName string, storageURL string) (*domain.Document, error) {
	if userID == "" {
		return nil, fmt.Errorf("upload document: user_id is required")
	}
	if docType == "" {
		return nil, fmt.Errorf("upload document: document_type is required")
	}
	if !isValidDocumentType(docType) {
		return nil, fmt.Errorf("upload document: invalid document type %q", docType)
	}
	if fileName == "" {
		return nil, fmt.Errorf("upload document: file_name is required")
	}

	doc := &domain.Document{
		UserID:     userID,
		Type:       docType,
		Status:     domain.DocStatusPending,
		FileName:   fileName,
		StorageURL: storageURL,
	}

	if err := v.repo.CreateDocument(ctx, doc); err != nil {
		return nil, fmt.Errorf("upload document: %w", err)
	}

	slog.Info("document uploaded",
		"document_id", doc.ID,
		"user_id", userID,
		"type", string(docType),
	)
	return doc, nil
}

// GetDocumentStatus returns the verification status of a specific document.
func (v *Verification) GetDocumentStatus(ctx context.Context, documentID string) (*domain.Document, error) {
	if documentID == "" {
		return nil, fmt.Errorf("get document status: document_id is required")
	}

	doc, err := v.repo.GetDocument(ctx, documentID)
	if err != nil {
		return nil, fmt.Errorf("get document status: %w", err)
	}
	return doc, nil
}

// ListDocuments lists all verification documents for a user.
func (v *Verification) ListDocuments(ctx context.Context, userID string) ([]domain.Document, error) {
	if userID == "" {
		return nil, fmt.Errorf("list documents: user_id is required")
	}

	docs, err := v.repo.ListDocuments(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	return docs, nil
}

// AdminReviewDocument approves or rejects a document and updates its status.
func (v *Verification) AdminReviewDocument(ctx context.Context, documentID string, approved bool, rejectionReason string) error {
	if documentID == "" {
		return fmt.Errorf("admin review document: document_id is required")
	}

	status := domain.DocStatusVerified
	if !approved {
		status = domain.DocStatusRejected
		if rejectionReason == "" {
			return fmt.Errorf("admin review document: rejection_reason is required when rejecting")
		}
	}

	if err := v.repo.UpdateDocumentStatus(ctx, documentID, status, rejectionReason); err != nil {
		return fmt.Errorf("admin review document: %w", err)
	}

	slog.Info("document reviewed",
		"document_id", documentID,
		"status", string(status),
	)
	return nil
}

// isValidDocumentType checks whether a document type is one of the known types.
func isValidDocumentType(dt domain.DocumentType) bool {
	switch dt {
	case domain.DocDriversLicense,
		domain.DocBusinessLicense,
		domain.DocEIN,
		domain.DocInsurance,
		domain.DocTradeLicense:
		return true
	default:
		return false
	}
}
