package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type autoReleaseRepo struct {
	domain.ContractRepository

	awaiting      []domain.Contract
	awaitingErr   error
	approved      []string
	jobsCompleted []string
	contract      *domain.Contract
	approveErr    error
	completeErr   error
}

func (r *autoReleaseRepo) GetContract(_ context.Context, id string) (*domain.Contract, error) {
	if r.contract == nil || r.contract.ID != id {
		return nil, domain.ErrContractNotFound
	}
	c := *r.contract
	return &c, nil
}

func (r *autoReleaseRepo) GetContractsAwaitingApproval(_ context.Context, _ time.Duration) ([]domain.Contract, error) {
	if r.awaitingErr != nil {
		return nil, r.awaitingErr
	}
	out := make([]domain.Contract, len(r.awaiting))
	copy(out, r.awaiting)
	return out, nil
}

func (r *autoReleaseRepo) ApproveCompletion(_ context.Context, contractID string) (*domain.Contract, error) {
	if r.approveErr != nil {
		return nil, r.approveErr
	}
	r.approved = append(r.approved, contractID)
	for i := range r.awaiting {
		if r.awaiting[i].ID == contractID {
			c := r.awaiting[i]
			c.Status = "completed"
			return &c, nil
		}
	}
	if r.contract != nil && r.contract.ID == contractID {
		c := *r.contract
		c.Status = "completed"
		return &c, nil
	}
	return &domain.Contract{ID: contractID, Status: "completed"}, nil
}

func (r *autoReleaseRepo) UpdateJobCompleted(_ context.Context, jobID string) error {
	if r.completeErr != nil {
		return r.completeErr
	}
	r.jobsCompleted = append(r.jobsCompleted, jobID)
	return nil
}

func (r *autoReleaseRepo) UpdateJobStatus(_ context.Context, _ string, _ string) error {
	return nil
}

type mockEscrowReleaser struct {
	ids        []string
	listErr    error
	releaseErr error
	listN      int
	releaseN   int
	released   []string
	reasons    []string
}

func (m *mockEscrowReleaser) ListEscrowPaymentIDs(_ context.Context, _, _ string) ([]string, error) {
	m.listN++
	if m.listErr != nil {
		return nil, m.listErr
	}
	out := make([]string, len(m.ids))
	copy(out, m.ids)
	return out, nil
}

func (m *mockEscrowReleaser) ReleaseEscrow(_ context.Context, paymentID, reason string) error {
	m.releaseN++
	m.released = append(m.released, paymentID)
	m.reasons = append(m.reasons, reason)
	if m.releaseErr != nil {
		return m.releaseErr
	}
	return nil
}

func awaitingContract(id, jobID, customerID string) domain.Contract {
	return domain.Contract{
		ID:          id,
		JobID:       jobID,
		CustomerID:  customerID,
		ProviderID:  "prov-1",
		Status:      "active",
		AmountCents: 10000,
	}
}

func TestApproveCompletion_noPaymentStillSucceeds(t *testing.T) {
	t.Parallel()
	repo := &autoReleaseRepo{
		contract: &domain.Contract{
			ID:          "c1",
			CustomerID:  "cust-1",
			ProviderID:  "prov-1",
			JobID:       "j1",
			Status:      "active",
			AmountCents: 10000,
		},
	}
	svc := NewContractService(repo, nil)

	got, err := svc.ApproveCompletion(context.Background(), "c1", "cust-1")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "completed", got.Status)
	assert.Equal(t, []string{"c1"}, repo.approved)
}

func TestApproveCompletion_wrongPartyRefused(t *testing.T) {
	t.Parallel()
	repo := &autoReleaseRepo{
		contract: &domain.Contract{
			ID:         "c1",
			CustomerID: "cust-1",
			ProviderID: "prov-1",
			Status:     "active",
		},
	}
	svc := NewContractService(repo, nil)

	_, err := svc.ApproveCompletion(context.Background(), "c1", "prov-1")
	require.ErrorIs(t, err, domain.ErrNotContractParty)
	assert.Empty(t, repo.approved)
}

