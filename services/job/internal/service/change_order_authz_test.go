//go:build integration

// Service-layer authz + state-machine tests for the change-order flow, exercised
// against the running dev Postgres at :5433. These prove the wrong party cannot
// act and a change order cannot be created on a non-active contract — the IDOR /
// wrong-party-can-act and broken-transition concerns from the dogfood brief.
//
// Run:
//
//	DATABASE_URL=postgres://nomarkup@localhost:5433/nomarkup?sslmode=disable \
//	go test -tags=integration -count=1 -run TestChangeOrderAuthz ./internal/service/...
package service

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/crypto"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/repository"
	"github.com/stretchr/testify/require"
)

const (
	coCustomer = "00000000-0000-0000-0000-000000000002"
	coProvider = "00000000-0000-0000-0000-000000000004"
)

// seedChangeOrderJob inserts a fresh job (owned by the seed customer) with one
// bid from the seed provider, registers cleanup for the job and everything
// hanging off it, and returns the job and bid IDs.
//
// Every contract needs its OWN job: CreateContract is idempotent per job
// (uq_contracts_live_job, migration 078) and returns the existing live
// contract instead of creating a second one. These tests used to share one
// hard-coded job with internal/repository/change_order_test.go, and
// `go test ./...` runs the two test binaries concurrently against the same
// database — so a test could be handed the other binary's contract (wrong
// amount / wrong status) or have its contract deleted mid-test by the other
// binary's cleanup ("contract not found"). The users are the fixed seed
// accounts (`make seed`).
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
		VALUES ($1::uuid, 'Change-order authz fixture',
			'Created by change_order_authz_test (integration).', $2::uuid,
			'Austin', 'TX', '78701',
			ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
			ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
			'awarded')
		RETURNING id::text`, coCustomer, catID).Scan(&jobID),
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
		RETURNING id::text`, jobID, coProvider).Scan(&bidID),
		"provision change-order fixture bid")
	return jobID, bidID
}

func authzTestSvc(t *testing.T) (*ContractService, *repository.PostgresRepository, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://nomarkup@localhost:5433/nomarkup?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), url)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	// The repository decrypts jobs.service_address (migration 104) on every
	// read; with no ENCRYPTION_KEY set crypto.FromEnv yields an ephemeral
	// development key, and the fixture rows carry no address at all.
	cipher, err := crypto.FromEnv()
	require.NoError(t, err, "build PII cipher")
	repo := repository.NewPostgresRepository(pool, cipher)
	return NewContractService(repo, repo), repo, pool
}

func mkContract(t *testing.T, repo *repository.PostgresRepository, pool *pgxpool.Pool, status string) string {
	t.Helper()
	jobID, bidID := seedChangeOrderJob(t, pool)
	c, err := repo.CreateContract(context.Background(), &domain.Contract{
		JobID: jobID, CustomerID: coCustomer, ProviderID: coProvider, BidID: bidID,
		AmountCents: 100_000, PaymentTiming: "completion", Status: status,
		CustomerAccepted: true, ProviderAccepted: true,
	}, []domain.MilestoneInput{{Description: "Complete work", AmountCents: 100_000}})
	require.NoError(t, err)
	return c.ID
}

func TestChangeOrderAuthz_CustomerCannotPropose(t *testing.T) {
	svc, repo, pool := authzTestSvc(t)
	cid := mkContract(t, repo, pool, "active")
	_, err := svc.ProposeChangeOrder(context.Background(), cid, coCustomer, "x", 1000)
	require.ErrorIs(t, err, domain.ErrChangeOrderNotProposer)
}

func TestChangeOrderAuthz_NonPartyCannotPropose(t *testing.T) {
	svc, repo, pool := authzTestSvc(t)
	cid := mkContract(t, repo, pool, "active")
	// provider@ (...0003) is a real user but not a party to this contract.
	_, err := svc.ProposeChangeOrder(context.Background(), cid,
		"00000000-0000-0000-0000-000000000003", "x", 1000)
	require.ErrorIs(t, err, domain.ErrNotContractParty)
}

