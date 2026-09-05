//go:build integration

package repository

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/services/user/internal/crypto"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// Run with:
//   DATABASE_URL=postgresql://nomarkup@localhost:5433/nomarkup?sslmode=disable \
//     go test -tags=integration ./internal/repository/...
//
// The test creates and destroys its own users (random uuid in email) so it
// is safe against the dev database. It does NOT assume an empty database.

func openTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgresql://nomarkup@localhost:5433/nomarkup?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), url)
	require.NoError(t, err)
	require.NoError(t, pool.Ping(context.Background()))
	return pool
}

func newTestRepo(t *testing.T) *PostgresRepository {
	t.Helper()
	pool := openTestDB(t)
	t.Cleanup(pool.Close)
	cipher, err := crypto.FromEnv()
	require.NoError(t, err)
	return NewPostgresRepository(pool, cipher)
}

// seedTestUser creates a minimally-populated user row plus a few related
// rows so the cascade has something to anonymize. Returns the userID and
// a cleanup function the test should call (which deletes the user row
// directly to avoid leaking test data even if the cascade did not run).
func seedTestUser(t *testing.T, repo *PostgresRepository, suffix string) (string, func()) {
	t.Helper()
	ctx := context.Background()

	email := fmt.Sprintf("gdpr-test-%s-%d@example.com", suffix, time.Now().UnixNano())

	var userID string
	err := repo.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, roles, status)
		VALUES ($1, 'fake-hash', 'Test User', ARRAY['customer','provider'], 'active')
		RETURNING id`, email).Scan(&userID)
	require.NoError(t, err)

	// Provider profile with PII columns populated.
	_, err = repo.pool.Exec(ctx, `
		INSERT INTO provider_profiles (user_id, business_name, bio, service_address, service_radius_km, ein_tin, insurance_policy_number)
		VALUES ($1, 'Acme Plumbing', 'best in town', '123 Main St', 50, '12-3456789', 'POL-001')`, userID)
	require.NoError(t, err)

	// Property with NOT NULL location.
	_, err = repo.pool.Exec(ctx, `
		INSERT INTO properties (user_id, address, city, state, zip_code, location)
		VALUES ($1, '742 Evergreen Terrace', 'Springfield', 'IL', '62701',
		        ST_SetSRID(ST_MakePoint(-89.6, 39.78), 4326))`, userID)
	require.NoError(t, err)

	// Notification.
	_, err = repo.pool.Exec(ctx, `
		INSERT INTO notifications (user_id, notification_type, title, body)
		VALUES ($1, 'new_bid', 'A bid landed', 'You got a bid')`, userID)
	require.NoError(t, err)

	cleanup := func() {
		// Best-effort. Delete in dependency order; ignore errors.
		_, _ = repo.pool.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1`, userID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM properties WHERE user_id = $1`, userID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM provider_portfolio_images WHERE provider_id IN (SELECT id FROM provider_profiles WHERE user_id = $1)`, userID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM provider_profiles WHERE user_id = $1`, userID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, userID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	}
	return userID, cleanup
}

func TestGDPR_FullLifecycle_Integration(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	userID, cleanup := seedTestUser(t, repo, "lifecycle")
	defer cleanup()

	// 1. Request deletion.
	requestedAt := time.Now().UTC()
	require.NoError(t, repo.MarkDeletionRequested(ctx, userID, "no longer needed", requestedAt))

	// State should reflect: requested but not finalized.
	requested, finalized, err := repo.GetUserDeletionState(ctx, userID)
	require.NoError(t, err)
	require.NotNil(t, requested)
	assert.WithinDuration(t, requestedAt, *requested, time.Second)
	assert.Nil(t, finalized)

	// 2. Re-request: should error with AlreadyRequested.
	err = repo.MarkDeletionRequested(ctx, userID, "again", requestedAt.Add(time.Hour))
	assert.ErrorIs(t, err, domain.ErrDeletionAlreadyRequested)

	// 3. Cancel.
	require.NoError(t, repo.ClearDeletionRequest(ctx, userID))
	requested, _, err = repo.GetUserDeletionState(ctx, userID)
	require.NoError(t, err)
	assert.Nil(t, requested)

	// 4. Re-request and finalize.
	require.NoError(t, repo.MarkDeletionRequested(ctx, userID, "final attempt", time.Now().UTC()))
	counts, err := repo.FinalizeAccountDeletion(ctx, userID)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, counts["users"], int64(1))
	assert.GreaterOrEqual(t, counts["provider_profiles"], int64(1))
	assert.GreaterOrEqual(t, counts["properties"], int64(1))
	assert.GreaterOrEqual(t, counts["notifications"], int64(1))

	// 5. Verify SQL evidence: PII columns wiped.
	var (
		gotEmail        string
		gotDisplayName  string
		gotPhone        *string
		gotPasswordHash *string
		gotStatus       string
		gotMFASecret    *string
	)
	err = repo.pool.QueryRow(ctx, `
		SELECT email, display_name, phone, password_hash, status, mfa_secret
		  FROM users WHERE id = $1`, userID).Scan(&gotEmail, &gotDisplayName, &gotPhone, &gotPasswordHash, &gotStatus, &gotMFASecret)
	require.NoError(t, err)
	assert.Equal(t, fmt.Sprintf("deleted-%s@deleted.local", userID), gotEmail)
	assert.Equal(t, "Deleted User", gotDisplayName)
	assert.Nil(t, gotPhone)
	assert.Nil(t, gotPasswordHash)
	assert.Equal(t, "deactivated", gotStatus)
	assert.Nil(t, gotMFASecret)

	// Provider profile.
	var (
		gotBusinessName *string
		gotBio          *string
		gotServiceAddr  *string
		gotEIN          *string
	)
	err = repo.pool.QueryRow(ctx, `
		SELECT business_name, bio, service_address, ein_tin
		  FROM provider_profiles WHERE user_id = $1`, userID).Scan(&gotBusinessName, &gotBio, &gotServiceAddr, &gotEIN)
	require.NoError(t, err)
	require.NotNil(t, gotBusinessName)
	assert.Equal(t, "Deleted Provider", *gotBusinessName)
	assert.Nil(t, gotBio)
	assert.Nil(t, gotServiceAddr)
	assert.Nil(t, gotEIN)

	// Properties — kept zip_code, anonymized everything else.
	var gotAddr, gotZip string
	err = repo.pool.QueryRow(ctx, `
		SELECT address, zip_code FROM properties WHERE user_id = $1`, userID).Scan(&gotAddr, &gotZip)
	require.NoError(t, err)
	assert.Equal(t, "[deleted]", gotAddr)
	assert.Equal(t, "62701", gotZip, "zip retained for analytics")

	// Notifications deleted.
	var notifCount int
	err = repo.pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE user_id = $1`, userID).Scan(&notifCount)
	require.NoError(t, err)
	assert.Equal(t, 0, notifCount)

	// 6. Idempotency.
	_, err = repo.FinalizeAccountDeletion(ctx, userID)
	assert.ErrorIs(t, err, domain.ErrDeletionAlreadyFinalized)
}

func TestGDPR_ListPendingFinalizations_RespectsCutoff(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	freshID, cleanFresh := seedTestUser(t, repo, "pending-fresh")
	defer cleanFresh()
	expiredID, cleanExpired := seedTestUser(t, repo, "pending-expired")
	defer cleanExpired()

	now := time.Now().UTC()
	require.NoError(t, repo.MarkDeletionRequested(ctx, freshID, "fresh", now))
	require.NoError(t, repo.MarkDeletionRequested(ctx, expiredID, "expired", now.Add(-31*24*time.Hour)))

	pending, err := repo.ListPendingFinalizations(ctx, now.Add(-30*24*time.Hour), 100)
	require.NoError(t, err)

	gotIDs := make(map[string]bool)
	for _, p := range pending {
		gotIDs[p.UserID] = true
	}
	assert.Contains(t, gotIDs, expiredID, "expired user must be listed")
	assert.NotContains(t, gotIDs, freshID, "fresh user must NOT be listed")
}
