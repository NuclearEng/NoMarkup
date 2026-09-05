//go:build integration

// GetMarketRange used to look up zip_code = fmt.Sprintf("%.4f,%.4f", lat, lng),
// which never matched market_ranges (real US ZIPs like 78701).
//
// Run:
//
//	DATABASE_URL=... go test -tags=integration -count=1 \
//	    -run 'TestNearestZip|TestGetMarketRange' ./internal/repository/...
package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/stretchr/testify/require"
)

// zip_codes seed (migration 039): Austin 78701 at 30.2672,-97.7431.
const (
	fixtureAustinLat = 30.2672
	fixtureAustinLng = -97.7431
	fixtureAustinZip = "78701"
	oceanLat         = 0.0
	oceanLng         = -40.0
)

func seedMarketRangeFixture(t *testing.T, pool *pgxpool.Pool) (categoryID string) {
	t.Helper()
	ctx := context.Background()
	suffix := time.Now().UnixNano()

	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO service_categories (name, slug, level)
		VALUES ($1, $2, 1)
		RETURNING id::text`,
		fmt.Sprintf("Market Range Fixture %d", suffix),
		fmt.Sprintf("market-range-fixture-%d", suffix)).Scan(&categoryID))

	_, err := pool.Exec(ctx, `
		INSERT INTO market_ranges (service_type_id, zip_code, city, state,
			low_cents, median_cents, high_cents, data_points,
			source, confidence, valid_until)
		VALUES ($1::uuid, $2, 'Austin', 'TX',
			15000, 30000, 50000, 42,
			'seeded', 0.65, now() + interval '90 days')`,
		categoryID, fixtureAustinZip)
	require.NoError(t, err)

	t.Cleanup(func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM market_ranges WHERE service_type_id = $1::uuid`, categoryID)
		_, _ = pool.Exec(cctx, `DELETE FROM service_categories WHERE id = $1::uuid`, categoryID)
	})
	return categoryID
}

func TestNearestZip_FixtureAustinHits78701(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))

	zip, err := repo.NearestZip(context.Background(), fixtureAustinLat, fixtureAustinLng, 80)
	require.NoError(t, err)
	require.Equal(t, fixtureAustinZip, zip)
}

func TestNearestZip_OceanMisses(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))

	_, err := repo.NearestZip(context.Background(), oceanLat, oceanLng, 80)
	require.Error(t, err)
	require.ErrorIs(t, err, domain.ErrMarketRangeNotFound)
}

func TestGetMarketRange_ZipStringPath(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	categoryID := seedMarketRangeFixture(t, pool)

	mr, err := repo.GetMarketRange(context.Background(), categoryID, nil, nil, fixtureAustinZip)
	require.NoError(t, err)
	require.Equal(t, fixtureAustinZip, mr.ZipCode)
	require.Equal(t, int64(30000), mr.MedianCents)

	mr, err = repo.GetMarketRange(context.Background(), categoryID, nil, nil, "78701-1234")
	require.NoError(t, err)
	require.Equal(t, fixtureAustinZip, mr.ZipCode)
}

func TestGetMarketRangeAt_AustinCoordsHitFixtureZip(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	categoryID := seedMarketRangeFixture(t, pool)

	mr, err := repo.GetMarketRangeAt(context.Background(), categoryID, nil, nil,
		fixtureAustinLat, fixtureAustinLng, 80)
	require.NoError(t, err)
	require.Equal(t, fixtureAustinZip, mr.ZipCode)
	require.Equal(t, int64(30000), mr.MedianCents)
	require.Equal(t, "Austin", mr.City)
}

func TestGetMarketRangeAt_OceanMisses(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	categoryID := seedMarketRangeFixture(t, pool)

	_, err := repo.GetMarketRangeAt(context.Background(), categoryID, nil, nil, oceanLat, oceanLng, 80)
	require.Error(t, err)
	require.ErrorIs(t, err, domain.ErrMarketRangeNotFound)
}

