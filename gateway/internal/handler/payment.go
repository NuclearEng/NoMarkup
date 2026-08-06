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
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

// PaymentHandler handles HTTP endpoints for payments.
type PaymentHandler struct {
	paymentClient paymentv1.PaymentServiceClient
	// contractClient resumes paused recurring configs after a successful visit
	// payment (FR-18.8). Optional: nil → process/capture still succeeds; resume
	// is best-effort only and must never fail the money path.
	contractClient contractv1.ContractServiceClient
	// db backs the instant-payout SUMMARY path (sum of prior instant_payouts)
	// and FR-16.7 recurring payment-retry reset after visit capture. Mutation
	// InstantPayout is owned by the payment service gRPC. May be nil in unit
	// tests that don't exercise those paths.
	db *pgxpool.Pool
	// resetPaymentRetryFn overrides SQL reset for unit tests (nil in production).
	resetPaymentRetryFn func(ctx context.Context, recurringID string) error
}

// NewPaymentHandler creates a new PaymentHandler. db is the gateway's shared
// pgx pool (instant-payout summary + FR-16.7 retry reset).
func NewPaymentHandler(paymentClient paymentv1.PaymentServiceClient, db *pgxpool.Pool) *PaymentHandler {
	return &PaymentHandler{paymentClient: paymentClient, db: db}
}

// SetContractClient wires FR-18.8 resume-after-visit-payment on ProcessPayment.
// Safe to leave unset in tests that never hit the recurring path.
func (h *PaymentHandler) SetContractClient(c contractv1.ContractServiceClient) {
	h.contractClient = c
}

// contractNumbersByID reads the human-readable contract_number for the given
// contract ids in a single parameterized query. The payment proto carries only
// the contract UUID, so the gateway projects the friendly NM-… number in for the
// payment-history rows — without it the row falls back to a truncated UUID
// ("Contract: 00000000…"). A nil db or query error returns an empty map
// (fail-soft: the number simply isn't enriched and the UI keeps its fallback).
// Mirrors WorkingCapitalHandler.contractNumbersByID for the advances list.
func (h *PaymentHandler) contractNumbersByID(ctx context.Context, ids []string) map[string]string {
	out := make(map[string]string, len(ids))
	if h.db == nil || len(ids) == 0 {
		return out
	}
	rows, err := h.db.Query(ctx,
		`SELECT id::text, contract_number FROM contracts WHERE id = ANY($1)`, ids)
	if err != nil {
		slog.ErrorContext(ctx, "payment contract_number enrichment query failed", "error", err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, number string
		if err := rows.Scan(&id, &number); err != nil {
			slog.ErrorContext(ctx, "payment contract_number enrichment scan failed", "error", err)
			return out
		}
		if number != "" {
			out[id] = number
		}
	}
	return out
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
		"charges_enabled":         resp.GetChargesEnabled(),
		"payouts_enabled":         resp.GetPayoutsEnabled(),
		"details_submitted":       resp.GetDetailsSubmitted(),
		"requirements":            resp.GetRequirements(),
		"transfers_ready":         resp.GetTransfersReady(),
		"stripe_transfers_status": resp.GetStripeTransfersStatus(),
		"dashboard":               resp.GetDashboard(),
		"accounts_api":            resp.GetAccountsApi(),
	})
}

