package service

import (
	"context"
	"errors"
	"testing"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// capTestRepo is a minimal ContractRepository for exercising the guarantee
// payout-cap logic in AdminResolveDispute. It embeds the interface so any
// unimplemented method panics if the code path under test unexpectedly calls
// it; only the four methods the resolve path touches are implemented.
type capTestRepo struct {
	domain.ContractRepository

	dispute      *domain.Dispute
	contract     *domain.Contract
	resolveCalls int
}

func (r *capTestRepo) GetDispute(_ context.Context, _ string) (*domain.Dispute, error) {
	if r.dispute == nil {
		return nil, domain.ErrDisputeNotFound
	}
	d := *r.dispute
	return &d, nil
}

func (r *capTestRepo) GetContract(_ context.Context, _ string) (*domain.Contract, error) {
	if r.contract == nil {
		return nil, domain.ErrContractNotFound
	}
	c := *r.contract
	return &c, nil
}

func (r *capTestRepo) ResolveDispute(_ context.Context, disputeID, resolutionType, _, _ string, refundAmountCents int64, guaranteeOutcome string) (*domain.Dispute, error) {
	r.resolveCalls++
	return &domain.Dispute{
		ID:                disputeID,
		ContractID:        r.dispute.ContractID,
		Status:            "resolved",
		ResolutionType:    resolutionType,
		RefundAmountCents: refundAmountCents,
		GuaranteeOutcome:  guaranteeOutcome,
	}, nil
}

func (r *capTestRepo) InsertAuditLog(_ context.Context, _, _, _, _ string, _ map[string]any) error {
	return nil
}

// TestAdminResolveDisputeGuaranteePayoutCap pins the money invariant: a
// guarantee payout must be non-negative and must never exceed the covered
// contract amount. A payout over the cap or below zero must be rejected with
// ErrInvalidGuaranteePayout and must NOT write the resolution.
func TestAdminResolveDisputeGuaranteePayoutCap(t *testing.T) {
	t.Parallel()

	const contractAmount int64 = 1001 // $10.01 covered contract

	tests := []struct {
		name         string
		payoutCents  int64
		wantErr      bool
		wantResolved bool
	}{
		{"payout below cap allowed", 500, false, true},
		{"payout exactly at cap allowed", 1001, false, true},
		{"payout one cent over cap rejected", 1002, true, false},
		{"payout grossly over cap rejected", 999999, true, false},
		{"negative payout rejected", -5000, true, false},
		{"zero payout allowed (no cap check)", 0, false, true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			repo := &capTestRepo{
				dispute: &domain.Dispute{
					ID:               "d1",
					ContractID:       "c1",
					Status:           "open",
					IsGuaranteeClaim: true,
				},
				contract: &domain.Contract{
					ID:          "c1",
					AmountCents: contractAmount,
				},
			}
			svc := NewContractService(repo, nil)

			resolved, err := svc.AdminResolveDispute(
				context.Background(),
				"d1", "guarantee_invoked", "notes", "admin1",
				tt.payoutCents, "refund",
			)

			if tt.wantErr {
				if err == nil {
					t.Fatalf("payout %d: expected error, got nil", tt.payoutCents)
				}
				if !errors.Is(err, domain.ErrInvalidGuaranteePayout) {
					t.Fatalf("payout %d: error = %v, want ErrInvalidGuaranteePayout", tt.payoutCents, err)
				}
				if repo.resolveCalls != 0 {
					t.Fatalf("payout %d: resolution was written despite invalid amount (%d calls)", tt.payoutCents, repo.resolveCalls)
				}
				return
			}

			if err != nil {
				t.Fatalf("payout %d: unexpected error: %v", tt.payoutCents, err)
			}
			if !tt.wantResolved || resolved == nil {
				t.Fatalf("payout %d: expected a resolved dispute, got %+v", tt.payoutCents, resolved)
			}
			if resolved.RefundAmountCents != tt.payoutCents {
				t.Fatalf("payout %d: persisted refund = %d, want %d", tt.payoutCents, resolved.RefundAmountCents, tt.payoutCents)
			}
		})
	}
}
