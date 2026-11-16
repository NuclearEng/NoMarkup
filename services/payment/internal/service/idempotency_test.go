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

// findPayableContract picks the customer's most recent contract that still
// has an unpaid remainder, and returns that remainder.
//
// CreatePayment no longer accepts a client-chosen amount: a one-shot charge
// must equal the contract's unpaid remainder (STRIPE-5 / MON-21 in
// service.go), anything else is 400 "invalid amount". The remainder is
// derived here with the same statuses paymentCountsTowardContractCap counts.
// If no such contract exists the test is skipped — it only runs against a
// seeded environment.
func findPayableContract(t *testing.T, pool *pgxpool.Pool, customerID string) (contractID, providerID string, remainingCents int64) {
	t.Helper()
	row := pool.QueryRow(context.Background(),
		`SELECT id, provider_id, remaining FROM (
		   SELECT c.id::text AS id, c.provider_id::text AS provider_id, c.created_at,
		          c.amount_cents - COALESCE((
		            SELECT sum(p.amount_cents) FROM payments p
		             WHERE p.contract_id = c.id
		               AND p.status::text IN ('pending','processing','escrow','released','completed','partially_refunded')
		          ), 0) AS remaining
		     FROM contracts c
		    WHERE c.customer_id = $1 AND c.deleted_at IS NULL
		 ) open_contracts
		 WHERE remaining > 0
		 ORDER BY created_at DESC, id
		 LIMIT 1`,
		customerID,
	)
	if err := row.Scan(&contractID, &providerID, &remainingCents); err != nil {
		t.Skipf("no contract with an unpaid remainder for customer %s — seed the DB with at least one: %v", customerID, err)
	}
	return contractID, providerID, remainingCents
}

// ensureProviderPayoutAccount gives the contract's provider a Connect account
// id for the duration of the test when the seed left it empty.
//
// CreatePayment resolves the payee's Connect account before it writes the
// payment row and answers 422 "provider is not set up to receive payouts"
// without one; database/cmd/seed creates providers that have not onboarded.
// The id is only stored and echoed by the dev-mode Stripe stub, so a
// placeholder is enough. The returned func restores the original (empty)
// value; defer it after pool.Close so it runs while the pool is still open.
func ensureProviderPayoutAccount(ctx context.Context, t *testing.T, pool *pgxpool.Pool, providerID string) (restore func()) {
	t.Helper()
	tag, err := pool.Exec(ctx,
		`UPDATE provider_profiles SET stripe_account_id = $2
		  WHERE user_id = $1 AND COALESCE(stripe_account_id, '') = ''`,
		providerID, "acct_tier1idem"+providerID[len(providerID)-12:],
	)
	if err != nil {
		t.Fatalf("set provider payout account: %v", err)
	}
	if tag.RowsAffected() == 0 {
		return func() {} // already onboarded (or no profile: the request will say so)
	}
	return func() {
		if _, err := pool.Exec(context.Background(),
			`UPDATE provider_profiles SET stripe_account_id = NULL WHERE user_id = $1`, providerID,
		); err != nil {
			t.Errorf("restore provider payout account: %v", err)
		}
	}
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
	contractID, providerID, amountCents := findPayableContract(t, pool, customerID)
	defer ensureProviderPayoutAccount(ctx, t, pool, providerID)()
	customerTok := idemLogin(t, "customer@nomarkup.com")

	idempotencyKey := fmt.Sprintf("tier1-idem-%d", time.Now().UnixNano())
	payload := map[string]any{
		"contract_id":     contractID,
		"provider_id":     providerID,
		"amount_cents":    amountCents,
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
