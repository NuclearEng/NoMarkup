package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// PaymentHandler handles HTTP endpoints for payments.
type PaymentHandler struct {
	paymentClient paymentv1.PaymentServiceClient
	// db backs the instant-payout ledger (instant_payouts). Other gateway
	// handlers query Postgres directly via pgxpool; we follow that pattern
	// rather than adding a new gRPC RPC. May be nil in unit tests that don't
	// exercise the ledger path.
	db *pgxpool.Pool
}

// NewPaymentHandler creates a new PaymentHandler. db is the gateway's shared
// pgx pool, used for the instant-payout ledger (idempotency + daily cap).
func NewPaymentHandler(paymentClient paymentv1.PaymentServiceClient, db *pgxpool.Pool) *PaymentHandler {
	return &PaymentHandler{paymentClient: paymentClient, db: db}
}

// CreateStripeAccount handles POST /api/v1/providers/me/stripe/account.
func (h *PaymentHandler) CreateStripeAccount(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	// Body is optional: the frontend "Connect with Stripe" action sends none and
	// the payment service derives email/business_name from the user record. An
	// empty/absent body must not 400 (was "invalid request body: EOF").
	var req struct {
		Email        string `json:"email"`
		BusinessName string `json:"business_name"`
	}
	if err := decodeJSONOptional(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	resp, err := h.paymentClient.CreateStripeAccount(r.Context(), &paymentv1.CreateStripeAccountRequest{
		UserId:       claims.UserID,
		Email:        req.Email,
		BusinessName: req.BusinessName,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"stripe_account_id": resp.GetStripeAccountId(),
	})
}

// GetStripeOnboardingLink handles GET /api/v1/providers/me/stripe/onboarding.
func (h *PaymentHandler) GetStripeOnboardingLink(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()
	returnURL := q.Get("return_url")
	refreshURL := q.Get("refresh_url")

	resp, err := h.paymentClient.GetStripeOnboardingLink(r.Context(), &paymentv1.GetStripeOnboardingLinkRequest{
		UserId:     claims.UserID,
		ReturnUrl:  returnURL,
		RefreshUrl: refreshURL,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"onboarding_url": resp.GetOnboardingUrl(),
	})
}

// GetStripeAccountStatus handles GET /api/v1/providers/me/stripe/status.
func (h *PaymentHandler) GetStripeAccountStatus(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.paymentClient.GetStripeAccountStatus(r.Context(), &paymentv1.GetStripeAccountStatusRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"charges_enabled":   resp.GetChargesEnabled(),
		"payouts_enabled":   resp.GetPayoutsEnabled(),
		"details_submitted": resp.GetDetailsSubmitted(),
		"requirements":      resp.GetRequirements(),
	})
}

// CreateSetupIntent handles POST /api/v1/payments/setup-intent.
func (h *PaymentHandler) CreateSetupIntent(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.paymentClient.CreateSetupIntent(r.Context(), &paymentv1.CreateSetupIntentRequest{
		CustomerId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"client_secret": resp.GetClientSecret(),
	})
}

