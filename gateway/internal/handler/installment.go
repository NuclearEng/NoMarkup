package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// InstallmentHandler handles HTTP endpoints for BNPL installment plans.
type InstallmentHandler struct {
	installmentClient paymentv1.InstallmentPlanServiceClient
}

// NewInstallmentHandler creates a new InstallmentHandler.
func NewInstallmentHandler(installmentClient paymentv1.InstallmentPlanServiceClient) *InstallmentHandler {
	return &InstallmentHandler{installmentClient: installmentClient}
}

type createInstallmentPlanRequest struct {
	ContractID       string `json:"contract_id"`
	ProviderID       string `json:"provider_id"`
	TotalAmountCents int64  `json:"total_amount_cents"`
	InstallmentCount int32  `json:"installment_count"`
	PaymentMethodID  string `json:"payment_method_id"`
	IdempotencyKey   string `json:"idempotency_key"`
}

// CreateInstallmentPlan handles POST /api/v1/payments/installment-plans.
func (h *InstallmentHandler) CreateInstallmentPlan(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req createInstallmentPlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.ContractID == "" {
		writeError(w, http.StatusBadRequest, "contract_id is required")
		return
	}
	if req.ProviderID == "" {
		writeError(w, http.StatusBadRequest, "provider_id is required")
		return
	}
	if req.TotalAmountCents <= 0 {
		writeError(w, http.StatusBadRequest, "total_amount_cents must be positive")
		return
	}
	if req.InstallmentCount != 3 && req.InstallmentCount != 6 {
		writeError(w, http.StatusBadRequest, "installment_count must be 3 or 6")
		return
	}
	if req.IdempotencyKey == "" {
		writeError(w, http.StatusBadRequest, "idempotency_key is required")
		return
	}

	grpcReq := &paymentv1.CreateInstallmentPlanRequest{
		ContractId:       req.ContractID,
		CustomerId:       claims.UserID,
		ProviderId:       req.ProviderID,
		TotalAmountCents: req.TotalAmountCents,
		InstallmentCount: req.InstallmentCount,
		PaymentMethodId:  req.PaymentMethodID,
		IdempotencyKey:   req.IdempotencyKey,
	}

	resp, err := h.installmentClient.CreateInstallmentPlan(r.Context(), grpcReq)
	if err != nil {
		slog.Error("create installment plan gRPC call failed", "error", err, "customer_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	result := protoInstallmentPlanToJSON(resp.GetPlan())
	result["first_installment_client_secret"] = resp.GetFirstInstallmentClientSecret()

	writeJSON(w, http.StatusCreated, result)
}

// GetInstallmentPlan handles GET /api/v1/payments/installment-plans/{id}.
func (h *InstallmentHandler) GetInstallmentPlan(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	planID := chi.URLParam(r, "id")
	if planID == "" {
		writeError(w, http.StatusBadRequest, "plan id required")
		return
	}

	resp, err := h.installmentClient.GetInstallmentPlan(r.Context(), &paymentv1.GetInstallmentPlanRequest{
		PlanId: planID,
	})
	if err != nil {
		slog.Error("get installment plan gRPC call failed", "error", err, "plan_id", planID)
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoInstallmentPlanToJSON(resp.GetPlan()))
}

// ListInstallmentPlans handles GET /api/v1/payments/installment-plans.
func (h *InstallmentHandler) ListInstallmentPlans(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()

	grpcReq := &paymentv1.ListInstallmentPlansRequest{
		UserId: claims.UserID,
	}

	if statusFilter := q.Get("status"); statusFilter != "" {
		grpcReq.StatusFilter = &statusFilter
	}

	resp, err := h.installmentClient.ListInstallmentPlans(r.Context(), grpcReq)
	if err != nil {
		slog.Error("list installment plans gRPC call failed", "error", err, "user_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	plans := make([]map[string]interface{}, 0, len(resp.GetPlans()))
	for _, p := range resp.GetPlans() {
		plans = append(plans, protoInstallmentPlanToJSON(p))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"installment_plans": plans,
	})
}

// --- Proto to JSON helpers ---

func protoInstallmentPlanToJSON(p *paymentv1.InstallmentPlan) map[string]interface{} {
	if p == nil {
		return map[string]interface{}{}
	}

	installments := make([]map[string]interface{}, 0, len(p.GetInstallments()))
	for _, si := range p.GetInstallments() {
		inst := map[string]interface{}{
			"id":                 si.GetId(),
			"installment_number": si.GetInstallmentNumber(),
			"amount_cents":       si.GetAmountCents(),
			"due_date":           si.GetDueDate(),
			"status":             si.GetStatus(),
			"payment_id":         nil,
			"paid_at":            nil,
		}
		if si.GetPaymentId() != "" {
			inst["payment_id"] = si.GetPaymentId()
		}
		if si.GetPaidAt() != nil {
			inst["paid_at"] = formatTimestamp(si.GetPaidAt())
		}
		installments = append(installments, inst)
	}

	result := map[string]interface{}{
		"id":                           p.GetId(),
		"contract_id":                  p.GetContractId(),
		"customer_id":                  p.GetCustomerId(),
		"provider_id":                  p.GetProviderId(),
		"total_amount_cents":           p.GetTotalAmountCents(),
		"bnpl_fee_cents":               p.GetBnplFeeCents(),
		"total_with_fee_cents":         p.GetTotalWithFeeCents(),
		"installment_count":            p.GetInstallmentCount(),
		"per_installment_cents":        p.GetPerInstallmentCents(),
		"fee_rate":                     p.GetFeeRate(),
		"status":                       p.GetStatus(),
		"stripe_provider_transfer_id":  p.GetStripeProviderTransferId(),
		"installments":                 installments,
		"provider_paid_at":             nil,
		"created_at":                   formatTimestamp(p.GetCreatedAt()),
		"updated_at":                   formatTimestamp(p.GetUpdatedAt()),
	}

	if p.GetProviderPaidAt() != nil {
		result["provider_paid_at"] = formatTimestamp(p.GetProviderPaidAt())
	}

	return result
}
