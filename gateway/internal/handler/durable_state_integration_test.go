//go:build integration

// Integration tests for the state moved out of evictable Redis (migrations
// 138 and 140): work-session evidence and calendar feed tokens, including the
// read-only legacy-Redis fallbacks. Postgres comes from DATABASE_URL (or
// GATEWAY_TEST_DATABASE_URL); the Redis cases additionally need REDIS_TEST_URL
// and skip without it.
//
//	DATABASE_URL=postgres://.../nomarkup_itest?sslmode=disable \
//	REDIS_TEST_URL=redis://127.0.0.1:6379/0 ENCRYPTION_KEY=... \
//	  go test -tags integration -run 'Durable' ./internal/handler/

package handler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
)

func durableTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := workEvidenceTestPool(t)
	for _, probe := range []string{
		`SELECT 1 FROM information_schema.columns WHERE table_name = 'contract_work_sessions' AND column_name = 'check_in_location_encrypted'`,
		`SELECT 1 FROM information_schema.tables WHERE table_name = 'calendar_feed_tokens'`,
	} {
		var one int
		if err := pool.QueryRow(context.Background(), probe).Scan(&one); err != nil {
			t.Skipf("schema predates migrations 138/140 (%v) — run migrate up", err)
		}
	}
	return pool
}

func durableTestRedis(t *testing.T) *cache.Client {
	t.Helper()
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		t.Skip("REDIS_TEST_URL unset — skipping legacy-Redis fallback test")
	}
	c := cache.New(url)
	if c == nil {
		t.Skip("Redis unreachable at REDIS_TEST_URL")
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func durableTestCipher(t *testing.T) *crypto.Cipher {
	t.Helper()
	var key [crypto.KeySize]byte
	_, err := rand.Read(key[:])
	require.NoError(t, err)
	return crypto.New(&key, nil)
}

// ── migration shape ─────────────────────────────────────────────────────────

func TestDurable_MigrationShape(t *testing.T) {
	pool := durableTestPool(t)
	ctx := context.Background()

	// 140: the hash CHECK rejects anything but 64 lowercase hex chars, so a raw
	// secret (or an upper-case hash) can never be stored by mistake.
	_, customerID, _ := seedWorkEvidenceContract(t, pool)
	_, err := pool.Exec(ctx, `INSERT INTO calendar_feed_tokens (token_hash, user_id, expires_at)
		VALUES ('not-a-hash', $1, now() + interval '1 day')`, customerID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "check constraint")

	// 139: plaintext work-session ordinates are reported by the audit view.
	contractID, _, providerID := seedWorkEvidenceContract(t, pool)
	var sessionID string
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO contract_work_sessions (contract_id, provider_id, checked_in_at, check_in_lat, check_in_lng)
		VALUES ($1, $2, now(), 30.27, -97.74) RETURNING id::text`, contractID, providerID).Scan(&sessionID))
	var cols []string
	rows, err := pool.Query(ctx, `SELECT column_name FROM pii_plaintext_audit WHERE id::text = $1`, sessionID)
	require.NoError(t, err)
	for rows.Next() {
		var c string
		require.NoError(t, rows.Scan(&c))
		cols = append(cols, c)
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, []string{"check_in_lat_lng"}, cols)
}

// ── work sessions ───────────────────────────────────────────────────────────

func TestDurable_WorkSessionStoreRoundTrip_encryptsAndClearsPlaintext(t *testing.T) {
	pool := durableTestPool(t)
	ctx := context.Background()
	contractID, _, providerID := seedWorkEvidenceContract(t, pool)
	cipher := durableTestCipher(t)
	store := pgWorkSessionStore{db: pool, cipher: cipher}

	// A row an OLD pod wrote in clear, still open.
	_, err := pool.Exec(ctx, `
		INSERT INTO contract_work_sessions (contract_id, provider_id, checked_in_at, check_in_lat, check_in_lng)
		VALUES ($1, $2, now() - interval '5 minutes', 1, 2)`, contractID, providerID)
	require.NoError(t, err)

	in := time.Now().UTC().Truncate(time.Second)
	require.NoError(t, store.RecordCheckIn(ctx, contractID, providerID, 30.2672, -97.7431, in))
	at, open, err := store.OpenCheckIn(ctx, contractID, providerID)
	require.NoError(t, err)
	require.True(t, open)
	assert.WithinDuration(t, in, at, time.Millisecond)

	out := in.Add(42 * time.Minute)
	require.NoError(t, store.RecordCheckOut(ctx, contractID, providerID, 30.2673, -97.7432, out, 42, in))
	sess, ok, err := store.Latest(ctx, contractID, providerID)
	require.NoError(t, err)
	require.True(t, ok)
	require.NotNil(t, sess.checkedOutAt)
	assert.Equal(t, 42, sess.durationMinutes)

	var n int
	var inEnc, outEnc *string
	var plaintext bool
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT count(*) OVER (), check_in_location_encrypted, check_out_location_encrypted,
		       (check_in_lat IS NOT NULL OR check_in_lng IS NOT NULL OR check_out_lat IS NOT NULL OR check_out_lng IS NOT NULL)
		  FROM contract_work_sessions WHERE contract_id = $1`, contractID).Scan(&n, &inEnc, &outEnc, &plaintext))
	assert.Equal(t, 1, n, "the refresh reused the open legacy row")
	assert.False(t, plaintext, "a new write clears the legacy plaintext ordinates")
	require.NotNil(t, inEnc)
	require.NotNil(t, outEnc)
	got, err := cipher.DecryptString(*inEnc)
	require.NoError(t, err)
	assert.Equal(t, "30.2672000,-97.7431000", got)
	got, err = cipher.DecryptString(*outEnc)
	require.NoError(t, err)
	assert.Equal(t, "30.2673000,-97.7432000", got)

	// The evidence pack and the release gate read the same rows.
	ready, missing, err := evaluateProofOfWork(ctx, pool, contractID)
	require.NoError(t, err)
	assert.False(t, ready)
	assert.Equal(t, []string{proofMissingAfterPhoto}, missing)
}

