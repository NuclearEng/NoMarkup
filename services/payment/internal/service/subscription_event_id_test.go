package service

import (
	"context"
	"testing"
	"time"

	"github.com/stripe/stripe-go/v82"
)

// These tests parse objects that have already passed signature verification.
// Production callers run stripe.webhooks.constructEvent() before this code.

type captureSubHook struct {
	called bool
	id     string
	reason string
	price  string
}

func (c *captureSubHook) HandleSubscriptionWebhook(_ context.Context, _ string, stripeSubscriptionID string, _, _ *time.Time, billingReason, stripePriceID string) error {
	c.called = true
	c.id = stripeSubscriptionID
	c.reason = billingReason
	c.price = stripePriceID
	return nil
}

func TestSubscriptionIDFromStripeObject_rejectsInvoiceID(t *testing.T) {
	t.Parallel()
	_, ok := SubscriptionIDFromStripeObject("invoice.paid", []byte(`{"id":"in_123"}`))
	if ok {
		t.Fatal("invoice id must not be treated as a subscription id")
	}
}

func TestPriceIDForTierSync_prefersPositiveProration(t *testing.T) {
	t.Parallel()
	raw := []byte(`{
		"lines": {"data": [
			{"amount": -100, "pricing": {"price_details": {"price": "price_old"}}, "parent": {"subscription_item_details": {"proration": true}}},
			{"amount": 900, "pricing": {"price_details": {"price": "price_new"}}, "parent": {"subscription_item_details": {"proration": true}}},
			{"amount": 5000, "pricing": {"price_details": {"price": "price_renewal"}}}
		]}
	}`)
	if got := PriceIDForTierSyncFromStripeObject("invoice.paid", raw); got != "price_new" {
		t.Fatalf("price = %q", got)
	}
	if got := PriceIDForTierSyncFromStripeObject("invoice.payment_failed", raw); got != "" {
		t.Fatalf("failed invoice must not sync a price, got %q", got)
	}
}

func TestHandleSubscriptionEvent_doesNotForwardInvoiceID(t *testing.T) {
	t.Parallel()
	hook := &captureSubHook{}
	svc := &PaymentService{subHook: hook}
	event := stripe.Event{
		Type: "invoice.paid",
		Data: &stripe.EventData{Raw: []byte(`{"id":"in_only","billing_reason":"subscription_cycle"}`)},
	}
	if err := svc.handleSubscriptionEvent(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	if hook.called {
		t.Fatalf("forwarded id %q", hook.id)
	}
}

func TestHandleSubscriptionEvent_forwardsParentSubscriptionAndPrice(t *testing.T) {
	t.Parallel()
	hook := &captureSubHook{}
	svc := &PaymentService{subHook: hook}
	raw := []byte(`{
		"id":"in_1",
		"billing_reason":"subscription_update",
		"parent":{"subscription_details":{"subscription":"sub_ok"}},
		"lines":{"data":[{"amount":700,"pricing":{"price_details":{"price":"price_up"}},"parent":{"subscription_item_details":{"proration":true}}}]}
	}`)
	event := stripe.Event{Type: "invoice.paid", Data: &stripe.EventData{Raw: raw}}
	if err := svc.handleSubscriptionEvent(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	if !hook.called || hook.id != "sub_ok" || hook.reason != "subscription_update" || hook.price != "price_up" {
		t.Fatalf("hook id=%q reason=%q price=%q called=%v", hook.id, hook.reason, hook.price, hook.called)
	}
}

func TestStripeTierChangeApplied(t *testing.T) {
	t.Parallel()
	if stripeTierChangeApplied(true, "paid") {
		t.Fatal("pending update must not apply")
	}
	if stripeTierChangeApplied(false, "open") {
		t.Fatal("unpaid invoice must not apply")
	}
	if !stripeTierChangeApplied(false, "paid") {
		t.Fatal("paid invoice without a pending update must apply")
	}
}

func TestProrationCentsFromInvoice_sumsProrationLines(t *testing.T) {
	t.Parallel()
	inv := &stripe.Invoice{
		AmountDue: 9999,
		Lines: &stripe.InvoiceLineItemList{
			Data: []*stripe.InvoiceLineItem{
				{
					Amount: -200,
					Parent: &stripe.InvoiceLineItemParent{
						SubscriptionItemDetails: &stripe.InvoiceLineItemParentSubscriptionItemDetails{Proration: true},
					},
				},
				{
					Amount: 800,
					Parent: &stripe.InvoiceLineItemParent{
						SubscriptionItemDetails: &stripe.InvoiceLineItemParentSubscriptionItemDetails{Proration: true},
					},
				},
			},
		},
	}
	if got := prorationCentsFromInvoice(inv); got != 600 {
		t.Fatalf("proration = %d", got)
	}
}
