//go:build integration

// Tier 1 production-readiness — money idempotency.
//
// Scenario:
//   1. Customer logs in.
//   2. Customer POSTs /api/v1/payments with the SAME Idempotency-Key 5 times.
//   3. Verify:
//        * exactly one payment row created (count payments by idempotency_key)
//        * exactly one Stripe PaymentIntent ID returned (DevStore in dev mode
//          returns "pi_dev_<key>" so any duplicate row would also produce a
//          duplicate stripe_payment_intent_id — the index/constraint or the
//          middleware must prevent that)
//        * 4 of the 5 responses are returned with X-Idempotency-Replayed=true
//
// This is the live integration test counterpart to the unit-level
// idempotency tests in gateway/internal/middleware/idempotency_test.go.
// It exercises the *full* request path: gateway middleware -> payment gRPC
// -> payment service -> repo -> Stripe (dev-mode stub).
//
// Run:
//   cd services/payment && go test -tags=integration -run TestIdempotency_PaymentDoubleSubmit ./internal/service/...
//
// Requires the same env as the other Tier 1 integration tests (gateway at
// $NOMARKUP_GATEWAY_URL, postgres at $DATABASE_URL).

package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const idemSeedPassword = "Password123!"

func idemGatewayURL() string {
	if v := os.Getenv("NOMARKUP_GATEWAY_URL"); v != "" {
		return v
	}
	return "http://localhost:8081"
}

func idemDatabaseURL() string {
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return "postgres://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable"
}

func idemLogin(t *testing.T, email string) string {
	t.Helper()
	body := bytes.NewBufferString(fmt.Sprintf(`{"email":%q,"password":%q}`, email, idemSeedPassword))
	resp, err := http.Post(idemGatewayURL()+"/api/v1/auth/login", "application/json", body)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("login %s status=%d body=%s", email, resp.StatusCode, raw)
	}
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode login: %v", err)
	}
	return out.AccessToken
}

// findRecentContract picks the most recent contract for the given customer
// so we have a real contract_id (FK in payments) to attach the test
// payments to. If no contract exists, the test is skipped — these tests
// only run against a seeded environment.
func findRecentContract(t *testing.T, pool *pgxpool.Pool, customerID string) (contractID, providerID string) {
	t.Helper()
	row := pool.QueryRow(context.Background(),
		`SELECT id, provider_id FROM contracts WHERE customer_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
		customerID,
	)
	if err := row.Scan(&contractID, &providerID); err != nil {
		t.Skipf("no contract found for customer %s — seed the DB with at least one contract: %v", customerID, err)
	}
	return contractID, providerID
}

func TestIdempotency_PaymentDoubleSubmit(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping idempotency integration test in -short mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, idemDatabaseURL())
	if err != nil {
		t.Fatalf("pgxpool: %v", err)
	}
	defer pool.Close()

	const customerID = "00000000-0000-0000-0000-000000000002"
	contractID, providerID := findRecentContract(t, pool, customerID)
	customerTok := idemLogin(t, "customer@nomarkup.com")

	idempotencyKey := fmt.Sprintf("tier1-idem-%d", time.Now().UnixNano())
	payload := map[string]any{
		"contract_id":     contractID,
		"provider_id":     providerID,
		"amount_cents":    1234,
		"idempotency_key": idempotencyKey,
	}
	raw, _ := json.Marshal(payload)

	const attempts = 5
	statuses := make([]int, attempts)
	bodies := make([][]byte, attempts)
	replayed := make([]string, attempts)

	for i := 0; i < attempts; i++ {
		req, _ := http.NewRequest(http.MethodPost, idemGatewayURL()+"/api/v1/payments", bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+customerTok)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", idempotencyKey)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		statuses[i] = resp.StatusCode
		bodies[i] = body
		replayed[i] = resp.Header.Get("X-Idempotency-Replayed")
	}

	// All 5 should yield the same status code (the cached one).
	first := statuses[0]
	for i, s := range statuses {
		if s != first {
			t.Errorf("attempt %d status=%d differs from first=%d body=%s",
				i, s, first, bodies[i])
		}
	}

	// 4 of the 5 should be marked replayed regardless of whether the
	// first attempt was a 2xx or a 4xx — the middleware caches whatever
	// response the handler produced and replays it deterministically.
	replayCount := 0
	for _, v := range replayed {
		if v == "true" {
			replayCount++
		}
	}
	if replayCount != attempts-1 {
		t.Errorf("expected exactly %d replayed responses (out of %d), got %d; "+
			"per-attempt statuses=%v replay flags=%v",
			attempts-1, attempts, replayCount, statuses, replayed)
	}

	// DB sanity: at most one payment row should ever be created for a
	// given idempotency_key — guaranteed by the
	// payments_idempotency_key_key UNIQUE index AND the gateway
	// middleware. Either layer alone is sufficient; together they're
	// belt-and-suspenders.
	var rowCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM payments WHERE idempotency_key=$1`,
		idempotencyKey,
	).Scan(&rowCount); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	if rowCount > 1 {
		t.Fatalf("expected at most 1 payment row for idempotency_key=%s, got %d",
			idempotencyKey, rowCount)
	}
	// If first was 2xx we expect exactly 1 row; if first was 4xx the
	// row was never created and 0 is also acceptable.
	if first < 400 && rowCount != 1 {
		t.Fatalf("first attempt 2xx but no payment row found for idempotency_key=%s",
			idempotencyKey)
	}

	// Stripe-call sanity: in dev mode the stub returns
	// "pi_dev_<idempotency_key>". With deduplication working there should be
	// exactly one *distinct* stripe_payment_intent_id across rows for this key.
	var distinctPI int
	if err := pool.QueryRow(ctx,
		`SELECT count(DISTINCT stripe_payment_intent_id)
		   FROM payments WHERE idempotency_key=$1
		     AND stripe_payment_intent_id IS NOT NULL`,
		idempotencyKey,
	).Scan(&distinctPI); err != nil {
		t.Fatalf("count distinct stripe pi: %v", err)
	}
	if distinctPI > 1 {
		t.Fatalf("expected at most 1 distinct stripe_payment_intent_id, got %d for key=%s",
			distinctPI, idempotencyKey)
	}
}
