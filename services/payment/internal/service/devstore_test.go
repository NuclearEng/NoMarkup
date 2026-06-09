package service

import (
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Payment methods ---

func TestDevStore_PaymentMethods(t *testing.T) {
	t.Parallel()

	store := newDevStore()

	// Empty list initially
	assert.Empty(t, store.ListPaymentMethods("user-1"))

	// Add one
	pm1 := store.AddPaymentMethod("user-1", "visa", "4242", 12, 2030)
	assert.True(t, strings.HasPrefix(pm1.ID, "pm_dev_"))
	assert.Equal(t, "visa", pm1.Brand)
	assert.Equal(t, "4242", pm1.LastFour)
	assert.Equal(t, int32(12), pm1.ExpMonth)
	assert.Equal(t, int32(2030), pm1.ExpYear)

	// Add second
	pm2 := store.AddPaymentMethod("user-1", "mastercard", "5454", 6, 2028)

	methods := store.ListPaymentMethods("user-1")
	require.Len(t, methods, 2)
	assert.NotEqual(t, pm1.ID, pm2.ID, "each AddPaymentMethod should yield a unique ID")

	// Different user is isolated
	store.AddPaymentMethod("user-2", "amex", "0005", 1, 2031)
	assert.Len(t, store.ListPaymentMethods("user-1"), 2)
	assert.Len(t, store.ListPaymentMethods("user-2"), 1)

	// Delete an existing method returns true
	assert.True(t, store.DeletePaymentMethod(pm1.ID))
	remaining := store.ListPaymentMethods("user-1")
	require.Len(t, remaining, 1)
	assert.Equal(t, pm2.ID, remaining[0].ID)

	// Delete nonexistent returns false
	assert.False(t, store.DeletePaymentMethod("pm_does_not_exist"))
}

func TestDevStore_ListReturnsCopyNotReference(t *testing.T) {
	t.Parallel()

	store := newDevStore()
	store.AddPaymentMethod("user-1", "visa", "4242", 12, 2030)

	a := store.ListPaymentMethods("user-1")
	require.Len(t, a, 1)

	// Mutating the returned slice must not affect the store.
	a[0].LastFour = "0000"

	b := store.ListPaymentMethods("user-1")
	assert.Equal(t, "4242", b[0].LastFour, "ListPaymentMethods must return an independent copy")
}

// --- Setup intents ---

func TestDevStore_SetupIntents(t *testing.T) {
	t.Parallel()

	store := newDevStore()

	tok := store.NewSetupIntent("user-1")
	assert.True(t, strings.HasPrefix(tok, "dev_seti_"),
		"dev setup-intent token must use the sentinel prefix the frontend recognizes")
	assert.True(t, IsDevSetupIntent(tok))

	// Real-looking client_secrets must NOT be classified as dev tokens.
	assert.False(t, IsDevSetupIntent("seti_1Hxxxx_secret_yyy"))
	assert.False(t, IsDevSetupIntent(""))

	// Each call yields a unique token.
	tok2 := store.NewSetupIntent("user-1")
	assert.NotEqual(t, tok, tok2)
}

// --- Subscriptions ---

func TestDevStore_SubscriptionLifecycle(t *testing.T) {
	t.Parallel()

	store := newDevStore()

	// Upsert creates new
	sub1 := store.UpsertSubscription("user-1", "price_pro_customer", "pm_1")
	assert.True(t, strings.HasPrefix(sub1.ID, "sub_dev_"))
	assert.Equal(t, "user-1", sub1.CustomerKey)
	assert.Equal(t, "price_pro_customer", sub1.StripePriceID)

	// Re-upsert for same customer updates rather than creating new
	sub2 := store.UpsertSubscription("user-1", "price_basic", "pm_2")
	assert.Equal(t, sub1.ID, sub2.ID, "second upsert for same customer must update existing subscription")
	assert.Equal(t, "price_basic", sub2.StripePriceID)
	assert.Equal(t, "pm_2", sub2.PaymentMethodID)

	// Empty payment_method preserves existing
	sub3 := store.UpsertSubscription("user-1", "price_premium", "")
	assert.Equal(t, "pm_2", sub3.PaymentMethodID,
		"empty payment_method on upsert must preserve the previous value")

	// UpdateSubscriptionPrice on known sub
	updated, ok := store.UpdateSubscriptionPrice(sub1.ID, "price_enterprise")
	assert.True(t, ok)
	assert.Equal(t, "price_enterprise", updated.StripePriceID)

	// UpdateSubscriptionPrice on unknown sub returns ok=false
	_, ok = store.UpdateSubscriptionPrice("sub_dev_nonexistent", "x")
	assert.False(t, ok)

	// Cancel removes both subscription and customer mapping
	assert.True(t, store.CancelSubscription(sub1.ID))
	// Subsequent upsert for the same customer should now create a NEW subscription.
	sub4 := store.UpsertSubscription("user-1", "price_basic", "pm_3")
	assert.NotEqual(t, sub1.ID, sub4.ID,
		"after cancellation, a new upsert should mint a fresh subscription ID")

	// Cancelling unknown subscription returns false
	assert.False(t, store.CancelSubscription("sub_dev_unknown"))
}

// --- Advances ---

func TestDevStore_RecordAdvance(t *testing.T) {
	t.Parallel()

	store := newDevStore()
	id1 := store.RecordAdvance("key-1", "provider-1", 50000)
	assert.True(t, strings.HasPrefix(id1, "tr_platform_dev_"))

	id2 := store.RecordAdvance("key-2", "provider-1", 25000)
	assert.NotEqual(t, id1, id2, "distinct idempotency keys must yield unique transfer IDs")

	// Idempotency: the SAME key must return the SAME transfer id (no double payout).
	id1again := store.RecordAdvance("key-1", "provider-1", 50000)
	assert.Equal(t, id1, id1again, "a repeated idempotency key must dedup to the same transfer ID")
}

// --- Concurrency ---

func TestDevStore_ConcurrentAccess(t *testing.T) {
	t.Parallel()

	// Verify the mutex actually protects against data races. The Go race
	// detector in `go test -race` will catch any unsynchronized access.
	store := newDevStore()

	const goroutines = 20
	const opsPerGoroutine = 50

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func(i int) {
			defer wg.Done()
			userKey := "user-" + string(rune('a'+i%5))
			for j := 0; j < opsPerGoroutine; j++ {
				pm := store.AddPaymentMethod(userKey, "visa", "4242", 1, 2030)
				_ = store.ListPaymentMethods(userKey)
				_ = store.DeletePaymentMethod(pm.ID)
				_ = store.NewSetupIntent(userKey)
				_ = store.RecordAdvance("idem-"+userKey+"-"+string(rune('0'+j%10)), userKey, 1000)
				store.UpsertSubscription(userKey, "price_x", "pm_x")
			}
		}(i)
	}
	wg.Wait()
}
