package handler

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const (
	instantMatchTTL     = 20 * time.Minute
	instantMatchOfferTTL = 15 * time.Minute
)

// instantMatchRecord is the per-job offer broadcast, stored in Redis under
// instant_match:{jobId}. It is created by the customer and discovered by
// every eligible provider via ListProviderOffers.
//
// Status here is the lifecycle of the OFFER itself, not any one provider's
// response:
//   - "pending"  → still open; any invited provider may accept or decline.
//   - "accepted" → a provider has claimed it; it is removed from everyone
//     else's open-offer list. AcceptedBy records the winner.
//
// A single provider declining MUST NOT mutate this record — that would
// block all other invited providers. Per-provider responses live in their
// own keys (see instantMatchResponse / providerResponseKey).
type instantMatchRecord struct {
	Status      string `json:"status"`
	ProviderID  string `json:"provider_id"`
	AcceptedBy  string `json:"accepted_by,omitempty"`
	OfferSentAt string `json:"offer_sent_at"`
	ExpiresAt   string `json:"expires_at"`
	JobTitle    string `json:"job_title,omitempty"`
	AmountCents int64  `json:"amount_cents,omitempty"`
}

// instantMatchResponse is a single provider's response to a job's offer,
// stored per (job, provider) under instant_match:{jobId}:resp:{providerId}.
// Tracking responses per provider keeps one provider's decline from
// affecting any other provider's offer.
type instantMatchResponse struct {
	Status      string `json:"status"` // "accepted" | "declined"
	ProviderID  string `json:"provider_id"`
	RespondedAt string `json:"responded_at"`
}

// jobOfferKey is the per-job offer broadcast key.
func jobOfferKey(jobID string) string {
	return fmt.Sprintf("instant_match:%s", jobID)
}

// providerResponseKey is the per-(job, provider) response key. It is a child
// of the job offer key but uses a distinct ":resp:" segment so the
// "instant_match:*" SCAN in ListProviderOffers can filter it out.
func providerResponseKey(jobID, providerID string) string {
	return fmt.Sprintf("instant_match:%s:resp:%s", jobID, providerID)
}

// InstantMatchHandler handles instant match endpoints.
type InstantMatchHandler struct {
	jobClient      jobv1.JobServiceClient
	bidClient      bidv1.BidServiceClient
	contractClient contractv1.ContractServiceClient
	cache          *cache.Client
}

// NewInstantMatchHandler creates a new InstantMatchHandler. contractClient
// (optional) is used to mint the contract row immediately after an offer is
// accepted — without it, accepting an instant-match offer only awards the bid
// and flips the job to `awarded`, leaving the offer→contract pipeline severed
// (the customer/provider never get a contract to accept). This mirrors
// BidHandler.AwardBid's saga step 2.
func NewInstantMatchHandler(jobClient jobv1.JobServiceClient, bidClient bidv1.BidServiceClient, contractClient contractv1.ContractServiceClient, cacheClient *cache.Client) *InstantMatchHandler {
	return &InstantMatchHandler{jobClient: jobClient, bidClient: bidClient, contractClient: contractClient, cache: cacheClient}
}

