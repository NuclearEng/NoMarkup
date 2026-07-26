//go:build integration

// Money invariants that live in the DATABASE, exercised through the real
// repository against a real PostgreSQL.
//
// These cover the two defects closed by migrations 075-079:
//
//   1. advance_repayments had no UNIQUE(advance_id, payment_id) and
//      UpdateAdvanceRepayment's `repaid_cents = repaid_cents + $2` had no cap in
//      its WHERE. The escrow-release resume path could therefore credit one
//      advance twice off a single payment while Stripe's idempotency key
//      returned the single original transfer — the ledger forgave more debt
//      than cash was withheld for.
//
//   2. RecordStripeEventStart was check-then-act: it discarded the INSERT's
//      RowsAffected and issued a separate SELECT, so two concurrent deliveries
//      of the same event both ran the handler to completion.
//
// Signature verification (STRIPE_WEBHOOK_SECRET, constructEvent) is upstream of
// everything here; these tests call the repository directly.
//
// Run:
//   cd services/payment && go test -tags=integration -run TestMoneyInvariants ./internal/repository/...
//
// Requires DATABASE_URL pointing at a database with the full migration chain
// applied (the CI integration job provides exactly that).

package repository

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

func moneyDatabaseURL() string {
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return "postgres://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable"
}

// moneyFixture is one provider with one contract, one payment, and two
// advances: advanceOpen has room left to repay, advanceFull is already repaid
// in full so the cap guard has something to reject.
type moneyFixture struct {
	pool        *pgxpool.Pool
	repo        *PostgresRepository
	providerID  string
	paymentA    string
	paymentB    string
	advanceOpen string
	advanceFull string
}

