//go:build integration

// Integration tests for CreateContract's idempotency against migration 078's
// uq_contracts_live_job partial UNIQUE index.
//
// Bug: CreateContract was a bare INSERT. Migration 078 correctly prevents a
// second live contract per job, but the documented award-failure recovery path
// (gateway/internal/handler/bid.go: "re-call this endpoint") then hit a raw
// 23505, which surfaced to the user as a 500. A predictable condition must not
// be a 500 (CLAUDE.md §15).
//
// Run:
//
//	DATABASE_URL=... go test -tags=integration -count=1 \
//	    -run TestCreateContract ./internal/repository/...
//
// Each test seeds its own users/job/bids and removes them in cleanup, so it
// leaves no residue and does not depend on `make seed` fixtures.
package repository

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// contractFixture is a self-contained job with two bids from two providers.
type contractFixture struct {
	jobID      string
	customerID string
	providerA  string
	providerB  string
	bidA       string
	bidB       string
	categoryID string
}

func seedContractFixture(t *testing.T, pool *pgxpool.Pool) contractFixture {
	t.Helper()
	ctx := context.Background()
	suffix := time.Now().UnixNano()

	var f contractFixture
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT id::text FROM service_categories ORDER BY id LIMIT 1`).Scan(&f.categoryID))

	mkUser := func(role, label string) string {
		var id string
		require.NoError(t, pool.QueryRow(ctx, `
			INSERT INTO users (email, display_name, roles)
			VALUES ($1, $2, ARRAY[$3]::text[])
			RETURNING id::text`,
			fmt.Sprintf("ct-%s-%d@example.test", label, suffix),
			"Contract Test "+label, role).Scan(&id))
		return id
	}
	f.customerID = mkUser("customer", "cust")
	f.providerA = mkUser("provider", "provA")
	f.providerB = mkUser("provider", "provB")

	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO jobs (customer_id, title, description, category_id,
		                  service_city, service_state, service_zip,
		                  service_location, approximate_location, status)
		VALUES ($1, 'contract idempotency job', 'desc', $2::uuid,
		        'Austin', 'TX', '78701',
		        ST_SetSRID(ST_MakePoint(-97.7, 30.3), 4326),
		        ST_SetSRID(ST_MakePoint(-97.7, 30.3), 4326),
		        'active')
		RETURNING id::text`, f.customerID, f.categoryID).Scan(&f.jobID))

	mkBid := func(providerID string, amount int64) string {
		var id string
		require.NoError(t, pool.QueryRow(ctx, `
			INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, status)
			VALUES ($1::uuid, $2::uuid, $3, $3, 'active')
			RETURNING id::text`, f.jobID, providerID, amount).Scan(&id))
		return id
	}
	f.bidA = mkBid(f.providerA, 120000)
	f.bidB = mkBid(f.providerB, 130000)

	t.Cleanup(func() {
		cctx := context.Background()
		// Children first — contracts/milestones hold FKs onto jobs and bids.
		_, _ = pool.Exec(cctx, `DELETE FROM milestones WHERE contract_id IN
			(SELECT id FROM contracts WHERE job_id = $1::uuid)`, f.jobID)
		_, _ = pool.Exec(cctx, `DELETE FROM contracts WHERE job_id = $1::uuid`, f.jobID)
		_, _ = pool.Exec(cctx, `DELETE FROM bids WHERE job_id = $1::uuid`, f.jobID)
		_, _ = pool.Exec(cctx, `DELETE FROM jobs WHERE id = $1::uuid`, f.jobID)
		_, _ = pool.Exec(cctx, `DELETE FROM users WHERE id = ANY($1::uuid[])`,
			[]string{f.customerID, f.providerA, f.providerB})
	})
	return f
}

func newContract(f contractFixture, bidID string, amount int64) *domain.Contract {
	return &domain.Contract{
		JobID:         f.jobID,
		CustomerID:    f.customerID,
		ProviderID:    f.providerA,
		BidID:         bidID,
		AmountCents:   amount,
		PaymentTiming: "completion",
		Status:        "pending_acceptance",
	}
}

