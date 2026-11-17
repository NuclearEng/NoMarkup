//go:build integration

package repository

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// workEvidenceFixture is one contract between a customer and a provider with
// proof-of-work rows (migrations 123 / 138) and a calendar feed token for each
// party (migration 140).
type workEvidenceFixture struct {
	customerID, providerID, contractID string
	sessionLegacyID, sessionEncID      string
}

func requireTable(t *testing.T, repo *PostgresRepository, name string) {
	t.Helper()
	var reg *string
	require.NoError(t, repo.pool.QueryRow(context.Background(),
		`SELECT to_regclass($1)::text`, "public."+name).Scan(&reg))
	if reg == nil {
		t.Skipf("%s missing — apply migrations through 140", name)
	}
}

func seedWorkEvidence(t *testing.T, repo *PostgresRepository) workEvidenceFixture {
	t.Helper()
	requireTable(t, repo, "calendar_feed_tokens")
	ctx := context.Background()
	suffix := fmt.Sprint(time.Now().UnixNano())
	var f workEvidenceFixture

	require.NoError(t, repo.pool.QueryRow(ctx, `
		INSERT INTO users (email, display_name, roles, status)
		VALUES ($1, 'WE Customer', ARRAY['customer'], 'active') RETURNING id::text`,
		"gdpr-we-c-"+suffix+"@example.com").Scan(&f.customerID))
	require.NoError(t, repo.pool.QueryRow(ctx, `
		INSERT INTO users (email, display_name, roles, status)
		VALUES ($1, 'WE Provider', ARRAY['provider'], 'active') RETURNING id::text`,
		"gdpr-we-p-"+suffix+"@example.com").Scan(&f.providerID))

	var categoryID, jobID, bidID string
	require.NoError(t, repo.pool.QueryRow(ctx, `SELECT id::text FROM service_categories LIMIT 1`).Scan(&categoryID))
	require.NoError(t, repo.pool.QueryRow(ctx, `
		INSERT INTO jobs (customer_id, title, description, category_id,
		                  service_city, service_state, service_zip,
		                  service_location, approximate_location, status, scheduled_date)
		VALUES ($1, 'WE job', 'proof of work', $2::uuid, 'Austin', 'TX', '78702',
		        ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
		        ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326), 'active', now()::date)
		RETURNING id::text`, f.customerID, categoryID).Scan(&jobID))
	require.NoError(t, repo.pool.QueryRow(ctx, `
		INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, status)
		VALUES ($1::uuid, $2::uuid, 25000, 25000, 'awarded') RETURNING id::text`,
		jobID, f.providerID).Scan(&bidID))
	require.NoError(t, repo.pool.QueryRow(ctx, `
		INSERT INTO contracts (contract_number, job_id, customer_id, provider_id, bid_id,
		                       amount_cents, payment_timing, status, started_at)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 25000, 'completion', 'active', now())
		RETURNING id::text`, "NM-WE-"+suffix, jobID, f.customerID, f.providerID, bidID).Scan(&f.contractID))

	// One closed session written by a pre-138 gateway (plaintext ordinates),
	// one open session written by a 138 gateway (ciphertext only).
	require.NoError(t, repo.pool.QueryRow(ctx, `
		INSERT INTO contract_work_sessions (contract_id, provider_id, checked_in_at, check_in_lat, check_in_lng,
		                                    checked_out_at, check_out_lat, check_out_lng, duration_minutes)
		VALUES ($1, $2, now() - interval '3 hours', 30.27, -97.74, now() - interval '2 hours', 30.27, -97.74, 60)
		RETURNING id::text`, f.contractID, f.providerID).Scan(&f.sessionLegacyID))
	require.NoError(t, repo.pool.QueryRow(ctx, `
		INSERT INTO contract_work_sessions (contract_id, provider_id, checked_in_at, check_in_location_encrypted)
		VALUES ($1, $2, now() - interval '10 minutes', 'c2VjcmV0Ym94LXNoYXBlZC1jaXBoZXJ0ZXh0LWZvci10aGUtdGVzdA==')
		RETURNING id::text`, f.contractID, f.providerID).Scan(&f.sessionEncID))

	_, err := repo.pool.Exec(ctx, `
		INSERT INTO contract_completion_photos (contract_id, uploaded_by, phase, url) VALUES
		  ($1, $2, 'before', 'https://cdn.example/p-before.jpg'),
		  ($1, $2, 'after',  'https://cdn.example/p-after.jpg'),
		  ($1, $3, 'after',  'https://cdn.example/c-after.jpg')`,
		f.contractID, f.providerID, f.customerID)
	require.NoError(t, err)

	_, err = repo.pool.Exec(ctx, `
		INSERT INTO calendar_feed_tokens (token_hash, user_id, expires_at) VALUES
		  ($1, $2, now() + interval '90 days'),
		  ($3, $4, now() + interval '90 days')`,
		strings.Repeat("a", 48)+fmt.Sprintf("%016x", time.Now().UnixNano()), f.providerID,
		strings.Repeat("b", 48)+fmt.Sprintf("%016x", time.Now().UnixNano()), f.customerID)
	require.NoError(t, err)

	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = repo.pool.Exec(ctx, `DELETE FROM calendar_feed_tokens WHERE user_id IN ($1, $2)`, f.customerID, f.providerID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM contract_completion_photos WHERE contract_id = $1`, f.contractID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM contract_work_sessions WHERE contract_id = $1`, f.contractID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM contracts WHERE id = $1`, f.contractID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM bids WHERE id = $1`, bidID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, jobID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, f.customerID, f.providerID)
	})
	return f
}

