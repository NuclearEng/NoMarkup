package handler

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// InsuranceHandler handles HTTP endpoints for insurance.
//
// The insurance RPCs live on the unified PaymentService (the proto was
// consolidated — there is no separate InsuranceService client).
type InsuranceHandler struct {
	client paymentv1.PaymentServiceClient
}

// NewInsuranceHandler creates a new InsuranceHandler.
func NewInsuranceHandler(client paymentv1.PaymentServiceClient) *InsuranceHandler {
	return &InsuranceHandler{client: client}
}

// ListProducts handles GET /api/v1/insurance/products (public).
func (h *InsuranceHandler) ListProducts(w http.ResponseWriter, r *http.Request) {
	resp, err := h.client.ListInsuranceProducts(r.Context(), &paymentv1.ListInsuranceProductsRequest{})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	products := make([]map[string]interface{}, 0, len(resp.GetProducts()))
	for _, p := range resp.GetProducts() {
		products = append(products, map[string]interface{}{
			"id":                    p.GetId(),
			"name":                  p.GetName(),
			"slug":                  p.GetSlug(),
			"description":           p.GetDescription(),
			"coverage_type":         p.GetCoverageType(),
			"base_rate_bps":         p.GetBaseRateBps(),
			"min_premium_cents":     p.GetMinPremiumCents(),
			"max_coverage_cents":    p.GetMaxCoverageCents(),
			"coverage_duration_days": p.GetCoverageDurationDays(),
			"deductible_cents":      p.GetDeductibleCents(),
			"terms_markdown":        p.GetTermsMarkdown(),
			"active":                p.GetActive(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"products": products,
	})
}

type getQuoteRequest struct {
	ProductID  string `json:"product_id"`
	ContractID string `json:"contract_id"`
}

// GetQuote handles POST /api/v1/insurance/quote.
//
// The premium is derived entirely server-side from the contract (amount +
// category). The client supplies only product_id + contract_id — any
// client-supplied amount is intentionally not accepted (price calc is
// server-side, CLAUDE.md §6).
func (h *InsuranceHandler) GetQuote(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req getQuoteRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate UUIDs up front so a malformed id returns a clear 400 rather than a
	// 500 from a downstream cast/lookup failure.
	if !isValidUUID(req.ProductID) {
		writeError(w, http.StatusBadRequest, "invalid insurance product id")
		return
	}
	if !isValidUUID(req.ContractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}

	resp, err := h.client.GetInsuranceQuote(r.Context(), &paymentv1.GetInsuranceQuoteRequest{
		ProductId:  req.ProductID,
		ContractId: req.ContractID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	q := resp.GetQuote()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"product_id":             q.GetProductId(),
		"product_name":           q.GetProductName(),
		"coverage_type":          q.GetCoverageType(),
		"premium_cents":          q.GetPremiumCents(),
		"coverage_amount_cents":  q.GetCoverageAmountCents(),
		"deductible_cents":       q.GetDeductibleCents(),
		"coverage_duration_days": q.GetCoverageDurationDays(),
		"effective_date":         q.GetEffectiveDate(),
		"expiration_date":        q.GetExpirationDate(),
	})
}

type purchaseInsuranceRequest struct {
	ProductID       string `json:"product_id"`
	ContractID      string `json:"contract_id"`
	PaymentMethodID string `json:"payment_method_id"`
}

// PurchaseInsurance handles POST /api/v1/insurance/purchase.
//
// SECURITY: customer_id comes from the JWT (claims), and provider_id + the
// premium amount are DERIVED server-side from the contract by the payment
// service after verifying the caller owns the contract. The client supplies
// only product_id, contract_id and (its own) payment_method_id — never a
// provider or an amount. This closes the original IDOR / amount-tampering hole.
func (h *InsuranceHandler) PurchaseInsurance(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req purchaseInsuranceRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate UUIDs up front so a missing/malformed id returns a clear 400
	// rather than a 500 from a downstream cast / FK lookup failure.
	if !isValidUUID(req.ProductID) {
		writeError(w, http.StatusBadRequest, "invalid insurance product id")
		return
	}
	if !isValidUUID(req.ContractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}
	if req.PaymentMethodID == "" {
		writeError(w, http.StatusBadRequest, "payment_method_id is required")
		return
	}

	resp, err := h.client.PurchaseInsurance(r.Context(), &paymentv1.PurchaseInsuranceRequest{
		ProductId:  req.ProductID,
		ContractId: req.ContractID,
		CustomerId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	result := protoInsurancePolicyToJSON(resp.GetPolicy())
	result["client_secret"] = resp.GetClientSecret()

	writeJSON(w, http.StatusCreated, result)
}

// ListPolicies handles GET /api/v1/insurance/policies.
func (h *InsuranceHandler) ListPolicies(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()
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

	resp, err := h.client.ListInsurancePolicies(r.Context(), &paymentv1.ListInsurancePoliciesRequest{
		UserId: claims.UserID,
		Pagination: &commonv1.PaginationRequest{
			Page:     page,
			PageSize: pageSize,
		},
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	policies := make([]map[string]interface{}, 0, len(resp.GetPolicies()))
	for _, p := range resp.GetPolicies() {
		policies = append(policies, protoInsurancePolicyToJSON(p))
	}

	result := map[string]interface{}{
		"policies": policies,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"total_count": pg.TotalCount,
			"page":        pg.Page,
			"page_size":   pg.PageSize,
			"total_pages": pg.TotalPages,
			"has_next":    pg.HasNext,
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// GetPolicy handles GET /api/v1/insurance/policies/{id}.
func (h *InsuranceHandler) GetPolicy(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	policyID := chi.URLParam(r, "id")
	if policyID == "" {
		writeError(w, http.StatusBadRequest, "policy id required")
		return
	}
	if !isValidUUID(policyID) {
		writeError(w, http.StatusBadRequest, "invalid insurance policy id")
		return
	}

	resp, err := h.client.GetInsurancePolicy(r.Context(), &paymentv1.GetInsurancePolicyRequest{
		PolicyId: policyID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	// Ownership check: a policy may only be read by its customer or provider,
	// or by an admin. Return 404 (not 403) to non-owners so the endpoint does
	// not leak the existence of other tenants' policies (IDOR fix).
	policy := resp.GetPolicy()
	if !hasRole(claims, "admin") &&
		policy.GetCustomerId() != claims.UserID &&
		policy.GetProviderId() != claims.UserID {
		writeError(w, http.StatusNotFound, "insurance policy not found")
		return
	}

	writeJSON(w, http.StatusOK, protoInsurancePolicyToJSON(policy))
}

type fileClaimRequest struct {
	PolicyID           string   `json:"policy_id"`
	ClaimType          string   `json:"claim_type"`
	Description        string   `json:"description"`
	EvidenceURLs       []string `json:"evidence_urls"`
	ClaimedAmountCents int64    `json:"claimed_amount_cents"`
}

// FileClaim handles POST /api/v1/insurance/claims.
func (h *InsuranceHandler) FileClaim(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req fileClaimRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.client.FileInsuranceClaim(r.Context(), &paymentv1.FileInsuranceClaimRequest{
		PolicyId:           req.PolicyID,
		ClaimantId:         claims.UserID,
		ClaimType:          req.ClaimType,
		Description:        req.Description,
		EvidenceUrls:       req.EvidenceURLs,
		ClaimedAmountCents: req.ClaimedAmountCents,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, protoInsuranceClaimToJSON(resp.GetClaim()))
}

// GetClaim handles GET /api/v1/insurance/claims/{id}.
func (h *InsuranceHandler) GetClaim(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	claimID := chi.URLParam(r, "id")
	if claimID == "" {
		writeError(w, http.StatusBadRequest, "claim id required")
		return
	}
	if !isValidUUID(claimID) {
		writeError(w, http.StatusBadRequest, "invalid insurance claim id")
		return
	}

	resp, err := h.client.GetInsuranceClaim(r.Context(), &paymentv1.GetInsuranceClaimRequest{
		ClaimId: claimID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	claim := resp.GetClaim()

	// Ownership check (IDOR fix): a claim may be read by the claimant who filed
	// it, by either party on the underlying policy (customer/provider), or by an
	// admin. Non-owners get 404 so the endpoint does not leak claim existence.
	if !hasRole(claims, "admin") && claim.GetClaimantId() != claims.UserID {
		polResp, err := h.client.GetInsurancePolicy(r.Context(), &paymentv1.GetInsurancePolicyRequest{
			PolicyId: claim.GetPolicyId(),
		})
		if err != nil {
			writeError(w, http.StatusNotFound, "insurance claim not found")
			return
		}
		policy := polResp.GetPolicy()
		if policy.GetCustomerId() != claims.UserID && policy.GetProviderId() != claims.UserID {
			writeError(w, http.StatusNotFound, "insurance claim not found")
			return
		}
	}

	writeJSON(w, http.StatusOK, protoInsuranceClaimToJSON(claim))
}

// AdminListClaims handles GET /api/v1/admin/insurance/claims.
func (h *InsuranceHandler) AdminListClaims(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

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

	grpcReq := &paymentv1.AdminListInsuranceClaimsRequest{
		Pagination: &commonv1.PaginationRequest{
			Page:     page,
			PageSize: pageSize,
		},
	}
	if statusStr := q.Get("status"); statusStr != "" {
		grpcReq.StatusFilter = &statusStr
	}

	resp, err := h.client.AdminListInsuranceClaims(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	claimsList := make([]map[string]interface{}, 0, len(resp.GetClaims()))
	for _, c := range resp.GetClaims() {
		claimsList = append(claimsList, protoInsuranceClaimToJSON(c))
	}

	result := map[string]interface{}{
		"claims": claimsList,
	}
	if pg := resp.GetPagination(); pg != nil {
		// camelCase to match the PaginationResponse TS contract the admin
		// DataTable reads (totalPages/hasNext). See admin advances for context.
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

type reviewClaimRequest struct {
	Approved            bool   `json:"approved"`
	ApprovedAmountCents int64  `json:"approved_amount_cents"`
	AssessorNotes       string `json:"assessor_notes"`
	DenialReason        string `json:"denial_reason"`
}

// AdminReviewClaim handles POST /api/v1/admin/insurance/claims/{id}/review.
func (h *InsuranceHandler) AdminReviewClaim(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	claimID := chi.URLParam(r, "id")
	if claimID == "" {
		writeError(w, http.StatusBadRequest, "claim id required")
		return
	}

	var req reviewClaimRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	resp, err := h.client.ReviewInsuranceClaim(r.Context(), &paymentv1.ReviewInsuranceClaimRequest{
		ClaimId:             claimID,
		ReviewerId:          claims.UserID,
		Approved:            req.Approved,
		ApprovedAmountCents: req.ApprovedAmountCents,
		AssessorNotes:       req.AssessorNotes,
		DenialReason:        req.DenialReason,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoInsuranceClaimToJSON(resp.GetClaim()))
}

// --- Proto to JSON helpers ---

func protoInsurancePolicyToJSON(p *paymentv1.InsurancePolicy) map[string]interface{} {
	if p == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":                      p.GetId(),
		"policy_number":           p.GetPolicyNumber(),
		"product_id":              p.GetProductId(),
		"contract_id":             p.GetContractId(),
		"customer_id":             p.GetCustomerId(),
		"provider_id":             p.GetProviderId(),
		"coverage_amount_cents":   p.GetCoverageAmountCents(),
		"premium_cents":           p.GetPremiumCents(),
		"deductible_cents":        p.GetDeductibleCents(),
		"effective_date":          p.GetEffectiveDate(),
		"expiration_date":         p.GetExpirationDate(),
		"status":                  p.GetStatus(),
		"cancellation_reason":     p.GetCancellationReason(),
		"created_at":              formatTimestamp(p.GetCreatedAt()),
	}

	if p.GetPaidAt() != nil {
		result["paid_at"] = formatTimestamp(p.GetPaidAt())
	}
	if p.GetCancelledAt() != nil {
		result["cancelled_at"] = formatTimestamp(p.GetCancelledAt())
	}

	return result
}

func protoInsuranceClaimToJSON(c *paymentv1.InsuranceClaim) map[string]interface{} {
	if c == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":                   c.GetId(),
		"claim_number":         c.GetClaimNumber(),
		"policy_id":            c.GetPolicyId(),
		"claimant_id":          c.GetClaimantId(),
		"claim_type":           c.GetClaimType(),
		"description":          c.GetDescription(),
		"evidence_urls":        c.GetEvidenceUrls(),
		"claimed_amount_cents": c.GetClaimedAmountCents(),
		"assessed_amount_cents": c.GetAssessedAmountCents(),
		"assessor_notes":       c.GetAssessorNotes(),
		"approved_amount_cents": c.GetApprovedAmountCents(),
		"payout_cents":         c.GetPayoutCents(),
		"status":               c.GetStatus(),
		"denial_reason":        c.GetDenialReason(),
		"reviewed_by":          c.GetReviewedBy(),
		"created_at":           formatTimestamp(c.GetCreatedAt()),
	}

	if c.GetReviewedAt() != nil {
		result["reviewed_at"] = formatTimestamp(c.GetReviewedAt())
	}
	if c.GetPaidAt() != nil {
		result["paid_at"] = formatTimestamp(c.GetPaidAt())
	}

	return result
}
