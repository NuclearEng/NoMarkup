package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	trustv1 "github.com/nomarkup/nomarkup/proto/trust/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// BidHandler handles HTTP endpoints for bids.
//
// db is optional — when non-nil it is used to EMIT in-app notifications
// for bid events and to evaluate the F4 background-check bid gate (flag ON
// requires latest provider_background_checks.status in {clear, consider}).
// A nil pool skips notifications and the bid gate (fail-soft / cannot read
// the flag as explicitly enabled).
type BidHandler struct {
	bidClient      bidv1.BidServiceClient
	contractClient contractv1.ContractServiceClient
	trustClient    trustv1.TrustServiceClient
	userClient     userv1.UserServiceClient
	db             *pgxpool.Pool
	bgGate         backgroundCheckBidGate
}

// NewBidHandler creates a new BidHandler. The optional contractClient is used
// to create a contract row immediately after a bid is awarded — without it,
// awarding a bid just flips status and the customer-accept → contract pipeline
// stays severed. db (optional) is used for notifications and the Checkr bid gate.
func NewBidHandler(bidClient bidv1.BidServiceClient, contractClient contractv1.ContractServiceClient, db *pgxpool.Pool) *BidHandler {
	return &BidHandler{
		bidClient:      bidClient,
		contractClient: contractClient,
		db:             db,
		bgGate:         newBackgroundCheckBidGate(db, nil),
	}
}

// SetTrustClient wires the trust engine into the bid handler so the
// customer-facing bid list can show each bidder's real computed trust score.
// Kept as a setter (rather than a constructor arg) so NewBidHandler's signature
// — referenced across main.go and tests — stays stable. Safe to leave unset: a
// nil trust client makes the trust enrichment a no-op (bids render without a
// trust card), matching the gateway's nil-safe degradation pattern.
func (h *BidHandler) SetTrustClient(c trustv1.TrustServiceClient) {
	h.trustClient = c
}

// SetUserClient wires the user service into the bid handler so the bid list can
// resolve each bidder's display name + avatar (the bidding engine returns empty
// provider fields by design and punts enrichment here). Without it, every bid
// card — and the award confirmation ("Award this job to <name> at $X") — renders
// a blank provider name. Nil-safe: an unset client makes enrichment a no-op.
func (h *BidHandler) SetUserClient(c userv1.UserServiceClient) {
	h.userClient = c
}

// SetCache wires Redis into the background-check bid gate so IsFeatureDisabled
// can hit the flag cache. Nil-safe; leave unset for unit tests.
func (h *BidHandler) SetCache(c *cache.Client) {
	h.bgGate.cache = c
}

// resolveProviderNames resolves a set of provider user ids to their public
// display_name + avatar_url via the user service, deduping ids and resolving
// them in ONE batched round trip (chunked at the server's cap) rather than one
// sequential GetUser per unique provider — a job with 50 unique bidders used to
// cost 50 serial calls and blew the p95 budget on its own. Fail-soft: a nil
// client or a failed lookup simply omits that provider (the card falls back to a
// blank name), never failing the bid list.
func (h *BidHandler) resolveProviderNames(ctx context.Context, ids []string) map[string]map[string]string {
	out := make(map[string]map[string]string)
	if h.userClient == nil {
		return out
	}

	users, err := batchGetUsers(ctx, h.userClient, ids)
	if err != nil {
		// Partial result: the successful chunks are still in users.
		slog.WarnContext(ctx, "bid list: resolve provider names failed", "error", err)
	}
	for id, u := range users {
		out[id] = map[string]string{
			"display_name": u.GetDisplayName(),
			"avatar_url":   u.GetAvatarUrl(),
		}
	}
	return out
}

type placeBidRequest struct {
	AmountCents int64 `json:"amount_cents"`
}

type updateBidRequest struct {
	NewAmountCents int64 `json:"new_amount_cents"`
}

