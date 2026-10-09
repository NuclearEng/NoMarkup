package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// setupIntentEventFixture wires a PaymentService with a customer provisioner and
// a validator that returns the given event.
//
// It deliberately goes through HandleWebhook rather than calling the handler
// directly, so every test here also exercises the two guards the handler
// inherits and must never bypass: mandatory signature verification via
// stripe.webhooks.constructEvent(), and event-id dedup through
// RecordStripeEventStart.
func setupIntentEventFixture(t *testing.T, si stripe.SetupIntent, eventType stripe.EventType) (*PaymentService, *fakeCustomerDirectory, *StripeService, *mockPaymentRepo) {
	t.Helper()

	raw, err := json.Marshal(si)
	require.NoError(t, err)

	processed := map[string]bool{}
	repo := &mockPaymentRepo{
		recordStripeEventStartFn: func(_ context.Context, eventID, _ string) (bool, error) {
			if processed[eventID] {
				return true, nil
			}
			processed[eventID] = true
			return false, nil
		},
		markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
	}

	ss := &StripeService{devMode: true}
	dir := newFakeCustomerDirectory()
	svc := NewPaymentService(repo, ss)
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, ss))
	svc.SetWebhookValidator(&fakeWebhookValidator{event: stripe.Event{
		ID:   "evt_setup_1",
		Type: eventType,
		Data: &stripe.EventData{Raw: raw},
	}})
	return svc, dir, ss, repo
}

// TestSetupIntentSucceeded_PersistsAndDefaultsTheCard is the core of the
// confirmation path.
//
// This event is often the ONLY signal the platform ever receives that a card was
// saved: a buyer can complete a 3DS challenge in their bank app and never return
// to the tab, so the synchronous confirmation call never happens. Losing this
// event means the buyer believes their card is on file and no charge will ever
// find it.
func TestSetupIntentSucceeded_PersistsAndDefaultsTheCard(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	si := stripe.SetupIntent{
		ID:            "seti_1",
		Customer:      &stripe.Customer{ID: "cus_known"},
		PaymentMethod: &stripe.PaymentMethod{ID: "pm_saved"},
		Metadata:      map[string]string{"platform_customer_id": "user-1"},
	}
	svc, dir, ss, _ := setupIntentEventFixture(t, si, "setup_intent.succeeded")

	// The user already owns this Stripe customer.
	dir.addUser("user-1", "u@example.com", "U")
	_, err := dir.ClaimUserStripeCustomerID(ctx, "user-1", "cus_known")
	require.NoError(t, err)

	require.NoError(t, svc.HandleWebhook(ctx, []byte("{}"), "sig"))

	methods, err := dir.ListUserPaymentMethods(ctx, "user-1")
	require.NoError(t, err)
	require.Len(t, methods, 1, "the saved card must be persisted")
	assert.Equal(t, "pm_saved", methods[0].ID)
	assert.True(t, methods[0].IsDefault)

	def, err := dir.GetDefaultUserPaymentMethod(ctx, "user-1")
	require.NoError(t, err)
	assert.Equal(t, "pm_saved", def, "the card must be chargeable off-session")

	assert.Equal(t, "pm_saved", ss.DevStore().DefaultPaymentMethod("cus_known"),
		"and set as the stripe-side customer default")
}

// TestSetupIntentSucceeded_RedeliveryIsIdempotent: Stripe redelivers successful
// events, and the synchronous path writes the same card. Neither may produce a
// duplicate or flap the default.
func TestSetupIntentSucceeded_RedeliveryIsIdempotent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	si := stripe.SetupIntent{
		ID:            "seti_1",
		Customer:      &stripe.Customer{ID: "cus_known"},
		PaymentMethod: &stripe.PaymentMethod{ID: "pm_saved"},
	}
	svc, dir, _, _ := setupIntentEventFixture(t, si, "setup_intent.succeeded")
	dir.addUser("user-1", "u@example.com", "U")
	_, err := dir.ClaimUserStripeCustomerID(ctx, "user-1", "cus_known")
	require.NoError(t, err)

	// Same event id three times: the dedup layer swallows 2 and 3, and even if it
	// did not, the upsert would converge.
	for i := 0; i < 3; i++ {
		require.NoError(t, svc.HandleWebhook(ctx, []byte("{}"), "sig"))
	}

	methods, err := dir.ListUserPaymentMethods(ctx, "user-1")
	require.NoError(t, err)
	assert.Len(t, methods, 1)
}

// TestSetupIntentSucceeded_ResolvesOwnerFromOurOwnRecord: the DB mapping (unique
// per migration 102) is preferred over the metadata tag, because the DB is what
// every other money path uses to decide who owns a customer.
func TestSetupIntentSucceeded_ResolvesOwnerFromOurOwnRecord(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	si := stripe.SetupIntent{
		ID:            "seti_1",
		Customer:      &stripe.Customer{ID: "cus_known"},
		PaymentMethod: &stripe.PaymentMethod{ID: "pm_saved"},
		// A tag naming a DIFFERENT user. The DB must win: otherwise a forged or
		// stale tag could attach a card to someone else's account.
		Metadata: map[string]string{"platform_customer_id": "attacker"},
	}
	svc, dir, _, _ := setupIntentEventFixture(t, si, "setup_intent.succeeded")
	dir.addUser("real-owner", "r@example.com", "R")
	dir.addUser("attacker", "a@example.com", "A")
	_, err := dir.ClaimUserStripeCustomerID(ctx, "real-owner", "cus_known")
	require.NoError(t, err)

	require.NoError(t, svc.HandleWebhook(ctx, []byte("{}"), "sig"))

	owner, err := dir.ListUserPaymentMethods(ctx, "real-owner")
	require.NoError(t, err)
	assert.Len(t, owner, 1, "the card belongs to the recorded owner of the customer")

	other, err := dir.ListUserPaymentMethods(ctx, "attacker")
	require.NoError(t, err)
	assert.Empty(t, other, "the metadata tag must not override our own ownership record")
}

