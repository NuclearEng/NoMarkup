package handler

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProofOfWorkReady(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		hasCheckIn    bool
		hasAfterPhoto bool
		wantReady     bool
		wantMissing   []string
	}{
		{
			name:        "neither",
			wantReady:   false,
			wantMissing: []string{proofMissingCheckIn, proofMissingAfterPhoto},
		},
		{
			name:        "check-in only",
			hasCheckIn:  true,
			wantReady:   false,
			wantMissing: []string{proofMissingAfterPhoto},
		},
		{
			name:          "after-photo only",
			hasAfterPhoto: true,
			wantReady:     false,
			wantMissing:   []string{proofMissingCheckIn},
		},
		{
			name:          "both",
			hasCheckIn:    true,
			hasAfterPhoto: true,
			wantReady:     true,
			wantMissing:   []string{},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.wantReady, proofOfWorkReady(tc.hasCheckIn, tc.hasAfterPhoto))
			assert.Equal(t, tc.wantMissing, proofOfWorkMissing(tc.hasCheckIn, tc.hasAfterPhoto))
		})
	}
}

func TestEvaluateProofOfWork_nilDBFailClosed(t *testing.T) {
	t.Parallel()
	ready, missing, err := evaluateProofOfWork(context.Background(), nil, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	require.NoError(t, err)
	assert.False(t, ready)
	assert.Equal(t, []string{proofMissingCheckIn, proofMissingAfterPhoto}, missing)
}

func TestEvaluateProofOfWork_emptyContractFailClosed(t *testing.T) {
	t.Parallel()
	ready, missing, err := evaluateProofOfWork(context.Background(), nil, "")
	require.NoError(t, err)
	assert.False(t, ready)
	assert.Equal(t, []string{proofMissingCheckIn, proofMissingAfterPhoto}, missing)
}

func TestGetWorkEvidence_nilDBNotReady(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)

	r := chi.NewRouter()
	r.Get("/api/v1/contracts/{id}/work-evidence", h.GetWorkEvidence)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/contracts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/work-evidence", nil)
	req = addClaimsToRequest(req, "customer-1", "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var body workEvidence
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.False(t, body.ReadyForRelease)
	assert.Equal(t, []string{proofMissingCheckIn, proofMissingAfterPhoto}, body.Missing)
	assert.Empty(t, body.Sessions)
	assert.Empty(t, body.Photos)
	// Arrays must be [] not null so clients can iterate.
	var raw map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &raw))
	assert.Equal(t, "[]", string(raw["sessions"]))
	assert.Equal(t, "[]", string(raw["photos"]))
}

func TestGetWorkEvidence_unauthorized(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	r := chi.NewRouter()
	r.Get("/api/v1/contracts/{id}/work-evidence", h.GetWorkEvidence)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/contracts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/work-evidence", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestGetWorkEvidence_missingContractID(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/work-evidence", nil)
	req = addClaimsToRequest(req, "customer-1", "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	h.GetWorkEvidence(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestWriteProofOfWorkRequired_json(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	writeProofOfWorkRequired(rec, []string{proofMissingCheckIn, proofMissingAfterPhoto})
	assert.Equal(t, http.StatusConflict, rec.Code)

	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "proof of work required", body["error"])
	missing, ok := body["missing"].([]interface{})
	require.True(t, ok)
	require.Len(t, missing, 2)
	assert.Equal(t, "check_in", missing[0])
	assert.Equal(t, "after_photo", missing[1])
}

func TestCheckOut_noActiveCheckIn(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	h.resolveJobSite = func(ctx context.Context, contractID string) (float64, float64, bool, error) {
		return 0, 0, false, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/checkout", h.CheckOut)

	body, _ := json.Marshal(map[string]float64{"lat": 1.0, "lng": 2.0})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/contracts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/checkout", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "provider-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "no active check-in")
}

func workEvidenceTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = os.Getenv("GATEWAY_TEST_DATABASE_URL")
	}
	if url == "" {
		t.Skip("DATABASE_URL unset — skipping proof-of-work persist test")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Skipf("cannot connect to test db: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Skipf("test db unreachable: %v", err)
	}
	var reg *string
	if err := pool.QueryRow(context.Background(),
		`SELECT to_regclass('public.contract_work_sessions')::text`).Scan(&reg); err != nil || reg == nil {
		t.Skip("contract_work_sessions missing — apply migration 123")
	}
	return pool
}

func powRandSuffix(t *testing.T) string {
	t.Helper()
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	const hexDigits = "0123456789abcdef"
	out := make([]byte, 0, 16)
	for _, v := range b {
		out = append(out, hexDigits[v>>4], hexDigits[v&0x0f])
	}
	return string(out)
}