type sessionState struct {
	checkedIn                    time.Time
	checkedOut                   *time.Time
	duration                     *int
	inEnc, outEnc                *string
	inLat, inLng, outLat, outLng *float64
}

func readSession(t *testing.T, repo *PostgresRepository, id string) sessionState {
	t.Helper()
	var s sessionState
	require.NoError(t, repo.pool.QueryRow(context.Background(), `
		SELECT checked_in_at, checked_out_at, duration_minutes,
		       check_in_location_encrypted, check_out_location_encrypted,
		       check_in_lat, check_in_lng, check_out_lat, check_out_lng
		  FROM contract_work_sessions WHERE id = $1`, id).Scan(
		&s.checkedIn, &s.checkedOut, &s.duration, &s.inEnc, &s.outEnc,
		&s.inLat, &s.inLng, &s.outLat, &s.outLng))
	return s
}

func assertCoordinatesErased(t *testing.T, s sessionState) {
	t.Helper()
	assert.Nil(t, s.inEnc)
	assert.Nil(t, s.outEnc)
	assert.Nil(t, s.inLat)
	assert.Nil(t, s.inLng)
	assert.Nil(t, s.outLat)
	assert.Nil(t, s.outLng)
}

func countRows(t *testing.T, repo *PostgresRepository, sql string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, repo.pool.QueryRow(context.Background(), sql, args...).Scan(&n))
	return n
}

// Erasing the PROVIDER keeps the session timestamps (contract evidence), nulls
// every coordinate, deletes the photos the provider uploaded (their S3 objects
// go with job-photos/{provider}/) but not the customer's, and revokes the
// provider's calendar feeds only.
func TestGDPR_ErasesProviderWorkEvidenceLocationsAndFeeds_Integration(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	f := seedWorkEvidence(t, repo)
	before := readSession(t, repo, f.sessionLegacyID)

	require.NoError(t, repo.MarkDeletionRequested(ctx, f.providerID, "test", time.Now().UTC()))
	counts, err := repo.FinalizeAccountDeletion(ctx, f.providerID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), counts["contract_work_sessions"])
	assert.Equal(t, int64(2), counts["contract_completion_photos"])
	assert.Equal(t, int64(1), counts["calendar_feed_tokens"])

	legacy := readSession(t, repo, f.sessionLegacyID)
	assertCoordinatesErased(t, legacy)
	assert.WithinDuration(t, before.checkedIn, legacy.checkedIn, time.Microsecond, "timestamps are kept as contract evidence")
	require.NotNil(t, legacy.checkedOut)
	require.NotNil(t, legacy.duration)
	assert.Equal(t, 60, *legacy.duration)
	assertCoordinatesErased(t, readSession(t, repo, f.sessionEncID))

	assert.Equal(t, 0, countRows(t, repo, `SELECT count(*) FROM contract_completion_photos WHERE uploaded_by = $1`, f.providerID))
	assert.Equal(t, 1, countRows(t, repo, `SELECT count(*) FROM contract_completion_photos WHERE uploaded_by = $1`, f.customerID))
	assert.Equal(t, 0, countRows(t, repo, `SELECT count(*) FROM calendar_feed_tokens WHERE user_id = $1`, f.providerID))
	assert.Equal(t, 1, countRows(t, repo, `SELECT count(*) FROM calendar_feed_tokens WHERE user_id = $1`, f.customerID))
	assert.Equal(t, 0, countRows(t, repo,
		`SELECT count(*) FROM pii_plaintext_audit WHERE table_name = 'contract_work_sessions' AND id IN ($1, $2)`,
		f.sessionLegacyID, f.sessionEncID))
}

// Erasing the CUSTOMER also nulls the coordinates (they locate the customer's
// home) while leaving the provider's photos — the provider's evidence.
func TestGDPR_ErasesCustomerWorkSessionLocations_Integration(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	f := seedWorkEvidence(t, repo)

	require.NoError(t, repo.MarkDeletionRequested(ctx, f.customerID, "test", time.Now().UTC()))
	counts, err := repo.FinalizeAccountDeletion(ctx, f.customerID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), counts["contract_work_sessions"])

	assertCoordinatesErased(t, readSession(t, repo, f.sessionLegacyID))
	assertCoordinatesErased(t, readSession(t, repo, f.sessionEncID))
	assert.Equal(t, 2, countRows(t, repo, `SELECT count(*) FROM contract_completion_photos WHERE uploaded_by = $1`, f.providerID))
	assert.Equal(t, 0, countRows(t, repo, `SELECT count(*) FROM contract_completion_photos WHERE uploaded_by = $1`, f.customerID))
	assert.Equal(t, 0, countRows(t, repo, `SELECT count(*) FROM calendar_feed_tokens WHERE user_id = $1`, f.customerID))
	assert.Equal(t, 2, countRows(t, repo, `SELECT count(*) FROM contract_work_sessions WHERE contract_id = $1`, f.contractID),
		"session rows are retained with the contract")
}
