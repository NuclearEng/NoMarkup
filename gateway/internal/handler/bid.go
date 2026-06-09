package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// BidHandler handles HTTP endpoints for bids.
//
// db is optional — when non-nil it is used purely to EMIT in-app notifications
// for bid events (a provider placing a bid → notify the job's customer; a
// customer awarding a bid → notify the winning provider). It is never on the
// critical path of placing/awarding a bid; a nil pool simply skips the
// notification (fail-soft), matching the rest of the gateway's nil-safe pattern.
type BidHandler struct {
	bidClient      bidv1.BidServiceClient
	contractClient contractv1.ContractServiceClient
	db             *pgxpool.Pool
}

// NewBidHandler creates a new BidHandler. The optional contractClient is used
// to create a contract row immediately after a bid is awarded — without it,
// awarding a bid just flips status and the customer-accept → contract pipeline
// stays severed. db (optional) is used only to emit in-app notifications.
func NewBidHandler(bidClient bidv1.BidServiceClient, contractClient contractv1.ContractServiceClient, db *pgxpool.Pool) *BidHandler {
	return &BidHandler{bidClient: bidClient, contractClient: contractClient, db: db}
}

type placeBidRequest struct {
	AmountCents int64 `json:"amount_cents"`
}

type updateBidRequest struct {
	NewAmountCents int64 `json:"new_amount_cents"`
}

// PlaceBid handles POST /api/v1/jobs/{jobID}/bids.
func (h *BidHandler) PlaceBid(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	if !hasRole(claims, "provider") {
		writeError(w, http.StatusForbidden, "provider role required")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	var req placeBidRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if msg := validateMoneyCents("amount_cents", req.AmountCents); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}

	resp, err := h.bidClient.PlaceBid(r.Context(), &bidv1.PlaceBidRequest{
		JobId:       jobID,
		ProviderId:  claims.UserID,
		AmountCents: req.AmountCents,
	})
	if err != nil {
		slog.WarnContext(r.Context(), "place bid failed",
			"job_id", jobID,
			"provider_id", claims.UserID,
			"amount_cents", req.AmountCents,
			"error", err,
		)
		writeGRPCError(w, err)
		return
	}

	slog.InfoContext(r.Context(), "bid placed",
		"job_id", jobID,
		"provider_id", claims.UserID,
		"amount_cents", req.AmountCents,
		"bid_id", resp.GetBid().GetId(),
	)

	// Notify the job's customer that a new bid landed on their job. Fail-soft:
	// runs after the bid is committed and swallows all errors so a notification
	// problem never breaks bidding. Recipient is the job owner (never the
	// bidding provider — emitNotification also guards self-notify).
	h.notifyNewBid(r.Context(), jobID, claims.UserID, req.AmountCents)

	writeJSON(w, http.StatusCreated, protoBidToJSON(resp.GetBid()))
}

// notifyNewBid emits a `new_bid` in-app notification to the customer who owns
// the job. Fully fail-soft (see emitNotification): any error is logged and
// swallowed. The job is a reverse auction, so a new bid is good news for the
// customer (someone is competing to do their job).
func (h *BidHandler) notifyNewBid(ctx context.Context, jobID, providerID string, amountCents int64) {
	if h.db == nil {
		return
	}

	var customerID, title string
	if err := h.db.QueryRow(ctx,
		`SELECT customer_id::text, title FROM jobs WHERE id = $1`, jobID,
	).Scan(&customerID, &title); err != nil {
		slog.ErrorContext(ctx, "new bid notification: job lookup failed",
			"error", err, "job_id", jobID)
		return
	}

	dollars := fmt.Sprintf("$%.2f", float64(amountCents)/100)
	emitNotification(ctx, h.db,
		providerID, customerID,
		"new_bid",
		"New bid on your job",
		fmt.Sprintf("A provider bid %s on \"%s\".", dollars, title),
		"/jobs/"+jobID,
		"job", jobID,
	)
}

