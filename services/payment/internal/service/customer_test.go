package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCustomerProvisioner_ConcurrentProvisioningYieldsExactlyOneCustomer is the
// central safety property of this whole change.
//
// Two Stripe Customers for one person is a silent, expensive bug: their saved
// cards split across the two objects, so a card saved through one is invisible
// and uncharageable through the other, and unwinding it means asking the user
// for their card again. It cannot be detected by looking at either object.
//
// The property must hold under real contention, so this races N goroutines
// through EnsureCustomer for the same user with no staggering and asserts on
// three independent witnesses: every caller got the SAME id, the directory holds
// that id, and Stripe minted exactly ONE customer.
func TestCustomerProvisioner_ConcurrentProvisioningYieldsExactlyOneCustomer(t *testing.T) {
	t.Parallel()

	const goroutines = 64

	ss := &StripeService{devMode: true}
	dir := newFakeCustomerDirectory()
	dir.addUser("user-1", "user-1@example.com", "User One")
	p := NewCustomerProvisioner(dir, ss)

	var (
		start sync.WaitGroup
		done  sync.WaitGroup
		mu    sync.Mutex
	)
	ids := make([]string, 0, goroutines)
	errs := make([]error, 0, goroutines)

	start.Add(1)
	for i := 0; i < goroutines; i++ {
		done.Add(1)
		go func() {
			defer done.Done()
			start.Wait() // release all goroutines at once
			id, err := p.EnsureCustomer(context.Background(), "user-1")
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, err)
				return
			}
			ids = append(ids, id)
		}()
	}
	start.Done()
	done.Wait()

	require.Empty(t, errs, "no caller may fail to get a customer")
	require.Len(t, ids, goroutines)

	first := ids[0]
	require.NotEmpty(t, first)
	for i, got := range ids {
		require.Equal(t, first, got,
			"goroutine %d got a DIFFERENT customer id; the user's cards would split across two Stripe Customers", i)
	}

	stored, err := dir.GetUserStripeCustomerID(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Equal(t, first, stored, "the recorded id must be the one every caller received")

	assert.Equal(t, 1, ss.DevStore().CustomerCount(),
		"exactly ONE stripe customer may exist for one person")
}

// TestCustomerProvisioner_ConcurrentProvisioningAcrossManyUsers proves the
// per-user lock does not serialize unrelated users into one another's customer.
func TestCustomerProvisioner_ConcurrentProvisioningAcrossManyUsers(t *testing.T) {
	t.Parallel()

	const users = 16
	const perUser = 8

	ss := &StripeService{devMode: true}
	dir := newFakeCustomerDirectory()
	userIDs := make([]string, users)
	for i := range userIDs {
		userIDs[i] = "user-" + string(rune('a'+i))
		dir.addUser(userIDs[i], userIDs[i]+"@example.com", "User")
	}
	p := NewCustomerProvisioner(dir, ss)

	var mu sync.Mutex
	got := make(map[string]map[string]struct{})
	var wg sync.WaitGroup
	for _, uid := range userIDs {
		for i := 0; i < perUser; i++ {
			wg.Add(1)
			go func(uid string) {
				defer wg.Done()
				id, err := p.EnsureCustomer(context.Background(), uid)
				if err != nil {
					return
				}
				mu.Lock()
				defer mu.Unlock()
				if got[uid] == nil {
					got[uid] = make(map[string]struct{})
				}
				got[uid][id] = struct{}{}
			}(uid)
		}
	}
	wg.Wait()

	require.Len(t, got, users)
	seen := make(map[string]string)
	for uid, idSet := range got {
		require.Len(t, idSet, 1, "user %s received more than one customer id", uid)
		for id := range idSet {
			if owner, dup := seen[id]; dup {
				t.Fatalf("customer %s handed to BOTH %s and %s: one user could see and charge the other's cards", id, owner, uid)
			}
			seen[id] = uid
		}
	}
	assert.Equal(t, users, ss.DevStore().CustomerCount(), "one customer per user, no more")
}

// TestCustomerProvisioner_IdempotentAcrossSequentialCalls: the ordinary repeat
// case must not create a second customer or even call Stripe again.
func TestCustomerProvisioner_IdempotentAcrossSequentialCalls(t *testing.T) {
	t.Parallel()

	ss := &StripeService{devMode: true}
	dir := newFakeCustomerDirectory()
	dir.addUser("user-1", "u@example.com", "U")
	p := NewCustomerProvisioner(dir, ss)

	first, err := p.EnsureCustomer(context.Background(), "user-1")
	require.NoError(t, err)
	claimsAfterFirst := dir.claimAttempts

	for i := 0; i < 5; i++ {
		again, err := p.EnsureCustomer(context.Background(), "user-1")
		require.NoError(t, err)
		assert.Equal(t, first, again)
	}

	assert.Equal(t, claimsAfterFirst, dir.claimAttempts,
		"the fast path must not re-claim; a provisioned user costs one read and no writes")
	assert.Equal(t, 1, ss.DevStore().CustomerCount())
}

