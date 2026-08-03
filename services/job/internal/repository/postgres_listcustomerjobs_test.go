//go:build integration

// Regression test for ListCustomerJobs column-count parity with scanJobRow.
//
// Bug: ListCustomerJobs' SELECT was missing the three columns
//   is_hourly, hourly_rate_cents, same_day_requested
// while scanJobRow was upgraded to scan 45 destinations. Every call returned
//   "number of field descriptions must equal number of destinations, got 42 and 45"
// and the gateway returned 500 for /api/jobs/customer.
//
// Run:
//   DATABASE_URL=postgres://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable \
//   go test -tags=integration -count=1 -run TestListCustomerJobs_ColumnParity \
//       ./internal/repository/...

package repository

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/crypto"
	"github.com/stretchr/testify/require"
)

// testCipher builds the PII cipher the repository needs for
// jobs.service_address and jobs.service_location_encrypted (migration 104).
// With no ENCRYPTION_KEY set, crypto.FromEnv falls back to an ephemeral
// development key, which is all these tests need: rows they read were written
// either as legacy plaintext (passthrough) or by this same process.
func testCipher(t *testing.T) *crypto.Cipher {
	t.Helper()
	c, err := crypto.FromEnv()
	require.NoError(t, err, "build PII cipher")
	return c
}

// seededCustomerID is the customer-role user planted by `make seed`.
const seededCustomerID = "00000000-0000-0000-0000-000000000002"

func repoTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), url)
	require.NoError(t, err, "connect db at %s", url)
	t.Cleanup(pool.Close)
	return pool
}

// TestListCustomerJobs_ColumnParity asserts that ListCustomerJobs' SELECT
// list matches scanJobRow's destination count. Before today's fix this test
// would have surfaced:
//   list customer jobs scan: number of field descriptions must equal number
//   of destinations, got 42 and 45
func TestListCustomerJobs_ColumnParity(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()

	jobs, pagination, err := repo.ListCustomerJobs(ctx, seededCustomerID, domain.ListCustomerJobsFilter{}, 1, 20)
	require.NoError(t, err, "ListCustomerJobs must not return a scan error")
	require.NotNil(t, pagination)
	require.Greater(t, pagination.TotalCount, 0,
		"seeded DB should have at least one job for customer %s — run `make seed`",
		seededCustomerID)
	require.NotEmpty(t, jobs, "seeded customer should have visible jobs")

	// Spot-check a few of the columns that were missing before the fix.
	// If any of these are zero-value across every returned row, the SELECT
	// shape is suspect. (We only require the fields to be populated by the
	// scanner — actual values come from the seed data.)
	j := jobs[0]
	require.NotEmpty(t, j.ID)
	require.Equal(t, seededCustomerID, j.CustomerID)
	// j.IsHourly / j.HourlyRateCents / j.SameDayRequested are present in
	// domain.Job. The scan would fail above if their slots were missing,
	// so reaching this line proves column parity.
}

// TestListDrafts_ColumnParity covers the sibling list-by-customer query.
// It uses the same scanJobRow helper and was updated in the same fix wave.
// Even if there are zero drafts for the seeded customer, the query itself
// must execute without a scan error (the loop simply won't run).
func TestListDrafts_ColumnParity(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()

	_, err := repo.ListDrafts(ctx, seededCustomerID)
	require.NoError(t, err, "ListDrafts must not return a scan error")
}

// TestAdminListJobs_ColumnParity covers the admin-facing list query — same
// scanJobRow helper, same column-parity hazard. The original fix wave missed
// this one; T1's regression sweep caught it.
func TestAdminListJobs_ColumnParity(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()

	jobs, pagination, err := repo.AdminListJobs(ctx, nil, nil, nil, 1, 20)
	require.NoError(t, err, "AdminListJobs must not return a scan error")
	require.NotNil(t, pagination)
	require.Greater(t, pagination.TotalCount, 0,
		"seeded DB should have admin-visible jobs — run `make seed`")
	require.NotEmpty(t, jobs)
}