func liveContractCount(t *testing.T, pool *pgxpool.Pool, jobID string) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM contracts
		 WHERE job_id = $1::uuid AND deleted_at IS NULL
		   AND status NOT IN ('cancelled', 'voided')`, jobID).Scan(&n))
	return n
}

// TestCreateContract_RetryIsIdempotent is the core case: calling the award path
// twice with the same bid must return the SAME contract and leave exactly one
// live row — no 23505, no second escrow lifecycle.
func TestCreateContract_RetryIsIdempotent(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	f := seedContractFixture(t, pool)
	ctx := context.Background()

	milestones := []domain.MilestoneInput{{Description: "Complete work", AmountCents: 120000}}

	first, err := repo.CreateContract(ctx, newContract(f, f.bidA, 120000), milestones)
	require.NoError(t, err, "first award must succeed")
	require.NotEmpty(t, first.ID)
	require.Equal(t, 1, liveContractCount(t, pool, f.jobID))

	second, err := repo.CreateContract(ctx, newContract(f, f.bidA, 120000), milestones)
	require.NoError(t, err, "retrying the same award must not error (was a raw 23505 -> 500)")
	require.Equal(t, first.ID, second.ID, "retry must return the existing contract")
	require.Equal(t, first.ContractNumber, second.ContractNumber)
	require.Equal(t, first.AmountCents, second.AmountCents)
	require.Equal(t, 1, liveContractCount(t, pool, f.jobID),
		"retry must not create a second contract")

	// The retry must not duplicate milestones either.
	var milestoneCount int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM milestones WHERE contract_id = $1::uuid`, first.ID).Scan(&milestoneCount))
	require.Equal(t, 1, milestoneCount, "retry must not re-insert milestones")
}

// TestCreateContract_SecondBidConflicts asserts the other branch: awarding a
// DIFFERENT bid on an already-contracted job is a conflict, not a retry, and
// must surface as a typed sentinel rather than the other provider's contract.
func TestCreateContract_SecondBidConflicts(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	f := seedContractFixture(t, pool)
	ctx := context.Background()

	_, err := repo.CreateContract(ctx, newContract(f, f.bidA, 120000),
		[]domain.MilestoneInput{{Description: "Work", AmountCents: 120000}})
	require.NoError(t, err)

	_, err = repo.CreateContract(ctx, newContract(f, f.bidB, 130000),
		[]domain.MilestoneInput{{Description: "Work", AmountCents: 130000}})
	require.Error(t, err, "awarding a second bid must be refused")
	require.True(t, errors.Is(err, domain.ErrJobAlreadyContracted),
		"must be the typed sentinel (gateway maps it to 409), got: %v", err)
	require.Equal(t, 1, liveContractCount(t, pool, f.jobID))
}

// TestCreateContract_CancelledFreesTheJob guards the product transition
// migration 078 deliberately allows: once a contract is cancelled it stops
// counting as live, so the customer can award a different bid.
func TestCreateContract_CancelledFreesTheJob(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	f := seedContractFixture(t, pool)
	ctx := context.Background()

	first, err := repo.CreateContract(ctx, newContract(f, f.bidA, 120000),
		[]domain.MilestoneInput{{Description: "Work", AmountCents: 120000}})
	require.NoError(t, err)

	_, err = pool.Exec(ctx,
		`UPDATE contracts SET status = 'cancelled' WHERE id = $1::uuid`, first.ID)
	require.NoError(t, err)
	require.Equal(t, 0, liveContractCount(t, pool, f.jobID))

	second, err := repo.CreateContract(ctx, newContract(f, f.bidB, 130000),
		[]domain.MilestoneInput{{Description: "Work", AmountCents: 130000}})
	require.NoError(t, err, "a cancelled contract must free the job for re-award")
	require.NotEqual(t, first.ID, second.ID)
	require.Equal(t, 1, liveContractCount(t, pool, f.jobID))
}

// TestCreateContract_ConcurrentAwardsProduceOne hammers the race the advisory
// FOR UPDATE lock and ON CONFLICT DO NOTHING backstop exist for: N goroutines
// awarding the same bid simultaneously must yield exactly one contract, and
// every caller must get that same contract back with no error.
func TestCreateContract_ConcurrentAwardsProduceOne(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	f := seedContractFixture(t, pool)

	const racers = 8
	type result struct {
		id  string
		err error
	}
	results := make(chan result, racers)
	start := make(chan struct{})

	for i := 0; i < racers; i++ {
		go func() {
			<-start
			c, err := repo.CreateContract(context.Background(),
				newContract(f, f.bidA, 120000),
				[]domain.MilestoneInput{{Description: "Work", AmountCents: 120000}})
			if err != nil {
				results <- result{err: err}
				return
			}
			results <- result{id: c.ID}
		}()
	}
	close(start)

	ids := make(map[string]struct{})
	for i := 0; i < racers; i++ {
		r := <-results
		require.NoError(t, r.err, "no racer may see a raw unique-violation error")
		ids[r.id] = struct{}{}
	}
	require.Len(t, ids, 1, "every racer must observe the same contract, got %v", ids)
	require.Equal(t, 1, liveContractCount(t, pool, f.jobID))
}