// notifyBidAwarded emits a single `bid_awarded` in-app notification to the
// provider who won the job. When a contract row was created (contractID != ""),
// the body and deep link point at the contract so the provider can act on it;
// otherwise we link back to the job. One notification intentionally covers both
// the award and the contract creation (same recipient, same instant) so the
// provider is not double-notified. Fully fail-soft.
func (h *BidHandler) notifyBidAwarded(ctx context.Context, jobID, customerID, providerID string, amountCents int64, contractID string) {
	if h.db == nil {
		return
	}

	var title string
	if err := h.db.QueryRow(ctx, `SELECT title FROM jobs WHERE id = $1`, jobID).Scan(&title); err != nil {
		// Title is enrichment only — fall back to a generic phrasing rather
		// than dropping the notification, so the provider is still told.
		slog.WarnContext(ctx, "bid awarded notification: job title lookup failed",
			"error", err, "job_id", jobID)
		title = "your job"
	}

	dollars := fmt.Sprintf("$%.2f", float64(amountCents)/100)
	actionURL := "/jobs/" + jobID
	body := fmt.Sprintf("Your %s bid on \"%s\" was accepted.", dollars, title)
	entityType, entityID := "job", jobID
	if contractID != "" {
		actionURL = "/contracts/" + contractID
		body = fmt.Sprintf("Your %s bid on \"%s\" was accepted — your contract is ready.", dollars, title)
		entityType, entityID = "contract", contractID
	}

	emitNotification(ctx, h.db,
		customerID, providerID,
		"bid_awarded",
		"You won the job",
		body,
		actionURL,
		entityType, entityID,
	)
}

// UpdateBid handles PATCH /api/v1/bids/{id}.
func (h *BidHandler) UpdateBid(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	bidID := chi.URLParam(r, "id")
	if bidID == "" {
		writeError(w, http.StatusBadRequest, "bid id required")
		return
	}

	var req updateBidRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if msg := validateMoneyCents("new_amount_cents", req.NewAmountCents); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}

	resp, err := h.bidClient.UpdateBid(r.Context(), &bidv1.UpdateBidRequest{
		BidId:          bidID,
		ProviderId:     claims.UserID,
		NewAmountCents: req.NewAmountCents,
	})
	if err != nil {
		slog.WarnContext(r.Context(), "update bid failed",
			"bid_id", bidID,
			"provider_id", claims.UserID,
			"new_amount_cents", req.NewAmountCents,
			"error", err,
		)
		writeGRPCError(w, err)
		return
	}

	slog.InfoContext(r.Context(), "bid updated",
		"bid_id", bidID,
		"provider_id", claims.UserID,
		"new_amount_cents", req.NewAmountCents,
	)
	writeJSON(w, http.StatusOK, protoBidToJSON(resp.GetBid()))
}

// WithdrawBid handles DELETE /api/v1/bids/{id}.
func (h *BidHandler) WithdrawBid(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	bidID := chi.URLParam(r, "id")
	if bidID == "" {
		writeError(w, http.StatusBadRequest, "bid id required")
		return
	}

	resp, err := h.bidClient.WithdrawBid(r.Context(), &bidv1.WithdrawBidRequest{
		BidId:      bidID,
		ProviderId: claims.UserID,
	})
	if err != nil {
		slog.WarnContext(r.Context(), "withdraw bid failed",
			"bid_id", bidID,
			"provider_id", claims.UserID,
			"error", err,
		)
		writeGRPCError(w, err)
		return
	}

	slog.InfoContext(r.Context(), "bid withdrawn",
		"bid_id", bidID,
		"provider_id", claims.UserID,
	)
	writeJSON(w, http.StatusOK, protoBidToJSON(resp.GetBid()))
}

