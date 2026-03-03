package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// PaymentHandler handles HTTP endpoints for payments.
type PaymentHandler struct {
	paymentClient paymentv1.PaymentServiceClient
}

// NewPaymentHandler creates a new PaymentHandler.
func NewPaymentHandler(paymentClient paymentv1.PaymentServiceClient) *PaymentHandler {
	return &PaymentHandler{paymentClient: paymentClient}
}

// CreateStripeAccount handles POST /api/v1/providers/me/stripe/account.
func (h *PaymentHandler) CreateStripeAccount(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req struct {
		Email        string `json:"email"`
		BusinessName string `json:"business_name"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
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
			"total_count": pg.GetTotalCount(),
			"page":        pg.GetPage(),
			"page_size":   pg.GetPageSize(),
			"total_pages": pg.GetTotalPages(),
			"has_next":    pg.GetHasNext(),
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