func newMoneyFixture(t *testing.T) *moneyFixture {
	t.Helper()

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, moneyDatabaseURL())
	if err != nil {
		t.Skipf("no database: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("database unreachable: %v", err)
	}

	f := &moneyFixture{
		pool:        pool,
		repo:        NewPostgresRepository(pool),
		providerID:  uuid.NewString(),
		paymentA:    uuid.NewString(),
		paymentB:    uuid.NewString(),
		advanceOpen: uuid.NewString(),
		advanceFull: uuid.NewString(),
	}

	customerID := uuid.NewString()
	categoryID := uuid.NewString()
	jobID := uuid.NewString()
	bidID := uuid.NewString()
	contractID := uuid.NewString()
	suffix := uuid.NewString()[:8]

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed %q: %v", sql, err)
		}
	}

	t.Cleanup(func() {
		// Reverse dependency order. Errors are ignored: a failed test may have
		// left a partial fixture and cleanup must not mask the real failure.
		for _, sql := range []string{
			`DELETE FROM advance_repayments WHERE advance_id = ANY($1)`,
		} {
			_, _ = pool.Exec(ctx, sql, []string{f.advanceOpen, f.advanceFull})
		}
		_, _ = pool.Exec(ctx, `DELETE FROM working_capital_advances WHERE id = ANY($1)`,
			[]string{f.advanceOpen, f.advanceFull})
		_, _ = pool.Exec(ctx, `DELETE FROM payments WHERE id = ANY($1)`,
			[]string{f.paymentA, f.paymentB})
		_, _ = pool.Exec(ctx, `DELETE FROM contracts WHERE id = $1`, contractID)
		_, _ = pool.Exec(ctx, `DELETE FROM bids WHERE id = $1`, bidID)
		_, _ = pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, jobID)
		_, _ = pool.Exec(ctx, `DELETE FROM service_categories WHERE id = $1`, categoryID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = ANY($1)`,
			[]string{customerID, f.providerID})
		pool.Close()
	})

	exec(`INSERT INTO users (id, email, display_name, roles) VALUES
	        ($1, $3, 'ITest Customer', ARRAY['customer']),
	        ($2, $4, 'ITest Provider', ARRAY['provider'])`,
		customerID, f.providerID,
		"itest-cust-"+suffix+"@example.test", "itest-prov-"+suffix+"@example.test")

	exec(`INSERT INTO service_categories (id, name, slug, level)
	      VALUES ($1, $2, $3, 1)`, categoryID, "ITest "+suffix, "itest-"+suffix)

	exec(`INSERT INTO jobs (id, customer_id, title, description, category_id,
	                        service_city, service_state, service_zip,
	                        service_location, approximate_location)
	      VALUES ($1, $2, 'ITest job', 'desc', $3, 'Austin', 'TX', '78701',
	              ST_SetSRID(ST_MakePoint(-97.7, 30.3), 4326),
	              ST_SetSRID(ST_MakePoint(-97.7, 30.3), 4326))`,
		jobID, customerID, categoryID)

	exec(`INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents)
	      VALUES ($1, $2, $3, 100000, 100000)`, bidID, jobID, f.providerID)

	exec(`INSERT INTO contracts (id, contract_number, job_id, customer_id, provider_id,
	                             bid_id, amount_cents, payment_timing, status)
	      VALUES ($1, $2, $3, $4, $5, $6, 100000, 'completion', 'active')`,
		contractID, "ITEST-"+suffix, jobID, customerID, f.providerID, bidID)

	exec(`INSERT INTO payments (id, contract_id, customer_id, provider_id, amount_cents,
	                            provider_payout_cents, idempotency_key, status)
	      VALUES ($1, $5, $3, $4, 100000, 90000, $6, 'escrow'),
	             ($2, $5, $3, $4, 100000, 90000, $7, 'escrow')`,
		f.paymentA, f.paymentB, customerID, f.providerID, contractID,
		"itest-a-"+suffix, "itest-b-"+suffix)

	// advanceOpen: 50000 principal + 2500 fee = 52500 owed, nothing repaid.
	exec(`INSERT INTO working_capital_advances
	        (id, provider_id, contract_id, advance_amount_cents, fee_cents,
	         repaid_cents, status, disbursed_at)
	      VALUES ($1, $2, $3, 50000, 2500, 0, 'disbursed', now())`,
		f.advanceOpen, f.providerID, contractID)

	// advanceFull: 10000 + 500 = 10500 owed, already fully repaid.
	exec(`INSERT INTO working_capital_advances
	        (id, provider_id, contract_id, advance_amount_cents, fee_cents,
	         repaid_cents, status, disbursed_at)
	      VALUES ($1, $2, $3, 10000, 500, 10500, 'repaid', now())`,
		f.advanceFull, f.providerID, contractID)

	return f
}

func TestMoneyInvariants_AdvanceRepaymentIsIdempotentPerPayment(t *testing.T) {
	ctx := context.Background()
	f := newMoneyFixture(t)

	// First deduction against advanceOpen for paymentA lands in full.
	first, err := f.repo.UpdateAdvanceRepayment(ctx, f.advanceOpen, f.paymentA, 9000)
	if err != nil {
		t.Fatalf("first repayment: %v", err)
	}
	if first.RepaidCents != 9000 {
		t.Fatalf("first repayment: repaid_cents = %d, want 9000", first.RepaidCents)
	}

	// Replaying the SAME (advance, payment) — what the escrow-release resume
	// path does after a crash between the transfer and the transfer-id stamp —
	// must credit NOTHING. Before migration 076 this incremented a second time.
	replay, err := f.repo.UpdateAdvanceRepayment(ctx, f.advanceOpen, f.paymentA, 9000)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replay.RepaidCents != first.RepaidCents {
		t.Fatalf("replay credited again: repaid_cents = %d, want %d (unchanged)",
			replay.RepaidCents, first.RepaidCents)
	}

	// And it must not have left a second ledger row behind either.
	var rows int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM advance_repayments WHERE advance_id = $1 AND payment_id = $2`,
		f.advanceOpen, f.paymentA).Scan(&rows); err != nil {
		t.Fatalf("count repayments: %v", err)
	}
	if rows != 1 {
		t.Fatalf("advance_repayments rows = %d, want 1", rows)
	}

	// A DIFFERENT payment against the same advance still applies normally.
	second, err := f.repo.UpdateAdvanceRepayment(ctx, f.advanceOpen, f.paymentB, 1000)
	if err != nil {
		t.Fatalf("second payment: %v", err)
	}
	if got := second.RepaidCents - replay.RepaidCents; got != 1000 {
		t.Fatalf("second payment applied %d, want 1000", got)
	}
}

func TestMoneyInvariants_AdvanceRepaymentCannotOverRepay(t *testing.T) {
	ctx := context.Background()
	f := newMoneyFixture(t)

	var before int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM advance_repayments WHERE advance_id = $1`,
		f.advanceFull).Scan(&before); err != nil {
		t.Fatalf("count before: %v", err)
	}

	// advanceFull already owes nothing. Even one cent more must be refused by
	// the cap in the UPDATE's WHERE clause.
	_, err := f.repo.UpdateAdvanceRepayment(ctx, f.advanceFull, f.paymentA, 1)
	if !errors.Is(err, domain.ErrInvalidAmount) {
		t.Fatalf("over-repay error = %v, want domain.ErrInvalidAmount", err)
	}

	// The rejected attempt must not leave a repayment row: the insert and the
	// capped update share one transaction.
	var after int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM advance_repayments WHERE advance_id = $1`,
		f.advanceFull).Scan(&after); err != nil {
		t.Fatalf("count after: %v", err)
	}
	if after != before {
		t.Fatalf("rejected repayment left %d row(s) behind (was %d)", after, before)
	}

	// And repaid_cents must be untouched.
	cur, err := f.repo.GetAdvance(ctx, f.advanceFull)
	if err != nil {
		t.Fatalf("get advance: %v", err)
	}
	if cur.RepaidCents != 10500 {
		t.Fatalf("repaid_cents = %d, want 10500 (unchanged)", cur.RepaidCents)
	}
}

