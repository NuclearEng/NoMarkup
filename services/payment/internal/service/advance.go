package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// advanceFeeRate is the percentage charged on working capital advances (3%).
const advanceFeeRate = 0.03

// RequestAdvance creates a new working capital advance request.
func (s *PaymentService) RequestAdvance(ctx context.Context, providerID, contractID string, amountCents int64) (*domain.Advance, error) {
	if providerID == "" {
		return nil, fmt.Errorf("request advance: provider_id is required")
	}
	if contractID == "" {
		return nil, fmt.Errorf("request advance: contract_id is required")
	}
	if amountCents <= 0 {
		return nil, fmt.Errorf("request advance: %w", domain.ErrInvalidAmount)
	}

	feeCents := int64(float64(amountCents) * advanceFeeRate)

	advance := &domain.Advance{
		ID:                 uuid.New().String(),
		ProviderID:         providerID,
		ContractID:         contractID,
		AdvanceAmountCents: amountCents,
		FeeCents:           feeCents,
		RepaidCents:        0,
		Status:             "requested",
	}

	if err := s.repo.CreateAdvance(ctx, advance); err != nil {
		return nil, err
	}

	slog.Info("advance requested",
		"advance_id", advance.ID,
		"provider_id", providerID,
		"contract_id", contractID,
		"amount_cents", amountCents,
		"fee_cents", feeCents,
	)

	return advance, nil
}

// ListAdvances returns paginated advances. If providerID is empty, returns all advances (admin).
func (s *PaymentService) ListAdvances(ctx context.Context, providerID string, statusFilter string, page, pageSize int) ([]*domain.Advance, int, error) {
	return s.repo.ListAdvances(ctx, providerID, statusFilter, page, pageSize)
}

// GetAdvance retrieves a single advance by ID.
func (s *PaymentService) GetAdvance(ctx context.Context, advanceID string) (*domain.Advance, error) {
	if advanceID == "" {
		return nil, fmt.Errorf("get advance: advance_id is required")
	}
	return s.repo.GetAdvance(ctx, advanceID)
}

// ReviewAdvance approves or rejects a working capital advance.
// Only advances in "requested" status can be reviewed.
func (s *PaymentService) ReviewAdvance(ctx context.Context, advanceID, reviewerID, action, reason string) (*domain.Advance, error) {
	if advanceID == "" {
		return nil, fmt.Errorf("review advance: advance_id is required")
	}
	if reviewerID == "" {
		return nil, fmt.Errorf("review advance: reviewer_id is required")
	}
	if action != "approve" && action != "reject" {
		return nil, fmt.Errorf("review advance: action must be 'approve' or 'reject'")
	}

	status := "approved"
	if action == "reject" {
		status = "rejected"
	}

	var rejectionReason *string
	if action == "reject" && reason != "" {
		rejectionReason = &reason
	}

	advance, err := s.repo.UpdateAdvanceReview(ctx, advanceID, status, reviewerID, rejectionReason)
	if err != nil {
		return nil, err
	}

	slog.Info("advance reviewed",
		"advance_id", advanceID,
		"reviewer_id", reviewerID,
		"action", action,
		"status", status,
	)

	return advance, nil
}
