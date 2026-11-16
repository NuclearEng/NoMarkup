//go:build integration

// Integration tests for GetCategoryMetrics.
//
// Bug: the query was a 3-way LEFT JOIN fan-out
// (service_categories → jobs → bids → analytics_transactions) whose date range
// lived ONLY inside FILTER (...) aggregate clauses. A FILTER prunes rows after
// they are read, so nothing bounded the scan and every admin analytics page
// load re-read the whole GMV ledger plus every bid ever placed
// (EXPLAIN: Seq Scan on analytics_transactions). LIMIT 100 sits above the
// GROUP BY and bounds nothing.
//
// The fan-out also over-counted GMV: bids × analytics_transactions multiplied
// each other, and SUM(at.amount_cents) — unlike the COUNT(DISTINCT ...)
// columns — had no protection, so each transaction was summed once per bid on
// the same job.
//
// Run:
//
//	DATABASE_URL=... go test -tags=integration -count=1 \
//	    -run TestGetCategoryMetrics ./internal/repository/...
package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

var (
	metricsWindowStart = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	metricsWindowEnd   = time.Date(2026, 3, 31, 23, 59, 59, 0, time.UTC)
)

// seedCategoryMetricsFixture builds one category with:
//   - 2 jobs created inside the window (1 completed inside it),
//   - 3 bids inside the window on those jobs,
//   - 1 analytics_transaction completed inside the window, on a job that has
//     MULTIPLE bids — the exact shape that made the old query multiply GMV.
func seedCategoryMetricsFixture(t *testing.T, pool *pgxpool.Pool) (categoryID string, wantGMV int64) {
	t.Helper()
	ctx := context.Background()
	suffix := time.Now().UnixNano()

	// A private category so no other data can contaminate the assertions.
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO service_categories (name, slug, level)
		VALUES ($1, $2, 1)
		RETURNING id::text`,
		fmt.Sprintf("Metrics Fixture %d", suffix),
		fmt.Sprintf("metrics-fixture-%d", suffix)).Scan(&categoryID))

	mkUser := func(role, label string) string {
		var id string
		require.NoError(t, pool.QueryRow(ctx, `
			INSERT INTO users (email, display_name, roles)
			VALUES ($1, $2, ARRAY[$3]::text[])
			RETURNING id::text`,
			fmt.Sprintf("cm-%s-%d@example.test", label, suffix),
			"Metrics "+label, role).Scan(&id))
		return id
	}
	customerID := mkUser("customer", "cust")
	provA := mkUser("provider", "a")
	provB := mkUser("provider", "b")
	provC := mkUser("provider", "c")

	mkJob := func(status string, createdAt time.Time) string {
		var id string
		require.NoError(t, pool.QueryRow(ctx, `
			INSERT INTO jobs (customer_id, title, description, category_id,
			                  service_city, service_state, service_zip,
			                  service_location, approximate_location,
			                  status, created_at)
			VALUES ($1::uuid, 'metrics job', 'desc', $2::uuid,
			        'Austin', 'TX', '78701',
			        ST_SetSRID(ST_MakePoint(-97.7, 30.3), 4326),
			        ST_SetSRID(ST_MakePoint(-97.7, 30.3), 4326),
			        $3, $4)
			RETURNING id::text`, customerID, categoryID, status, createdAt).Scan(&id))
		return id
	}

	// backdateUpdatedAt models "this job was completed inside the window".
	//
	// It must run LAST, after every bid is inserted: bids carries
	// bids_update_bid_count, which UPDATEs the parent job, which fires
	// set_updated_at_jobs and re-stamps updated_at = now(). Back-dating before
	// the bids exist is silently undone (observed: updated_at came back as
	// now(), and jobs_completed read 0).
	//
	// All three statements also have to share ONE transaction — issued
	// separately through the pool they can land on different sessions, leaving
	// the UPDATE to run with the trigger still live.
	backdateUpdatedAt := func(jobID string, updatedAt time.Time) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback(ctx) }()
		_, err = tx.Exec(ctx, `ALTER TABLE jobs DISABLE TRIGGER USER`)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `UPDATE jobs SET updated_at = $2 WHERE id = $1::uuid`, jobID, updatedAt)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `ALTER TABLE jobs ENABLE TRIGGER USER`)
		require.NoError(t, err)
		require.NoError(t, tx.Commit(ctx))
	}

	inWindow := metricsWindowStart.Add(24 * time.Hour)
	completedAt := metricsWindowStart.Add(30 * 24 * time.Hour)
	jobCompleted := mkJob("completed", inWindow)
	jobActive := mkJob("active", inWindow.Add(48*time.Hour))

	mkBid := func(jobID, providerID string, amount int64, createdAt time.Time) string {
		var id string
		require.NoError(t, pool.QueryRow(ctx, `
			INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents,
			                  status, created_at)
			VALUES ($1::uuid, $2::uuid, $3, $3, 'active', $4)
			RETURNING id::text`, jobID, providerID, amount, createdAt).Scan(&id))
		return id
	}
	// THREE bids on the completed job — the fan-out multiplier.
	bidA := mkBid(jobCompleted, provA, 50000, inWindow)
	mkBid(jobCompleted, provB, 51000, inWindow)
	mkBid(jobActive, provC, 60000, inWindow)

	var contractID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO contracts (contract_number, job_id, customer_id, provider_id,
		                       bid_id, amount_cents, payment_timing, status)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 50000, 'completion', 'completed')
		RETURNING id::text`,
		fmt.Sprintf("NM-TEST-%d", suffix%100000),
		jobCompleted, customerID, provA, bidA).Scan(&contractID))

	// Deliberately huge: GetCategoryMetrics is ORDER BY gmv_cents DESC LIMIT 100,
	// so the fixture has to outrank whatever else the database holds to be
	// guaranteed a place in the result set.
	wantGMV = 900_000_000_000
	_, err := pool.Exec(ctx, `
		INSERT INTO analytics_transactions (job_id, contract_id, customer_id, provider_id,
		                                    service_type_id, zip_code, city, state,
		                                    amount_cents, bid_count, completed_at)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
		        '78701', 'Austin', 'TX', $6, 3, $7)`,
		jobCompleted, contractID, customerID, provA, categoryID,
		wantGMV, completedAt)
	require.NoError(t, err)

	// Last, once nothing else will touch the jobs rows again.
	backdateUpdatedAt(jobCompleted, completedAt)
	backdateUpdatedAt(jobActive, inWindow.Add(48*time.Hour))

	t.Cleanup(func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM analytics_transactions WHERE service_type_id = $1::uuid`, categoryID)
		_, _ = pool.Exec(cctx, `DELETE FROM milestones WHERE contract_id = $1::uuid`, contractID)
		_, _ = pool.Exec(cctx, `DELETE FROM contracts WHERE id = $1::uuid`, contractID)
		_, _ = pool.Exec(cctx, `DELETE FROM bids WHERE job_id IN ($1::uuid, $2::uuid)`, jobCompleted, jobActive)
		_, _ = pool.Exec(cctx, `DELETE FROM jobs WHERE category_id = $1::uuid`, categoryID)
		_, _ = pool.Exec(cctx, `DELETE FROM users WHERE id = ANY($1::uuid[])`,
			[]string{customerID, provA, provB, provC})
		_, _ = pool.Exec(cctx, `DELETE FROM service_categories WHERE id = $1::uuid`, categoryID)
	})
	return categoryID, wantGMV
}

// TestGetCategoryMetrics_GMVNotMultipliedByBidCount is the regression test for
// the fan-out over-count. A single transaction on a job carrying three bids
// must report its amount once, not three times.
func TestGetCategoryMetrics_GMVNotMultipliedByBidCount(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	categoryID, wantGMV := seedCategoryMetricsFixture(t, pool)

	rows, err := repo.GetCategoryMetrics(context.Background(), metricsWindowStart, metricsWindowEnd)
	require.NoError(t, err)

	var found bool
	for _, m := range rows {
		if m.CategoryID != categoryID {
			continue
		}
		found = true
		require.Equal(t, wantGMV, m.GMVCents,
			"GMV must count each transaction once, not once per bid on its job")
		require.Equal(t, int32(2), m.JobsPosted, "both jobs were created inside the window")
		require.Equal(t, int32(1), m.JobsCompleted)
		require.Equal(t, int32(3), m.ActiveProviders, "three distinct providers bid inside the window")
		require.InDelta(t, 1.5, m.AvgBidsPerJob, 0.0001, "3 bids / 2 jobs")
		require.InDelta(t, 1.0, m.FillRate, 0.0001, "active + completed both count as filled")
		require.Equal(t, wantGMV, m.AvgJobValueCents, "GMV / 1 completed job")
	}
	require.True(t, found, "the seeded category must appear in the results")
}

// TestGetCategoryMetrics_MatchesLedgerTruth cross-checks reported GMV against a
// direct de-duplicated sum over the ledger, for EVERY category the query
// returns. Against the old query this failed on effectively every category
// that had both bids and transactions.
func TestGetCategoryMetrics_MatchesLedgerTruth(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()

	// Wide window so this exercises whatever data the database happens to hold.
	start := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Now().Add(24 * time.Hour)

	rows, err := repo.GetCategoryMetrics(ctx, start, end)
	require.NoError(t, err)
	if len(rows) == 0 {
		t.Skip("no categories with jobs in the window in this database")
	}

	truth := make(map[string]int64, len(rows))
	dbRows, err := pool.Query(ctx, `
		SELECT j.category_id::text, COALESCE(SUM(at.amount_cents), 0)::bigint
		  FROM analytics_transactions at
		  JOIN jobs j ON j.id = at.job_id AND j.deleted_at IS NULL
		 WHERE at.completed_at >= $1 AND at.completed_at <= $2
		 GROUP BY j.category_id`, start, end)
	require.NoError(t, err)
	defer dbRows.Close()
	for dbRows.Next() {
		var id string
		var gmv int64
		require.NoError(t, dbRows.Scan(&id, &gmv))
		truth[id] = gmv
	}
	require.NoError(t, dbRows.Err())

	for _, m := range rows {
		require.Equal(t, truth[m.CategoryID], m.GMVCents,
			"category %s (%s): reported GMV must equal the de-duplicated ledger sum",
			m.CategoryID, m.CategoryName)
	}
}