// Redis now holds nothing for a check-in: evicting every key changes nothing.
func TestDurable_WorkSessionSurvivesRedisLoss(t *testing.T) {
	pool := durableTestPool(t)
	rc := durableTestRedis(t)
	contractID, _, providerID := seedWorkEvidenceContract(t, pool)
	h := NewWorkspaceHandler(rc, nil, pool, durableTestCipher(t))
	r := workspaceTestRouter(h)
	base := "/api/v1/contracts/" + contractID

	code, _ := doWorkspaceAs(t, r, providerID, http.MethodPost, base+"/checkin", map[string]float64{"lat": 30.27, "lng": -97.74})
	require.Equal(t, http.StatusOK, code)

	ctx := context.Background()
	for _, k := range []string{legacyCheckInKey(contractID, providerID), legacyCheckOutKey(contractID, providerID)} {
		n, err := rc.Redis().Exists(ctx, k).Result()
		require.NoError(t, err)
		assert.Zero(t, n, "%s must not be written any more", k)
	}
	keys, err := rc.Redis().Keys(ctx, "contract:photo:"+contractID+":*").Result()
	require.NoError(t, err)
	assert.Empty(t, keys)

	code, got := doWorkspaceAs(t, r, providerID, http.MethodGet, base+"/work-session", nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "checked_in", got["status"])

	code, got = doWorkspaceAs(t, r, providerID, http.MethodPost, base+"/checkout", map[string]float64{"lat": 30.27, "lng": -97.74})
	require.Equal(t, http.StatusOK, code, got)
	code, got = doWorkspaceAs(t, r, providerID, http.MethodGet, base+"/work-session", nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "checked_out", got["status"])
}

// LEGACY fallback: a session that exists only as pre-138 Redis keys is still
// served, and a check-out against it lands durably in Postgres.
func TestDurable_WorkSessionLegacyRedisFallback(t *testing.T) {
	pool := durableTestPool(t)
	rc := durableTestRedis(t)
	ctx := context.Background()
	contractID, _, providerID := seedWorkEvidenceContract(t, pool)
	h := NewWorkspaceHandler(rc, nil, pool, durableTestCipher(t))
	r := workspaceTestRouter(h)
	base := "/api/v1/contracts/" + contractID

	legacyIn := time.Now().UTC().Add(-30 * time.Minute).Truncate(time.Second)
	rc.SetJSON(ctx, legacyCheckInKey(contractID, providerID), checkInData{Lat: 30.27, Lng: -97.74, Timestamp: legacyIn}, time.Hour)
	t.Cleanup(func() { h.legacy.forget(context.Background(), contractID, providerID) })

	code, got := doWorkspaceAs(t, r, providerID, http.MethodGet, base+"/work-session", nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "checked_in", got["status"])
	assert.Equal(t, legacyIn.Format(time.RFC3339), got["checked_in_at"])

	code, got = doWorkspaceAs(t, r, providerID, http.MethodPost, base+"/checkout", map[string]float64{"lat": 30.27, "lng": -97.74})
	require.Equal(t, http.StatusOK, code, got)
	assert.EqualValues(t, 30, got["duration_minutes"])

	sess, ok, err := pgWorkSessionStore{db: pool}.Latest(ctx, contractID, providerID)
	require.NoError(t, err)
	require.True(t, ok, "legacy check-in + new check-out is now a durable closed session")
	assert.WithinDuration(t, legacyIn, sess.checkedInAt, time.Second)
	require.NotNil(t, sess.checkedOutAt)

	n, err := rc.Redis().Exists(ctx, legacyCheckInKey(contractID, providerID)).Result()
	require.NoError(t, err)
	assert.Zero(t, n, "the legacy key is dropped once a durable row supersedes it")

	// Postgres wins over a stale legacy key from here on.
	rc.SetJSON(ctx, legacyCheckOutKey(contractID, providerID), checkOutData{Timestamp: legacyIn, DurationMinutes: 999}, time.Hour)
	_, got = doWorkspaceAs(t, r, providerID, http.MethodGet, base+"/work-session", nil)
	assert.EqualValues(t, 30, got["duration_minutes"])
}

