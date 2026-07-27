package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminDisputesHandler handles admin dispute management endpoints.
//
// db is the gateway pool, used to resolve contract parties for notifications
// and (R1) to locate refundable payments for guarantee claim payouts.
// paymentClient issues CreateRefund on approved guarantee payouts; nil-safe
// fail-closed when payout_cents > 0.
type AdminDisputesHandler struct {
	contractClient contractv1.ContractServiceClient
	paymentClient  paymentv1.PaymentServiceClient
	db             *pgxpool.Pool
}

// NewAdminDisputesHandler creates a new AdminDisputesHandler.
// paymentClient may be nil (tests); production must pass the payment gRPC client
// so guarantee approve with payout can call CreateRefund.
func NewAdminDisputesHandler(
	contractClient contractv1.ContractServiceClient,
	db *pgxpool.Pool,
	paymentClient paymentv1.PaymentServiceClient,
) *AdminDisputesHandler {
	return &AdminDisputesHandler{
		contractClient: contractClient,
		paymentClient:  paymentClient,
		db:             db,
	}
}

// notifyDisputeResolved tells BOTH contract parties (customer + provider) that
// the admin resolved their dispute. The admin is the actor, so neither party is
// the actor and both receive it (emitNotification's self-notify guard is a
// no-op here). Fully fail-soft: a party lookup failure skips the notification
// and never affects the (already-committed) resolution.
func (h *AdminDisputesHandler) notifyDisputeResolved(ctx context.Context, adminID, contractID string) {
	if h.db == nil || contractID == "" {
		return
	}
	var customerID, providerID string
	if err := h.db.QueryRow(ctx,
		`SELECT customer_id::text, provider_id::text FROM contracts WHERE id = $1`, contractID,
	).Scan(&customerID, &providerID); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.ErrorContext(ctx, "dispute resolved notification: contract party lookup failed",
				"error", err, "contract_id", contractID)
		}
		return
	}
	const (
		title = "Your dispute was resolved"
		body  = "An admin reviewed and resolved the dispute on your contract. See the outcome."
	)
	url := "/contracts/" + contractID
	emitNotification(ctx, h.db, adminID, customerID, "dispute_resolved", title, body, url, "contract", contractID)
	emitNotification(ctx, h.db, adminID, providerID, "dispute_resolved", title, body, url, "contract", contractID)
}