// PlaceBid handles POST /api/v1/jobs/{jobID}/bids.
//
// Durable idempotency (migration 110, listing_bids 056 parity):
//  1. Pre-lookup by (job_id, provider_id, Idempotency-Key) — Redis-miss replay
//     returns the prior row without calling the bidding engine.
//  2. After a successful insert (or AlreadyExists soft-replay), stamp the key
//     onto the bid row so step 1 works on subsequent retries.
//  3. UNIQUE(job_id, provider_id) remains the row-level double-insert guard;
//     matching-amount AlreadyExists soft-replay covers keys not yet stamped.
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

	if code, msg := h.bgGate.deny(r.Context(), claims.UserID); code != 0 {
		writeError(w, code, msg)
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

	idempotencyKey := r.Header.Get("Idempotency-Key")

	// Durable SQL soft-replay: same key + provider + job returns the prior bid
	// without a second gRPC place (survives Redis TTL/flush). True idempotency
	// returns the original result regardless of a (should-not-happen) body drift.
	if prior, found := h.loadBidByIdempotencyKey(r.Context(), jobID, claims.UserID, idempotencyKey); found {
		slog.InfoContext(r.Context(), "place bid durable idempotency replay",
			"job_id", jobID,
			"provider_id", claims.UserID,
			"bid_id", prior["id"],
		)
		writeJSON(w, http.StatusCreated, prior)
		return
	}

	resp, err := h.bidClient.PlaceBid(r.Context(), &bidv1.PlaceBidRequest{
		JobId:       jobID,
		ProviderId:  claims.UserID,
		AmountCents: req.AmountCents,
	})
	if err != nil {
		// Soft-replay sticky Idempotency-Key retries: UNIQUE(job_id, provider_id)
		// means the engine returns AlreadyExists when the provider already has a
		// row. If the active bid amount matches this request, return that bid as
		// success (201) so Redis-miss retries do not surface as 409. Different
		// amounts stay 409 — intentional re-bids use PATCH /bids/{id}.
		if st, ok := status.FromError(err); ok && st.Code() == codes.AlreadyExists {
			if prior, found := h.loadActiveProviderBid(r.Context(), jobID, claims.UserID, req.AmountCents); found {
				if bidID, _ := prior["id"].(string); bidID != "" {
					h.stampBidIdempotencyKey(r.Context(), bidID, claims.UserID, idempotencyKey)
				}
				slog.InfoContext(r.Context(), "place bid idempotency soft-replay",
					"job_id", jobID,
					"provider_id", claims.UserID,
					"amount_cents", req.AmountCents,
					"bid_id", prior["id"],
				)
				writeJSON(w, http.StatusCreated, prior)
				return
			}
		}
		slog.WarnContext(r.Context(), "place bid failed",
			"job_id", jobID,
			"provider_id", claims.UserID,
			"amount_cents", req.AmountCents,
			"error", err,
		)
		writeGRPCError(w, err)
		return
	}

	bidID := resp.GetBid().GetId()
	h.stampBidIdempotencyKey(r.Context(), bidID, claims.UserID, idempotencyKey)

	slog.InfoContext(r.Context(), "bid placed",
		"job_id", jobID,
		"provider_id", claims.UserID,
		"amount_cents", req.AmountCents,
		"bid_id", bidID,
	)

	// Notify the job's customer that a new bid landed on their job. Fail-soft:
	// runs after the bid is committed and swallows all errors so a notification
	// problem never breaks bidding. Recipient is the job owner (never the
	// bidding provider — emitNotification also guards self-notify).
	h.notifyNewBid(r.Context(), jobID, claims.UserID, req.AmountCents)

	writeJSON(w, http.StatusCreated, protoBidToJSON(resp.GetBid()))
}