// TestCustomerProvisioner_OrphanIsReadoptedNotDuplicated covers the failure the
// task names explicitly: a Customer exists at Stripe that we have no record of.
//
// Here the DB claim fails AFTER Stripe created the customer. The provisioner
// must report an error (never a customer id it could not record), and the NEXT
// attempt must re-adopt the SAME Stripe object rather than mint a second one.
func TestCustomerProvisioner_OrphanIsReadoptedNotDuplicated(t *testing.T) {
	t.Parallel()

	ss := &StripeService{devMode: true}
	dir := newFakeCustomerDirectory()
	dir.addUser("user-1", "u@example.com", "U")
	dir.failClaim = errors.New("database unavailable")
	p := NewCustomerProvisioner(dir, ss)

	_, err := p.EnsureCustomer(context.Background(), "user-1")
	require.Error(t, err, "must not return a customer id we failed to record")
	orphanCount := ss.DevStore().CustomerCount()
	require.Equal(t, 1, orphanCount, "stripe created one customer that we did not record")

	// The DB recovers.
	dir.failClaim = nil
	adopted, err := p.EnsureCustomer(context.Background(), "user-1")
	require.NoError(t, err)
	require.NotEmpty(t, adopted)

	assert.Equal(t, 1, ss.DevStore().CustomerCount(),
		"the orphan must be RE-ADOPTED, not duplicated — a second customer would strand any card on the first")
	assert.Equal(t, ss.DevStore().LookupCustomer("user-1"), adopted)
}

// TestCustomerProvisioner_LookupNeverProvisions guards the read path. A GET
// (e.g. list my cards) must never mint a Stripe object as a side effect.
func TestCustomerProvisioner_LookupNeverProvisions(t *testing.T) {
	t.Parallel()

	ss := &StripeService{devMode: true}
	dir := newFakeCustomerDirectory()
	dir.addUser("user-1", "u@example.com", "U")
	p := NewCustomerProvisioner(dir, ss)

	got, err := p.Lookup(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Empty(t, got, "an unprovisioned user has no customer, and asking must not create one")
	assert.Equal(t, 0, ss.DevStore().CustomerCount())
}

// TestCustomerProvisioner_RecordConfirmedPaymentMethod_Idempotent: the same card
// arrives from BOTH the setup_intent.succeeded handler and the synchronous
// confirmation path, and Stripe redelivers events. Repeated recording must
// converge, not accumulate.
func TestCustomerProvisioner_RecordConfirmedPaymentMethod_Idempotent(t *testing.T) {
	t.Parallel()

	ss := &StripeService{devMode: true}
	dir := newFakeCustomerDirectory()
	dir.addUser("user-1", "u@example.com", "U")
	p := NewCustomerProvisioner(dir, ss)

	cus, err := p.EnsureCustomer(context.Background(), "user-1")
	require.NoError(t, err)

	for i := 0; i < 3; i++ {
		require.NoError(t, p.RecordConfirmedPaymentMethod(context.Background(), "user-1", cus, "pm_test_1"))
	}

	methods, err := dir.ListUserPaymentMethods(context.Background(), "user-1")
	require.NoError(t, err)
	require.Len(t, methods, 1, "three arrivals of one card must produce one row")
	assert.True(t, methods[0].IsDefault)

	def, err := p.DefaultPaymentMethod(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Equal(t, "pm_test_1", def)
	assert.Equal(t, "pm_test_1", ss.DevStore().DefaultPaymentMethod(cus),
		"stripe-side default must point at the card too")
}

// TestCustomerProvisioner_SecondCardBecomesDefaultExactlyOnce proves the
// single-default invariant the partial unique index enforces in Postgres.
func TestCustomerProvisioner_SecondCardBecomesDefaultExactlyOnce(t *testing.T) {
	t.Parallel()

	ss := &StripeService{devMode: true}
	dir := newFakeCustomerDirectory()
	dir.addUser("user-1", "u@example.com", "U")
	p := NewCustomerProvisioner(dir, ss)

	cus, err := p.EnsureCustomer(context.Background(), "user-1")
	require.NoError(t, err)
	require.NoError(t, p.RecordConfirmedPaymentMethod(context.Background(), "user-1", cus, "pm_a"))
	require.NoError(t, p.RecordConfirmedPaymentMethod(context.Background(), "user-1", cus, "pm_b"))

	methods, err := dir.ListUserPaymentMethods(context.Background(), "user-1")
	require.NoError(t, err)
	require.Len(t, methods, 2)

	defaults := 0
	for _, m := range methods {
		if m.IsDefault {
			defaults++
		}
	}
	assert.Equal(t, 1, defaults, "exactly one default; two would make 'which card do we charge?' ambiguous")

	def, err := p.DefaultPaymentMethod(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Equal(t, "pm_b", def, "the most recently saved card becomes the default")
}
