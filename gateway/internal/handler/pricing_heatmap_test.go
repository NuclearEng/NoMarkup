package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHeatmapQuery_joinsZipCodesAndDropsUnknown(t *testing.T) {
	q := strings.ToLower(heatmapQuery)
	assert.Contains(t, q, "join zip_codes")
	assert.Contains(t, q, "z.lat")
	assert.Contains(t, q, "z.lng")
	assert.Contains(t, q, "zip_code <> 'unknown'")
	assert.NotContains(t, q, "39.8283")
	assert.NotContains(t, q, "-98.5795")
}

func TestGetHeatmap_nilDBEmptyPoints(t *testing.T) {
	h := NewPricingHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/pricing/heatmap", nil)
	rec := httptest.NewRecorder()

	h.GetHeatmap(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	body := decodeJSONResponse(t, rec)
	points, ok := body["points"].([]interface{})
	require.True(t, ok)
	assert.Empty(t, points)
	cc := rec.Header().Get("Cache-Control")
	assert.Contains(t, cc, "s-maxage=")
}

func TestGetHeatmap_categoryQueryAccepted(t *testing.T) {
	h := NewPricingHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/pricing/heatmap?category=plumbing", nil)
	rec := httptest.NewRecorder()

	h.GetHeatmap(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	body := decodeJSONResponse(t, rec)
	_, ok := body["points"].([]interface{})
	assert.True(t, ok)
}

func heatmapTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("GATEWAY_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no GATEWAY_TEST_DATABASE_URL/DATABASE_URL — skipping heatmap SQL test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func TestHeatmapSQL_unknownZipOmittedKnownPresent(t *testing.T) {
	pool := heatmapTestPool(t)
	ctx := context.Background()

	// Exercise the same join contract against VALUES so the test does not
	// depend on the materialized view having rows.
	const probe = `
		WITH fair_price_index(zip_code, median_price_cents, completed_jobs, category_slug) AS (
			VALUES
				('98103', 18500::bigint, 8::bigint, 'plumbing'),
				('unknown', 10000::bigint, 5::bigint, 'plumbing'),
				('00000', 1::bigint, 3::bigint, 'plumbing')
		), zip_codes(zip, lat, lng) AS (
			VALUES ('98103', 47.67::float8, -122.34::float8)
		)
		SELECT z.zip, z.lat, z.lng, f.median_price_cents, f.completed_jobs
		FROM fair_price_index f
		INNER JOIN zip_codes z ON z.zip = f.zip_code
		WHERE f.zip_code <> 'unknown'`

	rows, err := pool.Query(ctx, probe)
	require.NoError(t, err)
	defer rows.Close()

	var got []heatmapPoint
	for rows.Next() {
		var p heatmapPoint
		require.NoError(t, rows.Scan(&p.ZipCode, &p.Lat, &p.Lng, &p.MedianPriceCents, &p.CompletedJobs))
		got = append(got, p)
	}
	require.NoError(t, rows.Err())
	require.Len(t, got, 1)
	assert.Equal(t, "98103", got[0].ZipCode)
	assert.InDelta(t, 47.67, got[0].Lat, 0.001)
	assert.InDelta(t, -122.34, got[0].Lng, 0.001)
	assert.Equal(t, int64(18500), got[0].MedianPriceCents)
}

func TestGetHeatmap_liveHandlerDropsUnknown(t *testing.T) {
	pool := heatmapTestPool(t)
	h := NewPricingHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/pricing/heatmap", nil)
	rec := httptest.NewRecorder()
	h.GetHeatmap(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	body := decodeJSONResponse(t, rec)
	raw, ok := body["points"].([]interface{})
	require.True(t, ok)
	for _, item := range raw {
		p, ok := item.(map[string]interface{})
		require.True(t, ok)
		zip, _ := p["zip_code"].(string)
		assert.NotEqual(t, "unknown", zip)
		assert.NotEmpty(t, zip)
		_, hasLat := p["lat"]
		_, hasLng := p["lng"]
		assert.True(t, hasLat)
		assert.True(t, hasLng)
	}
}