// TestSetupIntentSucceeded_UnactionablePayloadsAreAcked: a 500 here makes Stripe
// retry for three days, and no retry makes an unknown customer known. These must
// ack (return nil) while still not persisting anything.
func TestSetupIntentSucceeded_UnactionablePayloadsAreAcked(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		si   stripe.SetupIntent
	}{
		{
			name: "no_payment_method",
			si:   stripe.SetupIntent{ID: "seti_1", Customer: &stripe.Customer{ID: "cus_known"}},
		},
		{
			name: "no_customer_means_the_card_attached_to_nothing",
			si:   stripe.SetupIntent{ID: "seti_1", PaymentMethod: &stripe.PaymentMethod{ID: "pm_x"}},
		},
		{
			name: "unknown_customer_and_no_tag",
			si: stripe.SetupIntent{
				ID:            "seti_1",
				Customer:      &stripe.Customer{ID: "cus_from_another_environment"},
				PaymentMethod: &stripe.PaymentMethod{ID: "pm_x"},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc, dir, _, _ := setupIntentEventFixture(t, tc.si, "setup_intent.succeeded")
			dir.addUser("user-1", "u@example.com", "U")

			err := svc.HandleWebhook(context.Background(), []byte("{}"), "sig")
			require.NoError(t, err, "must ack so Stripe does not retry-storm for 3 days")

			methods, listErr := dir.ListUserPaymentMethods(context.Background(), "user-1")
			require.NoError(t, listErr)
			assert.Empty(t, methods, "nothing may be persisted from an unactionable payload")
		})
	}
}

// TestSetupIntentEvents_RequireSignatureVerification: the new handlers are
// reachable only through the verified path. Without a validator the service
// refuses every event, including these.
func TestSetupIntentEvents_RequireSignatureVerification(t *testing.T) {
	t.Parallel()

	ss := &StripeService{devMode: true}
	svc := NewPaymentService(&mockPaymentRepo{}, ss)
	svc.SetCustomerProvisioner(NewCustomerProvisioner(newFakeCustomerDirectory(), ss))
	// Deliberately NO SetWebhookValidator.

	err := svc.HandleWebhook(context.Background(), []byte(`{"type":"setup_intent.succeeded"}`), "sig")
	require.Error(t, err, "an unverified setup_intent event must never reach the handler")
	assert.Contains(t, err.Error(), "validator not configured")
}

// TestSetupIntentFailed_IsAckedAndPersistsNothing: a failed setup is not a
// platform fault and no retry changes it.
func TestSetupIntentFailed_IsAckedAndPersistsNothing(t *testing.T) {
	t.Parallel()

	si := stripe.SetupIntent{
		ID:       "seti_1",
		Customer: &stripe.Customer{ID: "cus_known"},
		Metadata: map[string]string{"platform_customer_id": "user-1"},
	}
	svc, dir, _, _ := setupIntentEventFixture(t, si, "setup_intent.setup_failed")
	dir.addUser("user-1", "u@example.com", "U")

	require.NoError(t, svc.HandleWebhook(context.Background(), []byte("{}"), "sig"))

	methods, err := dir.ListUserPaymentMethods(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Empty(t, methods)
}

// TestPaymentMethodDetached_RemovesChargeability keeps the fail-closed
// chargeability check honest when a card is removed outside our API.
func TestPaymentMethodDetached_RemovesChargeability(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	raw, err := json.Marshal(stripe.PaymentMethod{ID: "pm_gone"})
	require.NoError(t, err)

	repo := &mockPaymentRepo{
		recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
		markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
	}
	ss := &StripeService{devMode: true}
	dir := newFakeCustomerDirectory()
	svc := NewPaymentService(repo, ss)
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, ss))
	svc.SetWebhookValidator(&fakeWebhookValidator{event: stripe.Event{
		ID:   "evt_detach",
		Type: "payment_method.detached",
		Data: &stripe.EventData{Raw: raw},
	}})

	dir.addUser("user-1", "u@example.com", "U")
	_, err = dir.ClaimUserStripeCustomerID(ctx, "user-1", "cus_known")
	require.NoError(t, err)
	p := NewCustomerProvisioner(dir, ss)
	require.NoError(t, p.RecordConfirmedPaymentMethod(ctx, "user-1", "cus_known", "pm_gone"))

	def, err := p.DefaultPaymentMethod(ctx, "user-1")
	require.NoError(t, err)
	require.Equal(t, "pm_gone", def)

	require.NoError(t, svc.HandleWebhook(ctx, []byte("{}"), "sig"))

	def, err = p.DefaultPaymentMethod(ctx, "user-1")
	require.NoError(t, err)
	assert.Empty(t, def, "a card detached at Stripe must stop being chargeable here")
}