func TestMoneyInvariants_AdvanceRepaymentUnknownAdvance(t *testing.T) {
	ctx := context.Background()
	f := newMoneyFixture(t)

	// A missing advance must report not-found, NOT the over-repay error — the
	// two share a zero-rows UPDATE result and must be told apart.
	_, err := f.repo.UpdateAdvanceRepayment(ctx, uuid.NewString(), f.paymentA, 1)
	if !errors.Is(err, domain.ErrAdvanceNotFound) {
		t.Fatalf("unknown advance error = %v, want domain.ErrAdvanceNotFound", err)
	}
}

func TestMoneyInvariants_StripeEventClaimIsExclusive(t *testing.T) {
	ctx := context.Background()
	f := newMoneyFixture(t)

	eventID := "evt_itest_" + uuid.NewString()
	t.Cleanup(func() {
		_, _ = f.pool.Exec(ctx, `DELETE FROM stripe_events WHERE id = $1`, eventID)
	})

	// Fan out concurrent deliveries of the SAME event id. Exactly one caller
	// may be told to process it. The old check-then-act implementation let all
	// of them through.
	const n = 16
	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		winners int
		errs    []error
	)
	start := make(chan struct{})
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			already, err := f.repo.RecordStripeEventStart(ctx, eventID, "payment_intent.succeeded")
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, err)
				return
			}
			if !already {
				winners++
			}
		}()
	}
	close(start)
	wg.Wait()

	if len(errs) > 0 {
		t.Fatalf("claim errors: %v", errs)
	}
	if winners != 1 {
		t.Fatalf("%d callers were told to process event %s, want exactly 1", winners, eventID)
	}

	// A redelivery while the winner still holds the lease must be skipped.
	already, err := f.repo.RecordStripeEventStart(ctx, eventID, "payment_intent.succeeded")
	if err != nil {
		t.Fatalf("redelivery: %v", err)
	}
	if !already {
		t.Fatal("redelivery inside the claim lease was allowed to reprocess")
	}
}

func TestMoneyInvariants_StripeEventLeaseExpiryAndTerminality(t *testing.T) {
	ctx := context.Background()
	f := newMoneyFixture(t)

	eventID := "evt_itest_" + uuid.NewString()
	t.Cleanup(func() {
		_, _ = f.pool.Exec(ctx, `DELETE FROM stripe_events WHERE id = $1`, eventID)
	})

	already, err := f.repo.RecordStripeEventStart(ctx, eventID, "charge.refunded")
	if err != nil {
		t.Fatalf("initial claim: %v", err)
	}
	if already {
		t.Fatal("first claim of a new event was refused")
	}

	// Simulate the claiming worker crashing: age the claim past the lease.
	expire := func() {
		t.Helper()
		if _, err := f.pool.Exec(ctx,
			`UPDATE stripe_events SET claimed_at = now() - $2::interval WHERE id = $1`,
			eventID, (2 * stripeEventClaimLease).String()); err != nil {
			t.Fatalf("expire claim: %v", err)
		}
	}
	expire()

	// MON-12: a crashed attempt must become retryable, because Stripe
	// redelivers for up to 3 days.
	already, err = f.repo.RecordStripeEventStart(ctx, eventID, "charge.refunded")
	if err != nil {
		t.Fatalf("reclaim: %v", err)
	}
	if already {
		t.Fatal("an expired claim was not re-claimable — a crashed handler would never retry")
	}

	// Once the event is fully processed it is terminal, lease or no lease.
	if err := f.repo.MarkStripeEventProcessed(ctx, eventID); err != nil {
		t.Fatalf("mark processed: %v", err)
	}
	expire()
	already, err = f.repo.RecordStripeEventStart(ctx, eventID, "charge.refunded")
	if err != nil {
		t.Fatalf("post-processed claim: %v", err)
	}
	if !already {
		t.Fatal("a fully processed event was handed out for reprocessing")
	}

	var attempts int
	var processedAt *time.Time
	if err := f.pool.QueryRow(ctx,
		`SELECT attempts, processed_at FROM stripe_events WHERE id = $1`,
		eventID).Scan(&attempts, &processedAt); err != nil {
		t.Fatalf("read event: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2 (initial claim + reclaim)", attempts)
	}
	if processedAt == nil {
		t.Fatal("processed_at was not stamped")
	}
	fmt.Fprintf(os.Stderr, "event %s: attempts=%d processed_at=%v\n", eventID, attempts, *processedAt)
}
