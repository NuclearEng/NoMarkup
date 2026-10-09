package grpc

import "testing"

func TestSubscriptionIDFromStripeEvent_parentDetails(t *testing.T) {
	t.Parallel()
	payload := []byte(`{"type":"invoice.paid","data":{"object":{"id":"in_123","parent":{"subscription_details":{"subscription":"sub_parent"}}}}}`)
	id, ok := subscriptionIDFromStripeEvent("invoice.paid", payload)
	if !ok || id != "sub_parent" {
		t.Fatalf("id=%q ok=%v", id, ok)
	}
}

func TestSubscriptionIDFromStripeEvent_legacyString(t *testing.T) {
	t.Parallel()
	payload := []byte(`{"data":{"object":{"id":"in_123","subscription":"sub_legacy"}}}`)
	id, ok := subscriptionIDFromStripeEvent("invoice.paid", payload)
	if !ok || id != "sub_legacy" {
		t.Fatalf("id=%q ok=%v", id, ok)
	}
}

func TestSubscriptionIDFromStripeEvent_expandedObject(t *testing.T) {
	t.Parallel()
	payload := []byte(`{"data":{"object":{"id":"in_123","subscription":{"id":"sub_obj"}}}}`)
	id, ok := subscriptionIDFromStripeEvent("invoice.paid", payload)
	if !ok || id != "sub_obj" {
		t.Fatalf("id=%q ok=%v", id, ok)
	}
}

func TestSubscriptionIDFromStripeEvent_invoiceIDIsNotASubscription(t *testing.T) {
	t.Parallel()
	payload := []byte(`{"data":{"object":{"id":"in_123"}}}`)
	if _, ok := subscriptionIDFromStripeEvent("invoice.paid", payload); ok {
		t.Fatal("invoice id must not be treated as a subscription id")
	}
}

func TestSubscriptionIDFromStripeEvent_subscriptionObjectID(t *testing.T) {
	t.Parallel()
	payload := []byte(`{"data":{"object":{"id":"sub_direct"}}}`)
	id, ok := subscriptionIDFromStripeEvent("customer.subscription.updated", payload)
	if !ok || id != "sub_direct" {
		t.Fatalf("id=%q ok=%v", id, ok)
	}
}
