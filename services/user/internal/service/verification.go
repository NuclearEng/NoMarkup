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
//
// FR-2.10 hard lockout: when resubmission_count for this document type has
// already reached MaxDocumentResubmissions (3), further uploads are refused
// with ErrResubmissionLimitReached (maps to gRPC FailedPrecondition → HTTP 422).
// The count is carried forward onto each new row for the same type so rejections
// accumulate across resubmits (each CreateDocument starts a new pending row).
func (v *Verification) UploadDocument(ctx context.Context, userID string, docType domain.DocumentType, fileName string, storageURL string, mimeType string, sizeBytes int64) (*domain.Document, error) {
	if userID == "" {
		return nil, fmt.Errorf("upload document: user_id is required")
	}
	docType = normalizeDocumentType(docType)
	if docType == "" || !isValidDocumentType(docType) {
		return nil, fmt.Errorf("upload document: %w", domain.ErrInvalidDocumentType)
	}
	if fileName == "" {
		return nil, fmt.Errorf("upload document: %w", domain.ErrMissingFileName)
	}

	// FR-2.10: refuse when this type is hard-locked after max rejections.
	carryCount, locked, err := v.resubmissionState(ctx, userID, docType)
	if err != nil {
		return nil, fmt.Errorf("upload document: %w", err)
	}
	if locked {
		return nil, fmt.Errorf("upload document: %w", domain.ErrResubmissionLimitReached)
	}

	doc := &domain.Document{
		UserID:            userID,
		Type:              docType,
		Status:            domain.DocStatusPending,
		FileName:          fileName,
		StorageURL:        storageURL,
		MimeType:          mimeType,
		SizeBytes:         sizeBytes,
		ResubmissionCount: carryCount,
	}

	if err := v.repo.CreateDocument(ctx, doc); err != nil {
		return nil, fmt.Errorf("upload document: %w", err)
	}

	slog.Info("document uploaded",
		"document_id", doc.ID,
		"user_id", userID,
		"type", string(docType),
		"resubmission_count", doc.ResubmissionCount,
	)
	return doc, nil
}

// resubmissionState returns the count to carry onto a new upload for docType
// and whether further uploads are hard-locked (FR-2.10).
//
// Lockout uses max(resubmission_count) across rows of that type, and also the
// number of rejected rows, so both the carry-forward lineage and legacy
// one-reject-per-row history enforce the same "3 rejections max" rule.
func (v *Verification) resubmissionState(ctx context.Context, userID string, docType domain.DocumentType) (carry int, locked bool, err error) {
	docs, err := v.repo.ListDocuments(ctx, userID)
	if err != nil {
		return 0, false, err
	}

	maxCount := 0
	rejectedRows := 0
	for _, d := range docs {
		if normalizeDocumentType(d.Type) != docType {
			continue
		}
		if d.ResubmissionCount > maxCount {
			maxCount = d.ResubmissionCount
		}
		if d.Status == domain.DocStatusRejected {
			rejectedRows++
		}
	}

	if maxCount >= domain.MaxDocumentResubmissions || rejectedRows >= domain.MaxDocumentResubmissions {
		return maxCount, true, nil
	}
	return maxCount, false, nil
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
		// FR-2.10: refuse further rejections that would be meaningless once locked;
		// still allow the status write if under the cap (UpdateDocumentStatus
		// increments). Pre-check is best-effort for a clear error when already at max.
		doc, err := v.repo.GetDocument(ctx, documentID)
		if err != nil {
			return fmt.Errorf("admin review document: %w", err)
		}
		if doc.ResubmissionCount >= domain.MaxDocumentResubmissions {
			return fmt.Errorf("admin review document: %w", domain.ErrResubmissionLimitReached)
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

// normalizeDocumentType maps legacy / alternate client wire values onto the
// canonical domain types used for storage and FR-2.10 resubmission tracking.
func normalizeDocumentType(dt domain.DocumentType) domain.DocumentType {
	switch dt {
	case "government_id", "driver_license", "id":
		return domain.DocDriversLicense
	case "proof_of_insurance":
		return domain.DocInsurance
	default:
		return dt
	}
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

