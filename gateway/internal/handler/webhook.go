package handler

import (
	"io"
	"net/http"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

// WebhookHandler handles incoming webhook requests.
type WebhookHandler struct {
	paymentClient paymentv1.PaymentServiceClient
}

// NewWebhookHandler creates a new WebhookHandler.
func NewWebhookHandler(paymentClient paymentv1.PaymentServiceClient) *WebhookHandler {
	return &WebhookHandler{paymentClient: paymentClient}
}

// HandleStripeWebhook handles POST /api/v1/webhooks/stripe.
// It reads the raw body (not JSON-decoded) and passes it to the payment service.
// This endpoint has NO auth middleware -- verified by Stripe signature on the payment service side.
func (h *WebhookHandler) HandleStripeWebhook(w http.ResponseWriter, r *http.Request) {
	// Read raw body.
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer r.Body.Close()

	signature := r.Header.Get("Stripe-Signature")

	_, err = h.paymentClient.HandleStripeWebhook(r.Context(), &paymentv1.HandleStripeWebhookRequest{
		Payload:   string(body),
		Signature: signature,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	w.WriteHeader(http.StatusOK)
}