func TestGetClearedPriceTransactions_FillsNearestMarketID(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()
	suffix := time.Now().UnixNano()

	var categoryID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO service_categories (name, slug, level)
		VALUES ($1, $2, 1)
		RETURNING id::text`,
		fmt.Sprintf("Cleared Price Market %d", suffix),
		fmt.Sprintf("cleared-price-market-%d", suffix)).Scan(&categoryID))

	marketSlug := fmt.Sprintf("test-austin-mr-%d", suffix)
	_, err := pool.Exec(ctx, `
		INSERT INTO markets (slug, name, region, region_code, country, source, is_active, lat, lng, location)
		VALUES ($1, 'Test Austin', 'Texas', 'TX', 'US', 'manual', true,
		        $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography)`,
		marketSlug, fixtureAustinLat, fixtureAustinLng)
	require.NoError(t, err)

	mkUser := func(role, label string) string {
		var id string
		require.NoError(t, pool.QueryRow(ctx, `
			INSERT INTO users (email, display_name, roles)
			VALUES ($1, $2, ARRAY[$3]::text[])
			RETURNING id::text`,
			fmt.Sprintf("mr-%s-%d@example.test", label, suffix),
			"MarketRange "+label, role).Scan(&id))
		return id
	}
	customerID := mkUser("customer", "cust")
	providerID := mkUser("provider", "prov")

	var jobID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO jobs (customer_id, title, description, category_id,
		                  service_city, service_state, service_zip,
		                  service_location, approximate_location, status)
		VALUES ($1::uuid, 'cleared price geo job', 'desc', $2::uuid,
		        'Austin', 'TX', $3,
		        ST_SetSRID(ST_MakePoint($4, $5), 4326),
		        ST_SetSRID(ST_MakePoint($4, $5), 4326),
		        'completed')
		RETURNING id::text`,
		customerID, categoryID, fixtureAustinZip, fixtureAustinLng, fixtureAustinLat).Scan(&jobID))

	var bidID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, status)
		VALUES ($1::uuid, $2::uuid, 25000, 25000, 'awarded')
		RETURNING id::text`, jobID, providerID).Scan(&bidID))

	settled := time.Now().UTC().Add(-24 * time.Hour)
	var contractID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO contracts (contract_number, job_id, customer_id, provider_id,
		                       bid_id, amount_cents, payment_timing, status, completed_at)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 25000, 'completion', 'completed', $6)
		RETURNING id::text`,
		fmt.Sprintf("NM-MR-%d", suffix%100000),
		jobID, customerID, providerID, bidID, settled).Scan(&contractID))

	t.Cleanup(func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM contracts WHERE id = $1::uuid`, contractID)
		_, _ = pool.Exec(cctx, `DELETE FROM bids WHERE id = $1::uuid`, bidID)
		_, _ = pool.Exec(cctx, `DELETE FROM jobs WHERE id = $1::uuid`, jobID)
		_, _ = pool.Exec(cctx, `DELETE FROM users WHERE id = ANY($1::uuid[])`, []string{customerID, providerID})
		_, _ = pool.Exec(cctx, `DELETE FROM markets WHERE slug = $1`, marketSlug)
		_, _ = pool.Exec(cctx, `DELETE FROM service_categories WHERE id = $1::uuid`, categoryID)
	})

	txns, err := repo.GetClearedPriceTransactions(ctx, categoryID, time.Now().UTC())
	require.NoError(t, err)
	require.Len(t, txns, 1)
	require.Equal(t, marketSlug, txns[0].MarketID)
	require.Equal(t, fixtureAustinZip, txns[0].Zip)
}

func TestGetClearedPriceTransactions_OceanJobLeavesMarketIDEmpty(t *testing.T) {
	pool := repoTestDB(t)
	repo := NewPostgresRepository(pool, testCipher(t))
	ctx := context.Background()
	suffix := time.Now().UnixNano()

	var categoryID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO service_categories (name, slug, level)
		VALUES ($1, $2, 1)
		RETURNING id::text`,
		fmt.Sprintf("Cleared Price Ocean %d", suffix),
		fmt.Sprintf("cleared-price-ocean-%d", suffix)).Scan(&categoryID))

	mkUser := func(role, label string) string {
		var id string
		require.NoError(t, pool.QueryRow(ctx, `
			INSERT INTO users (email, display_name, roles)
			VALUES ($1, $2, ARRAY[$3]::text[])
			RETURNING id::text`,
			fmt.Sprintf("mro-%s-%d@example.test", label, suffix),
			"MarketRangeOcean "+label, role).Scan(&id))
		return id
	}
	customerID := mkUser("customer", "cust")
	providerID := mkUser("provider", "prov")

	var jobID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO jobs (customer_id, title, description, category_id,
		                  service_city, service_state, service_zip,
		                  service_location, approximate_location, status)
		VALUES ($1::uuid, 'ocean job', 'desc', $2::uuid,
		        'Atlantic', 'XX', '',
		        ST_SetSRID(ST_MakePoint($3, $4), 4326),
		        ST_SetSRID(ST_MakePoint($3, $4), 4326),
		        'completed')
		RETURNING id::text`,
		customerID, categoryID, oceanLng, oceanLat).Scan(&jobID))

	var bidID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, status)
		VALUES ($1::uuid, $2::uuid, 10000, 10000, 'awarded')
		RETURNING id::text`, jobID, providerID).Scan(&bidID))

	settled := time.Now().UTC().Add(-24 * time.Hour)
	var contractID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO contracts (contract_number, job_id, customer_id, provider_id,
		                       bid_id, amount_cents, payment_timing, status, completed_at)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 10000, 'completion', 'completed', $6)
		RETURNING id::text`,
		fmt.Sprintf("NM-MRO-%d", suffix%100000),
		jobID, customerID, providerID, bidID, settled).Scan(&contractID))

	t.Cleanup(func() {
		cctx := context.Background()
		_, _ = pool.Exec(cctx, `DELETE FROM contracts WHERE id = $1::uuid`, contractID)
		_, _ = pool.Exec(cctx, `DELETE FROM bids WHERE id = $1::uuid`, bidID)
		_, _ = pool.Exec(cctx, `DELETE FROM jobs WHERE id = $1::uuid`, jobID)
		_, _ = pool.Exec(cctx, `DELETE FROM users WHERE id = ANY($1::uuid[])`, []string{customerID, providerID})
		_, _ = pool.Exec(cctx, `DELETE FROM service_categories WHERE id = $1::uuid`, categoryID)
	})

	txns, err := repo.GetClearedPriceTransactions(ctx, categoryID, time.Now().UTC())
	require.NoError(t, err)
	require.Len(t, txns, 1)
	require.Empty(t, txns[0].MarketID)
}