// CreateStripeAccountSession handles POST /api/v1/providers/me/stripe/account-session.
// Returns a single-use client_secret for Connect embedded components.
func (h *PaymentHandler) CreateStripeAccountSession(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.paymentClient.CreateStripeAccountSession(r.Context(), &paymentv1.CreateStripeAccountSessionRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	out := map[string]interface{}{
		"client_secret": resp.GetClientSecret(),
	}
	if resp.GetExpiresAt() != nil {
		out["expires_at"] = resp.GetExpiresAt().AsTime().UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, out)
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
//
// On successful capture (status escrow), when the payment is for a recurring
// visit (recurring_instance_id set), FR-18.8 best-effort resumes a paused
// recurring config so visits generate again after the customer pays. Resume
// failures never fail the payment response (fail-soft residual fields only).
// FR-16.7: next_retry_at is stored on setup failure (migration 113); gateway
// ProcessDueRecurringPaymentRetries re-runs CreatePayment with attempt-N when
// due. CreatePayment failure counting (pause at 3) is wired on approve/
// auto-approve and scheduled retry; this path only resets the counter after capture.
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

	payment := resp.GetPayment()
	result := protoPaymentToJSON(payment)
	// FR-18.8: money path already succeeded — resume must not undo or fail it.
	h.resumeRecurringAfterPaymentSuccess(r.Context(), result, payment)
	writeJSON(w, http.StatusOK, result)
}

// resumeRecurringAfterPaymentSuccess implements FR-18.8 resume half: when a
// visit payment captures successfully, resume the contract's recurring config
// if it is paused (typically after CreatePayment failures reached the FR-16.7
// partial threshold of 3). Always resume when status=paused — there is no
// pause_reason column. Also clears payment_retry_count (migration 112) so the
// next failure series starts clean. Fail-soft: lookup/resume/reset errors only
// add residual fields; payment JSON already stands. No-ops for non-recurring
// payments and when the config is not paused (reset still attempted when we
// have a recurring_id).
func (h *PaymentHandler) resumeRecurringAfterPaymentSuccess(
	ctx context.Context,
	result map[string]interface{},
	payment *paymentv1.Payment,
) {
	if payment == nil {
		return
	}
	instanceID := payment.GetRecurringInstanceId()
	if instanceID == "" {
		// Milestone / one-shot escrow — not a visit payment.
		return
	}
	// ProcessPayment returns escrow on capture success. Defensive: only resume
	// on funded statuses (never invent success from pending/failed).
	switch payment.GetStatus() {
	case paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW,
		paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED,
		paymentv1.PaymentStatus_PAYMENT_STATUS_COMPLETED:
		// ok
	default:
		slog.InfoContext(ctx, "FR-18.8: skip resume — visit payment not in funded status",
			"payment_id", payment.GetId(),
			"instance_id", instanceID,
			"status", paymentStatusToString(payment.GetStatus()),
		)
		return
	}

	contractID := payment.GetContractId()
	customerID := payment.GetCustomerId()
	if contractID == "" {
		result["recurring_resume_residual"] = "contract_unresolved"
		slog.WarnContext(ctx, "FR-18.8: cannot resume recurring after payment success (no contract id)",
			"payment_id", payment.GetId(),
			"instance_id", instanceID,
		)
		return
	}

	if h.contractClient == nil {
		result["recurring_resume_residual"] = "contract_service_unwired"
		slog.WarnContext(ctx, "FR-18.8: contract client unwired; cannot resume after visit payment (payment kept)",
			"payment_id", payment.GetId(),
			"instance_id", instanceID,
			"contract_id", contractID,
		)
		return
	}
	if customerID == "" {
		result["recurring_resume_residual"] = "customer_unresolved"
		slog.WarnContext(ctx, "FR-18.8: cannot resume recurring after payment success (no customer id; payment kept)",
			"payment_id", payment.GetId(),
			"instance_id", instanceID,
			"contract_id", contractID,
		)
		return
	}

	cfgResp, err := h.contractClient.GetRecurringConfig(ctx, &contractv1.GetRecurringConfigRequest{
		ContractId:       contractID,
		RequestingUserId: customerID,
	})
	if err != nil {
		slog.WarnContext(ctx, "FR-18.8: GetRecurringConfig failed after payment success (payment kept)",
			"payment_id", payment.GetId(),
			"instance_id", instanceID,
			"contract_id", contractID,
			"error", err,
		)
		result["recurring_resume_residual"] = "config_lookup_failed"
		return
	}
	cfg := cfgResp.GetConfig()
	if cfg == nil || cfg.GetId() == "" {
		slog.WarnContext(ctx, "FR-18.8: no recurring config to resume after payment success (payment kept)",
			"payment_id", payment.GetId(),
			"instance_id", instanceID,
			"contract_id", contractID,
		)
		result["recurring_resume_residual"] = "config_missing"
		return
	}

	result["recurring_id"] = cfg.GetId()
	// FR-16.7 partial: clear strike count whenever visit money succeeds.
	h.resetPaymentRetryAfterVisitPay(ctx, result, cfg.GetId(), payment.GetId(), instanceID)

	status := cfg.GetStatus()
	if status == "active" {
		// Already generating visits — surface status; no Resume RPC.
		result["recurring_status"] = "active"
		result["recurring_resumed"] = false
		slog.InfoContext(ctx, "FR-18.8: recurring already active after visit payment (no-op)",
			"payment_id", payment.GetId(),
			"instance_id", instanceID,
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
		)
		return
	}
	if status != "paused" {
		// cancelled / other — do not force-resume; leave alone.
		result["recurring_status"] = status
		result["recurring_resume_residual"] = "not_paused"
		slog.InfoContext(ctx, "FR-18.8: skip resume after payment success — config not paused (payment kept)",
			"payment_id", payment.GetId(),
			"instance_id", instanceID,
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
			"status", status,
		)
		return
	}

	resumeResp, resumeErr := h.contractClient.ResumeRecurring(ctx, &contractv1.ResumeRecurringRequest{
		RecurringId: cfg.GetId(),
		UserId:      customerID,
	})
	if resumeErr != nil {
		slog.WarnContext(ctx, "FR-18.8: ResumeRecurring failed after payment success (payment kept)",
			"payment_id", payment.GetId(),
			"instance_id", instanceID,
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
			"error", resumeErr,
		)
		result["recurring_resume_residual"] = "resume_failed"
		result["recurring_status"] = "paused"
		return
	}

	resumedCfg := resumeResp.GetConfig()
	result["recurring_resumed"] = true
	result["recurring_status"] = "active"
	if resumedCfg != nil {
		result["recurring_config"] = protoRecurringConfigToJSON(resumedCfg)
		if st := resumedCfg.GetStatus(); st != "" {
			result["recurring_status"] = st
		}
	}
	slog.InfoContext(ctx, "FR-18.8: recurring resumed after successful visit payment",
		"payment_id", payment.GetId(),
		"instance_id", instanceID,
		"contract_id", contractID,
		"recurring_id", cfg.GetId(),
		"customer_id", customerID,
	)
}

// resetPaymentRetryAfterVisitPay clears FR-16.7 partial payment_retry_count
// and next_retry_at. Fail-soft residual only — never fails ProcessPayment.
func (h *PaymentHandler) resetPaymentRetryAfterVisitPay(
	ctx context.Context,
	result map[string]interface{},
	recurringID, paymentID, instanceID string,
) {
	if recurringID == "" {
		return
	}
	var err error
	if h.resetPaymentRetryFn != nil {
		err = h.resetPaymentRetryFn(ctx, recurringID)
	} else {
		err = resetRecurringPaymentRetryCount(ctx, h.db, recurringID)
	}
	if err != nil {
		// db unwired in unit tests is expected — only residual when production
		// SQL fails (or explicit test hook errors).
		if errors.Is(err, errPaymentRetryDBUnwired) {
			return
		}
		slog.WarnContext(ctx, "FR-16.7: payment_retry_count reset failed after visit pay (payment kept)",
			"payment_id", paymentID,
			"instance_id", instanceID,
			"recurring_id", recurringID,
			"error", err,
		)
		result["payment_retry_reset_residual"] = "reset_failed"
		return
	}
	result["payment_retry_count"] = 0
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

	// Resolve every payment's contract_number in one batch query so the history
	// rows show the friendly NM-… reference instead of a raw contract UUID. Dedup
	// is handled by the WHERE id = ANY query; fail-soft (missing → UUID fallback).
	contractIDs := make([]string, 0, len(resp.GetPayments()))
	for _, p := range resp.GetPayments() {
		if cid := p.GetContractId(); cid != "" {
			contractIDs = append(contractIDs, cid)
		}
	}
	contractNumbers := h.contractNumbersByID(r.Context(), contractIDs)

	payments := make([]map[string]interface{}, 0, len(resp.GetPayments()))
	for _, p := range resp.GetPayments() {
		jc := protoPaymentToJSON(p)
		if n := contractNumbers[p.GetContractId()]; n != "" {
			jc["contract_number"] = n
		}
		payments = append(payments, jc)
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

	// The party check on this route admits BOTH the customer and the provider,
	// so the actor and their role travel to the payment service, which decides
	// what this particular party may do. Refunding an already-paid-out payment
	// draws on the platform balance, so the service restricts it to admins.
	resp, err := h.paymentClient.CreateRefund(r.Context(), &paymentv1.CreateRefundRequest{
		PaymentId:    paymentID,
		AmountCents:  req.AmountCents,
		Reason:       req.Reason,
		InitiatedBy:  claims.UserID,
		ActorIsAdmin: hasRole(claims, "admin"),
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

	// Same reasoning as RefundPayment: the route's party check cannot tell the
	// payer from the payee, and releasing escrow pays the provider. The service
	// refuses a provider releasing their own escrow.
	resp, err := h.paymentClient.ReleaseEscrow(r.Context(), &paymentv1.ReleaseEscrowRequest{
		PaymentId:    paymentID,
		Reason:       req.Reason,
		ActorUserId:  claims.UserID,
		ActorIsAdmin: hasRole(claims, "admin"),
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
// Eligibility is restricted to RELEASED + COMPLETED payments (payment service
// claim path). Fee, per-txn, and daily caps live in the payment service.
//
// Money-safety (MON-09/10/11) is owned by PaymentService.InstantPayout:
//  1. Idempotent replay of completed ledger rows.
//  2. CLAIM ledger first under per-provider advisory lock.
//  3. Stripe Connect Instant Payout (or payout_dev_* only in payment-service
//     devMode — never with live keys).
// Gateway is a thin auth + verified-provider gate + gRPC proxy.
func (h *PaymentHandler) InstantPayout(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	if h.paymentClient == nil {
		slog.Error("instant payout: payment client not configured",
			"provider_id", claims.UserID)
		writeError(w, http.StatusServiceUnavailable, "instant payout is temporarily unavailable")
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
	// Durable dedup is UNIQUE(provider_id, idempotency_key) in the payment
	// service ledger — independent of Redis response-cache middleware.
	idemKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idemKey == "" {
		idemKey = strings.TrimSpace(req.IdempotencyKey)
	}

	// Cheap early reject for oversize amounts (also enforced in payment service).
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

	// Payment service owns claim-first ledger + Stripe Instant Payout.
	// Live keys create a real Connect payout or fail closed; never fabricate
	// payout_dev_* success ids outside payment-service devMode.
	resp, err := h.paymentClient.InstantPayout(r.Context(), &paymentv1.InstantPayoutRequest{
		ProviderId:     claims.UserID,
		AmountCents:    req.AmountCents,
		IdempotencyKey: idemKey,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"payout_id":         resp.GetPayoutId(),
		"amount_cents":      resp.GetAmountCents(),
		"fee_cents":         resp.GetFeeCents(),
		"net_cents":         resp.GetNetCents(),
		"status":            resp.GetStatus(),
		"estimated_arrival": "Within minutes",
		"replayed":          resp.GetReplayed(),
	})
}

// grossEligiblePayoutCents returns the sum of this provider's RELEASED and
// COMPLETED payouts (provider_payout_cents) — the gross cleared earnings safe
// to front (MON-09). RELEASED means escrow has been released to the provider;
// COMPLETED means the dispute window has also elapsed. Pending / in-escrow
// funds are excluded. We filter by provider_id because a user can appear on a
// payment as either the customer or the provider. This is the GROSS basis;
// subtract prior instant payouts (see netInstantPayoutAvailableCents) for the
// actual withdrawable balance.
func (h *PaymentHandler) grossEligiblePayoutCents(ctx context.Context, providerID string) (int64, error) {
	// ListPayments accepts a single status filter; fetch without a filter and
	// keep RELEASED + COMPLETED client-side so eligibility includes both.
	listResp, err := h.paymentClient.ListPayments(ctx, &paymentv1.ListPaymentsRequest{
		UserId:     providerID,
		Pagination: &commonv1.PaginationRequest{Page: 1, PageSize: 1000},
	})
	if err != nil {
		return 0, err
	}
	const (
		completed = paymentv1.PaymentStatus_PAYMENT_STATUS_COMPLETED
		released  = paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED
	)
	var gross int64
	for _, p := range listResp.GetPayments() {
		if p.GetProviderId() != providerID {
			continue
		}
		st := p.GetStatus()
		if st == completed || st == released {
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

// executeStripeInstantPayout is a historical fail-closed guard retained for
// unit tests. Production InstantPayout goes through paymentClient.InstantPayout
// (payment service owns Stripe + ledger). A live key here still refuses a
// fabricated payout_dev_* id.
//
// Returns ("", errInstantPayoutNotConfigured) when a real Stripe key is set.
func executeStripeInstantPayout(_ /* amountCents */, _ /* netCents */ int64) (string, error) {
	if hasRealStripeKey() {
		return "", errInstantPayoutNotConfigured
	}
	return "payout_dev_" + strings.SplitN(uuid.NewString(), "-", 2)[0], nil
}

// errInstantPayoutNotConfigured is returned when a live Stripe key is present
// but the gateway cannot execute a real payout. Mapped to HTTP 503.
var errInstantPayoutNotConfigured = errors.New("instant payout is not configured")

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
// earnings (sum of RELEASED + COMPLETED provider payouts), computed by the
// caller. Inside the lock we sum every prior non-failed instant payout and
// reject if grossEligible − priorPaidOut < amount. Because this runs under the
// same per-provider advisory lock as the cap check, two concurrent payouts for
// one provider cannot jointly exceed the net balance: the second to acquire the
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
