package grpc

import "github.com/nomarkup/nomarkup/services/payment/internal/service"

// subscriptionIDFromStripeEvent delegates to the service parser so the gRPC
// webhook path and the payment webhook path cannot drift. Callers must run
// stripe.webhooks.constructEvent() before using the id.
func subscriptionIDFromStripeEvent(eventType string, payload []byte) (string, bool) {
	return service.SubscriptionIDFromStripeEvent(eventType, payload)
}

// resolvedSubscriptionID returns "" when an invoice or subscription event has
// no subscription id. An invoice id is never a substitute.
func resolvedSubscriptionID(eventType string, payload []byte, objectID, legacySubscription string) string {
	return service.ResolvedSubscriptionID(eventType, payload, objectID, legacySubscription)
}