func doWorkspaceAs(t *testing.T, r http.Handler, userID, method, path string, body interface{}) (int, map[string]interface{}) {
	t.Helper()
	var payload string
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		payload = string(b)
	}
	req := httptest.NewRequest(method, path, strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, userID, "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	out := map[string]interface{}{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// ── calendar feed tokens ────────────────────────────────────────────────────

func feedHash(t *testing.T) (secret, hashHex string) {
	t.Helper()
	secret, hashHex, err := mintCalendarFeedSecret()
	require.NoError(t, err)
	return secret, hashHex
}

func TestDurable_CalendarFeedStoreRoundTripExpiryAndPrune(t *testing.T) {
	pool := durableTestPool(t)
	ctx := context.Background()
	_, userID, _ := seedWorkEvidenceContract(t, pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM calendar_feed_tokens WHERE user_id = $1`, userID)
	})
	store := pgCalendarFeedStore{db: pool}

	_, live := feedHash(t)
	require.NoError(t, store.Put(ctx, live, userID, calendarFeedTTL))
	got, ok := store.Get(ctx, live)
	require.True(t, ok)
	assert.Equal(t, userID, got)

	var expires time.Time
	require.NoError(t, pool.QueryRow(ctx, `SELECT expires_at FROM calendar_feed_tokens WHERE token_hash = $1`, live).Scan(&expires))
	assert.WithinDuration(t, time.Now().Add(calendarFeedTTL), expires, time.Minute, "90-day expiry")

	// Expired: dead on read before any prune runs.
	_, stale := feedHash(t)
	_, err := pool.Exec(ctx, `INSERT INTO calendar_feed_tokens (token_hash, user_id, expires_at, created_at)
		VALUES ($1, $2, now() - interval '1 second', now() - interval '91 days')`, stale, userID)
	require.NoError(t, err)
	_, ok = store.Get(ctx, stale)
	assert.False(t, ok, "an expired token must not authenticate")

	// The next mint prunes it.
	_, another := feedHash(t)
	require.NoError(t, store.Put(ctx, another, userID, calendarFeedTTL))
	var n int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM calendar_feed_tokens WHERE token_hash = $1`, stale).Scan(&n))
	assert.Zero(t, n, "expired token pruned on mint")

	_, ok = store.Get(ctx, strings.Repeat("0", 64))
	assert.False(t, ok)
}