// ListPaymentMethods handles GET /api/v1/payments/methods.
func (h *PaymentHandler) ListPaymentMethods(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.paymentClient.ListPaymentMethods(r.Context(), &paymentv1.ListPaymentMethodsRequest{
		CustomerId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	methods := make([]map[string]interface{}, 0, len(resp.GetMethods()))
	for _, m := range resp.GetMethods() {
		methods = append(methods, map[string]interface{}{
			"id":         m.GetId(),
			"type":       m.GetType(),
			"last_four":  m.GetLastFour(),
			"brand":      m.GetBrand(),
			"exp_month":  m.GetExpMonth(),
			"exp_year":   m.GetExpYear(),
			"is_default": m.GetIsDefault(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"methods": methods,
	})
}

// AddDevPaymentMethod handles POST /api/v1/payments/dev/methods. Dev-only
// fallback for when Stripe keys aren't configured. The payment service
// rejects the RPC with FailedPrecondition outside dev mode.
func (h *PaymentHandler) AddDevPaymentMethod(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var body struct {
		Brand    string `json:"brand"`
		LastFour string `json:"last_four"`
		ExpMonth int32  `json:"exp_month"`
		ExpYear  int32  `json:"exp_year"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Brand == "" || body.LastFour == "" || body.ExpMonth == 0 || body.ExpYear == 0 {
		writeError(w, http.StatusBadRequest, "brand, last_four, exp_month, exp_year are required")
		return
	}
	if len(body.LastFour) != 4 {
		writeError(w, http.StatusBadRequest, "last_four must be exactly 4 digits")
		return
	}

	resp, err := h.paymentClient.AddDevPaymentMethod(r.Context(), &paymentv1.AddDevPaymentMethodRequest{
		CustomerId: claims.UserID,
		Brand:      body.Brand,
		LastFour:   body.LastFour,
		ExpMonth:   body.ExpMonth,
		ExpYear:    body.ExpYear,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	m := resp.GetMethod()
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":         m.GetId(),
		"type":       m.GetType(),
		"last_four":  m.GetLastFour(),
		"brand":      m.GetBrand(),
		"exp_month":  m.GetExpMonth(),
		"exp_year":   m.GetExpYear(),
		"is_default": m.GetIsDefault(),
	})
}

// DeletePaymentMethod handles DELETE /api/v1/payments/methods/{id}.
func (h *PaymentHandler) DeletePaymentMethod(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	methodID := chi.URLParam(r, "id")
	if methodID == "" {
		writeError(w, http.StatusBadRequest, "payment method id required")
		return
	}

	_, err := h.paymentClient.DeletePaymentMethod(r.Context(), &paymentv1.DeletePaymentMethodRequest{
		PaymentMethodId: methodID,
		CustomerId:      claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"deleted": true,
	})
}

type createPaymentRequest struct {
	ContractID          string `json:"contract_id"`
	MilestoneID         string `json:"milestone_id"`
	RecurringInstanceID string `json:"recurring_instance_id"`
	ProviderID          string `json:"provider_id"`
	AmountCents         int64  `json:"amount_cents"`
	IdempotencyKey      string `json:"idempotency_key"`
	InstallmentNumber   int32  `json:"installment_number"`
	TotalInstallments   int32  `json:"total_installments"`
}

// CreatePayment handles POST /api/v1/payments.
func (h *PaymentHandler) CreatePayment(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req createPaymentRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	grpcReq := &paymentv1.CreatePaymentRequest{
		ContractId:          req.ContractID,
		MilestoneId:         req.MilestoneID,
		RecurringInstanceId: req.RecurringInstanceID,
		CustomerId:          claims.UserID,
		ProviderId:          req.ProviderID,
		AmountCents:         req.AmountCents,
		IdempotencyKey:      req.IdempotencyKey,
		InstallmentNumber:   req.InstallmentNumber,
		TotalInstallments:   req.TotalInstallments,
	}

	resp, err := h.paymentClient.CreatePayment(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := protoPaymentToJSON(resp.GetPayment())
	result["client_secret"] = resp.GetClientSecret()

	writeJSON(w, http.StatusCreated, result)
}

type processPaymentRequest struct {
	PaymentMethodID string `json:"payment_method_id"`
}

// ProcessPayment handles POST /api/v1/payments/{id}/process.
func (h *PaymentHandler) ProcessPayment(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	paymentID := chi.URLParam(r, "id")
	if paymentID == "" {
		writeError(w, http.StatusBadRequest, "payment id required")
		return
	}

	var req processPaymentRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.paymentClient.ProcessPayment(r.Context(), &paymentv1.ProcessPaymentRequest{
		PaymentId:       paymentID,
		PaymentMethodId: req.PaymentMethodID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoPaymentToJSON(resp.GetPayment()))
}

// ListPayments handles GET /api/v1/payments.
func (h *PaymentHandler) ListPayments(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()

	grpcReq := &paymentv1.ListPaymentsRequest{
		UserId: claims.UserID,
	}

	if statusStr := q.Get("status"); statusStr != "" {
		st := stringToPaymentStatus(statusStr)
		grpcReq.StatusFilter = &st
	}

	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil {
			pageSize = int32(v)
		}
	}
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     page,
		PageSize: pageSize,
	}

	resp, err := h.paymentClient.ListPayments(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	payments := make([]map[string]interface{}, 0, len(resp.GetPayments()))
	for _, p := range resp.GetPayments() {
		payments = append(payments, protoPaymentToJSON(p))
	}

	result := map[string]interface{}{
		"payments": payments,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"totalCount": pg.GetTotalCount(),
			"page":        pg.GetPage(),
			"pageSize":   pg.GetPageSize(),
			"totalPages": pg.GetTotalPages(),
			"hasNext":    pg.GetHasNext(),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// GetPayment handles GET /api/v1/payments/{id}.
func (h *PaymentHandler) GetPayment(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	paymentID := chi.URLParam(r, "id")
	if paymentID == "" {
		writeError(w, http.StatusBadRequest, "payment id required")
		return
	}

	resp, err := h.paymentClient.GetPayment(r.Context(), &paymentv1.GetPaymentRequest{
		PaymentId: paymentID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := protoPaymentToJSON(resp.GetPayment())
	if b := resp.GetBreakdown(); b != nil {
		result["breakdown"] = map[string]interface{}{
			"subtotal_cents":        b.GetSubtotalCents(),
			"platform_fee_cents":    b.GetPlatformFeeCents(),
			"guarantee_fee_cents":   b.GetGuaranteeFeeCents(),
			"total_cents":           b.GetTotalCents(),
			"provider_payout_cents": b.GetProviderPayoutCents(),
			"fee_percentage":        b.GetFeePercentage(),
			"guarantee_percentage":  b.GetGuaranteePercentage(),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

type refundPaymentRequest struct {
	AmountCents int64  `json:"amount_cents"`
	Reason      string `json:"reason"`
}

// RefundPayment handles POST /api/v1/payments/{id}/refund.
func (h *PaymentHandler) RefundPayment(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	paymentID := chi.URLParam(r, "id")
	if paymentID == "" {
		writeError(w, http.StatusBadRequest, "payment id required")
		return
	}

	var req refundPaymentRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.paymentClient.CreateRefund(r.Context(), &paymentv1.CreateRefundRequest{
		PaymentId:   paymentID,
		AmountCents: req.AmountCents,
		Reason:      req.Reason,
		InitiatedBy: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoPaymentToJSON(resp.GetPayment()))
}

type releasePaymentRequest struct {
	Reason string `json:"reason"`
}

// ReleasePayment handles POST /api/v1/payments/{id}/release.
func (h *PaymentHandler) ReleasePayment(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	paymentID := chi.URLParam(r, "id")
	if paymentID == "" {
		writeError(w, http.StatusBadRequest, "payment id required")
		return
	}

	var req releasePaymentRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.paymentClient.ReleaseEscrow(r.Context(), &paymentv1.ReleaseEscrowRequest{
		PaymentId: paymentID,
		Reason:    req.Reason,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	// Notify the provider that escrow was released and their payout is on the
	// way. The Payment proto carries provider_id/customer_id directly, so no DB
	// lookup is needed. Recipient is always the provider (the payee); the actor
	// is whoever released (customer confirming completion, or an admin), so the
	// provider is never the actor. Fail-soft + nil-safe via emitNotification.
	pay := resp.GetPayment()
	dollars := fmt.Sprintf("$%.2f", float64(pay.GetProviderPayoutCents())/100)
	actionURL := "/payments/" + pay.GetId()
	if pay.GetContractId() != "" {
		actionURL = "/contracts/" + pay.GetContractId()
	}
	emitNotification(r.Context(), h.db,
		claims.UserID, pay.GetProviderId(),
		"payout_sent",
		"Payout released",
		fmt.Sprintf("Escrow was released — your payout of %s is on the way.", dollars),
		actionURL,
		"payment", pay.GetId(),
	)

	writeJSON(w, http.StatusOK, protoPaymentToJSON(pay))
}

type calculateFeesRequest struct {
	AmountCents int64  `json:"amount_cents"`
	CategoryID  string `json:"category_id"`
}

// CalculateFees handles POST /api/v1/payments/calculate-fees.
func (h *PaymentHandler) CalculateFees(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req calculateFeesRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.paymentClient.CalculateFees(r.Context(), &paymentv1.CalculateFeesRequest{
		AmountCents: req.AmountCents,
		CategoryId:  req.CategoryID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	b := resp.GetBreakdown()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"subtotal_cents":        b.GetSubtotalCents(),
		"platform_fee_cents":    b.GetPlatformFeeCents(),
		"guarantee_fee_cents":   b.GetGuaranteeFeeCents(),
		"total_cents":           b.GetTotalCents(),
		"provider_payout_cents": b.GetProviderPayoutCents(),
		"fee_percentage":        b.GetFeePercentage(),
		"guarantee_percentage":  b.GetGuaranteePercentage(),
	})
}

// instantPayoutRequest is the request body for POST /api/v1/payments/instant-payout.
type instantPayoutRequest struct {
	AmountCents int64 `json:"amount_cents"`
	// IdempotencyKey is an optional body-level fallback for clients that cannot
	// set the Idempotency-Key header. The header takes precedence.
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// InstantPayout handles POST /api/v1/payments/instant-payout.
// Initiates an instant Stripe payout for the authenticated provider.
//
// RISK MODEL (fail closed): NoMarkup fronts the money instantly, so it is only
// safe to pay out funds that are CAPTURED and past the escrow/dispute hold.
// Eligibility is therefore restricted to the provider's own COMPLETED payments
// (escrow released, dispute window elapsed) — never pending, in-escrow, or
// released-but-unconfirmed funds, which can still refund/chargeback and leave
// the platform holding the loss. The fee is configurable (see
// instant_payout_pricing.go) so it covers Stripe's instant-payout cost plus a
// margin, and per-transaction + per-day caps bound clawback exposure.
func (h *PaymentHandler) InstantPayout(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req instantPayoutRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.AmountCents <= 0 {
		writeError(w, http.StatusBadRequest, "amount_cents must be positive")
		return
	}

	// Idempotency key: prefer the Idempotency-Key header (the web client always
	// sends it; the payment route group also enforces it via
	// middleware.RequireIdempotencyKey), fall back to an optional body field.
	// The ledger UNIQUE(provider_id, idempotency_key) is the DURABLE dedup —
	// independent of the Redis response-cache middleware, which can be evicted.
	idemKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idemKey == "" {
		idemKey = strings.TrimSpace(req.IdempotencyKey)
	}

	// Idempotent replay: if this provider already has a payout under this key,
	// return the prior ledger result instead of paying again. Durable across
	// Redis flushes / restarts.
	if idemKey != "" && h.db != nil {
		if prior, found, err := h.lookupInstantPayoutByKey(r.Context(), claims.UserID, idemKey); err != nil {
			slog.Error("instant payout: idempotency lookup failed",
				"provider_id", claims.UserID, "error", err)
			writeError(w, http.StatusInternalServerError, "could not process instant payout")
			return
		} else if found {
			writeJSON(w, http.StatusOK, prior)
			return
		}
	}

	// Per-transaction cap. Larger sums route through the free standard payout.
	if maxTxn := instantPayoutMaxPerTxnCents(); req.AmountCents > maxTxn {
		writeError(w, http.StatusUnprocessableEntity,
			"amount exceeds the per-transaction instant payout limit")
		return
	}

	// Verified-provider / good-standing gate: Stripe must have payouts enabled
	// on the provider's Connect account (KYC complete, no payout hold). Fail
	// closed if we cannot confirm it.
	acct, err := h.paymentClient.GetStripeAccountStatus(r.Context(),
		&paymentv1.GetStripeAccountStatusRequest{UserId: claims.UserID})
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	if !acct.GetPayoutsEnabled() {
		writeError(w, http.StatusForbidden,
			"instant payout unavailable: complete payout verification first")
		return
	}

	// Eligible balance = sum of this provider's COMPLETED payouts only (see
	// grossEligiblePayoutCents). COMPLETED means escrow released and the dispute
	// window has elapsed, so the funds are safe to front.
	grossEligibleCents, err := h.grossEligiblePayoutCents(r.Context(), claims.UserID)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	// NET balance = gross cleared earnings − amount already instant-paid-out.
	// This pre-lock subtraction makes the early reject ACCURATE (so the provider
	// sees the right number before we take the lock); the authoritative,
	// concurrency-safe check is re-done inside insertInstantPayoutWithCap under
	// the per-provider advisory lock. Without subtracting priorPaidOut a provider
	// could withdraw the same cleared earnings repeatedly.
	priorPaidOut := int64(0)
	if h.db != nil {
		var perr error
		priorPaidOut, perr = h.sumAllInstantPayouts(r.Context(), h.db, claims.UserID)
		if perr != nil {
			slog.Error("instant payout: prior-payout sum failed",
				"provider_id", claims.UserID, "error", perr)
			writeError(w, http.StatusInternalServerError, "could not process instant payout")
			return
		}
	}
	availableCents := netInstantPayoutAvailableCents(grossEligibleCents, priorPaidOut)

	if req.AmountCents > availableCents {
		writeError(w, http.StatusUnprocessableEntity,
			"instant payout exceeds your available cleared balance")
		return
	}

	// Configurable platform fee (basis points + minimum), integer-cent math.
	feeCents := computeInstantPayoutFeeCents(
		req.AmountCents, instantPayoutFeeBps(), instantPayoutMinFeeCents())
	if feeCents >= req.AmountCents {
		// Fee would consume the whole payout (amount below the economic floor).
		writeError(w, http.StatusUnprocessableEntity,
			"amount too small for instant payout after fees")
		return
	}
	netCents := req.AmountCents - feeCents

	if h.db == nil {
		// No ledger backing configured — fail closed rather than report an
		// unrecorded success (the bug this change exists to kill).
		slog.Error("instant payout: no db pool configured; refusing to pay without a ledger",
			"provider_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "instant payout is temporarily unavailable")
		return
	}

	// Execute the payout against the payment provider (Stripe in prod, dev-mock
	// otherwise) and RECORD it in the ledger. The ledger write is the source of
	// truth: it backs idempotent replay and the daily cap.
	stripePayoutID := executeStripeInstantPayout(req.AmountCents, netCents)

	keyArg := idempotencyKeyArg(idemKey)

	// CONCURRENCY (TOCTOU): the daily-cap check and the ledger insert must be one
	// atomic, per-provider-serialized step. Previously the trailing-24h sum and
	// the insert were separate statements with no lock, so N concurrent
	// different-key payouts for the same provider each read the same pre-cap sum,
	// all passed, and all inserted — breaching the daily cap. We now run both
	// inside a single transaction guarded by a transaction-scoped advisory lock
	// keyed on the provider id (pg_advisory_xact_lock). The lock serializes only
	// same-provider payouts (different providers hash to different keys and never
	// contend); the cap is re-summed INSIDE the lock so each request sees every
	// previously-committed payout. The lock auto-releases at COMMIT/ROLLBACK.
	row, err := h.insertInstantPayoutWithCap(r.Context(), claims.UserID,
		req.AmountCents, feeCents, netCents, grossEligibleCents, "completed", stripePayoutID, keyArg)
	if err != nil {
		if errors.Is(err, errInstantPayoutInsufficientBalance) {
			writeError(w, http.StatusUnprocessableEntity,
				"instant payout exceeds your available cleared balance")
			return
		}
		if errors.Is(err, errInstantPayoutDailyCap) {
			writeError(w, http.StatusUnprocessableEntity,
				"amount exceeds the daily instant payout limit")
			return
		}
		// A UNIQUE(provider_id, idempotency_key) collision means a concurrent
		// request under the same key already wrote the row — replay it instead
		// of double-paying. (Note: the dev-mock executeStripeInstantPayout is a
		// no-op so there is no duplicate transfer to reverse here; the prod
		// Stripe path must use the same key as its Stripe idempotency key so the
		// transfer is likewise deduped — see executeStripeInstantPayout.)
		if isUniqueViolation(err) && idemKey != "" {
			if prior, found, lerr := h.lookupInstantPayoutByKey(r.Context(), claims.UserID, idemKey); lerr == nil && found {
				writeJSON(w, http.StatusOK, prior)
				return
			}
		}
		slog.Error("instant payout: ledger write failed",
			"provider_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "could not record instant payout")
		return
	}

	writeJSON(w, http.StatusOK, instantPayoutResponse(row))
}

// grossEligiblePayoutCents returns the sum of this provider's COMPLETED payouts
// (provider_payout_cents) — the gross cleared earnings safe to front. We filter
// by provider_id because a user can appear on a payment as either the customer
// or the provider. This is the GROSS basis; subtract prior instant payouts (see
// netInstantPayoutAvailableCents) for the actual withdrawable balance.
func (h *PaymentHandler) grossEligiblePayoutCents(ctx context.Context, providerID string) (int64, error) {
	const completed = paymentv1.PaymentStatus_PAYMENT_STATUS_COMPLETED
	statusFilter := completed
	listResp, err := h.paymentClient.ListPayments(ctx, &paymentv1.ListPaymentsRequest{
		UserId:       providerID,
		StatusFilter: &statusFilter,
		Pagination:   &commonv1.PaginationRequest{Page: 1, PageSize: 1000},
	})
	if err != nil {
		return 0, err
	}
	var gross int64
	for _, p := range listResp.GetPayments() {
		if p.GetProviderId() == providerID && p.GetStatus() == completed {
			gross += p.GetProviderPayoutCents()
		}
	}
	return gross, nil
}

// GetInstantPayoutSummary handles GET /api/v1/payments/instant-payout/summary.
// It returns the provider's NET withdrawable balance so the UI shows what is
// actually withdrawable, not the gross earnings. Server-computed (CLAUDE.md §6:
// all price calculations server-side; client displays only) from the SAME
// formula the mutation enforces: available = gross cleared earnings − prior
// non-failed instant payouts.
func (h *PaymentHandler) GetInstantPayoutSummary(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	grossEligibleCents, err := h.grossEligiblePayoutCents(r.Context(), claims.UserID)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	priorPaidOut := int64(0)
	if h.db != nil {
		var perr error
		priorPaidOut, perr = h.sumAllInstantPayouts(r.Context(), h.db, claims.UserID)
		if perr != nil {
			slog.Error("instant payout summary: prior-payout sum failed",
				"provider_id", claims.UserID, "error", perr)
			writeError(w, http.StatusInternalServerError, "could not load payout balance")
			return
		}
	}

	available := netInstantPayoutAvailableCents(grossEligibleCents, priorPaidOut)
	if available < 0 {
		available = 0 // never advertise a negative withdrawable balance
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"available_cents":      available,
		"gross_eligible_cents": grossEligibleCents,
		"paid_out_cents":       priorPaidOut,
	})
}

// instantPayoutRow is a hydrated ledger row used to build the HTTP response.
type instantPayoutRow struct {
	ID          string
	AmountCents int64
	FeeCents    int64
	NetCents    int64
	Status      string
}

// instantPayoutResponse builds the backward-compatible JSON body. The web
// InstantPayoutButton/useInstantPayout reads payout_id, amount_cents and
// estimated_arrival; fee_cents/net_cents/status are additive.
func instantPayoutResponse(row instantPayoutRow) map[string]interface{} {
	return map[string]interface{}{
		"payout_id":         row.ID, // real ledger UUID (was the fake "payout-<userID>")
		"amount_cents":      row.AmountCents,
		"fee_cents":         row.FeeCents,
		"net_cents":         row.NetCents,
		"status":            row.Status,
		"estimated_arrival": "Within minutes",
	}
}

// idempotencyKeyArg converts an empty key to a NULL DB argument so the partial
// UNIQUE index (WHERE idempotency_key IS NOT NULL) is not engaged for keyless
// legacy calls.
func idempotencyKeyArg(key string) *string {
	if key == "" {
		return nil
	}
	return &key
}

// executeStripeInstantPayout performs the actual money movement and returns the
// provider-side payout id stored in the ledger as stripe_payout_id.
//
// PROD PATH (TODO — the one guarded call that remains): when a real Stripe key
// is configured, call the Stripe Payout API (stripe.Payout / Transfer to the
// provider's Connect account) using the request's Idempotency-Key as Stripe's
// idempotency key, and return payout.ID. The gateway does not currently hold a
// Stripe client (the payment service owns Stripe); wiring this is the remaining
// production step. Until then we never have a real Stripe key in dev
// (STRIPE_SECRET_KEY is the sk_test_ placeholder), so we return a dev-mock id
// "payout_dev_<short-uuid>" — mirroring the advances' "tr_platform_dev_<uuid>".
func executeStripeInstantPayout(_ /* amountCents */, _ /* netCents */ int64) string {
	if hasRealStripeKey() {
		// PROD: stripePayout, _ := stripeClient.Payouts.New(...); return stripePayout.ID
		// Not wired in the gateway yet — see doc comment above. Fall through to
		// the dev-mock so dev/sandbox stacks keep working until then.
		slog.Warn("instant payout: real Stripe key present but gateway Stripe payout is not wired; using dev-mock id")
	}
	return "payout_dev_" + strings.SplitN(uuid.NewString(), "-", 2)[0]
}

// hasRealStripeKey reports whether a non-placeholder Stripe secret is set. Dev
// uses the sk_test_ placeholder, so live payouts stay disabled there.
func hasRealStripeKey() bool {
	k := strings.TrimSpace(getStripeSecretKey())
	return strings.HasPrefix(k, "sk_live_")
}

// getStripeSecretKey reads the Stripe secret from the environment the same way
// the rest of the stack does. Kept tiny so the prod-Stripe wiring has one place
// to read the key.
func getStripeSecretKey() string {
	if v := os.Getenv("STRIPE_SECRET_KEY"); v != "" {
		return v
	}
	return os.Getenv("STRIPE_SECRET")
}

// --- instant_payouts ledger access (gateway dbPool, parameterized SQL) ---

// lookupInstantPayoutByKey returns the prior ledger result for (provider, key)
// if one exists, for idempotent replay.
func (h *PaymentHandler) lookupInstantPayoutByKey(
	ctx context.Context, providerID, key string,
) (map[string]interface{}, bool, error) {
	var row instantPayoutRow
	err := h.db.QueryRow(ctx, `
		SELECT id::text, amount_cents, fee_cents, net_cents, status
		  FROM instant_payouts
		 WHERE provider_id = $1 AND idempotency_key = $2
		 LIMIT 1
	`, providerID, key).Scan(&row.ID, &row.AmountCents, &row.FeeCents, &row.NetCents, &row.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return instantPayoutResponse(row), true, nil
}

// pgxQuerier is the subset of pgxpool.Pool / pgx.Tx the ledger helpers need, so
// the same SQL runs against either the pool or an open transaction.
type pgxQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// sumInstantPayoutsLast24h returns the total amount_cents this provider has
// instant-paid in the trailing 24h — the real basis for the daily cap. It takes
// an explicit querier so it can be summed inside the cap transaction (under the
// per-provider advisory lock), seeing all committed payouts.
func (h *PaymentHandler) sumInstantPayoutsLast24h(ctx context.Context, q pgxQuerier, providerID string) (int64, error) {
	var total int64
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_cents), 0)
		  FROM instant_payouts
		 WHERE provider_id = $1
		   AND status <> 'failed'
		   AND created_at >= now() - interval '24 hours'
	`, providerID).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total, nil
}

// sumAllInstantPayouts returns this provider's ALL-TIME instant-payout total
// (amount_cents) across every non-failed payout — the cumulative amount already
// disbursed against their cleared earnings. This is the value subtracted from
// gross-eligible cleared earnings to get the NET withdrawable balance: a
// provider may only ever instant-pay-out the sum of their COMPLETED payouts
// MINUS what they have already taken out, otherwise they could withdraw the
// same cleared earnings repeatedly. We exclude only 'failed' rows (consistent
// with sumInstantPayoutsLast24h) because 'pending' and 'completed' payouts both
// disbursed (or are mid-disbursement) and must count against the balance;
// 'failed' never moved money. Takes an explicit querier so the authoritative
// check can run inside the cap transaction under the per-provider advisory lock.
func (h *PaymentHandler) sumAllInstantPayouts(ctx context.Context, q pgxQuerier, providerID string) (int64, error) {
	var total int64
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_cents), 0)
		  FROM instant_payouts
		 WHERE provider_id = $1
		   AND status <> 'failed'
	`, providerID).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total, nil
}

// insertInstantPayout writes the ledger row and returns the hydrated result.
// It takes an explicit querier so the write can join the cap transaction.
func (h *PaymentHandler) insertInstantPayout(
	ctx context.Context,
	q pgxQuerier,
	providerID string,
	amountCents, feeCents, netCents int64,
	status, stripePayoutID string,
	idemKey *string,
) (instantPayoutRow, error) {
	var row instantPayoutRow
	err := q.QueryRow(ctx, `
		INSERT INTO instant_payouts
			(provider_id, amount_cents, fee_cents, net_cents, status, stripe_payout_id, idempotency_key)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id::text, amount_cents, fee_cents, net_cents, status
	`, providerID, amountCents, feeCents, netCents, status, stripePayoutID, idemKey).
		Scan(&row.ID, &row.AmountCents, &row.FeeCents, &row.NetCents, &row.Status)
	if err != nil {
		return instantPayoutRow{}, err
	}
	return row, nil
}

// errInstantPayoutDailyCap signals that the request would breach the provider's
// rolling 24h instant-payout cap. Mapped to 422 by the handler.
var errInstantPayoutDailyCap = errors.New("instant payout daily cap exceeded")

// errInstantPayoutInsufficientBalance signals that the request would exceed the
// provider's NET cleared balance, i.e. gross-eligible cleared earnings (sum of
// COMPLETED provider payouts) MINUS the amount already instant-paid-out. Without
// this check a provider could withdraw the same cleared earnings repeatedly (up
// to the daily cap), being paid far more than they earned. Mapped to 422.
var errInstantPayoutInsufficientBalance = errors.New("instant payout exceeds available cleared balance")

// netInstantPayoutAvailableCents is the single source of truth for a provider's
// withdrawable balance: gross cleared earnings (sum of COMPLETED provider
// payouts) MINUS everything already instant-paid-out (non-failed). Money-critical
// and unit-tested — the whole bug class is "forgetting the subtraction", so this
// keeps the formula in one place used by both the pre-lock and in-tx checks.
func netInstantPayoutAvailableCents(grossEligibleCents, priorPaidOutCents int64) int64 {
	return grossEligibleCents - priorPaidOutCents
}

// insertInstantPayoutWithCap atomically enforces the rolling daily cap and
// writes the ledger row for one provider.
//
// CONCURRENCY: it opens a transaction, takes a transaction-scoped advisory lock
// keyed on the provider id (pg_advisory_xact_lock(hashtext($providerID))), then
// re-sums the trailing-24h total and inserts — all under that lock. Same-provider
// payouts serialize on the lock, so each request's cap sum reflects every payout
// committed before it; different providers hash to different keys and never
// contend. The lock releases automatically at COMMIT/ROLLBACK.
//
// If the request would push the trailing total over the cap, the tx is rolled
// back and errInstantPayoutDailyCap is returned (no row written, no money moved
// in the ledger). A UNIQUE(provider_id, idempotency_key) collision surfaces as
// the underlying pgx error so the caller can replay the prior result.
//
// BALANCE (money-critical): grossEligibleCents is the provider's cleared
// earnings (sum of COMPLETED provider payouts), computed by the caller. Inside
// the lock we sum every prior non-failed instant payout and reject if
// grossEligible − priorPaidOut < amount. Because this runs under the same
// per-provider advisory lock as the cap check, two concurrent payouts for one
// provider cannot jointly exceed the net balance: the second to acquire the
// lock sees the first's committed row in priorPaidOut.
func (h *PaymentHandler) insertInstantPayoutWithCap(
	ctx context.Context,
	providerID string,
	amountCents, feeCents, netCents, grossEligibleCents int64,
	status, stripePayoutID string,
	idemKey *string,
) (instantPayoutRow, error) {
	tx, err := h.db.Begin(ctx)
	if err != nil {
		return instantPayoutRow{}, err
	}
	// Rollback is a no-op after a successful Commit, so this is safe to defer
	// unconditionally and guarantees release on every error path.
	defer func() { _ = tx.Rollback(ctx) }()

	// Per-provider serialization: concurrent payouts for the SAME provider block
	// here until the holder commits/rolls back; other providers proceed freely.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, providerID); err != nil {
		return instantPayoutRow{}, err
	}

	// AUTHORITATIVE net-balance check. Sum every prior non-failed instant payout
	// INSIDE the lock, then reject if this payout would exceed the provider's net
	// withdrawable balance (gross cleared earnings − already-paid-out). This is
	// the check that actually prevents repeated withdrawal of the same earnings;
	// the pre-lock check in the handler is only a friendly early reject.
	priorPaidOut, err := h.sumAllInstantPayouts(ctx, tx, providerID)
	if err != nil {
		return instantPayoutRow{}, err
	}
	if netInstantPayoutAvailableCents(grossEligibleCents, priorPaidOut) < amountCents {
		return instantPayoutRow{}, errInstantPayoutInsufficientBalance
	}

	// Re-sum INSIDE the lock so we count every payout committed before us, then
	// re-check the cap. This is the authoritative check; any pre-lock read is
	// only advisory.
	todayCents, err := h.sumInstantPayoutsLast24h(ctx, tx, providerID)
	if err != nil {
		return instantPayoutRow{}, err
	}
	if maxDay := instantPayoutMaxPerDayCents(); todayCents+amountCents > maxDay {
		return instantPayoutRow{}, errInstantPayoutDailyCap
	}

	row, err := h.insertInstantPayout(ctx, tx, providerID,
		amountCents, feeCents, netCents, status, stripePayoutID, idemKey)
	if err != nil {
		return instantPayoutRow{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return instantPayoutRow{}, err
	}
	return row, nil
}

// --- Proto to JSON helpers ---

func protoPaymentToJSON(p *paymentv1.Payment) map[string]interface{} {
	if p == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":                    p.GetId(),
		"contract_id":          p.GetContractId(),
		"customer_id":          p.GetCustomerId(),
		"provider_id":          p.GetProviderId(),
		"amount_cents":         p.GetAmountCents(),
		"platform_fee_cents":   p.GetPlatformFeeCents(),
		"guarantee_fee_cents":  p.GetGuaranteeFeeCents(),
		"provider_payout_cents": p.GetProviderPayoutCents(),
		"status":               paymentStatusToString(p.GetStatus()),
		"failure_reason":       p.GetFailureReason(),
		"refund_amount_cents":  p.GetRefundAmountCents(),
		"refund_reason":        p.GetRefundReason(),
		"installment_number":   p.GetInstallmentNumber(),
		"total_installments":   p.GetTotalInstallments(),
		"retry_count":          p.GetRetryCount(),
		"created_at":           formatTimestamp(p.GetCreatedAt()),
	}

	if p.GetMilestoneId() != "" {
		result["milestone_id"] = p.GetMilestoneId()
	}
	if p.GetRecurringInstanceId() != "" {
		result["recurring_instance_id"] = p.GetRecurringInstanceId()
	}
	if p.GetEscrowAt() != nil {
		result["escrow_at"] = formatTimestamp(p.GetEscrowAt())
	}
	if p.GetReleasedAt() != nil {
		result["released_at"] = formatTimestamp(p.GetReleasedAt())
	}
	if p.GetCompletedAt() != nil {
		result["completed_at"] = formatTimestamp(p.GetCompletedAt())
	}

	return result
}

func paymentStatusToString(s paymentv1.PaymentStatus) string {
	switch s {
	case paymentv1.PaymentStatus_PAYMENT_STATUS_PENDING:
		return "pending"
	case paymentv1.PaymentStatus_PAYMENT_STATUS_PROCESSING:
		return "processing"
	case paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW:
		return "escrow"
	case paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED:
		return "released"
	case paymentv1.PaymentStatus_PAYMENT_STATUS_COMPLETED:
		return "completed"
	case paymentv1.PaymentStatus_PAYMENT_STATUS_FAILED:
		return "failed"
	case paymentv1.PaymentStatus_PAYMENT_STATUS_REFUNDED:
		return "refunded"
	case paymentv1.PaymentStatus_PAYMENT_STATUS_PARTIALLY_REFUNDED:
		return "partially_refunded"
	case paymentv1.PaymentStatus_PAYMENT_STATUS_DISPUTED:
		return "disputed"
	case paymentv1.PaymentStatus_PAYMENT_STATUS_CHARGEBACK:
		return "chargeback"
	default:
		return "unspecified"
	}
}

func stringToPaymentStatus(s string) paymentv1.PaymentStatus {
	switch s {
	case "pending":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_PENDING
	case "processing":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_PROCESSING
	case "escrow":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW
	case "released":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED
	case "completed":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_COMPLETED
	case "failed":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_FAILED
	case "refunded":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_REFUNDED
	case "partially_refunded":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_PARTIALLY_REFUNDED
	case "disputed":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_DISPUTED
	case "chargeback":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_CHARGEBACK
	default:
		return paymentv1.PaymentStatus_PAYMENT_STATUS_UNSPECIFIED
	}
}