// ListDisputes handles GET /api/v1/admin/disputes.
// Query params: status, is_guarantee_claim, page, page_size.
func (h *AdminDisputesHandler) ListDisputes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &contractv1.ListDisputesRequest{}

	// Parse optional status filter.
	if s := q.Get("status"); s != "" {
		status := parseDisputeStatus(s)
		if status != contractv1.DisputeStatus_DISPUTE_STATUS_UNSPECIFIED {
			grpcReq.StatusFilter = &status
		}
	}

	// Parse optional is_guarantee_claim filter.
	if gc := q.Get("is_guarantee_claim"); gc != "" {
		val := gc == "true" || gc == "1"
		grpcReq.IsGuaranteeClaim = &val
	}

	// Parse pagination.
	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 {
			pageSize = int32(v)
		}
	}
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     page,
		PageSize: pageSize,
	}

	resp, err := h.contractClient.ListDisputes(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	disputes := make([]map[string]interface{}, 0, len(resp.GetDisputes()))
	for _, d := range resp.GetDisputes() {
		disputes = append(disputes, disputeToJSON(d))
	}

	result := map[string]interface{}{
		"disputes": disputes,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

// GetDispute handles GET /api/v1/admin/disputes/{id}.
func (h *AdminDisputesHandler) GetDispute(w http.ResponseWriter, r *http.Request) {
	disputeID := chi.URLParam(r, "id")
	if !isValidUUID(disputeID) {
		writeError(w, http.StatusBadRequest, "invalid dispute id")
		return
	}

	resp, err := h.contractClient.GetDispute(r.Context(), &contractv1.GetDisputeRequest{
		DisputeId: disputeID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"dispute": disputeToJSON(resp.GetDispute()),
	})
}

// ResolveDispute handles POST /api/v1/admin/disputes/{id}/resolve.
func (h *AdminDisputesHandler) ResolveDispute(w http.ResponseWriter, r *http.Request) {
	disputeID := chi.URLParam(r, "id")
	if !isValidUUID(disputeID) {
		writeError(w, http.StatusBadRequest, "invalid dispute id")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		ResolutionType    string `json:"resolution_type"`
		ResolutionNotes   string `json:"resolution_notes"`
		RefundAmountCents int64  `json:"refund_amount_cents"`
		GuaranteeOutcome  string `json:"guarantee_outcome"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}

	resp, err := h.contractClient.AdminResolveDispute(r.Context(), &contractv1.AdminResolveDisputeRequest{
		DisputeId:         disputeID,
		AdminId:           claims.UserID,
		ResolutionType:    body.ResolutionType,
		ResolutionNotes:   body.ResolutionNotes,
		RefundAmountCents: body.RefundAmountCents,
		GuaranteeOutcome:  body.GuaranteeOutcome,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	// Notify BOTH contract parties that their dispute was resolved. Fail-soft.
	h.notifyDisputeResolved(r.Context(), claims.UserID, resp.GetDispute().GetContractId())

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"dispute": disputeToJSON(resp.GetDispute()),
	})
}

// --- Guarantee Claims ---

// ListGuaranteeClaims handles GET /api/v1/admin/guarantee-claims.
// Query params: status, page, page_size.
func (h *AdminDisputesHandler) ListGuaranteeClaims(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	isGuaranteeClaim := true
	grpcReq := &contractv1.ListDisputesRequest{
		IsGuaranteeClaim: &isGuaranteeClaim,
	}

	// Parse optional status filter.
	if s := q.Get("status"); s != "" {
		status := parseDisputeStatus(s)
		if status != contractv1.DisputeStatus_DISPUTE_STATUS_UNSPECIFIED {
			grpcReq.StatusFilter = &status
		}
	}

	// Parse pagination.
	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 {
			pageSize = int32(v)
		}
	}
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     page,
		PageSize: pageSize,
	}

	resp, err := h.contractClient.ListDisputes(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	claims := make([]map[string]interface{}, 0, len(resp.GetDisputes()))
	for _, d := range resp.GetDisputes() {
		claims = append(claims, disputeToJSON(d))
	}

	result := map[string]interface{}{
		"guarantee_claims": claims,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

// ReviewGuaranteeClaim handles PUT /api/v1/admin/guarantee-claims/{id}/review.
// Admin approves or rejects a guarantee claim.
//
// R1 money path: when approved with payout_cents > 0, the gateway issues a
// payment CreateRefund (admin actor) BEFORE resolving the dispute so a failed
// refund never leaves a "resolved + payout booked" claim with no Stripe refund.
// CreateRefund is CAS-safe on the payment row; dispute resolve is CAS on open status.
func (h *AdminDisputesHandler) ReviewGuaranteeClaim(w http.ResponseWriter, r *http.Request) {
	claimID := chi.URLParam(r, "id")
	if !isValidUUID(claimID) {
		writeError(w, http.StatusBadRequest, "invalid claim id")
		return
	}

	adminClaims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Approved        bool   `json:"approved"`
		ResolutionNotes string `json:"resolution_notes"`
		PayoutCents     int64  `json:"payout_cents"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}

	if body.ResolutionNotes == "" {
		writeError(w, http.StatusBadRequest, "resolution_notes is required")
		return
	}

	resolutionType := "dismissed"
	guaranteeOutcome := "denied"
	refundCents := int64(0)
	var refundedPaymentID string
	if body.Approved {
		resolutionType = "guarantee_invoked"
		guaranteeOutcome = "refund"
		refundCents = body.PayoutCents

		// Money guard (CLAUDE.md §6 — server-side price calc, fail closed).
		// The payout is untrusted admin input. Reject a negative payout and a
		// payout exceeding the covered contract amount with a clean,
		// admin-actionable 400 BEFORE the gRPC call. The contract service
		// re-enforces both invariants authoritatively; this is the front-line
		// check that surfaces the contract cap in the error message.
		if refundCents < 0 {
			writeError(w, http.StatusBadRequest, "payout amount must not be negative")
			return
		}
		var contractID string
		var capCents int64
		var alreadyPaid bool
		if refundCents > 0 {
			if h.db == nil {
				writeError(w, http.StatusServiceUnavailable, "database unavailable for payout verification")
				return
			}
			var paidAt *time.Time
			err := h.db.QueryRow(r.Context(), `
				SELECT c.id::text, c.amount_cents, d.guarantee_paid_at
				  FROM disputes d
				  JOIN contracts c ON c.id = d.contract_id
				 WHERE d.id = $1`, claimID,
			).Scan(&contractID, &capCents, &paidAt)
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				// Fall through — the service layer maps a missing dispute to 404.
			case err != nil:
				slog.ErrorContext(r.Context(), "guarantee review: payout-cap lookup failed",
					"error", err, "claim_id", claimID)
				writeError(w, http.StatusInternalServerError, "failed to verify payout cap")
				return
			case refundCents > capCents:
				writeError(w, http.StatusBadRequest,
					"payout exceeds the covered contract amount ("+formatCentsUSD(capCents)+")")
				return
			}
			alreadyPaid = paidAt != nil

			// Fail closed: money must move before we mark the claim resolved.
			// If guarantee_paid_at is set, skip CreateRefund (retry after resolve fail).
			if contractID != "" && !alreadyPaid {
				paymentID, refundErr := h.refundGuaranteePayout(
					r.Context(),
					adminClaims.UserID,
					claimID,
					contractID,
					refundCents,
					body.ResolutionNotes,
				)
				if refundErr != nil {
					writeError(w, refundErr.status, refundErr.message)
					return
				}
				refundedPaymentID = paymentID
				// Stamp paid_at so a second approve cannot double-refund.
				if _, stampErr := h.db.Exec(r.Context(), `
					UPDATE disputes
					   SET guarantee_payout_cents = $2,
					       guarantee_reviewed_by = $3::uuid,
					       guarantee_reviewed_at = now(),
					       guarantee_paid_at = now(),
					       updated_at = now()
					 WHERE id = $1
					   AND guarantee_paid_at IS NULL`,
					claimID, refundCents, adminClaims.UserID,
				); stampErr != nil {
					slog.ErrorContext(r.Context(), "guarantee review: stamp paid_at failed after refund",
						"error", stampErr, "claim_id", claimID, "payment_id", paymentID)
					// Money already moved — continue to resolve; ops can reconcile stamp.
				}
			}
		}
	}

	resp, err := h.contractClient.AdminResolveDispute(r.Context(), &contractv1.AdminResolveDisputeRequest{
		DisputeId:         claimID,
		AdminId:           adminClaims.UserID,
		ResolutionType:    resolutionType,
		ResolutionNotes:   body.ResolutionNotes,
		RefundAmountCents: refundCents,
		GuaranteeOutcome:  guaranteeOutcome,
	})
	if err != nil {
		// Refund already succeeded: log hard so ops can reconcile if resolve fails.
		if refundedPaymentID != "" {
			slog.ErrorContext(r.Context(), "guarantee review: refund succeeded but dispute resolve failed — manual reconcile",
				"error", err,
				"claim_id", claimID,
				"payment_id", refundedPaymentID,
				"payout_cents", refundCents,
			)
		}
		writeGRPCError(w, err)
		return
	}

	out := map[string]interface{}{
		"guarantee_claim": disputeToJSON(resp.GetDispute()),
	}
	if refundedPaymentID != "" {
		out["refund_payment_id"] = refundedPaymentID
		out["refund_amount_cents"] = refundCents
	}
	writeJSON(w, http.StatusOK, out)
}

// guaranteeRefundError is a typed HTTP error for the money path.
type guaranteeRefundError struct {
	status  int
	message string
}

func (e *guaranteeRefundError) Error() string { return e.message }

// refundablePayment is one contract payment slice eligible for guarantee refund.
type refundablePayment struct {
	ID        string
	Remaining int64
	Status    string
}

// allocateGuaranteeRefunds walks oldest-first payments and assigns slices until
// payout is covered. Fail-closed when total remaining < payout. Pure function
// for unit tests.
func allocateGuaranteeRefunds(payments []refundablePayment, payoutCents int64) ([]refundablePayment, *guaranteeRefundError) {
	if payoutCents <= 0 {
		return nil, &guaranteeRefundError{
			status:  http.StatusBadRequest,
			message: "payout amount must be positive for a guarantee refund",
		}
	}
	if len(payments) == 0 {
		return nil, &guaranteeRefundError{
			status:  http.StatusConflict,
			message: "no refundable payment on this contract; cannot pay out guarantee claim",
		}
	}
	var total int64
	for _, p := range payments {
		if p.Remaining > 0 {
			total += p.Remaining
		}
	}
	if total < payoutCents {
		return nil, &guaranteeRefundError{
			status: http.StatusBadRequest,
			message: fmt.Sprintf(
				"payout exceeds refundable payment balance (%s remaining across payments)",
				formatCentsUSD(total),
			),
		}
	}
	leftover := payoutCents
	out := make([]refundablePayment, 0, len(payments))
	for _, p := range payments {
		if leftover <= 0 {
			break
		}
		if p.Remaining <= 0 {
			continue
		}
		slice := p.Remaining
		if slice > leftover {
			slice = leftover
		}
		out = append(out, refundablePayment{ID: p.ID, Remaining: slice, Status: p.Status})
		leftover -= slice
	}
	if leftover > 0 {
		// Should be unreachable after total check.
		return nil, &guaranteeRefundError{
			status:  http.StatusInternalServerError,
			message: "failed to allocate guarantee refund across payments",
		}
	}
	return out, nil
}

// refundGuaranteePayout locates refundable contract payments and calls CreateRefund
// as admin, allocating oldest-first across milestones when needed. Fail-closed:
// no payment client, no eligible payment, underfunded total, or Stripe/service
// failure → error without resolving the dispute.
//
// On multi-slice refunds, a mid-loop failure may leave earlier slices refunded;
// guarantee_paid_at is only stamped after the full allocation succeeds, so ops
// must reconcile partial Stripe refunds before re-approving the same claim.
func (h *AdminDisputesHandler) refundGuaranteePayout(
	ctx context.Context,
	adminID, claimID, contractID string,
	payoutCents int64,
	reason string,
) (primaryPaymentID string, err *guaranteeRefundError) {
	if h.paymentClient == nil {
		return "", &guaranteeRefundError{
			status:  http.StatusServiceUnavailable,
			message: "payment service unavailable; cannot pay out guarantee claim",
		}
	}
	if h.db == nil {
		return "", &guaranteeRefundError{
			status:  http.StatusServiceUnavailable,
			message: "database unavailable; cannot pay out guarantee claim",
		}
	}

	rows, qerr := h.db.Query(ctx, `
		SELECT id::text, amount_cents, COALESCE(refund_amount_cents, 0), status
		  FROM payments
		 WHERE contract_id = $1
		   AND status IN ('escrow', 'released', 'completed', 'partially_refunded')
		   AND amount_cents - COALESCE(refund_amount_cents, 0) > 0
		 ORDER BY created_at ASC`, contractID)
	if qerr != nil {
		slog.ErrorContext(ctx, "guarantee refund: payment list failed",
			"error", qerr, "contract_id", contractID, "claim_id", claimID)
		return "", &guaranteeRefundError{
			status:  http.StatusInternalServerError,
			message: "failed to locate contract payment for guarantee payout",
		}
	}
	defer rows.Close()

	var payments []refundablePayment
	for rows.Next() {
		var pid string
		var amountCents, alreadyRefunded int64
		var status string
		if scanErr := rows.Scan(&pid, &amountCents, &alreadyRefunded, &status); scanErr != nil {
			return "", &guaranteeRefundError{
				status:  http.StatusInternalServerError,
				message: "failed to locate contract payment for guarantee payout",
			}
		}
		remaining := amountCents - alreadyRefunded
		if remaining > 0 {
			payments = append(payments, refundablePayment{ID: pid, Remaining: remaining, Status: status})
		}
	}
	if err := rows.Err(); err != nil {
		return "", &guaranteeRefundError{
			status:  http.StatusInternalServerError,
			message: "failed to locate contract payment for guarantee payout",
		}
	}

	slices, allocErr := allocateGuaranteeRefunds(payments, payoutCents)
	if allocErr != nil {
		return "", allocErr
	}

	refundReason := reason
	if refundReason == "" {
		refundReason = "guarantee claim payout"
	}
	// Tag reason with claim id for audit (payment refund_reason column).
	refundReason = fmt.Sprintf("guarantee-claim:%s: %s", claimID, refundReason)
	if len(refundReason) > 500 {
		refundReason = refundReason[:500]
	}

	var lastID string
	for i, slice := range slices {
		resp, rerr := h.paymentClient.CreateRefund(ctx, &paymentv1.CreateRefundRequest{
			PaymentId:       slice.ID,
			AmountCents:     slice.Remaining,
			Reason:          refundReason,
			InitiatedBy:     adminID,
			ActorIsAdmin:    true,
			SystemInitiated: false,
		})
		if rerr != nil {
			slog.ErrorContext(ctx, "guarantee refund: CreateRefund failed",
				"error", rerr,
				"payment_id", slice.ID,
				"claim_id", claimID,
				"slice_cents", slice.Remaining,
				"slice_index", i,
				"slices_total", len(slices),
			)
			return "", &guaranteeRefundError{
				status:  http.StatusBadGateway,
				message: "payment refund failed; claim left open for retry (check for partial refunds)",
			}
		}
		lastID = slice.ID
		if resp.GetPayment() != nil && resp.GetPayment().GetId() != "" {
			lastID = resp.GetPayment().GetId()
		}
		slog.InfoContext(ctx, "guarantee claim refund slice issued",
			"claim_id", claimID,
			"payment_id", lastID,
			"slice_cents", slice.Remaining,
			"admin_id", adminID,
			"prior_status", slice.Status,
			"slice_index", i,
		)
	}
	return lastID, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func disputeToJSON(d *contractv1.Dispute) map[string]interface{} {
	if d == nil {
		return map[string]interface{}{}
	}
	result := map[string]interface{}{
		"id":                 d.GetId(),
		"contract_id":       d.GetContractId(),
		"opened_by":         d.GetOpenedBy(),
		"dispute_type":      protoEnumToString(d.GetDisputeType().String(), "DISPUTE_TYPE_"),
		"description":       d.GetDescription(),
		"status":            protoEnumToString(d.GetStatus().String(), "DISPUTE_STATUS_"),
		"is_guarantee_claim": d.GetIsGuaranteeClaim(),
		"created_at":        formatTimestamp(d.GetCreatedAt()),
	}
	if d.GetResolvedAt() != nil {
		result["resolved_at"] = formatTimestamp(d.GetResolvedAt())
	}
	if d.GetResolutionType() != "" {
		result["resolution_type"] = d.GetResolutionType()
	}
	if d.GetResolutionNotes() != "" {
		result["resolution_notes"] = d.GetResolutionNotes()
	}
	return result
}

// formatCentsUSD renders an integer cent amount as a "$X.YY" string for
// admin-facing error messages. Always two decimals; handles negatives.
func formatCentsUSD(cents int64) string {
	neg := ""
	if cents < 0 {
		neg = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s$%d.%02d", neg, cents/100, cents%100)
}

func parseDisputeStatus(s string) contractv1.DisputeStatus {
	switch s {
	case "open":
		return contractv1.DisputeStatus_DISPUTE_STATUS_OPEN
	case "under_review":
		return contractv1.DisputeStatus_DISPUTE_STATUS_UNDER_REVIEW
	case "resolved":
		return contractv1.DisputeStatus_DISPUTE_STATUS_RESOLVED
	case "escalated":
		return contractv1.DisputeStatus_DISPUTE_STATUS_ESCALATED
	case "closed":
		return contractv1.DisputeStatus_DISPUTE_STATUS_CLOSED
	default:
		return contractv1.DisputeStatus_DISPUTE_STATUS_UNSPECIFIED
	}
}