// CreateInstantMatch handles POST /api/v1/jobs/{id}/instant-match.
// Requires auth — customer only. Creates a pending instant match record in Redis.
func (h *InstantMatchHandler) CreateInstantMatch(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if !hasRole(claims, "customer") {
		writeError(w, http.StatusForbidden, "customer role required")
		return
	}

	jobID := chi.URLParam(r, "id")
	if !isValidUUID(jobID) {
		writeError(w, http.StatusBadRequest, "invalid job id")
		return
	}

	// Fetch job details to verify ownership and get metadata.
	jobResp, err := h.jobClient.GetJob(r.Context(), &jobv1.GetJobRequest{
		JobId:            jobID,
		RequestingUserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	job := jobResp.GetJob().GetJob()
	if job == nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	// Verify the requesting user owns the job.
	if job.GetCustomerId() != claims.UserID {
		writeError(w, http.StatusForbidden, "you do not own this job")
		return
	}

	// Instant-match accept awards the job at the customer's
	// offer_accepted_cents (see bidding engine accept_offer_price). Without
	// that price set, every provider's accept would fail downstream with
	// "job has no offer accepted price". Reject up front with a clear,
	// customer-actionable message instead of fanning out an offer that can
	// never be accepted.
	if job.OfferAcceptedCents == nil || job.GetOfferAcceptedCents() <= 0 {
		writeError(w, http.StatusBadRequest,
			"set an accept-now price on this job before requesting an instant match")
		return
	}

	now := time.Now().UTC()
	expiresAt := now.Add(instantMatchOfferTTL)

	rec := instantMatchRecord{
		Status:      "pending",
		ProviderID:  "",
		OfferSentAt: now.Format(time.RFC3339),
		ExpiresAt:   expiresAt.Format(time.RFC3339),
		JobTitle:    job.GetTitle(),
		// Show providers the price they will actually be awarded on accept —
		// the offer_accepted_cents the engine uses — NOT starting_bid_cents.
		// Surfacing the starting bid here let a provider accept for a
		// different (lower) amount than the card advertised.
		AmountCents: job.GetOfferAcceptedCents(),
	}

	redisKey := jobOfferKey(jobID)
	h.cache.SetJSON(r.Context(), redisKey, rec, instantMatchTTL)

	slog.Info("instant match created",
		"job_id", jobID,
		"customer_id", claims.UserID,
		"expires_at", expiresAt,
	)

	writeJSON(w, http.StatusOK, map[string]string{
		"status":     "offer_sent",
		"expires_at": expiresAt.Format(time.RFC3339),
	})
}

// ListProviderOffers handles GET /api/v1/provider/offers.
// Requires auth — provider only. Scans Redis for all pending instant_match:* keys.
func (h *InstantMatchHandler) ListProviderOffers(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	// Use the underlying Redis client to scan for matching keys.
	if h.cache == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"offers": []interface{}{}})
		return
	}

	rdb := h.cache.Redis()
	if rdb == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"offers": []interface{}{}})
		return
	}

	ctx := r.Context()
	var keys []string
	var cursor uint64
	for {
		batch, nextCursor, err := rdb.Scan(ctx, cursor, "instant_match:*", 100).Result()
		if err != nil {
			slog.Warn("instant match scan error", "error", err)
			break
		}
		keys = append(keys, batch...)
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	offers := make([]map[string]interface{}, 0, len(keys))
	for _, key := range keys {
		// The SCAN pattern "instant_match:*" also matches the per-provider
		// response keys "instant_match:{jobId}:resp:{providerId}". Those are
		// not offers — skip them.
		if strings.Contains(key, ":resp:") {
			continue
		}

		data, err := rdb.Get(ctx, key).Bytes()
		if err != nil {
			continue
		}

		var rec instantMatchRecord
		if err := json.Unmarshal(data, &rec); err != nil {
			continue
		}

		if rec.Status != "pending" {
			continue
		}

		// Extract jobID from key (format: instant_match:{jobId}).
		jobID := ""
		if len(key) > len("instant_match:") {
			jobID = key[len("instant_match:"):]
		}

		// Hide offers this provider has already responded to (accepted or
		// declined) so a decline removes the offer for THIS provider only.
		var resp instantMatchResponse
		if h.cache.GetJSON(ctx, providerResponseKey(jobID, claims.UserID), &resp) {
			continue
		}

		offers = append(offers, map[string]interface{}{
			"job_id":       jobID,
			"job_title":    rec.JobTitle,
			"expires_at":   rec.ExpiresAt,
			"amount_cents": rec.AmountCents,
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"offers": offers})
}

// AcceptOffer handles POST /api/v1/provider/offers/{jobId}/accept.
// Requires auth — provider only.
func (h *InstantMatchHandler) AcceptOffer(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if !hasRole(claims, "provider") {
		writeError(w, http.StatusForbidden, "provider role required")
		return
	}

	jobID := chi.URLParam(r, "jobId")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	ctx := r.Context()
	offerKey := jobOfferKey(jobID)

	var rec instantMatchRecord
	if !h.cache.GetJSON(ctx, offerKey, &rec) {
		writeError(w, http.StatusNotFound, "offer not found")
		return
	}

	// If this provider already declined this offer, they cannot now accept.
	var prior instantMatchResponse
	if h.cache.GetJSON(ctx, providerResponseKey(jobID, claims.UserID), &prior) {
		if prior.Status == "accepted" {
			writeJSON(w, http.StatusOK, map[string]string{"status": "accepted"})
			return
		}
		writeError(w, http.StatusConflict, "you have already declined this offer")
		return
	}

	// The offer must still be open. A "pending" offer is claimable; an
	// already-"accepted" offer has been won by another provider.
	if rec.Status != "pending" {
		writeError(w, http.StatusConflict, "offer is no longer available")
		return
	}

	// Check if expired.
	expiresAt, err := time.Parse(time.RFC3339, rec.ExpiresAt)
	if err == nil && time.Now().UTC().After(expiresAt) {
		writeError(w, http.StatusGone, "offer has expired")
		return
	}

	// Atomically claim the offer for this provider. Accept (unlike decline) is
	// exclusive: only the first accepter may win the job. The previous
	// GetJSON(pending)-check-then-SetJSON(accepted) sequence was a non-atomic
	// check-then-set — two concurrent accepts could both read "pending" and
	// both proceed (TOCTOU), producing a double-award. ClaimJSON is a single
	// Redis SET ... NX: exactly one caller sets the claim key and wins; every
	// other concurrent accept sees the key already set and is rejected here
	// with 409 Conflict, before ever reaching the bid engine. The engine's
	// FOR UPDATE-locked accept_offer_price is the authoritative backstop.
	claimKey := offerKey + ":claim"
	claim := instantMatchResponse{
		Status:      "accepted",
		ProviderID:  claims.UserID,
		RespondedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if !h.cache.ClaimJSON(ctx, claimKey, claim, instantMatchTTL) {
		// Another provider already claimed this offer. If we are the holder of
		// the claim (e.g. a retried request), fall through; otherwise reject.
		var existing instantMatchResponse
		if h.cache.GetJSON(ctx, claimKey, &existing) && existing.ProviderID != claims.UserID {
			writeError(w, http.StatusConflict, "offer has already been accepted by another provider")
			return
		}
	}

	// Record this provider's acceptance (per-provider) and mark the shared
	// per-job offer record as accepted so it stops being shown to others.
	resp := instantMatchResponse{
		Status:      "accepted",
		ProviderID:  claims.UserID,
		RespondedAt: time.Now().UTC().Format(time.RFC3339),
	}
	h.cache.SetJSON(ctx, providerResponseKey(jobID, claims.UserID), resp, instantMatchTTL)

	rec.Status = "accepted"
	rec.AcceptedBy = claims.UserID
	rec.ProviderID = claims.UserID
	h.cache.SetJSON(ctx, offerKey, rec, instantMatchTTL)

	// Award the job to this provider by calling the bid service's
	// AcceptOfferPrice(jobId, providerId) RPC — the same award path
	// POST /jobs/{id}/bids/accept-offer uses (see bid.go). This creates the
	// awarded bid + contract. AcceptOfferPrice resolves the offer's price
	// server-side, so no price needs to be passed from here.
	bidResp, err := h.bidClient.AcceptOfferPrice(ctx, &bidv1.AcceptOfferPriceRequest{
		JobId:      jobID,
		ProviderId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	awardedBid := bidResp.GetBid()

	// Saga step 2: now that the bid is awarded, mint the contract row so the
	// instant-match accept → contract pipeline is wired end-to-end (same as
	// BidHandler.AwardBid). Without this, accepting an instant-match offer left
	// the job `awarded` with an awarded bid but NO contract — the customer and
	// provider had nothing to accept and no escrow could be funded.
	//
	// We need the job's customer_id (the contract's other party); the accept
	// claims only carry the provider. Fetch the job to resolve it.
	contractID := ""
	if h.contractClient != nil {
		jobResp, jobErr := h.jobClient.GetJob(ctx, &jobv1.GetJobRequest{
			JobId:            jobID,
			RequestingUserId: claims.UserID,
		})
		if jobErr != nil {
			// The bid is already awarded; the contract is missing. Don't 500
			// the provider — log loudly for ops recovery and return the award.
			slog.Error("instant match: failed to load job for contract creation (manual recovery required)",
				"job_id", jobID,
				"provider_id", claims.UserID,
				"bid_id", awardedBid.GetId(),
				"error", jobErr,
			)
		} else if job := jobResp.GetJob().GetJob(); job != nil {
			contractResp, contractErr := h.contractClient.CreateContractFromAward(ctx, &contractv1.CreateContractFromAwardRequest{
				JobId:         jobID,
				BidId:         awardedBid.GetId(),
				CustomerId:    job.GetCustomerId(),
				ProviderId:    awardedBid.GetProviderId(),
				AmountCents:   awardedBid.GetAmountCents(),
				PaymentTiming: commonv1.PaymentTiming_PAYMENT_TIMING_COMPLETION,
			})
			if contractErr != nil {
				slog.Error("instant match: contract creation after accept failed (manual recovery required)",
					"job_id", jobID,
					"provider_id", claims.UserID,
					"bid_id", awardedBid.GetId(),
					"amount_cents", awardedBid.GetAmountCents(),
					"error", contractErr,
				)
			} else {
				contractID = contractResp.GetContract().GetId()
			}
		}
	}

	slog.Info("instant match offer accepted",
		"job_id", jobID,
		"provider_id", claims.UserID,
		"bid_id", awardedBid.GetId(),
		"contract_id", contractID,
	)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "accepted",
		"bid":         protoBidToJSON(awardedBid),
		"contract_id": contractID,
	})
}

// DeclineOffer handles POST /api/v1/provider/offers/{jobId}/decline.
// Requires auth — provider only.
func (h *InstantMatchHandler) DeclineOffer(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if !hasRole(claims, "provider") {
		writeError(w, http.StatusForbidden, "provider role required")
		return
	}

	jobID := chi.URLParam(r, "jobId")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	ctx := r.Context()
	offerKey := jobOfferKey(jobID)

	var rec instantMatchRecord
	if !h.cache.GetJSON(ctx, offerKey, &rec) {
		writeError(w, http.StatusNotFound, "offer not found")
		return
	}

	// A decline is scoped to THIS provider only — we record it in the
	// per-(job, provider) key and deliberately do NOT mutate the shared
	// per-job offer record. Other invited providers keep seeing the offer as
	// pending and can still accept it.
	var prior instantMatchResponse
	if h.cache.GetJSON(ctx, providerResponseKey(jobID, claims.UserID), &prior) {
		if prior.Status == "accepted" {
			writeError(w, http.StatusConflict, "you have already accepted this offer")
			return
		}
		// Already declined — idempotent.
		writeJSON(w, http.StatusOK, map[string]string{"status": "declined"})
		return
	}

	resp := instantMatchResponse{
		Status:      "declined",
		ProviderID:  claims.UserID,
		RespondedAt: time.Now().UTC().Format(time.RFC3339),
	}
	h.cache.SetJSON(ctx, providerResponseKey(jobID, claims.UserID), resp, instantMatchTTL)

	slog.Info("instant match offer declined",
		"job_id", jobID,
		"provider_id", claims.UserID,
	)

	writeJSON(w, http.StatusOK, map[string]string{"status": "declined"})
}

