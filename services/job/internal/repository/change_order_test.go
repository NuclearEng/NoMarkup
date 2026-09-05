//go:build integration

// Integration tests for the contract change-order money/state machine.
//
// These exercise the real Postgres repo at :5433 (the running dev DB), covering
// the bug fixed in this branch: ProposeChangeOrder / RespondToChangeOrder were
// entirely unimplemented in the job service, so the gateway returned 501 for
// both POST and PUT change-order endpoints.
//
// Run:
//   DATABASE_URL=postgres://nomarkup@localhost:5433/nomarkup?sslmode=disable \
//   go test -tags=integration -count=1 -run TestChangeOrder ./internal/repository/...
//
// The tests seed their own contract (reusing a real job_id/bid_id so the NOT
// NULL FKs are satisfied) and delete it in cleanup, so they leave no residue.
package repository

import (
	"context"
	"testing"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/stretchr/testify/require"
)

const (
	coCustomerID = "00000000-0000-0000-0000-000000000002"
	coProviderID = "00000000-0000-0000-0000-000000000004"
	// A real job/bid pair from the seeded data — the contracts FKs are NOT NULL.
	coJobID = "ec6b56bd-4348-446a-875e-21b0359a06cb"
	coBidID = "fa199d9a-491d-4883-b52b-b992b7ac8355"
)

// seedActiveContract creates an active contract with a single full-amount
// milestone and returns its ID, registering cleanup.
func seedActiveContract(t *testing.T, repo *PostgresRepository, amountCents int64) string {
	t.Helper()
	ctx := context.Background()
	c, err := repo.CreateContract(ctx, &domain.Contract{
		JobID:            coJobID,
		CustomerID:       coCustomerID,
		ProviderID:       coProviderID,
		BidID:            coBidID,
		AmountCents:      amountCents,
		PaymentTiming:    "completion",
		Status:           "active",
		CustomerAccepted: true,
		ProviderAccepted: true,
	}, []domain.MilestoneInput{{Description: "Complete work", AmountCents: amountCents}})
	require.NoError(t, err)

	pool := repo.pool
	t.Cleanup(func() {
		// change_orders + milestones cascade on contract delete.
		_, _ = pool.Exec(context.Background(), `DELETE FROM contracts WHERE id = $1`, c.ID)
	})
	return c.ID
}

// TestChangeOrder_Accept_AppliesDeltaToContractAndMilestone verifies the core
// money math: on accept the contract amount AND the single milestone amount each
// move by exactly the delta (integer cents), and the change order is 'accepted'.
func TestChangeOrder_Accept_AppliesDeltaToContractAndMilestone(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()

	const start int64 = 100_000
	const delta int64 = 25_000
	cid := seedActiveContract(t, repo, start)

	co, err := repo.CreateChangeOrder(ctx, &domain.ChangeOrder{
		ContractID: cid, ProposedBy: coProviderID,
		Description: "Extra materials", AmountDeltaCents: delta, Status: "proposed",
	})
	require.NoError(t, err)
	require.Equal(t, "proposed", co.Status)

	accepted, err := repo.AcceptChangeOrder(ctx, co.ID)
	require.NoError(t, err)
	require.Equal(t, "accepted", accepted.Status)
	require.NotNil(t, accepted.AcceptedAt)

	got, err := repo.GetContract(ctx, cid)
	require.NoError(t, err)
	require.Equal(t, start+delta, got.AmountCents, "contract amount must move by exactly the delta")
	require.Len(t, got.Milestones, 1)
	require.Equal(t, start+delta, got.Milestones[0].AmountCents, "single milestone must reconcile to contract amount")
}