// End to end through the handler: mint, then the calendar app's poll.
func TestDurable_CalendarFeedMintThenPoll(t *testing.T) {
	pool := durableTestPool(t)
	_, userID, _ := seedWorkEvidenceContract(t, pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM calendar_feed_tokens WHERE user_id = $1`, userID)
	})
	h := NewCalendarExportHandler(pool, nil, durableTestCipher(t))

	req := httptest.NewRequest(http.MethodPost, "https://api.example.com/api/v1/me/calendar-feed", nil)
	req = addClaimsToRequest(req, userID, "u@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	h.MintFeed(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var minted map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &minted))
	feedURL := minted["url"]
	require.Contains(t, feedURL, "?feed=")

	// The raw secret is not in the table; its hash is.
	secret := feedURL[strings.Index(feedURL, "?feed=")+len("?feed="):]
	sum := sha256.Sum256([]byte(secret))
	var stored int
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT count(*) FROM calendar_feed_tokens WHERE token_hash = $1 AND user_id = $2`,
		hex.EncodeToString(sum[:]), userID).Scan(&stored))
	assert.Equal(t, 1, stored)
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT count(*) FROM calendar_feed_tokens WHERE token_hash = $1`, secret).Scan(&stored))
	assert.Zero(t, stored)

	poll := httptest.NewRequest(http.MethodGet, "https://api.example.com/api/v1/me/calendar.ics?feed="+secret, nil)
	rec = httptest.NewRecorder()
	h.ExportICS(rec, poll)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "BEGIN:VCALENDAR")
}

// LEGACY fallback: a pre-140 Redis-only token keeps working, is adopted into
// Postgres with the TTL it had left, and leaves Redis.
func TestDurable_CalendarFeedLegacyRedisAdoption(t *testing.T) {
	pool := durableTestPool(t)
	rc := durableTestRedis(t)
	ctx := context.Background()
	_, userID, _ := seedWorkEvidenceContract(t, pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM calendar_feed_tokens WHERE user_id = $1`, userID)
	})
	h := NewCalendarExportHandler(pool, nil, durableTestCipher(t)).WithCache(rc)

	secret, hashHex := feedHash(t)
	remaining := 10 * 24 * time.Hour
	require.NoError(t, rc.Redis().Set(ctx, legacyCalendarFeedKey(hashHex), userID, remaining).Err())
	t.Cleanup(func() { rc.Delete(context.Background(), legacyCalendarFeedKey(hashHex)) })

	got, ok := h.lookupFeed(ctx, secret)
	require.True(t, ok)
	assert.Equal(t, userID, got)

	var expires time.Time
	require.NoError(t, pool.QueryRow(ctx, `SELECT expires_at FROM calendar_feed_tokens WHERE token_hash = $1`, hashHex).Scan(&expires))
	assert.WithinDuration(t, time.Now().Add(remaining), expires, time.Minute, "adopted with the TTL it had left, not a fresh 90 days")
	n, err := rc.Redis().Exists(ctx, legacyCalendarFeedKey(hashHex)).Result()
	require.NoError(t, err)
	assert.Zero(t, n, "legacy key removed after adoption")

	// Served from Postgres from now on, Redis gone.
	got, ok = h.lookupFeed(ctx, secret)
	require.True(t, ok)
	assert.Equal(t, userID, got)
}

// An erased user's legacy token is not resurrected.
func TestDurable_CalendarFeedLegacyRefusedForErasedUser(t *testing.T) {
	pool := durableTestPool(t)
	rc := durableTestRedis(t)
	ctx := context.Background()
	_, userID, _ := seedWorkEvidenceContract(t, pool)
	_, err := pool.Exec(ctx, `UPDATE users SET deletion_finalized_at = now() WHERE id = $1`, userID)
	require.NoError(t, err)
	h := NewCalendarExportHandler(pool, nil, durableTestCipher(t)).WithCache(rc)

	secret, hashHex := feedHash(t)
	require.NoError(t, rc.Redis().Set(ctx, legacyCalendarFeedKey(hashHex), userID, time.Hour).Err())
	t.Cleanup(func() { rc.Delete(context.Background(), legacyCalendarFeedKey(hashHex)) })

	_, ok := h.lookupFeed(ctx, secret)
	assert.False(t, ok)
	var n int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM calendar_feed_tokens WHERE token_hash = $1`, hashHex).Scan(&n))
	assert.Zero(t, n)
	exists, err := rc.Redis().Exists(ctx, legacyCalendarFeedKey(hashHex)).Result()
	require.NoError(t, err)
	assert.Zero(t, exists)
}

// ── GDPR export ─────────────────────────────────────────────────────────────

func TestDurable_DataExportIncludesWorkEvidence(t *testing.T) {
	pool := durableTestPool(t)
	ctx := context.Background()
	contractID, _, providerID := seedWorkEvidenceContract(t, pool)
	cipher := durableTestCipher(t)
	store := pgWorkSessionStore{db: pool, cipher: cipher}
	at := time.Now().UTC()
	require.NoError(t, store.RecordCheckIn(ctx, contractID, providerID, 30.2672, -97.7431, at))
	ws := NewWorkspaceHandler(nil, nil, pool, cipher)
	require.NoError(t, ws.persistCompletionPhoto(ctx, contractID, providerID, "after", "https://cdn.example/after.jpg"))

	h := NewDataExportHandler(pool, cipher)
	sessions, _, err := h.exportWorkSessions(ctx, providerID)
	require.NoError(t, err)
	items := sessions.([]map[string]interface{})
	require.Len(t, items, 1)
	assert.Equal(t, "30.2672000,-97.7431000", items[0]["check_in_location"])
	assert.Nil(t, items[0]["check_out_location"])
	assert.Equal(t, contractID, items[0]["contract_id"])

	photos, _, err := h.exportCompletionPhotos(ctx, providerID)
	require.NoError(t, err)
	require.Len(t, photos.([]map[string]interface{}), 1)
}
