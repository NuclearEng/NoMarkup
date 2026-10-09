package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

// WorkingCapitalHandler handles HTTP endpoints for working capital advances.
type WorkingCapitalHandler struct {
	paymentClient paymentv1.PaymentServiceClient
	// db is used for the provider-facing repayment path. The payment service
	// exposes no RepayAdvance gRPC, so the gateway pays down the outstanding
	// balance directly with a parameterized, ownership-scoped UPDATE.
	db *pgxpool.Pool
}

// NewWorkingCapitalHandler creates a new WorkingCapitalHandler.
func NewWorkingCapitalHandler(paymentClient paymentv1.PaymentServiceClient, db *pgxpool.Pool) *WorkingCapitalHandler {
	return &WorkingCapitalHandler{paymentClient: paymentClient, db: db}
}

// contractNumbersByID reads the human-readable contract_number for the given
// contract ids in a single parameterized query. The advance proto carries only
// the contract UUID, so the gateway projects the friendly number in — without
// it the repay dialog and advance rows fall back to a truncated UUID ("Pay
// down 00000000…"). A nil db or query error returns an empty map (fail-soft:
// the number simply isn't enriched, and the UI keeps its UUID fallback).
func (h *WorkingCapitalHandler) contractNumbersByID(ctx context.Context, ids []string) map[string]string {
	out := make(map[string]string, len(ids))
	if h.db == nil || len(ids) == 0 {
		return out
	}
	rows, err := h.db.Query(ctx,
		`SELECT id::text, contract_number FROM contracts WHERE id = ANY($1)`, ids)
	if err != nil {
		slog.ErrorContext(ctx, "advance contract_number enrichment query failed", "error", err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, number string
		if err := rows.Scan(&id, &number); err != nil {
			slog.ErrorContext(ctx, "advance contract_number enrichment scan failed", "error", err)
			return out
		}
		if number != "" {
			out[id] = number
		}
	}
	return out
}

type requestAdvanceRequest struct {
	ContractID  string `json:"contract_id"`
	AmountCents int64  `json:"amount_cents"`
}

// RequestAdvance handles POST /api/v1/providers/me/advances.
func (h *WorkingCapitalHandler) RequestAdvance(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req requestAdvanceRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.ContractID == "" {
		writeError(w, http.StatusBadRequest, "contract_id is required")
		return
	}
	if req.AmountCents <= 0 {
		writeError(w, http.StatusBadRequest, "amount_cents must be positive")
		return
	}

	resp, err := h.paymentClient.RequestAdvance(r.Context(), &paymentv1.RequestAdvanceRequest{
		ProviderId:  claims.UserID,
		ContractId:  req.ContractID,
		AmountCents: req.AmountCents,
	})
	if err != nil {
		if strings.Contains(err.Error(), "declined") {
			writeError(w, http.StatusUnprocessableEntity,
				"Advance declined: your business credit score is below the minimum to qualify right now. Complete and repay more jobs on time to build it up.")
			return
		}
		if strings.Contains(err.Error(), "exceeds available credit") {
			writeError(w, http.StatusUnprocessableEntity,
				"Advance declined: the requested amount exceeds your available credit. Check your credit limit and reduce the amount, or repay outstanding advances to free up credit.")
			return
		}
		slog.Error("request advance gRPC call failed", "error", err, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	advanceJSON := protoAdvanceToJSON(resp.GetAdvance())

	// Surface WHY the fee is what it is on the creation response so the borrower
	// sees the pricing rationale inline (APR, base rate, risk grade) instead of
	// having to cross-reference the separate /credit-limit quote. We recompute
	// the score via the same authoritative gRPC path the credit-limit uses; the
	// payment service is the authority that actually charged the fee, and the
	// per-advance fee_breakdown above is the source of truth for the amounts.
	if cl, clErr := h.paymentClient.GetCreditLimit(r.Context(), &paymentv1.GetCreditLimitRequest{
		ProviderId: claims.UserID,
	}); clErr == nil {
		var onTimeRate *float64
		if v := cl.GetOnTimeRate(); v > 0 {
			onTimeRate = &v
		}
		score := businessCreditScore(onTimeRate, int(cl.GetJobsCompleted()), cl.GetTotalEarningsCents())
		aprBps := dynamicAPRBps(score)
		advanceJSON["pricing"] = map[string]interface{}{
			"business_credit_score": score,
			"credit_grade":          creditGrade(score),
			"base_rate_bps":         baseAdvanceRateBps(),
			"apr_bps":               aprBps,
			"term_days":             defaultAdvanceTermDays,
		}
	} else {
		slog.Warn("could not attach advance pricing rationale; fee breakdown still present",
			"error", clErr, "provider_id", claims.UserID)
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"advance": advanceJSON,
	})
}

// ListMyAdvances handles GET /api/v1/providers/me/advances.
func (h *WorkingCapitalHandler) ListMyAdvances(w http.ResponseWriter, r *http.Request) {
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

	grpcReq := &paymentv1.ListAdvancesRequest{
		ProviderId: claims.UserID,
		Pagination: &commonv1.PaginationRequest{
			Page:     page,
			PageSize: pageSize,
		},
	}

	if statusFilter := q.Get("status"); statusFilter != "" {
		grpcReq.StatusFilter = &statusFilter
	}

	resp, err := h.paymentClient.ListAdvances(r.Context(), grpcReq)
	if err != nil {
		slog.Error("list advances gRPC call failed", "error", err, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	// Resolve friendly contract numbers in one batched query so each row (and
	// the repay dialog) shows the contract number instead of a truncated UUID.
	contractIDs := make([]string, 0, len(resp.GetAdvances()))
	for _, a := range resp.GetAdvances() {
		if cid := a.GetContractId(); cid != "" {
			contractIDs = append(contractIDs, cid)
		}
	}
	numbers := h.contractNumbersByID(r.Context(), contractIDs)

	advances := make([]map[string]interface{}, 0, len(resp.GetAdvances()))
	for _, a := range resp.GetAdvances() {
		jc := protoAdvanceToJSON(a)
		if n := numbers[a.GetContractId()]; n != "" {
			jc["contract_number"] = n
		}
		advances = append(advances, jc)
	}

	result := map[string]interface{}{
		"advances": advances,
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

// GetAdvance handles GET /api/v1/providers/me/advances/{id}.
func (h *WorkingCapitalHandler) GetAdvance(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	advanceID := chi.URLParam(r, "id")
	if advanceID == "" {
		writeError(w, http.StatusBadRequest, "advance id required")
		return
	}
	if !isValidUUID(advanceID) {
		writeError(w, http.StatusBadRequest, "invalid advance id")
		return
	}

	resp, err := h.paymentClient.GetAdvance(r.Context(), &paymentv1.GetAdvanceRequest{
		AdvanceId: advanceID,
	})
	if err != nil {
		slog.Error("get advance gRPC call failed", "error", err, "advance_id", advanceID)
		writeGRPCError(w, err)
		return
	}

	// Ownership check (IDOR guard): this is the provider-facing `/me/` route, so
	// the advance MUST belong to the calling provider. The payment service fetches
	// by id only, so enforce ownership here against the verified JWT subject.
	// Respond 404 (not 403) so a non-owner cannot even confirm the id exists.
	advance := resp.GetAdvance()
	if advance == nil || advance.GetProviderId() != claims.UserID {
		slog.Warn("advance ownership check failed",
			"advance_id", advanceID, "caller_provider_id", claims.UserID)
		writeError(w, http.StatusNotFound, "advance not found")
		return
	}

	advanceJSON := protoAdvanceToJSON(advance)
	if cid := advance.GetContractId(); cid != "" {
		if n := h.contractNumbersByID(r.Context(), []string{cid})[cid]; n != "" {
			advanceJSON["contract_number"] = n
		}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advance": advanceJSON,
	})
}

type repayAdvanceRequest struct {
	AmountCents int64 `json:"amount_cents"`
}

// RepayAdvance handles POST /api/v1/providers/me/advances/{id}/repay.
//
// Providers pay down the outstanding balance on a working-capital advance.
// The payment service exposes no RepayAdvance gRPC, so we apply the paydown
// directly against the gateway dbPool with a parameterized, ownership-scoped
// UPDATE (provider_id == claims.UserID), mirroring the status-transition logic
// the payment repository uses. All amounts are integer cents.
//
// Idempotency: the route is mounted behind middleware.RequireIdempotencyKey,
// so a retried request with the same Idempotency-Key is short-circuited before
// it reaches this handler — the UPDATE never double-applies.
func (h *WorkingCapitalHandler) RepayAdvance(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	advanceID := chi.URLParam(r, "id")
	if advanceID == "" {
		writeError(w, http.StatusBadRequest, "advance id required")
		return
	}
	if !isValidUUID(advanceID) {
		writeError(w, http.StatusBadRequest, "invalid advance id")
		return
	}

	var req repayAdvanceRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.AmountCents <= 0 {
		writeError(w, http.StatusBadRequest, "amount_cents must be positive")
		return
	}

	// Ownership + outstanding check (IDOR guard): fetch the advance scoped to the
	// calling provider. A non-owner (or non-existent id) gets 404 so the id can't
	// be probed. We read principal/fee/repaid to validate the amount server-side
	// (never trust the client) against the true outstanding balance.
	var principal, fee, repaid int64
	var status string
	err := h.db.QueryRow(r.Context(), `
		SELECT advance_amount_cents, fee_cents, repaid_cents, status
		FROM working_capital_advances
		WHERE id = $1 AND provider_id = $2`,
		advanceID, claims.UserID,
	).Scan(&principal, &fee, &repaid, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("repay advance ownership check failed",
				"advance_id", advanceID, "caller_provider_id", claims.UserID)
			writeError(w, http.StatusNotFound, "advance not found")
			return
		}
		slog.Error("repay advance fetch failed", "error", err, "advance_id", advanceID)
		writeError(w, http.StatusInternalServerError, "could not load advance")
		return
	}

	// An advance is only repayable once funds are out (disbursed/repaying).
	if status != "disbursed" && status != "repaying" {
		writeError(w, http.StatusUnprocessableEntity,
			"This advance is not currently repayable. Only disbursed advances with an outstanding balance can be repaid.")
		return
	}

	outstanding := principal + fee - repaid
	if outstanding <= 0 {
		writeError(w, http.StatusUnprocessableEntity, "This advance is already fully repaid.")
		return
	}
	if req.AmountCents > outstanding {
		writeError(w, http.StatusUnprocessableEntity,
			"Repayment amount exceeds the outstanding balance on this advance.")
		return
	}

	// Apply the paydown: increment repaid_cents and transition status, mirroring
	// the payment repository (repaid → fully paid, otherwise mark 'repaying').
	//
	// CONCURRENCY (TOCTOU): the outstanding read above is advisory only — used for
	// friendly pre-validation. The authoritative over-repay guard lives in the
	// UPDATE's WHERE clause (`repaid_cents + $amt <= advance_amount_cents +
	// fee_cents`), so it is evaluated atomically against the CURRENT row under the
	// row lock the UPDATE takes. Two concurrent different-key repays can no longer
	// both pass a stale read and both apply: whichever commits first moves
	// repaid_cents, and the other's WHERE re-evaluates against the new value and
	// matches zero rows. Ownership is re-asserted in the WHERE so a concurrent
	// change can't let a non-owner write. Parameterized; integer cents only.
	var (
		newPrincipal, newFee, newRepaid int64
		newStatus                       string
	)
	err = h.db.QueryRow(r.Context(), `
		UPDATE working_capital_advances SET
			repaid_cents = repaid_cents + $3,
			status = CASE
				WHEN repaid_cents + $3 >= advance_amount_cents + fee_cents THEN 'repaid'
				WHEN status = 'disbursed' THEN 'repaying'
				ELSE status
			END,
			repaid_at = CASE
				WHEN repaid_cents + $3 >= advance_amount_cents + fee_cents THEN now()
				ELSE repaid_at
			END,
			updated_at = now()
		WHERE id = $1 AND provider_id = $2
		  AND repaid_cents + $3 <= advance_amount_cents + fee_cents
		RETURNING advance_amount_cents, fee_cents, repaid_cents, status`,
		advanceID, claims.UserID, req.AmountCents,
	).Scan(&newPrincipal, &newFee, &newRepaid, &newStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Zero rows matched. Either (a) the advance no longer exists / isn't
			// owned by this provider, or (b) the over-repay guard rejected it
			// (another concurrent repay raised repaid_cents so this amount now
			// exceeds the outstanding balance). Re-read the row scoped to the
			// owner to distinguish 404 (not found / not owned) from 422
			// (exceeds outstanding) and report the right error.
			var curPrincipal, curFee, curRepaid int64
			rerr := h.db.QueryRow(r.Context(), `
				SELECT advance_amount_cents, fee_cents, repaid_cents
				FROM working_capital_advances
				WHERE id = $1 AND provider_id = $2`,
				advanceID, claims.UserID,
			).Scan(&curPrincipal, &curFee, &curRepaid)
			if rerr != nil {
				if errors.Is(rerr, pgx.ErrNoRows) {
					slog.Warn("repay advance gone or not owned on retry",
						"advance_id", advanceID, "provider_id", claims.UserID)
					writeError(w, http.StatusNotFound, "advance not found")
					return
				}
				slog.Error("repay advance re-read failed", "error", rerr,
					"advance_id", advanceID, "provider_id", claims.UserID)
				writeError(w, http.StatusInternalServerError, "could not record repayment")
				return
			}
			// Row exists and is owned → the WHERE rejected on the over-repay guard.
			writeError(w, http.StatusUnprocessableEntity,
				"Repayment amount exceeds the outstanding balance on this advance.")
			return
		}
		slog.Error("repay advance update failed", "error", err,
			"advance_id", advanceID, "provider_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "could not record repayment")
		return
	}

	newOutstanding := newPrincipal + newFee - newRepaid
	if newOutstanding < 0 {
		newOutstanding = 0
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advance": map[string]interface{}{
			"id":                    advanceID,
			"provider_id":           claims.UserID,
			"advance_amount_cents":  newPrincipal,
			"fee_cents":             newFee,
			"total_repayable_cents": newPrincipal + newFee,
			"repaid_cents":          newRepaid,
			"outstanding_cents":     newOutstanding,
			"status":                newStatus,
		},
	})
}

// AdminListAdvances handles GET /api/v1/admin/advances.
func (h *WorkingCapitalHandler) AdminListAdvances(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
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

	// Admin list: empty provider_id to get all advances.
	grpcReq := &paymentv1.ListAdvancesRequest{
		ProviderId: "",
		Pagination: &commonv1.PaginationRequest{
			Page:     page,
			PageSize: pageSize,
		},
	}

	if statusFilter := q.Get("status"); statusFilter != "" {
		grpcReq.StatusFilter = &statusFilter
	}

	resp, err := h.paymentClient.ListAdvances(r.Context(), grpcReq)
	if err != nil {
		slog.Error("admin list advances gRPC call failed", "error", err)
		writeGRPCError(w, err)
		return
	}

	advances := make([]map[string]interface{}, 0, len(resp.GetAdvances()))
	for _, a := range resp.GetAdvances() {
		advances = append(advances, protoAdvanceToJSON(a))
	}

	result := map[string]interface{}{
		"advances": advances,
	}
	if pg := resp.GetPagination(); pg != nil {
		// Emit camelCase pagination to match the shared PaginationResponse TS
		// contract that the admin DataTable reads (totalPages/hasNext). Snake
		// case here left totalPages undefined, silently hiding the pager.
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

type adminReviewAdvanceRequest struct {
	Action string `json:"action"`
	Reason string `json:"reason"`
}

// AdminReviewAdvance handles POST /api/v1/admin/advances/{id}/review.
func (h *WorkingCapitalHandler) AdminReviewAdvance(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	advanceID := chi.URLParam(r, "id")
	if !isValidUUID(advanceID) {
		writeError(w, http.StatusBadRequest, "invalid advance id")
		return
	}

	var req adminReviewAdvanceRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.Action != "approve" && req.Action != "reject" {
		writeError(w, http.StatusBadRequest, "action must be 'approve' or 'reject'")
		return
	}

	resp, err := h.paymentClient.ReviewAdvance(r.Context(), &paymentv1.ReviewAdvanceRequest{
		AdvanceId:  advanceID,
		ReviewerId: claims.UserID,
		Action:     req.Action,
		Reason:     req.Reason,
	})
	if err != nil {
		slog.Error("review advance gRPC call failed", "error", err, "advance_id", advanceID, "reviewer_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advance": protoAdvanceToJSON(resp.GetAdvance()),
	})
}

// AdminDisburseAdvance handles POST /api/v1/admin/advances/{id}/disburse.
func (h *WorkingCapitalHandler) AdminDisburseAdvance(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	advanceID := chi.URLParam(r, "id")
	if !isValidUUID(advanceID) {
		writeError(w, http.StatusBadRequest, "invalid advance id")
		return
	}

	resp, err := h.paymentClient.DisburseAdvance(r.Context(), &paymentv1.DisburseAdvanceRequest{
		AdvanceId: advanceID,
		AdminId:   claims.UserID,
	})
	if err != nil {
		slog.Error("disburse advance gRPC call failed", "error", err, "advance_id", advanceID, "admin_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	result := protoAdvanceToJSON(resp.GetAdvance())
	result["stripe_transfer_id"] = resp.GetStripeTransferId()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"advance": result,
	})
}

// GetCreditLimit handles GET /api/v1/providers/me/credit-limit.
func (h *WorkingCapitalHandler) GetCreditLimit(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.paymentClient.GetCreditLimit(r.Context(), &paymentv1.GetCreditLimitRequest{
		ProviderId: claims.UserID,
	})
	if err != nil {
		slog.Error("get credit limit gRPC call failed", "error", err, "provider_id", claims.UserID)
		writeGRPCError(w, err)
		return
	}

	result := map[string]interface{}{
		"provider_id":             resp.GetProviderId(),
		"max_advance_cents":       resp.GetMaxAdvanceCents(),
		"total_outstanding_cents": resp.GetTotalOutstandingCents(),
		// Web contract (CreditLimit) reads `available_cents`; keep this key in
		// sync with it so the provider dashboard renders the real number instead
		// of NaN.
		"available_cents":      resp.GetAvailableAdvanceCents(),
		"risk_score":           resp.GetRiskScore(),
		"jobs_completed":       resp.GetJobsCompleted(),
		"total_earnings_cents": resp.GetTotalEarningsCents(),
		"avg_job_value_cents":  resp.GetAvgJobValueCents(),
		"on_time_rate":         resp.GetOnTimeRate(),
		"last_computed_at":     nil,
		// Underwriting-engine decision (deterministic, explainable, auditable).
		"approved":                resp.GetApproved(),
		"tier":                    resp.GetTier(),
		"available_advance_cents": resp.GetAvailableAdvanceCents(),
		"fee_bps":                 resp.GetFeeBps(),
		"factor_rate":             resp.GetFactorRate(),
		"holdback_pct":            resp.GetHoldbackPct(),
		"binding_cap":             resp.GetBindingCap(),
		"binding_gate":            resp.GetBindingGate(),
		"decision_hash":           resp.GetDecisionHash(),
		"model_version":           resp.GetModelVersion(),
	}
	reasons := make([]map[string]interface{}, 0, len(resp.GetReasons()))
	for _, rr := range resp.GetReasons() {
		reasons = append(reasons, map[string]interface{}{
			"code":         rr.GetCode(),
			"label":        rr.GetLabel(),
			"contribution": rr.GetContribution(),
		})
	}
	result["reasons"] = reasons
	if resp.GetLastComputedAt() != nil {
		result["last_computed_at"] = formatTimestamp(resp.GetLastComputedAt())
	}

	// Risk-based pricing quote: business credit score → grade → dynamic APR.
	// A zero on-time rate is treated as "no advance history" (neutral); the
	// payment service is authoritative at charge time.
	var onTimeRate *float64
	if v := resp.GetOnTimeRate(); v > 0 {
		onTimeRate = &v
	}
	score := businessCreditScore(onTimeRate, int(resp.GetJobsCompleted()), resp.GetTotalEarningsCents())
	grade := creditGrade(score)
	result["business_credit_score"] = score
	result["credit_grade"] = grade
	result["base_rate_bps"] = baseAdvanceRateBps()
	result["apr_bps"] = dynamicAPRBps(score)
	result["eligible"] = score >= minLendingScore

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"credit_limit": result,
	})
}

// --- Proto to JSON helper ---

func protoAdvanceToJSON(a *paymentv1.Advance) map[string]interface{} {
	if a == nil {
		return map[string]interface{}{}
	}

	// Transparent, itemized fee breakdown (founder rule: "be very transparent
	// on all fees, hide nothing"). All values below are derived directly from
	// the stored advance — no recomputation, so they can never drift from what
	// the provider was actually charged:
	//   fee_cents          = service_fee_cents + interest_cents
	//   total_repayable    = principal + fee_cents
	principal := a.GetAdvanceAmountCents()
	serviceFee := a.GetServiceFeeCents()
	interest := a.GetFeeCents() - serviceFee
	if interest < 0 {
		interest = 0
	}

	result := map[string]interface{}{
		"id":                   a.GetId(),
		"provider_id":          a.GetProviderId(),
		"contract_id":          a.GetContractId(),
		"advance_amount_cents": principal,
		"fee_cents":            a.GetFeeCents(),
		// Itemized fee breakdown — what makes up fee_cents.
		"fee_breakdown": map[string]interface{}{
			"service_fee_cents": serviceFee, // flat 3% origination on principal
			"service_fee_rate":  advanceServiceFeeRate,
			"interest_cents":    interest, // prorated APR interest over the term
			"term_days":         defaultAdvanceTermDays,
			"total_fee_cents":   a.GetFeeCents(),
		},
		"total_repayable_cents": principal + a.GetFeeCents(),
		"repaid_cents":          a.GetRepaidCents(),
		"status":                a.GetStatus(),
		"reviewed_by":           nil,
		"reviewed_at":           nil,
		"rejection_reason":      nil,
		"disbursed_at":          nil,
		"repaid_at":             nil,
		"stripe_transfer_id":    nil,
		"created_at":            formatTimestamp(a.GetCreatedAt()),
		"updated_at":            formatTimestamp(a.GetUpdatedAt()),
	}

	if a.GetReviewedBy() != "" {
		result["reviewed_by"] = a.GetReviewedBy()
	}
	if a.GetReviewedAt() != nil {
		result["reviewed_at"] = formatTimestamp(a.GetReviewedAt())
	}
	if a.GetRejectionReason() != "" {
		result["rejection_reason"] = a.GetRejectionReason()
	}
	if a.GetDisbursedAt() != nil {
		result["disbursed_at"] = formatTimestamp(a.GetDisbursedAt())
	}
	if a.GetRepaidAt() != nil {
		result["repaid_at"] = formatTimestamp(a.GetRepaidAt())
	}
	if a.GetStripeTransferId() != "" {
		result["stripe_transfer_id"] = a.GetStripeTransferId()
	}

	return result
}