// loadBidByIdempotencyKey returns the provider's bid for this job stamped with
// the given client Idempotency-Key (migration 110). Empty key or nil db → miss.
func (h *BidHandler) loadBidByIdempotencyKey(ctx context.Context, jobID, providerID, idempotencyKey string) (map[string]interface{}, bool) {
	if h.db == nil || idempotencyKey == "" {
		return nil, false
	}
	var (
		id, st string
		amount int64
	)
	err := h.db.QueryRow(ctx, `
		SELECT id::text, amount_cents, status
		  FROM bids
		 WHERE job_id = $1 AND provider_id = $2 AND idempotency_key = $3
		 LIMIT 1`,
		jobID, providerID, idempotencyKey,
	).Scan(&id, &amount, &st)
	if err != nil {
		return nil, false
	}
	return map[string]interface{}{
		"id":           id,
		"job_id":       jobID,
		"provider_id":  providerID,
		"amount_cents": amount,
		"status":       st,
	}, true
}

// stampBidIdempotencyKey persists the client key on the bid row after a
// successful place (or amount soft-replay). Best-effort / fail-soft: a stamp
// failure still leaves UNIQUE(job_id, provider_id) + amount soft-replay as the
// double-insert guard; Redis middleware covers the happy path.
func (h *BidHandler) stampBidIdempotencyKey(ctx context.Context, bidID, providerID, idempotencyKey string) {
	if h.db == nil || bidID == "" || idempotencyKey == "" {
		return
	}
	// Only stamp when unset, or when replaying the same key (never overwrite a
	// different key that won a concurrent race).
	tag, err := h.db.Exec(ctx, `
		UPDATE bids
		   SET idempotency_key = $1, updated_at = now()
		 WHERE id = $2
		   AND provider_id = $3
		   AND (idempotency_key IS NULL OR idempotency_key = $1)`,
		idempotencyKey, bidID, providerID,
	)
	if err != nil {
		slog.WarnContext(ctx, "place bid: failed to stamp idempotency_key",
			"error", err, "bid_id", bidID)
		return
	}
	_ = tag
}

// loadActiveProviderBid returns the provider's active bid on the job when the
// amount matches. Used for PlaceBid soft-replay after AlreadyExists.
func (h *BidHandler) loadActiveProviderBid(ctx context.Context, jobID, providerID string, amountCents int64) (map[string]interface{}, bool) {
	if h.db == nil {
		return nil, false
	}
	var (
		id, status string
		amount     int64
	)
	err := h.db.QueryRow(ctx, `
		SELECT id::text, amount_cents, status
		  FROM bids
		 WHERE job_id = $1 AND provider_id = $2 AND status = 'active'
		 LIMIT 1`,
		jobID, providerID,
	).Scan(&id, &amount, &status)
	if err != nil || amount != amountCents {
		return nil, false
	}
	return map[string]interface{}{
		"id":           id,
		"job_id":       jobID,
		"provider_id":  providerID,
		"amount_cents": amount,
		"status":       status,
	}, true
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
	// endpoint. That recovery is now genuinely idempotent: contracts carries a
	// partial UNIQUE index on the live job (migration 078) and CreateContract
	// resolves the retry rather than minting a second contract, so re-calling
	// returns the SAME contract instead of forking the escrow lifecycle. A
	// re-call naming a DIFFERENT bid is refused, because returning another
	// provider's contract would be a wrong answer rather than a retry. This
	// mirrors the "saga without compensating action" pattern called out in the
	// task brief.
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
			// A live contract already exists for this job under a DIFFERENT
			// bid. Not a failure to recover from — the job is already
			// contracted, so tell the caller plainly instead of logging it as
			// a broken saga and returning 200.
			if status.Code(contractErr) == codes.AlreadyExists {
				writeError(w, http.StatusConflict, "this job already has an active contract")
				return
			}
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

	// Resolve each bidder's real computed trust score. We dedupe provider IDs
	// across the bid list and do ONE trust lookup per unique provider (a single
	// provider can hold many bids on the same job), not one per bid.
	providerIDs := make([]string, 0, len(resp.GetBids()))
	for _, bwp := range resp.GetBids() {
		if pid := bwp.GetBid().GetProviderId(); pid != "" {
			providerIDs = append(providerIDs, pid)
		}
	}
	trustByProvider := h.batchTrustScores(r.Context(), providerIDs)
	// The bidding engine returns empty provider name/avatar by design; resolve
	// them from the user service so the bid cards and the award confirmation show
	// who is actually bidding (the endpoint is already job-owner-only).
	namesByProvider := h.resolveProviderNames(r.Context(), providerIDs)
	// FR-4.5: verification badges (engine leaves badges empty; enrich from
	// verified documents via user service). Fail-soft when userClient is nil.
	badgesByProvider := h.batchVerificationBadges(r.Context(), providerIDs)

	bids := make([]map[string]interface{}, 0, len(resp.GetBids()))
	for _, bwp := range resp.GetBids() {
		pid := bwp.GetBid().GetProviderId()
		displayName := bwp.GetProviderDisplayName()
		avatarURL := bwp.GetProviderAvatarUrl()
		if n, ok := namesByProvider[pid]; ok {
			if displayName == "" {
				displayName = n["display_name"]
			}
			if avatarURL == "" {
				avatarURL = n["avatar_url"]
			}
		}
		// Prefer engine-supplied badges when present; otherwise use enrichment.
		badges := protoVerificationBadgesToJSON(bwp.GetBadges())
		if len(badges) == 0 {
			badges = badgesByProvider[pid]
		}
		entry := map[string]interface{}{
			"bid":                    protoBidToJSON(bwp.GetBid()),
			"provider_display_name":  displayName,
			"provider_business_name": bwp.GetProviderBusinessName(),
			"provider_avatar_url":    avatarURL,
			"jobs_completed":         bwp.GetJobsCompleted(),
			// Real trust score, fetched above. nil when the provider has no
			// score yet or the trust engine was unreachable (fail-soft) — the
			// BidCard then renders without a trust gauge, never an error.
			"trust_score":    trustByProvider[bwp.GetBid().GetProviderId()],
			"review_summary": nil,
			// FR-4.5 — verified document types for badge chips (may be empty).
			"badges": badges,
		}
		bids = append(bids, entry)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"bids": bids,
	})
}

