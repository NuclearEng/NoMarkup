//go:build integration

// Stripe billing identity, exercised against a real PostgreSQL.
//
// The unit tests in internal/service prove the provisioning LOGIC against an
// in-memory directory. These prove the parts only a real database can, and they
// are the load-bearing half: the whole no-duplicate-customer argument rests on
// `UPDATE ... WHERE stripe_customer_id IS NULL` being atomic under real row
// locking, and on the partial unique indexes from migrations 102/103 actually
// rejecting the writes they are supposed to reject. A fake cannot establish
// either.
//
// Run:
//
//	cd services/payment && DATABASE_URL=... go test -tags=integration \
//	    -run TestStripeCustomer ./internal/repository/...
//
// Requires DATABASE_URL pointing at a database with the full migration chain
// (through 103) applied. Every fixture row is created under a unique id and
// dropped in t.Cleanup.

package repository

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// newCustomerFixture creates one user and returns a repo bound to a live pool.
func newCustomerFixture(t *testing.T) (*PostgresRepository, *pgxpool.Pool, string) {
	t.Helper()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, moneyDatabaseURL())
	if err != nil {
		t.Fatalf("connect db: %v", err)
	}
	t.Cleanup(pool.Close)

	userID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (id, email, display_name, roles, status)
		VALUES ($1, $2, $3, ARRAY['customer'], 'active')`,
		userID, fmt.Sprintf("cust-%s@example.test", userID), "customer fixture",
	); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_payment_methods WHERE user_id = $1`, userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})

	return NewPostgresRepository(pool), pool, userID
}

// TestStripeCustomer_ClaimIsAtomicUnderRealConcurrency is the database half of
// the no-duplicate-customer guarantee.
//
// N goroutines each present a DIFFERENT candidate customer id — the pessimistic
// case, equivalent to Stripe's idempotency key having expired between attempts.
// Exactly one must win, and every loser must be handed the winner's id rather
// than its own. If the guarded UPDATE were not atomic, two callers would each
// believe their own candidate was recorded and the user's cards would split.
func TestStripeCustomer_ClaimIsAtomicUnderRealConcurrency(t *testing.T) {
	repo, _, userID := newCustomerFixture(t)
	ctx := context.Background()

	const goroutines = 32

	var (
		start sync.WaitGroup
		done  sync.WaitGroup
		mu    sync.Mutex
	)
	results := make([]string, 0, goroutines)
	var failures []error

	start.Add(1)
	for i := 0; i < goroutines; i++ {
		done.Add(1)
		go func(i int) {
			defer done.Done()
			candidate := fmt.Sprintf("cus_race_%s_%d", userID[:8], i)
			start.Wait()
			got, err := repo.ClaimUserStripeCustomerID(ctx, userID, candidate)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failures = append(failures, err)
				return
			}
			results = append(results, got)
		}(i)
	}
	start.Done()
	done.Wait()

	if len(failures) != 0 {
		t.Fatalf("no claim may fail: %v", failures)
	}
	if len(results) != goroutines {
		t.Fatalf("want %d results, got %d", goroutines, len(results))
	}

	winner := results[0]
	for i, got := range results {
		if got != winner {
			t.Fatalf("goroutine %d received %q but goroutine 0 received %q; "+
				"two customers for one user splits their saved cards", i, got, winner)
		}
	}

	stored, err := repo.GetUserStripeCustomerID(ctx, userID)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if stored != winner {
		t.Fatalf("stored %q but callers were told %q", stored, winner)
	}
}

// TestStripeCustomer_UniqueIndexRejectsSharedCustomer proves migration 102's
// partial unique index: two users can never point at one Stripe Customer, which
// would let one user list and charge the other's cards.
func TestStripeCustomer_UniqueIndexRejectsSharedCustomer(t *testing.T) {
	repo, pool, userA := newCustomerFixture(t)
	_, _, userB := newCustomerFixture(t)
	ctx := context.Background()

	shared := "cus_shared_" + uuid.NewString()[:8]
	if _, err := repo.ClaimUserStripeCustomerID(ctx, userA, shared); err != nil {
		t.Fatalf("first claim: %v", err)
	}

	// Direct write, bypassing the guarded UPDATE, so the INDEX is what is on
	// trial here rather than the application logic.
	_, err := pool.Exec(ctx, `UPDATE users SET stripe_customer_id = $2 WHERE id = $1`, userB, shared)
	if err == nil {
		t.Fatal("the unique index must reject two users sharing one stripe customer")
	}

	// And both users' state is still coherent.
	gotA, err := repo.GetUserStripeCustomerID(ctx, userA)
	if err != nil || gotA != shared {
		t.Fatalf("user A lost its customer: %q, %v", gotA, err)
	}
	gotB, err := repo.GetUserStripeCustomerID(ctx, userB)
	if err != nil {
		t.Fatalf("read user B: %v", err)
	}
	if gotB != "" {
		t.Fatalf("user B must remain unprovisioned, got %q", gotB)
	}
}