// TestChangeOrder_NegativeDelta_ReducesAmount verifies a negative delta lowers
// the amount by exactly the delta (no sign/abs bug).
func TestChangeOrder_NegativeDelta_ReducesAmount(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()

	const start int64 = 100_000
	const delta int64 = -30_000
	cid := seedActiveContract(t, repo, start)

	co, err := repo.CreateChangeOrder(ctx, &domain.ChangeOrder{
		ContractID: cid, ProposedBy: coProviderID,
		Description: "Scope reduction", AmountDeltaCents: delta, Status: "proposed",
	})
	require.NoError(t, err)

	_, err = repo.AcceptChangeOrder(ctx, co.ID)
	require.NoError(t, err)

	got, err := repo.GetContract(ctx, cid)
	require.NoError(t, err)
	require.Equal(t, start+delta, got.AmountCents)
	require.Equal(t, start+delta, got.Milestones[0].AmountCents)
}

// TestChangeOrder_DoubleAccept_IsIdempotent verifies the delta is applied at
// most once: a second accept returns ErrChangeOrderNotPending and the amount is
// unchanged (no double-apply money bug).
func TestChangeOrder_DoubleAccept_IsIdempotent(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()

	const start int64 = 50_000
	const delta int64 = 10_000
	cid := seedActiveContract(t, repo, start)

	co, err := repo.CreateChangeOrder(ctx, &domain.ChangeOrder{
		ContractID: cid, ProposedBy: coProviderID,
		Description: "Add work", AmountDeltaCents: delta, Status: "proposed",
	})
	require.NoError(t, err)

	_, err = repo.AcceptChangeOrder(ctx, co.ID)
	require.NoError(t, err)

	_, err = repo.AcceptChangeOrder(ctx, co.ID)
	require.ErrorIs(t, err, domain.ErrChangeOrderNotPending, "second accept must not apply the delta again")

	got, err := repo.GetContract(ctx, cid)
	require.NoError(t, err)
	require.Equal(t, start+delta, got.AmountCents, "amount must reflect exactly one application of the delta")
}

// TestChangeOrder_Reject_NoMoneyChange verifies a reject moves no money and the
// status becomes 'rejected'.
func TestChangeOrder_Reject_NoMoneyChange(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()

	const start int64 = 80_000
	cid := seedActiveContract(t, repo, start)

	co, err := repo.CreateChangeOrder(ctx, &domain.ChangeOrder{
		ContractID: cid, ProposedBy: coProviderID,
		Description: "Rejected change", AmountDeltaCents: 99_999, Status: "proposed",
	})
	require.NoError(t, err)

	rejected, err := repo.RejectChangeOrder(ctx, co.ID)
	require.NoError(t, err)
	require.Equal(t, "rejected", rejected.Status)

	got, err := repo.GetContract(ctx, cid)
	require.NoError(t, err)
	require.Equal(t, start, got.AmountCents, "reject must not change the contract amount")
	require.Equal(t, start, got.Milestones[0].AmountCents)
}

// TestChangeOrder_RejectThenAccept_Blocked verifies a rejected change order
// cannot subsequently be accepted (state machine integrity).
func TestChangeOrder_RejectThenAccept_Blocked(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()

	cid := seedActiveContract(t, repo, 40_000)
	co, err := repo.CreateChangeOrder(ctx, &domain.ChangeOrder{
		ContractID: cid, ProposedBy: coProviderID,
		Description: "x", AmountDeltaCents: 5_000, Status: "proposed",
	})
	require.NoError(t, err)

	_, err = repo.RejectChangeOrder(ctx, co.ID)
	require.NoError(t, err)

	_, err = repo.AcceptChangeOrder(ctx, co.ID)
	require.ErrorIs(t, err, domain.ErrChangeOrderNotPending)

	got, err := repo.GetContract(ctx, cid)
	require.NoError(t, err)
	require.Equal(t, int64(40_000), got.AmountCents)
}

// TestChangeOrder_GetMissing returns ErrChangeOrderNotFound for an unknown id.
func TestChangeOrder_GetMissing(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	_, err := repo.GetChangeOrder(context.Background(), "00000000-0000-0000-0000-0000000000ff")
	require.ErrorIs(t, err, domain.ErrChangeOrderNotFound)
}
