package service

import (
	"context"
	"errors"
	"testing"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUploadDocument_FirstUploadOK(t *testing.T) {
	t.Parallel()

	var created *domain.Document
	repo := &mockUserRepo{
		listDocumentsFn: func(_ context.Context, _ string) ([]domain.Document, error) {
			return nil, nil
		},
		createDocumentFn: func(_ context.Context, doc *domain.Document) error {
			doc.ID = "doc-1"
			created = doc
			return nil
		},
	}
	svc := NewVerification(repo)

	doc, err := svc.UploadDocument(context.Background(), "user-1", domain.DocDriversLicense,
		"id.jpg", "documents/user-1/id.jpg", "image/jpeg", 1024)
	require.NoError(t, err)
	require.NotNil(t, doc)
	assert.Equal(t, "doc-1", doc.ID)
	assert.Equal(t, domain.DocStatusPending, doc.Status)
	assert.Equal(t, 0, doc.ResubmissionCount)
	require.NotNil(t, created)
	assert.Equal(t, 0, created.ResubmissionCount)
}

func TestUploadDocument_CarriesResubmissionCount(t *testing.T) {
	t.Parallel()

	var created *domain.Document
	repo := &mockUserRepo{
		listDocumentsFn: func(_ context.Context, _ string) ([]domain.Document, error) {
			return []domain.Document{{
				ID:                "old",
				Type:              domain.DocInsurance,
				Status:            domain.DocStatusRejected,
				ResubmissionCount: 2,
			}}, nil
		},
		createDocumentFn: func(_ context.Context, doc *domain.Document) error {
			doc.ID = "doc-2"
			created = doc
			return nil
		},
	}
	svc := NewVerification(repo)

	doc, err := svc.UploadDocument(context.Background(), "user-1", domain.DocInsurance,
		"ins.pdf", "documents/user-1/ins.pdf", "application/pdf", 2048)
	require.NoError(t, err)
	require.NotNil(t, created)
	assert.Equal(t, 2, doc.ResubmissionCount)
	assert.Equal(t, 2, created.ResubmissionCount)
}

func TestUploadDocument_HardLockoutWhenCountAtMax(t *testing.T) {
	t.Parallel()

	createCalled := false
	repo := &mockUserRepo{
		listDocumentsFn: func(_ context.Context, _ string) ([]domain.Document, error) {
			return []domain.Document{{
				ID:                "locked",
				Type:              domain.DocTradeLicense,
				Status:            domain.DocStatusRejected,
				ResubmissionCount: domain.MaxDocumentResubmissions,
			}}, nil
		},
		createDocumentFn: func(_ context.Context, _ *domain.Document) error {
			createCalled = true
			return nil
		},
	}
	svc := NewVerification(repo)

	doc, err := svc.UploadDocument(context.Background(), "user-1", domain.DocTradeLicense,
		"trade.pdf", "documents/user-1/trade.pdf", "application/pdf", 100)
	require.Error(t, err)
	assert.Nil(t, doc)
	assert.True(t, errors.Is(err, domain.ErrResubmissionLimitReached))
	assert.False(t, createCalled, "must not create a document after hard lockout")
}

func TestUploadDocument_HardLockoutWhenThreeRejectedRows(t *testing.T) {
	t.Parallel()

	// Legacy path: each resubmit was a new row with resubmission_count=1.
	repo := &mockUserRepo{
		listDocumentsFn: func(_ context.Context, _ string) ([]domain.Document, error) {
			return []domain.Document{
				{ID: "a", Type: domain.DocEIN, Status: domain.DocStatusRejected, ResubmissionCount: 1},
				{ID: "b", Type: domain.DocEIN, Status: domain.DocStatusRejected, ResubmissionCount: 1},
				{ID: "c", Type: domain.DocEIN, Status: domain.DocStatusRejected, ResubmissionCount: 1},
			}, nil
		},
		createDocumentFn: func(_ context.Context, _ *domain.Document) error {
			t.Fatal("should not create")
			return nil
		},
	}
	svc := NewVerification(repo)

	_, err := svc.UploadDocument(context.Background(), "user-1", domain.DocEIN,
		"ein.pdf", "documents/user-1/ein.pdf", "application/pdf", 100)
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrResubmissionLimitReached))
}

func TestUploadDocument_OtherTypesUnaffectedByLockout(t *testing.T) {
	t.Parallel()

	repo := &mockUserRepo{
		listDocumentsFn: func(_ context.Context, _ string) ([]domain.Document, error) {
			return []domain.Document{{
				ID:                "locked-dl",
				Type:              domain.DocDriversLicense,
				Status:            domain.DocStatusRejected,
				ResubmissionCount: 3,
			}}, nil
		},
		createDocumentFn: func(_ context.Context, doc *domain.Document) error {
			doc.ID = "new-ins"
			return nil
		},
	}
	svc := NewVerification(repo)

	doc, err := svc.UploadDocument(context.Background(), "user-1", domain.DocInsurance,
		"ins.pdf", "documents/user-1/ins.pdf", "application/pdf", 100)
	require.NoError(t, err)
	assert.Equal(t, "new-ins", doc.ID)
	assert.Equal(t, 0, doc.ResubmissionCount)
}

func TestUploadDocument_Validation(t *testing.T) {
	t.Parallel()
	svc := NewVerification(&mockUserRepo{})

	_, err := svc.UploadDocument(context.Background(), "", domain.DocInsurance, "f.pdf", "u", "application/pdf", 1)
	require.Error(t, err)

	_, err = svc.UploadDocument(context.Background(), "user-1", domain.DocumentType("nope"), "f.pdf", "u", "application/pdf", 1)
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrInvalidDocumentType))

	_, err = svc.UploadDocument(context.Background(), "user-1", domain.DocInsurance, "", "u", "application/pdf", 1)
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrMissingFileName))
}