func TestChangeOrderAuthz_CannotProposeOnNonActive(t *testing.T) {
	svc, repo, pool := authzTestSvc(t)
	cid := mkContract(t, repo, pool, "pending_acceptance")
	_, err := svc.ProposeChangeOrder(context.Background(), cid, coProvider, "x", 1000)
	require.ErrorIs(t, err, domain.ErrContractNotActive)
}

func TestChangeOrderAuthz_ZeroAndAbsurdDeltaRejected(t *testing.T) {
	svc, repo, pool := authzTestSvc(t)
	cid := mkContract(t, repo, pool, "active")
	_, err := svc.ProposeChangeOrder(context.Background(), cid, coProvider, "x", 0)
	require.ErrorIs(t, err, domain.ErrInvalidChangeOrderDelta, "zero delta")

	// Negative delta larger than the contract amount would drive it <= 0.
	_, err = svc.ProposeChangeOrder(context.Background(), cid, coProvider, "x", -100_000)
	require.ErrorIs(t, err, domain.ErrInvalidChangeOrderDelta, "delta to zero amount")

	_, err = svc.ProposeChangeOrder(context.Background(), cid, coProvider, "x", 2_000_000_000_000)
	require.ErrorIs(t, err, domain.ErrInvalidChangeOrderDelta, "absurd delta")
}

func TestChangeOrderAuthz_ProviderCannotApprove(t *testing.T) {
	svc, repo, pool := authzTestSvc(t)
	ctx := context.Background()
	cid := mkContract(t, repo, pool, "active")
	co, err := svc.ProposeChangeOrder(ctx, cid, coProvider, "Add work", 5_000)
	require.NoError(t, err)

	// The provider (proposer) must not be able to approve their own change order.
	_, err = svc.RespondToChangeOrder(ctx, co.ID, coProvider, true)
	require.ErrorIs(t, err, domain.ErrChangeOrderNotResponder)

	// And the contract amount must be unchanged after the blocked approval.
	got, err := repo.GetContract(ctx, cid)
	require.NoError(t, err)
	require.Equal(t, int64(100_000), got.AmountCents)
}

func TestChangeOrderAuthz_NonPartyCannotRespond(t *testing.T) {
	svc, repo, pool := authzTestSvc(t)
	ctx := context.Background()
	cid := mkContract(t, repo, pool, "active")
	co, err := svc.ProposeChangeOrder(ctx, cid, coProvider, "Add work", 5_000)
	require.NoError(t, err)

	_, err = svc.RespondToChangeOrder(ctx, co.ID,
		"00000000-0000-0000-0000-000000000003", true)
	require.ErrorIs(t, err, domain.ErrNotContractParty)
}

func TestChangeOrderAuthz_CustomerApproveAppliesDelta(t *testing.T) {
	svc, repo, pool := authzTestSvc(t)
	ctx := context.Background()
	cid := mkContract(t, repo, pool, "active")
	co, err := svc.ProposeChangeOrder(ctx, cid, coProvider, "Add work", 12_345)
	require.NoError(t, err)

	updated, err := svc.RespondToChangeOrder(ctx, co.ID, coCustomer, true)
	require.NoError(t, err)
	require.Equal(t, "accepted", updated.Status)

	got, err := repo.GetContract(ctx, cid)
	require.NoError(t, err)
	require.Equal(t, int64(112_345), got.AmountCents)
	require.Equal(t, int64(112_345), got.Milestones[0].AmountCents)

	// Double-approve via the service must 409 (not re-apply).
	_, err = svc.RespondToChangeOrder(ctx, co.ID, coCustomer, true)
	require.ErrorIs(t, err, domain.ErrChangeOrderNotPending)
	got2, err := repo.GetContract(ctx, cid)
	require.NoError(t, err)
	require.Equal(t, int64(112_345), got2.AmountCents)
}