// TestStripeCustomer_UnprovisionedIsEmptyNotAnError: "no customer yet" is a
// normal state the caller must be able to act on, while a MISSING user must be
// an error — provisioning a Stripe Customer for a nonexistent user is not
// something we may silently do.
func TestStripeCustomer_UnprovisionedIsEmptyNotAnError(t *testing.T) {
	repo, _, userID := newCustomerFixture(t)
	ctx := context.Background()

	got, err := repo.GetUserStripeCustomerID(ctx, userID)
	if err != nil {
		t.Fatalf("unprovisioned user must not error: %v", err)
	}
	if got != "" {
		t.Fatalf("want empty, got %q", got)
	}

	if _, err := repo.GetUserStripeCustomerID(ctx, uuid.NewString()); !errors.Is(err, domain.ErrPaymentNotFound) {
		t.Fatalf("a missing user must be ErrPaymentNotFound, got %v", err)
	}
}

// TestStripeCustomer_GetStripeCustomerIDReadsTheUser proves the redirect: the
// legacy path read subscriptions.stripe_customer_id, a column nothing ever
// wrote, so this returned "" for every user on the platform.
func TestStripeCustomer_GetStripeCustomerIDReadsTheUser(t *testing.T) {
	repo, _, userID := newCustomerFixture(t)
	ctx := context.Background()

	if got, err := repo.GetStripeCustomerID(ctx, userID); err != nil || got != "" {
		t.Fatalf("before provisioning want ('', nil), got (%q, %v)", got, err)
	}

	want := "cus_read_" + uuid.NewString()[:8]
	if _, err := repo.ClaimUserStripeCustomerID(ctx, userID, want); err != nil {
		t.Fatalf("claim: %v", err)
	}

	got, err := repo.GetStripeCustomerID(ctx, userID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != want {
		t.Fatalf("want %q, got %q — the shared PaymentRepository accessor must see the user's customer", want, got)
	}
}

// TestStripePaymentMethods_UpsertIsIdempotentAndDefaultIsSingular exercises
// migration 103's two indexes together, which is how they are used: the same
// card arrives repeatedly (event redelivery + the synchronous path) and must
// converge on one row, and only one card may ever be default.
func TestStripePaymentMethods_UpsertIsIdempotentAndDefaultIsSingular(t *testing.T) {
	repo, _, userID := newCustomerFixture(t)
	ctx := context.Background()

	cus := "cus_pm_" + uuid.NewString()[:8]
	if _, err := repo.ClaimUserStripeCustomerID(ctx, userID, cus); err != nil {
		t.Fatalf("claim: %v", err)
	}

	pmA := domain.PaymentMethod{ID: "pm_a_" + uuid.NewString()[:8], Type: "card", Brand: "visa", LastFour: "4242", ExpMonth: 12, ExpYear: 2030}

	// The same card three times, as redelivery would.
	for i := 0; i < 3; i++ {
		if err := repo.UpsertUserPaymentMethod(ctx, userID, cus, pmA); err != nil {
			t.Fatalf("upsert %d: %v", i, err)
		}
	}
	methods, err := repo.ListUserPaymentMethods(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(methods) != 1 {
		t.Fatalf("three arrivals of one card must produce one row, got %d", len(methods))
	}

	if err := repo.SetDefaultUserPaymentMethod(ctx, userID, pmA.ID); err != nil {
		t.Fatalf("set default A: %v", err)
	}

	// A second card takes over as default; the demote+promote must be one
	// transaction or the unique index rejects it.
	pmB := domain.PaymentMethod{ID: "pm_b_" + uuid.NewString()[:8], Type: "card", Brand: "mastercard", LastFour: "4444", ExpMonth: 1, ExpYear: 2031}
	if err := repo.UpsertUserPaymentMethod(ctx, userID, cus, pmB); err != nil {
		t.Fatalf("upsert B: %v", err)
	}
	if err := repo.SetDefaultUserPaymentMethod(ctx, userID, pmB.ID); err != nil {
		t.Fatalf("set default B: %v", err)
	}

	methods, err = repo.ListUserPaymentMethods(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(methods) != 2 {
		t.Fatalf("want 2 cards, got %d", len(methods))
	}
	defaults := 0
	for _, m := range methods {
		if m.IsDefault {
			defaults++
		}
	}
	if defaults != 1 {
		t.Fatalf("exactly one default required, got %d", defaults)
	}

	got, err := repo.GetDefaultUserPaymentMethod(ctx, userID)
	if err != nil || got != pmB.ID {
		t.Fatalf("want default %q, got (%q, %v)", pmB.ID, got, err)
	}
}

// TestStripePaymentMethods_DefaultingAForeignCardIsRefused is the ownership
// guard. Defaulting a card that is not the user's would point their off-session
// charges at someone else's instrument.
func TestStripePaymentMethods_DefaultingAForeignCardIsRefused(t *testing.T) {
	repoA, _, userA := newCustomerFixture(t)
	_, _, userB := newCustomerFixture(t)
	ctx := context.Background()

	cusA := "cus_own_a_" + uuid.NewString()[:8]
	cusB := "cus_own_b_" + uuid.NewString()[:8]
	if _, err := repoA.ClaimUserStripeCustomerID(ctx, userA, cusA); err != nil {
		t.Fatalf("claim A: %v", err)
	}
	if _, err := repoA.ClaimUserStripeCustomerID(ctx, userB, cusB); err != nil {
		t.Fatalf("claim B: %v", err)
	}

	foreign := domain.PaymentMethod{ID: "pm_foreign_" + uuid.NewString()[:8], Type: "card"}
	if err := repoA.UpsertUserPaymentMethod(ctx, userB, cusB, foreign); err != nil {
		t.Fatalf("upsert B's card: %v", err)
	}

	err := repoA.SetDefaultUserPaymentMethod(ctx, userA, foreign.ID)
	if !errors.Is(err, domain.ErrPaymentNotFound) {
		t.Fatalf("defaulting another user's card must be refused, got %v", err)
	}

	// B still owns it, and it was not promoted.
	owner, err := repoA.FindUserByPaymentMethodID(ctx, foreign.ID)
	if err != nil || owner != userB {
		t.Fatalf("ownership changed: %q, %v", owner, err)
	}
}

// TestStripePaymentMethods_SoftDeleteRemovesChargeability: a detached card must
// stop being the default so the fail-closed chargeability check declines to
// charge it, while the row survives for audit.
func TestStripePaymentMethods_SoftDeleteRemovesChargeability(t *testing.T) {
	repo, pool, userID := newCustomerFixture(t)
	ctx := context.Background()

	cus := "cus_del_" + uuid.NewString()[:8]
	if _, err := repo.ClaimUserStripeCustomerID(ctx, userID, cus); err != nil {
		t.Fatalf("claim: %v", err)
	}
	pm := domain.PaymentMethod{ID: "pm_del_" + uuid.NewString()[:8], Type: "card"}
	if err := repo.UpsertUserPaymentMethod(ctx, userID, cus, pm); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := repo.SetDefaultUserPaymentMethod(ctx, userID, pm.ID); err != nil {
		t.Fatalf("set default: %v", err)
	}

	if err := repo.SoftDeleteUserPaymentMethod(ctx, userID, pm.ID); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	got, err := repo.GetDefaultUserPaymentMethod(ctx, userID)
	if err != nil {
		t.Fatalf("get default: %v", err)
	}
	if got != "" {
		t.Fatalf("a detached card must not remain chargeable, got %q", got)
	}

	methods, err := repo.ListUserPaymentMethods(ctx, userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(methods) != 0 {
		t.Fatalf("a detached card must not be listed, got %d", len(methods))
	}

	// But the row survives for audit.
	var deleted int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM user_payment_methods WHERE stripe_payment_method_id = $1 AND deleted_at IS NOT NULL`,
		pm.ID).Scan(&deleted); err != nil {
		t.Fatalf("count: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("soft delete must retain the row for audit, found %d", deleted)
	}

	// Re-attaching the same card revives THAT row rather than inserting a second.
	if err := repo.UpsertUserPaymentMethod(ctx, userID, cus, pm); err != nil {
		t.Fatalf("re-upsert: %v", err)
	}
	var total int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM user_payment_methods WHERE stripe_payment_method_id = $1`,
		pm.ID).Scan(&total); err != nil {
		t.Fatalf("count: %v", err)
	}
	if total != 1 {
		t.Fatalf("re-attaching must revive the original row, found %d rows", total)
	}
}
