package handler

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// TaxHandler handles HTTP endpoints for tax forms and invoices.
type TaxHandler struct {
	taxClient paymentv1.TaxInvoiceServiceClient
}

// NewTaxHandler creates a new TaxHandler.
func NewTaxHandler(taxClient paymentv1.TaxInvoiceServiceClient) *TaxHandler {
	return &TaxHandler{taxClient: taxClient}
}

// GenerateTaxForm handles POST /api/v1/providers/me/tax-forms/{year}/generate.
func (h *TaxHandler) GenerateTaxForm(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	yearStr := chi.URLParam(r, "year")
	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 2020 || year > 2100 {
		writeError(w, http.StatusBadRequest, "invalid tax year")
		return
	}

	resp, err := h.taxClient.GenerateTaxForm(r.Context(), &paymentv1.GenerateTaxFormRequest{
		ProviderId: claims.UserID,
		TaxYear:    int32(year),
	})
	if err != nil {
		slog.Error("generate tax form gRPC call failed", "error", err, "provider_id", claims.UserID, "year", year)
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"tax_form": protoTaxFormToJSON(resp.GetTaxForm()),
	})
}

// ListTaxForms handles GET /api/v1/providers/me/tax-forms.
func (h *TaxHandler) ListTaxForms(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.taxClient.ListTaxForms(r.Context(), &paymentv1.ListTaxFormsRequest{
		ProviderId: claims.UserID,
	})
	if err != nil {
		slog.Error("list tax forms gRPC call failed", "error", err, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	forms := make([]map[string]interface{}, 0, len(resp.GetForms()))
	for _, f := range resp.GetForms() {
		forms = append(forms, protoTaxFormToJSON(f))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"forms": forms,
	})
}

// GetTaxForm handles GET /api/v1/providers/me/tax-forms/{year}.
func (h *TaxHandler) GetTaxForm(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	yearStr := chi.URLParam(r, "year")
	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 2020 || year > 2100 {
		writeError(w, http.StatusBadRequest, "invalid tax year")
		return
	}

	resp, err := h.taxClient.GetTaxForm(r.Context(), &paymentv1.GetTaxFormRequest{
		ProviderId: claims.UserID,
		TaxYear:    int32(year),
	})
	if err != nil {
		slog.Error("get tax form gRPC call failed", "error", err, "provider_id", claims.UserID, "year", year)
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tax_form": protoTaxFormToJSON(resp.GetTaxForm()),
	})
}

// DownloadTaxForm handles GET /api/v1/providers/me/tax-forms/{year}/download.
// This endpoint returns HTML content with an attachment disposition for download.
func (h *TaxHandler) DownloadTaxForm(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	yearStr := chi.URLParam(r, "year")
	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 2020 || year > 2100 {
		writeError(w, http.StatusBadRequest, "invalid tax year")
		return
	}

	resp, err := h.taxClient.GetTaxFormHTML(r.Context(), &paymentv1.GetTaxFormHTMLRequest{
		ProviderId: claims.UserID,
		TaxYear:    int32(year),
	})
	if err != nil {
		slog.Error("download tax form HTML gRPC call failed", "error", err, "provider_id", claims.UserID, "year", year)
		writeGRPCError(w, err)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"1099-NEC-"+yearStr+".html\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(resp.GetHtml()))
}

// GenerateInvoice handles POST /api/v1/contracts/{id}/invoice.
func (h *TaxHandler) GenerateInvoice(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	resp, err := h.taxClient.GenerateInvoice(r.Context(), &paymentv1.GenerateInvoiceRequest{
		ContractId: contractID,
	})
	if err != nil {
		slog.Error("generate invoice gRPC call failed", "error", err, "contract_id", contractID)
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"invoice_url": resp.GetInvoiceUrl(),
	})
}

// DownloadInvoice handles GET /api/v1/contracts/{id}/invoice/download.
// This endpoint returns the invoice HTML with attachment disposition.
func (h *TaxHandler) DownloadInvoice(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	contractID := chi.URLParam(r, "id")
	if contractID == "" {
		writeError(w, http.StatusBadRequest, "contract id required")
		return
	}

	resp, err := h.taxClient.GetInvoiceHTML(r.Context(), &paymentv1.GetInvoiceHTMLRequest{
		ContractId: contractID,
	})
	if err != nil {
		slog.Error("download invoice HTML gRPC call failed", "error", err, "contract_id", contractID)
		writeGRPCError(w, err)
		return
	}

	// Use first 8 chars of contract ID for filename.
	filenameID := contractID
	if len(filenameID) > 8 {
		filenameID = filenameID[:8]
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"invoice-"+filenameID+".html\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(resp.GetHtml()))
}

// --- Proto to JSON helpers ---

func protoTaxFormToJSON(tf *paymentv1.TaxForm) map[string]interface{} {
	if tf == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":                         tf.GetId(),
		"provider_id":               tf.GetProviderId(),
		"tax_year":                  tf.GetTaxYear(),
		"form_type":                 tf.GetFormType(),
		"provider_legal_name":       tf.GetProviderLegalName(),
		"provider_tax_id_last4":     tf.GetProviderTaxIdLast4(),
		"provider_address":          tf.GetProviderAddress(),
		"total_compensation_cents":  tf.GetTotalCompensationCents(),
		"federal_tax_withheld_cents": tf.GetFederalTaxWithheldCents(),
		"state_tax_withheld_cents":  tf.GetStateTaxWithheldCents(),
		"platform_ein":             tf.GetPlatformEin(),
		"platform_name":            tf.GetPlatformName(),
		"pdf_url":                  tf.GetPdfUrl(),
		"status":                   tf.GetStatus(),
		"created_at":               formatTimestamp(tf.GetCreatedAt()),
		"updated_at":               formatTimestamp(tf.GetUpdatedAt()),
	}

	if tf.GetDeliveredAt() != nil {
		result["delivered_at"] = formatTimestamp(tf.GetDeliveredAt())
	}
	if tf.GetFiledAt() != nil {
		result["filed_at"] = formatTimestamp(tf.GetFiledAt())
	}

	return result
}