// batchVerificationBadges loads verified document types per provider (FR-4.5).
// Concurrent fan-out mirrors batchTrustScores; fail-soft on any error.
func (h *BidHandler) batchVerificationBadges(ctx context.Context, providerIDs []string) map[string][]map[string]interface{} {
	out := make(map[string][]map[string]interface{})
	if h.userClient == nil || len(providerIDs) == 0 {
		return out
	}

	unique := make([]string, 0, len(providerIDs))
	seen := make(map[string]struct{}, len(providerIDs))
	for _, id := range providerIDs {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}

	const maxConcurrent = 8
	sem := make(chan struct{}, maxConcurrent)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, id := range unique {
		wg.Add(1)
		go func(providerID string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			resp, err := h.userClient.ListDocuments(ctx, &userv1.ListDocumentsRequest{UserId: providerID})
			if err != nil {
				slog.DebugContext(ctx, "bid list verification badges lookup failed", "error", err, "provider_id", providerID)
				return
			}
			badges := make([]map[string]interface{}, 0)
			for _, d := range resp.GetDocuments() {
				if verificationStatusToString(d.GetStatus()) != "verified" {
					continue
				}
				docType := d.GetDocumentType()
				if docType == "" {
					continue
				}
				entry := map[string]interface{}{
					"document_type": docType,
					"status":        "verified",
				}
				if d.GetExpiresAt() != nil {
					entry["expires_at"] = formatTimestamp(d.GetExpiresAt())
				}
				badges = append(badges, entry)
			}
			if len(badges) == 0 {
				return
			}
			mu.Lock()
			out[providerID] = badges
			mu.Unlock()
		}(id)
	}
	wg.Wait()
	return out
}

