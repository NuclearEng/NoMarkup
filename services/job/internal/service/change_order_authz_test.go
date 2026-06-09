//go:build integration

// Service-layer authz + state-machine tests for the change-order flow, exercised
// against the running dev Postgres at :5433. These prove the wrong party cannot
// act and a change order cannot be created on a non-active contract — the IDOR /
// wrong-party-can-act and broken-transition concerns from the dogfood brief.
//
// Run:
//   DATABASE_URL=postgres://nomarkup@localhost:5433/nomarkup?sslmode=disable \
//   go test -tags=integration -count=1 -run TestChangeOrderAuthz ./internal/service/...
package service

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/repository"
	"github.com/stretchr/testify/require"
)

const (
	coCustomer = "00000000-0000-0000-0000-000000000002"
	coProvider = "00000000-0000-0000-0000-000000000004"
	coJob      = "ec6b56bd-4348-446a-875e-21b0359a06cb"
	coBid      = "fa199d9a-491d-4883-b52b-b992b7ac8355"
)

func authzTestSvc(t *testing.T) (*ContractService, *repository.PostgresRepository, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://nomarkup@localhost:5433/nomarkup?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), url)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	repo := repository.NewPostgresRepository(pool)
	return NewContractService(repo, repo), repo, pool
}

func mkContract(t *testing.T, repo *repository.PostgresRepository, pool *pgxpool.Pool, status string) string {
	t.Helper()
	c, err := repo.CreateContract(context.Background(), &domain.Contract{
		JobID: coJob, CustomerID: coCustomer, ProviderID: coProvider, BidID: coBid,
		AmountCents: 100_000, PaymentTiming: "completion", Status: status,
		CustomerAccepted: true, ProviderAccepted: true,
	}, []domain.MilestoneInput{{Description: "Complete work", AmountCents: 100_000}})
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM contracts WHERE id = $1`, c.ID)
	})
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
