package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminBankingHandler handles admin platform-bank-account management endpoints.
//
// The platform's own payout bank account is modeled as a Stripe External
// Account on the PLATFORM Stripe account. Raw account/routing numbers are never
// sent to this API: the client tokenizes them via Stripe.js and submits a
// bank_account token (btok_...).
type AdminBankingHandler struct {
	paymentClient paymentv1.PaymentServiceClient
}

// NewAdminBankingHandler creates a new AdminBankingHandler.
func NewAdminBankingHandler(paymentClient paymentv1.PaymentServiceClient) *AdminBankingHandler {
	return &AdminBankingHandler{paymentClient: paymentClient}
}

// GetPlatformBankAccount handles GET /api/v1/admin/platform/bank-account.
func (h *AdminBankingHandler) GetPlatformBankAccount(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	resp, err := h.paymentClient.AdminGetPlatformBankAccount(r.Context(), &paymentv1.AdminGetPlatformBankAccountRequest{
		AdminId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"account": platformBankAccountToJSON(resp.GetAccount()),
	})
}

// SetPlatformBankAccount handles POST /api/v1/admin/platform/bank-account.
// The admin_id comes from the JWT claims, never from the request body.
func (h *AdminBankingHandler) SetPlatformBankAccount(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		BankAccountToken  string `json:"bank_account_token"`
		AccountHolderName string `json:"account_holder_name"`
		AccountHolderType string `json:"account_holder_type"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.BankAccountToken == "" {
		writeError(w, http.StatusBadRequest, "bank_account_token is required")
		return
	}

	resp, err := h.paymentClient.AdminSetPlatformBankAccount(r.Context(), &paymentv1.AdminSetPlatformBankAccountRequest{
		AdminId:           claims.UserID,
		BankAccountToken:  body.BankAccountToken,
		AccountHolderName: body.AccountHolderName,
		AccountHolderType: body.AccountHolderType,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"account": platformBankAccountToJSON(resp.GetAccount()),
	})
}

// DeletePlatformBankAccount handles DELETE /api/v1/admin/platform/bank-account/{id}.
func (h *AdminBankingHandler) DeletePlatformBankAccount(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "bank account id required")
		return
	}

	resp, err := h.paymentClient.AdminDeletePlatformBankAccount(r.Context(), &paymentv1.AdminDeletePlatformBankAccountRequest{
		AdminId: claims.UserID,
		Id:      id,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"deleted": resp.GetDeleted(),
	})
}

// platformBankAccountToJSON maps the proto account onto a JSON-friendly map.
// Returns nil when no account is configured so callers can distinguish "unset".
func platformBankAccountToJSON(a *paymentv1.PlatformBankAccount) interface{} {
	if a == nil {
		return nil
	}
	return map[string]interface{}{
		"id":                         a.GetId(),
		"stripe_external_account_id": a.GetStripeExternalAccountId(),
		"bank_name":                  a.GetBankName(),
		"account_holder_name":        a.GetAccountHolderName(),
		"account_holder_type":        a.GetAccountHolderType(),
		"last4":                      a.GetLast4(),
		"routing_last4":              a.GetRoutingLast4(),
		"currency":                   a.GetCurrency(),
		"country":                    a.GetCountry(),
		"status":                     a.GetStatus(),
		"is_default":                 a.GetIsDefault(),
		"created_at":                 formatTimestamp(a.GetCreatedAt()),
		"updated_at":                 formatTimestamp(a.GetUpdatedAt()),
	}
}