// protoVerificationBadgesToJSON maps bid-engine VerificationBadge protos to JSON maps.
// Only verified badges are projected onto the customer ladder.
func protoVerificationBadgesToJSON(badges []*userv1.VerificationBadge) []map[string]interface{} {
	if len(badges) == 0 {
		return nil
	}
	out := make([]map[string]interface{}, 0, len(badges))
	for _, b := range badges {
		if b == nil {
			continue
		}
		status := verificationStatusToString(b.GetStatus())
		if status == "" {
			status = "verified"
		}
		if status != "verified" {
			continue
		}
		docType := b.GetDocumentType()
		if docType == "" {
			continue
		}
		entry := map[string]interface{}{
			"document_type": docType,
			"status":        status,
		}
		if b.GetExpiresAt() != nil {
			entry["expires_at"] = formatTimestamp(b.GetExpiresAt())
		}
		if b.GetVerifiedAt() != nil {
			entry["verified_at"] = formatTimestamp(b.GetVerifiedAt())
		}
		out = append(out, entry)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// batchTrustScores fetches the real computed trust score for a set of provider
// IDs and returns a map keyed by provider ID. The score shape matches the
// public projection emitted everywhere else (provider.go): {overall_score
// (0.0–1.0), tier}, which the web BidCard reads (it multiplies overall_score by
// 100 for the 0–100 gauge). Input IDs are deduped so each unique provider is
// looked up exactly once. Lookups run with a bounded concurrent fan-out (the
// trust proto exposes no batch *query* RPC — BatchComputeTrustScores recomputes
// rather than reads). Fully fail-soft: a nil trust client, a missing score, or
// any lookup error simply omits that provider from the map (caller emits null),
// never failing the bid list.
func (h *BidHandler) batchTrustScores(ctx context.Context, providerIDs []string) map[string]map[string]interface{} {
	out := make(map[string]map[string]interface{})
	if h.trustClient == nil || len(providerIDs) == 0 {
		return out
	}

	// Dedupe while preserving a stable set of unique IDs.
	unique := make([]string, 0, len(providerIDs))
	seen := make(map[string]struct{}, len(providerIDs))
	for _, id := range providerIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}

	const maxConcurrent = 8
	sem := make(chan struct{}, maxConcurrent)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, id := range unique {
		wg.Add(1)
		go func(providerID string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			resp, err := h.trustClient.GetTrustScore(ctx, &trustv1.GetTrustScoreRequest{UserId: providerID})
			if err != nil {
				// NotFound is expected for providers without a score yet.
				slog.DebugContext(ctx, "bid list trust score lookup failed", "error", err, "provider_id", providerID)
				return
			}
			score := resp.GetScore()
			if score == nil {
				return
			}
			summary := map[string]interface{}{
				"overall_score": score.GetOverallScore(),
				"tier":          trustTierToString(score.GetTier()),
			}
			mu.Lock()
			out[providerID] = summary
			mu.Unlock()
		}(id)
	}
	wg.Wait()
	return out
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
			"page":       pg.GetPage(),
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
//
// Dual gate: live_auction DB flag via RequireFlag on the route (migration 013);
// ENABLE_LIVE_AUCTION ops kill switch AND-ed here (middleware.LiveAuctionEnvEnabled).
func (h *BidHandler) GetLiveAuctionState(w http.ResponseWriter, r *http.Request) {
	if !middleware.LiveAuctionEnvEnabled() {
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
//
// Dual gate: live_auction DB flag via RequireFlag on the route (migration 013);
// ENABLE_LIVE_AUCTION ops kill switch AND-ed here (middleware.LiveAuctionEnvEnabled).
func (h *BidHandler) GetAuctionEvents(w http.ResponseWriter, r *http.Request) {
	if !middleware.LiveAuctionEnvEnabled() {
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
		"id":                    b.GetId(),
		"job_id":                b.GetJobId(),
		"provider_id":           b.GetProviderId(),
		"amount_cents":          b.GetAmountCents(),
		"is_offer_accepted":     b.GetIsOfferAccepted(),
		"status":                bidStatusToString(b.GetStatus()),
		"original_amount_cents": b.GetOriginalAmountCents(),
		"created_at":            formatTimestamp(b.GetCreatedAt()),
		"updated_at":            formatTimestamp(b.GetUpdatedAt()),
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