// AcceptOffer handles POST /api/v1/jobs/{jobID}/bids/accept-offer.
func (h *BidHandler) AcceptOffer(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	if !hasRole(claims, "provider") {
		writeError(w, http.StatusForbidden, "provider role required")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	resp, err := h.bidClient.AcceptOfferPrice(r.Context(), &bidv1.AcceptOfferPriceRequest{
		JobId:      jobID,
		ProviderId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, protoBidToJSON(resp.GetBid()))
}

// AwardBid handles POST /api/v1/jobs/{jobID}/bids/{bidID}/award.
func (h *BidHandler) AwardBid(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	if !hasRole(claims, "customer") {
		writeError(w, http.StatusForbidden, "customer role required")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	bidID := chi.URLParam(r, "bidID")
	if bidID == "" {
		writeError(w, http.StatusBadRequest, "bid id required")
		return
	}

	resp, err := h.bidClient.AwardBid(r.Context(), &bidv1.AwardBidRequest{
		JobId:      jobID,
		BidId:      bidID,
		CustomerId: claims.UserID,
	})
	if err != nil {
		slog.WarnContext(r.Context(), "award bid failed",
			"job_id", jobID,
			"bid_id", bidID,
			"customer_id", claims.UserID,
			"error", err,
		)
		writeGRPCError(w, err)
		return
	}

	awardedBid := resp.GetAwardedBid()

	// Saga step 2: now that the bidding engine has marked the winning bid as
	// "awarded" and all other active bids as "not_selected", create the contract
	// row so the customer-accept → contract pipeline is wired end-to-end.
	//
	// If contract creation fails after a successful award, we cannot cleanly
	// reverse the award (it spans services / a separate Rust pool), so we log
	// loudly and emit a metric for ops to follow up on. The customer still
	// sees their bid awarded, and the recovery path is to re-call this
	// endpoint or have ops insert the contract manually. This mirrors the
	// "saga without compensating action" pattern called out in the task brief.
	contractID := ""
	if h.contractClient != nil {
		contractResp, contractErr := h.contractClient.CreateContractFromAward(r.Context(), &contractv1.CreateContractFromAwardRequest{
			JobId:         jobID,
			BidId:         bidID,
			CustomerId:    claims.UserID,
			ProviderId:    awardedBid.GetProviderId(),
			AmountCents:   awardedBid.GetAmountCents(),
			PaymentTiming: commonv1.PaymentTiming_PAYMENT_TIMING_COMPLETION,
		})
		if contractErr != nil {
			// Bid is already awarded; the contract is missing. This is the
			// state the original bug produced — log loudly so ops can recover.
			slog.ErrorContext(r.Context(), "contract creation after award failed (manual recovery required)",
				"job_id", jobID,
				"bid_id", bidID,
				"customer_id", claims.UserID,
				"provider_id", awardedBid.GetProviderId(),
				"amount_cents", awardedBid.GetAmountCents(),
				"error", contractErr,
			)
		} else {
			contractID = contractResp.GetContract().GetId()
		}
	}

	slog.InfoContext(r.Context(), "bid awarded",
		"job_id", jobID,
		"bid_id", bidID,
		"customer_id", claims.UserID,
		"contract_id", contractID,
	)

	// Notify the WINNING provider their bid was awarded (and, when contract
	// creation succeeded, that the contract is ready). One notification covers
	// both "bid awarded" and "contract created" — same recipient, same moment —
	// so we never double-notify. Fail-soft: swallows all errors. Recipient is
	// the awarded provider, never the awarding customer (self-notify guarded).
	h.notifyBidAwarded(r.Context(), jobID, claims.UserID, awardedBid.GetProviderId(), awardedBid.GetAmountCents(), contractID)

	result := protoBidToJSON(awardedBid)
	if contractID != "" {
		result["contract_id"] = contractID
	}

	writeJSON(w, http.StatusOK, result)
}

// ListBidsForJob handles GET /api/v1/jobs/{jobID}/bids.
func (h *BidHandler) ListBidsForJob(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	resp, err := h.bidClient.ListBidsForJob(r.Context(), &bidv1.ListBidsForJobRequest{
		JobId:      jobID,
		CustomerId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	bids := make([]map[string]interface{}, 0, len(resp.GetBids()))
	for _, bwp := range resp.GetBids() {
		entry := map[string]interface{}{
			"bid":                    protoBidToJSON(bwp.GetBid()),
			"provider_display_name":  bwp.GetProviderDisplayName(),
			"provider_business_name": bwp.GetProviderBusinessName(),
			"provider_avatar_url":    bwp.GetProviderAvatarUrl(),
			"jobs_completed":         bwp.GetJobsCompleted(),
			"trust_score":            nil,
			"review_summary":         nil,
		}
		bids = append(bids, entry)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"bids": bids,
	})
}

// ListMyBids handles GET /api/v1/bids/mine.
func (h *BidHandler) ListMyBids(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()

	grpcReq := &bidv1.ListBidsForProviderRequest{
		ProviderId: claims.UserID,
	}

	if statusStr := q.Get("status"); statusStr != "" {
		st := stringToBidStatus(statusStr)
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

	resp, err := h.bidClient.ListBidsForProvider(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	bids := make([]map[string]interface{}, 0, len(resp.GetBids()))
	for _, b := range resp.GetBids() {
		bids = append(bids, protoBidToJSON(b))
	}

	result := map[string]interface{}{
		"bids": bids,
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

// GetBid handles GET /api/v1/bids/{id}.
func (h *BidHandler) GetBid(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	bidID := chi.URLParam(r, "id")
	if bidID == "" {
		writeError(w, http.StatusBadRequest, "bid id required")
		return
	}

	resp, err := h.bidClient.GetBid(r.Context(), &bidv1.GetBidRequest{
		BidId:            bidID,
		RequestingUserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoBidToJSON(resp.GetBid()))
}

// GetBidAnalytics handles GET /api/v1/bids/analytics.
func (h *BidHandler) GetBidAnalytics(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	jobID := r.URL.Query().Get("job_id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job_id query parameter is required")
		return
	}

	resp, err := h.bidClient.GetBidAnalytics(r.Context(), &bidv1.GetBidAnalyticsRequest{
		JobId: jobID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_bids":           resp.GetTotalBids(),
		"lowest_bid_cents":     resp.GetLowestBidCents(),
		"highest_bid_cents":    resp.GetHighestBidCents(),
		"median_bid_cents":     resp.GetMedianBidCents(),
		"offer_accepted_count": resp.GetOfferAcceptedCount(),
		"first_bid_at":         formatTimestamp(resp.GetFirstBidAt()),
		"last_bid_at":          formatTimestamp(resp.GetLastBidAt()),
	})
}

// GetBidCount handles GET /api/v1/jobs/{jobID}/bids/count.
func (h *BidHandler) GetBidCount(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	resp, err := h.bidClient.GetBidCount(r.Context(), &bidv1.GetBidCountRequest{
		JobId: jobID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"count": resp.GetCount(),
	})
}

// GetLiveAuctionState returns the current state of a live auction.
func (h *BidHandler) GetLiveAuctionState(w http.ResponseWriter, r *http.Request) {
	if os.Getenv("ENABLE_LIVE_AUCTION") != "true" {
		writeError(w, http.StatusNotFound, "live auctions not enabled")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job ID required")
		return
	}

	resp, err := h.bidClient.GetLiveAuctionState(r.Context(), &bidv1.GetLiveAuctionStateRequest{
		JobId: jobID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp.GetState())
}

// GetAuctionEvents returns the bid events for a live auction.
func (h *BidHandler) GetAuctionEvents(w http.ResponseWriter, r *http.Request) {
	if os.Getenv("ENABLE_LIVE_AUCTION") != "true" {
		writeError(w, http.StatusNotFound, "live auctions not enabled")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job ID required")
		return
	}

	resp, err := h.bidClient.GetAuctionEvents(r.Context(), &bidv1.GetAuctionEventsRequest{
		JobId: jobID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp.GetEvents())
}

// protoBidToJSON converts a proto Bid to a JSON-friendly map.
func protoBidToJSON(b *bidv1.Bid) map[string]interface{} {
	if b == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":                     b.GetId(),
		"job_id":                 b.GetJobId(),
		"provider_id":            b.GetProviderId(),
		"amount_cents":           b.GetAmountCents(),
		"is_offer_accepted":      b.GetIsOfferAccepted(),
		"status":                 bidStatusToString(b.GetStatus()),
		"original_amount_cents":  b.GetOriginalAmountCents(),
		"created_at":             formatTimestamp(b.GetCreatedAt()),
		"updated_at":             formatTimestamp(b.GetUpdatedAt()),
	}

	if b.GetAwardedAt() != nil {
		result["awarded_at"] = formatTimestamp(b.GetAwardedAt())
	}
	if b.GetWithdrawnAt() != nil {
		result["withdrawn_at"] = formatTimestamp(b.GetWithdrawnAt())
	}

	history := make([]map[string]interface{}, 0, len(b.GetBidHistory()))
	for _, u := range b.GetBidHistory() {
		history = append(history, map[string]interface{}{
			"amount_cents": u.GetAmountCents(),
			"updated_at":   formatTimestamp(u.GetUpdatedAt()),
		})
	}
	result["bid_history"] = history

	return result
}

func bidStatusToString(s bidv1.BidStatus) string {
	switch s {
	case bidv1.BidStatus_BID_STATUS_ACTIVE:
		return "active"
	case bidv1.BidStatus_BID_STATUS_AWARDED:
		return "awarded"
	case bidv1.BidStatus_BID_STATUS_NOT_SELECTED:
		return "not_selected"
	case bidv1.BidStatus_BID_STATUS_WITHDRAWN:
		return "withdrawn"
	case bidv1.BidStatus_BID_STATUS_EXPIRED:
		return "expired"
	default:
		return "unspecified"
	}
}

func stringToBidStatus(s string) bidv1.BidStatus {
	switch s {
	case "active":
		return bidv1.BidStatus_BID_STATUS_ACTIVE
	case "awarded":
		return bidv1.BidStatus_BID_STATUS_AWARDED
	case "not_selected":
		return bidv1.BidStatus_BID_STATUS_NOT_SELECTED
	case "withdrawn":
		return bidv1.BidStatus_BID_STATUS_WITHDRAWN
	case "expired":
		return bidv1.BidStatus_BID_STATUS_EXPIRED
	default:
		return bidv1.BidStatus_BID_STATUS_UNSPECIFIED
	}
}

func hasRole(claims *middleware.Claims, role string) bool {
	for _, r := range claims.Roles {
		if r == role {
			return true
		}
	}
	return false
}
