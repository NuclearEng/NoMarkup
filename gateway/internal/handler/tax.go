package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// TaxHandler handles HTTP endpoints for tax forms and invoices.
//
// The tax/invoice RPCs live on the unified PaymentService (the proto was
// consolidated — there is no separate TaxInvoiceService client).
//
// The tax-ESTIMATE endpoint additionally needs the authoritative net-earnings
// figure (from the analytics service, same source the Tax Center earnings card
// uses) and the provider's state (read directly from their completed jobs via
// the db pool), so we inject both here. Computing the estimate gateway-side
// mirrors the existing advance_pricing.go precedent (financial figures derived
// in the gateway against the analytics client + db pool).
type TaxHandler struct {
	taxClient       paymentv1.PaymentServiceClient
	analyticsClient analyticsv1.AnalyticsServiceClient
	db              *pgxpool.Pool
}

// NewTaxHandler creates a new TaxHandler.
func NewTaxHandler(
	taxClient paymentv1.PaymentServiceClient,
	analyticsClient analyticsv1.AnalyticsServiceClient,
	db *pgxpool.Pool,
) *TaxHandler {
	return &TaxHandler{taxClient: taxClient, analyticsClient: analyticsClient, db: db}
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

// GetTaxEstimate handles GET /api/v1/providers/me/tax-estimate?year=YYYY.
//
// Returns an authoritative, itemized self-employment + federal income + state
// tax estimate for the provider's net SE earnings in the given tax year. All
// math is server-side and in integer cents (see tax_estimate_calc.go for the
// formula and cited 2025 brackets/rates). Owner-scoped via the JWT subject.
func (h *TaxHandler) GetTaxEstimate(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	year := time.Now().Year()
	if y := r.URL.Query().Get("year"); y != "" {
		if v, err := strconv.Atoi(y); err == nil && v >= 2020 && v <= 2100 {
			year = v
		}
	}

	// Authoritative net SE earnings for the year — same analytics source the Tax
	// Center earnings card reads, so the estimate and the displayed net agree.
	start := time.Date(year, time.January, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(year, time.December, 31, 23, 59, 59, 0, time.UTC)
	earnResp, err := h.analyticsClient.GetProviderEarnings(r.Context(), &analyticsv1.GetProviderEarningsRequest{
		ProviderId: claims.UserID,
		DateRange: &commonv1.DateRange{
			Start: timestamppb.New(start),
			End:   timestamppb.New(end),
		},
		GroupBy: "year",
	})
	if err != nil {
		slog.Error("tax estimate: get provider earnings failed", "error", err, "provider_id", claims.UserID, "year", year)
		writeGRPCError(w, err)
		return
	}
	netEarningsCents := earnResp.GetNetEarningsCents()

	// Source the provider's state from their most recent completed job's
	// service_state (the authoritative location where they earned). Best-effort:
	// an unknown state simply yields a $0 state-tax line, clearly labeled in the
	// UI, rather than failing the whole estimate (fail soft, CLAUDE.md §15).
	stateCode := h.lookupProviderState(r, claims.UserID)

	est := computeTaxEstimate(netEarningsCents, stateCode)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tax_estimate": map[string]interface{}{
			"tax_year":                    year,
			"net_earnings_cents":          est.NetEarningsCents,
			"se_calc_base_cents":          est.SECalcBaseCents,
			"se_tax_cents":                est.SETaxCents,
			"se_tax_rate":                 seTaxRate,
			"half_se_tax_deduction_cents": est.HalfSETaxDeductCents,
			"standard_deduction_cents":    est.StandardDeductCents,
			"federal_taxable_cents":       est.FederalTaxableCents,
			"federal_income_tax_cents":    est.FederalIncomeTaxCents,
			"state_code":                  est.StateCode,
			"state_tax_rate":              est.StateTaxRate,
			"state_income_tax_cents":      est.StateIncomeTaxCents,
			"has_state_data":              est.HasStateData,
			"total_tax_cents":             est.TotalTaxCents,
			"effective_rate":              est.EffectiveRate,
		},
	})
}

// lookupProviderState returns the USPS 2-letter state where the provider most
// recently completed work, read from contracts → jobs.service_state. Returns ""
// (no state data) on any miss; never errors the request.
func (h *TaxHandler) lookupProviderState(r *http.Request, providerID string) string {
	if h.db == nil {
		return ""
	}
	var state *string
	err := h.db.QueryRow(r.Context(), `
		SELECT j.service_state
		FROM contracts c
		JOIN jobs j ON j.id = c.job_id
		WHERE c.provider_id = $1 AND j.service_state IS NOT NULL AND j.service_state <> ''
		ORDER BY c.created_at DESC
		LIMIT 1`, providerID).Scan(&state)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("tax estimate: provider state lookup failed; proceeding without state tax",
				"error", err, "provider_id", providerID)
		}
		return ""
	}
	if state == nil {
		return ""
	}
	return *state
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
		"provider_id":                tf.GetProviderId(),
		"tax_year":                   tf.GetTaxYear(),
		"form_type":                  tf.GetFormType(),
		"provider_legal_name":        tf.GetProviderLegalName(),
		"provider_tax_id_last4":      tf.GetProviderTaxIdLast4(),
		"provider_address":           tf.GetProviderAddress(),
		"total_compensation_cents":   tf.GetTotalCompensationCents(),
		"federal_tax_withheld_cents": tf.GetFederalTaxWithheldCents(),
		"state_tax_withheld_cents":   tf.GetStateTaxWithheldCents(),
		"platform_ein":               tf.GetPlatformEin(),
		"platform_name":              tf.GetPlatformName(),
		"pdf_url":                    tf.GetPdfUrl(),
		"status":                     tf.GetStatus(),
		"created_at":                 formatTimestamp(tf.GetCreatedAt()),
		"updated_at":                 formatTimestamp(tf.GetUpdatedAt()),
	}

	if tf.GetDeliveredAt() != nil {
		result["delivered_at"] = formatTimestamp(tf.GetDeliveredAt())
	}
	if tf.GetFiledAt() != nil {
		result["filed_at"] = formatTimestamp(tf.GetFiledAt())
	}

	return result
}
