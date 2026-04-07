package handler

import (
	"io"
	"log/slog"
	"net/http"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	subscriptionv1 "github.com/nomarkup/nomarkup/proto/subscription/v1"
)

// WebhookHandler handles incoming webhook requests.
type WebhookHandler struct {
	paymentClient      paymentv1.PaymentServiceClient
	subscriptionClient subscriptionv1.SubscriptionServiceClient
}

// NewWebhookHandler creates a new WebhookHandler.
func NewWebhookHandler(paymentClient paymentv1.PaymentServiceClient, subscriptionClient subscriptionv1.SubscriptionServiceClient) *WebhookHandler {
	return &WebhookHandler{
		paymentClient:      paymentClient,
		subscriptionClient: subscriptionClient,
	}
}

// HandleStripeWebhook handles POST /api/v1/webhooks/stripe.
// It reads the raw body (not JSON-decoded) and passes it to the payment service.
// This endpoint has NO auth middleware -- verified by Stripe signature on the payment service side.
func (h *WebhookHandler) HandleStripeWebhook(w http.ResponseWriter, r *http.Request) {
	// Read raw body.
	body, err := io.ReadAll(r.Body)
	if err != nil {
		slog.ErrorContext(r.Context(), "stripe webhook: failed to read body", "error", err)
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer r.Body.Close()

	// Stripe-Signature header is required for webhook verification.
	// The payment service calls stripe.webhooks.constructEvent() to verify webhook authenticity.
	signature := r.Header.Get("Stripe-Signature")

	slog.InfoContext(r.Context(), "stripe webhook received",
		"payload_bytes", len(body),
		"signature_present", signature != "",
	)

	_, err = h.paymentClient.HandleStripeWebhook(r.Context(), &paymentv1.HandleStripeWebhookRequest{
		Payload:   string(body),
		Signature: signature,
	})
	if err != nil {
		slog.ErrorContext(r.Context(), "stripe webhook processing failed",
			"payload_bytes", len(body),
			"error", err,
		)
		writeGRPCError(w, err)
		return
	}

	slog.InfoContext(r.Context(), "stripe webhook processed successfully", "payload_bytes", len(body))
	w.WriteHeader(http.StatusOK)
}

// HandleSubscriptionWebhook handles POST /api/v1/webhooks/subscription.
// It reads the raw body and passes it to the subscription service for processing.
// This endpoint has NO auth middleware -- verified by Stripe signature on the subscription service side.
func (h *WebhookHandler) HandleSubscriptionWebhook(w http.ResponseWriter, r *http.Request) {
	// Read raw body.
	body, err := io.ReadAll(r.Body)
	if err != nil {
		slog.ErrorContext(r.Context(), "subscription webhook: failed to read body", "error", err)
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer r.Body.Close()

	// Stripe-Signature header is required for webhook verification.
	// The subscription service calls stripe.webhooks.constructEvent() to verify webhook authenticity.
	signature := r.Header.Get("Stripe-Signature")

	slog.InfoContext(r.Context(), "subscription webhook received",
		"payload_bytes", len(body),
		"signature_present", signature != "",
	)

	_, err = h.subscriptionClient.HandleSubscriptionWebhook(r.Context(), &subscriptionv1.HandleSubscriptionWebhookRequest{
		Payload:   string(body),
		Signature: signature,
	})
	if err != nil {
		slog.ErrorContext(r.Context(), "subscription webhook processing failed",
			"payload_bytes", len(body),
			"error", err,
		)
		writeGRPCError(w, err)
		return
	}

	slog.InfoContext(r.Context(), "subscription webhook processed successfully", "payload_bytes", len(body))
	w.WriteHeader(http.StatusOK)
}