func seedWorkEvidenceContract(t *testing.T, pool *pgxpool.Pool) (contractID, customerID, providerID string) {
	t.Helper()
	ctx := context.Background()
	suffix := powRandSuffix(t)

	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, display_name, roles, status)
		VALUES ($1, 'POW Customer', ARRAY['customer'], 'active')
		RETURNING id::text`, "pow-c-"+suffix+"@nomarkup.test").Scan(&customerID); err != nil {
		t.Fatalf("seed customer: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, display_name, roles, status)
		VALUES ($1, 'POW Provider', ARRAY['provider'], 'active')
		RETURNING id::text`, "pow-p-"+suffix+"@nomarkup.test").Scan(&providerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}

	var categoryID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM service_categories LIMIT 1`).Scan(&categoryID); err != nil {
		t.Fatalf("find a service category: %v", err)
	}

	var jobID, bidID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO jobs (
		    customer_id, title, description, category_id,
		    service_city, service_state, service_zip,
		    service_location, approximate_location, status, scheduled_date)
		VALUES ($1, 'POW persist', 'proof of work', $2::uuid,
		        'Austin', 'TX', '78702',
		        ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
		        ST_SetSRID(ST_MakePoint(-97.74, 30.27), 4326),
		        'active', now()::date)
		RETURNING id::text`, customerID, categoryID).Scan(&jobID); err != nil {
		t.Fatalf("seed job: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, status)
		VALUES ($1::uuid, $2::uuid, 25000, 25000, 'awarded')
		RETURNING id::text`, jobID, providerID).Scan(&bidID); err != nil {
		t.Fatalf("seed bid: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO contracts (
		    contract_number, job_id, customer_id, provider_id, bid_id,
		    amount_cents, payment_timing, status, started_at)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
		        25000, 'completion', 'active', now())
		RETURNING id::text`,
		"NM-POW-"+suffix, jobID, customerID, providerID, bidID,
	).Scan(&contractID); err != nil {
		t.Fatalf("seed contract: %v", err)
	}

	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM contract_completion_photos WHERE contract_id = $1`, contractID)
		_, _ = pool.Exec(ctx, `DELETE FROM contract_work_sessions WHERE contract_id = $1`, contractID)
		_, _ = pool.Exec(ctx, `DELETE FROM contracts WHERE id = $1`, contractID)
		_, _ = pool.Exec(ctx, `DELETE FROM bids WHERE id = $1`, bidID)
		_, _ = pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, jobID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1 OR id = $2`, customerID, providerID)
	})
	return contractID, customerID, providerID
}

func TestPersistCheckInAndPhoto_readyForRelease(t *testing.T) {
	pool := workEvidenceTestPool(t)
	contractID, _, providerID := seedWorkEvidenceContract(t, pool)
	h := NewWorkspaceHandler(nil, nil, pool)
	ctx := context.Background()
	now := time.Now().UTC()

	ready, missing, err := evaluateProofOfWork(ctx, pool, contractID)
	require.NoError(t, err)
	assert.False(t, ready)
	assert.Equal(t, []string{proofMissingCheckIn, proofMissingAfterPhoto}, missing)

	require.NoError(t, h.persistCheckIn(ctx, contractID, providerID, 30.27, -97.74, now))
	// Refreshing an open session must not create a second row.
	later := now.Add(2 * time.Minute)
	require.NoError(t, h.persistCheckIn(ctx, contractID, providerID, 30.271, -97.741, later))

	var sessionCount int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM contract_work_sessions WHERE contract_id = $1`, contractID).Scan(&sessionCount))
	assert.Equal(t, 1, sessionCount)

	ready, missing, err = evaluateProofOfWork(ctx, pool, contractID)
	require.NoError(t, err)
	assert.False(t, ready)
	assert.Equal(t, []string{proofMissingAfterPhoto}, missing)

	require.NoError(t, h.persistCompletionPhoto(ctx, contractID, providerID, "before", "https://cdn.example/before.jpg"))
	ready, missing, err = evaluateProofOfWork(ctx, pool, contractID)
	require.NoError(t, err)
	assert.False(t, ready, "before photo is not enough")
	assert.Equal(t, []string{proofMissingAfterPhoto}, missing)

	require.NoError(t, h.persistCompletionPhoto(ctx, contractID, providerID, "after", "https://cdn.example/after-1.jpg"))
	require.NoError(t, h.persistCompletionPhoto(ctx, contractID, providerID, "after", "https://cdn.example/after-2.jpg"))

	ready, missing, err = evaluateProofOfWork(ctx, pool, contractID)
	require.NoError(t, err)
	assert.True(t, ready)
	assert.Empty(t, missing)

	ev, err := loadWorkEvidence(ctx, pool, contractID)
	require.NoError(t, err)
	assert.True(t, ev.ReadyForRelease)
	require.Len(t, ev.Sessions, 1)
	assert.Equal(t, later.Format(time.RFC3339), ev.Sessions[0].CheckedInAt)
	assert.Nil(t, ev.Sessions[0].CheckedOutAt)
	require.Len(t, ev.Photos, 3)

	require.NoError(t, h.persistCheckOut(ctx, contractID, providerID, 30.27, -97.74, later.Add(time.Hour), 60, later))
	ev, err = loadWorkEvidence(ctx, pool, contractID)
	require.NoError(t, err)
	require.Len(t, ev.Sessions, 1)
	require.NotNil(t, ev.Sessions[0].CheckedOutAt)
	assert.Equal(t, 60, ev.Sessions[0].DurationMinutes)
	assert.True(t, ev.ReadyForRelease)
}
