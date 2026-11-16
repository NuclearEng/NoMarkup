//go:build integration

// Integration tests for the contract change-order money/state machine.
//
// These exercise the real Postgres repo at :5433 (the running dev DB), covering
// the bug fixed in this branch: ProposeChangeOrder / RespondToChangeOrder were
// entirely unimplemented in the job service, so the gateway returned 501 for
// both POST and PUT change-order endpoints.
//
// Run:
//
//	DATABASE_URL=postgres://nomarkup@localhost:5433/nomarkup?sslmode=disable \
//	go test -tags=integration -count=1 -run TestChangeOrder ./internal/repository/...
//
// Every contract gets its OWN job + bid (seedChangeOrderJob). CreateContract is
// idempotent per job (uq_contracts_live_job, migration 078): a second create
// for a job that already has a live contract returns the existing row. Sharing
// one hard-coded job across tests — and across the repository and service test
// binaries, which `go test ./...` runs concurrently — therefore handed tests
// each other's contracts (wrong amounts, "contract not found" after the other
// binary's cleanup). Only the two seed users (`make seed`) are shared.
package repository

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/stretchr/testify/require"
)

const (
	coCustomerID = "00000000-0000-0000-0000-000000000002"
	coProviderID = "00000000-0000-0000-0000-000000000004"
)

// seedChangeOrderJob inserts a fresh job (owned by the seed customer) with one
// bid from the seed provider, and registers cleanup for the job and everything
// hanging off it. It returns the job and bid IDs.
func seedChangeOrderJob(t *testing.T, pool *pgxpool.Pool) (jobID, bidID string) {
	t.Helper()
	ctx := context.Background()

	var catID string
	require.NoError(t,
		pool.QueryRow(ctx, `SELECT id::text FROM service_categories ORDER BY id LIMIT 1`).Scan(&catID),
		"need service_categories taxonomy — run migrations first")

	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO jobs (customer_id, title, description, category_id,
			service_city, service_state, service_zip,
			service_location, approximate_location, status)
		VALUES ($1::uuid, 'Change-order fixture',
			'Created by change_order_test (integration).', $2::uuid,
			'Austin', 'TX', '78701',
			ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
			ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
			'awarded')
		RETURNING id::text`, coCustomerID, catID).Scan(&jobID),
		"provision change-order fixture job (seed users required — run `make seed`)")

	t.Cleanup(func() {
		cctx := context.Background()
		// Children first: contracts hold FKs onto jobs and bids; change_orders
		// and milestones cascade on contract delete.
		_, _ = pool.Exec(cctx, `DELETE FROM contracts WHERE job_id = $1::uuid`, jobID)
		_, _ = pool.Exec(cctx, `DELETE FROM bids WHERE job_id = $1::uuid`, jobID)
		_, _ = pool.Exec(cctx, `DELETE FROM jobs WHERE id = $1::uuid`, jobID)
	})

	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents)
		VALUES ($1::uuid, $2::uuid, 100000, 100000)
		RETURNING id::text`, jobID, coProviderID).Scan(&bidID),
		"provision change-order fixture bid")
	return jobID, bidID
}

// seedActiveContract creates an active contract with a single full-amount
// milestone on its own fresh job and returns its ID. Cleanup is registered by
// seedChangeOrderJob.
func seedActiveContract(t *testing.T, repo *PostgresRepository, amountCents int64) string {
	t.Helper()
	jobID, bidID := seedChangeOrderJob(t, repo.pool)
	c, err := repo.CreateContract(context.Background(), &domain.Contract{
		JobID:            jobID,
		CustomerID:       coCustomerID,
		ProviderID:       coProviderID,
		BidID:            bidID,
		AmountCents:      amountCents,
		PaymentTiming:    "completion",
		Status:           "active",
		CustomerAccepted: true,
		ProviderAccepted: true,
	}, []domain.MilestoneInput{{Description: "Complete work", AmountCents: amountCents}})
	require.NoError(t, err)
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