func TestAutoReleaseCompletedContracts_releasesEscrowAsSystem(t *testing.T) {
	t.Parallel()

	const (
		contractID = "c-auto-1"
		jobID      = "j-auto-1"
		customerID = "cust-1"
		paymentID  = "pay-escrow-1"
	)

	tests := []struct {
		name         string
		escrow       *mockEscrowReleaser
		wantApproved bool
		wantJob      bool
		wantList     int
		wantRelease  int
		wantReason   string
	}{
		{
			name: "system actor releases escrow then completes",
			escrow: &mockEscrowReleaser{
				ids: []string{paymentID},
			},
			wantApproved: true,
			wantJob:      true,
			wantList:     1,
			wantRelease:  1,
			wantReason:   "auto_release",
		},
		{
			name:         "no escrow payment still completes",
			escrow:       &mockEscrowReleaser{},
			wantApproved: true,
			wantJob:      true,
			wantList:     1,
			wantRelease:  0,
		},
		{
			name:         "nil escrow client still completes (unpaid / unwired)",
			escrow:       nil,
			wantApproved: true,
			wantJob:      true,
			wantList:     0,
			wantRelease:  0,
		},
		{
			name: "not-in-escrow FailedPrecondition is fail-soft and still completes",
			escrow: &mockEscrowReleaser{
				ids:        []string{paymentID},
				releaseErr: status.Error(codes.FailedPrecondition, "invalid status for this operation"),
			},
			wantApproved: true,
			wantJob:      true,
			wantList:     1,
			wantRelease:  1,
			wantReason:   "auto_release",
		},
		{
			name: "list error skips complete so next sweep retries",
			escrow: &mockEscrowReleaser{
				listErr: errors.New("payment mesh down"),
			},
			wantApproved: false,
			wantJob:      false,
			wantList:     1,
			wantRelease:  0,
		},
		{
			name: "hard release error skips complete so next sweep retries",
			escrow: &mockEscrowReleaser{
				ids:        []string{paymentID},
				releaseErr: errors.New("stripe timeout"),
			},
			wantApproved: false,
			wantJob:      false,
			wantList:     1,
			wantRelease:  1,
			wantReason:   "auto_release",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			repo := &autoReleaseRepo{
				awaiting: []domain.Contract{awaitingContract(contractID, jobID, customerID)},
			}
			svc := NewContractService(repo, nil)
			if tt.escrow != nil {
				svc.SetEscrowReleaser(tt.escrow)
			}

			err := svc.AutoReleaseCompletedContracts(context.Background())
			require.NoError(t, err)

			if tt.wantApproved {
				assert.Equal(t, []string{contractID}, repo.approved)
			} else {
				assert.Empty(t, repo.approved)
			}
			if tt.wantJob {
				assert.Equal(t, []string{jobID}, repo.jobsCompleted)
			} else {
				assert.Empty(t, repo.jobsCompleted)
			}
			if tt.escrow != nil {
				assert.Equal(t, tt.wantList, tt.escrow.listN)
				assert.Equal(t, tt.wantRelease, tt.escrow.releaseN)
				if tt.wantRelease > 0 {
					assert.Equal(t, []string{paymentID}, tt.escrow.released)
					for _, reason := range tt.escrow.reasons {
						assert.Equal(t, tt.wantReason, reason)
					}
				}
			}
		})
	}
}

func TestAutoReleaseCompletedContracts_idempotentSecondSweep(t *testing.T) {
	t.Parallel()
	repo := &autoReleaseRepo{
		awaiting: []domain.Contract{awaitingContract("c1", "j1", "cust-1")},
	}
	escrow := &mockEscrowReleaser{ids: []string{"pay-1"}}
	svc := NewContractService(repo, nil)
	svc.SetEscrowReleaser(escrow)

	require.NoError(t, svc.AutoReleaseCompletedContracts(context.Background()))
	assert.Equal(t, 1, escrow.releaseN)
	assert.Equal(t, []string{"c1"}, repo.approved)

	// Next tick: contract no longer awaiting.
	repo.awaiting = nil
	require.NoError(t, svc.AutoReleaseCompletedContracts(context.Background()))
	assert.Equal(t, 1, escrow.releaseN, "second sweep must not release again")
	assert.Equal(t, []string{"c1"}, repo.approved)
}

func TestSkippableEscrowReleaseErr(t *testing.T) {
	t.Parallel()
	assert.True(t, skippableEscrowReleaseErr(nil))
	assert.True(t, skippableEscrowReleaseErr(status.Error(codes.FailedPrecondition, "invalid status")))
	assert.True(t, skippableEscrowReleaseErr(status.Error(codes.NotFound, "payment not found")))
	assert.False(t, skippableEscrowReleaseErr(status.Error(codes.PermissionDenied, "provider cannot release")))
	assert.False(t, skippableEscrowReleaseErr(errors.New("network")))
}
