package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

const (
	instantMatchTTL      = 20 * time.Minute
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
	userClient     userv1.UserServiceClient
	cache          *cache.Client
	db             *pgxpool.Pool
}

// NewInstantMatchHandler creates a new InstantMatchHandler.
//
// contractClient (optional) is used to mint the contract row immediately after
// an offer is accepted — without it, accepting an instant-match offer only
// awards the bid and flips the job to `awarded`, leaving the offer→contract
// pipeline severed (the customer/provider never get a contract to accept).
// This mirrors BidHandler.AwardBid's saga step 2.
//
// userClient + db gate Redis fan-out (ListProviderOffers / AcceptOffer) to
// providers with instant_enabled and (available_now OR currently inside an
// instant_schedule window). db is optional: missing schedule fails soft to
// available_now only; missing userClient fails closed (no offers).
func NewInstantMatchHandler(
	jobClient jobv1.JobServiceClient,
	bidClient bidv1.BidServiceClient,
	contractClient contractv1.ContractServiceClient,
	cacheClient *cache.Client,
	userClient userv1.UserServiceClient,
	db *pgxpool.Pool,
) *InstantMatchHandler {
	return &InstantMatchHandler{
		jobClient:      jobClient,
		bidClient:      bidClient,
		contractClient: contractClient,
		userClient:     userClient,
		cache:          cacheClient,
		db:             db,
	}
}

// providerEligibleForInstantFanOut loads the caller's instant flags + schedule
// and returns whether they should see/accept redis-broadcast offers.
// Fail-closed when the profile cannot be loaded (do not fan out to everyone).
func (h *InstantMatchHandler) providerEligibleForInstantFanOut(ctx context.Context, userID string) bool {
	if h.userClient == nil || userID == "" {
		return false
	}
	resp, err := h.userClient.GetProviderProfile(ctx, &userv1.GetProviderProfileRequest{
		UserId: userID,
	})
	if err != nil {
		slog.Warn("instant match: eligibility profile lookup failed",
			"user_id", userID,
			"error", err,
		)
		return false
	}
	p := resp.GetProfile()
	if p == nil {
		return false
	}
	schedule, loc := h.loadInstantScheduleAndLocation(ctx, userID)
	return isProviderInstantEligible(
		p.GetInstantEnabled(),
		p.GetInstantAvailable(),
		schedule,
		time.Now(),
		loc,
	)
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

	// Fan-out in-app notifications to eligible Instant providers (fail-soft).
	// Geo/category/trust SQL prefilter + schedule gate. Providers still poll inbox.
	matchCtx := h.loadInstantJobMatchContext(r.Context(), jobID, job)
	notified := h.notifyInstantOfferToProviders(
		r.Context(),
		claims.UserID,
		jobID,
		job.GetTitle(),
		rec.AmountCents,
		expiresAt,
		matchCtx,
	)

	slog.Info("instant match created",
		"job_id", jobID,
		"customer_id", claims.UserID,
		"expires_at", expiresAt,
		"providers_notified", notified,
	)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":             "offer_sent",
		"expires_at":         expiresAt.Format(time.RFC3339),
		"providers_notified": notified,
	})
}

// ListProviderOffers handles GET /api/v1/provider/offers.
// Requires auth — provider only. Scans Redis for all pending instant_match:* keys.
// Gates: schedule/available_now, then per-job geo/category/trust (same as notify).
func (h *InstantMatchHandler) ListProviderOffers(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	ctx := r.Context()

	// Eligibility gate before Redis SCAN — providers outside their schedule
	// (and not available_now) must not receive the broadcast.
	if !h.providerEligibleForInstantFanOut(ctx, claims.UserID) {
		writeJSON(w, http.StatusOK, map[string]interface{}{"offers": []interface{}{}})
		return
	}

	// Soft travel ETA: provider service_location × job approximate/service geo.
	// Fail-soft when either side is missing — UI skips the label.
	provLat, provLng, hasProvGeo := h.loadProviderServiceCoords(ctx, claims.UserID)

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

	// Cache per-job match context so SCAN of many keys does not re-query jobs.
	matchByJob := make(map[string]instantJobMatchContext)

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
		if jobID == "" {
			continue
		}

		// Hide offers this provider has already responded to (accepted or
		// declined) so a decline removes the offer for THIS provider only.
		var resp instantMatchResponse
		if h.cache.GetJSON(ctx, providerResponseKey(jobID, claims.UserID), &resp) {
			continue
		}

		// Same geo/category/trust prefilter as notify — close list/notify skew.
		matchCtx, ok := matchByJob[jobID]
		if !ok {
			matchCtx = h.loadInstantJobMatchContext(ctx, jobID, nil)
			matchByJob[jobID] = matchCtx
		}
		if !h.providerMatchesInstantJob(ctx, claims.UserID, matchCtx) {
			continue
		}

		offers = append(offers, buildProviderInstantOffer(
			jobID, rec, matchCtx, provLat, provLng, hasProvGeo,
		))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"offers": offers})
}

// AcceptOffer handles POST /api/v1/provider/offers/{jobId}/accept.
// Requires auth — provider only. Same schedule + geo/category/trust gates as
// ListProviderOffers / notify so accept cannot bypass the prefilter.
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

	if !h.providerEligibleForInstantFanOut(ctx, claims.UserID) {
		writeError(w, http.StatusForbidden,
			"you are not currently available for instant match")
		return
	}

	// Geo/category/trust match — same as notify + list (cannot accept a job
	// outside service radius / category after learning the Redis key).
	matchCtx := h.loadInstantJobMatchContext(ctx, jobID, nil)
	if !h.providerMatchesInstantJob(ctx, claims.UserID, matchCtx) {
		writeError(w, http.StatusForbidden,
			"this instant offer is not available for your service area or categories")
		return
	}

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
	customerID := ""
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
		customerID = job.GetCustomerId()
		if h.contractClient != nil {
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

	// Notify customer that a provider accepted Instant (PRD step 5 minus ETA).
	// Fail-soft; award already stands.
	if customerID != "" {
		h.notifyInstantAcceptedToCustomer(ctx, claims.UserID, customerID, jobID, contractID, awardedBid.GetAmountCents())
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

// instantJobMatchContext is optional geo/category for Instant notify prefilter.
// Missing geo/category fails soft (broader fan-out) rather than aborting Create.
type instantJobMatchContext struct {
	HasGeo      bool
	Lat         float64
	Lng         float64
	CategoryIDs []string // non-empty UUIDs from job category tree
}

// loadInstantJobMatchContext loads job lat/lng from PostGIS and category IDs
// (proto when present, else jobs table). Fail-soft on missing pieces.
func (h *InstantMatchHandler) loadInstantJobMatchContext(
	ctx context.Context,
	jobID string,
	job *jobv1.Job,
) instantJobMatchContext {
	out := instantJobMatchContext{}
	if job != nil {
		if cat := job.GetCategory(); cat != nil && cat.GetId() != "" {
			out.CategoryIDs = append(out.CategoryIDs, cat.GetId())
		}
		if sub := job.GetSubcategory(); sub != nil && sub.GetId() != "" {
			out.CategoryIDs = append(out.CategoryIDs, sub.GetId())
		}
		if st := job.GetServiceType(); st != nil && st.GetId() != "" {
			out.CategoryIDs = append(out.CategoryIDs, st.GetId())
		}
	}
	if h.db == nil || jobID == "" {
		return out
	}
	var lat, lng *float64
	var catID, subID, typeID *string
	err := h.db.QueryRow(ctx, `
		SELECT ST_Y(COALESCE(service_location, approximate_location)),
		       ST_X(COALESCE(service_location, approximate_location)),
		       category_id::text,
		       subcategory_id::text,
		       service_type_id::text
		  FROM jobs
		 WHERE id = $1 AND deleted_at IS NULL`,
		jobID,
	).Scan(&lat, &lng, &catID, &subID, &typeID)
	if err != nil {
		slog.WarnContext(ctx, "instant match: job match-context lookup failed (filters fail-soft)",
			"job_id", jobID,
			"error", err,
		)
		return out
	}
	if lat != nil && lng != nil && !(*lat == 0 && *lng == 0) {
		out.HasGeo = true
		out.Lat = *lat
		out.Lng = *lng
	}
	// Prefer SQL categories when proto lacked them (List/Accept only have jobID).
	if len(out.CategoryIDs) == 0 {
		for _, id := range []*string{catID, subID, typeID} {
			if id != nil && *id != "" {
				out.CategoryIDs = append(out.CategoryIDs, *id)
			}
		}
	}
	return out
}

// providerMatchesInstantJob reports whether providerUserID would pass the same
// geo/category/trust prefilter as Instant notify. Fail-open when db is nil
// (dev/tests without Postgres still exercise schedule gates only).
// Fail-closed for under_review trust when the row can be read.
func (h *InstantMatchHandler) providerMatchesInstantJob(
	ctx context.Context,
	providerUserID string,
	matchCtx instantJobMatchContext,
) bool {
	if providerUserID == "" {
		return false
	}
	if h.db == nil {
		return true
	}
	// No geo and no category constraints → any Instant-enabled provider is fine
	// (notify SQL would only apply trust + enabled; schedule is separate).
	// Still enforce under_review exclusion when we can.
	q := `
		SELECT EXISTS (
		  SELECT 1
		    FROM provider_profiles pp
		    JOIN users u ON u.id = pp.user_id
		    LEFT JOIN trust_scores ts
		      ON ts.user_id = pp.user_id AND ts.role = 'provider'
		   WHERE pp.user_id = $1
		     AND pp.instant_enabled = true
		     AND u.deleted_at IS NULL
		     AND u.status = 'active'
		     AND COALESCE(ts.tier, 'new') <> 'under_review'`
	args := []interface{}{providerUserID}
	argN := 2

	if len(matchCtx.CategoryIDs) > 0 {
		q += fmt.Sprintf(`
		     AND EXISTS (
		       SELECT 1 FROM provider_service_categories psc
		       WHERE psc.provider_id = pp.id
		         AND psc.category_id = ANY($%d::uuid[])
		     )`, argN)
		args = append(args, matchCtx.CategoryIDs)
		argN++
	}
	if matchCtx.HasGeo {
		q += fmt.Sprintf(`
		     AND pp.service_location IS NOT NULL
		     AND ST_DWithin(
		       pp.service_location::geography,
		       ST_SetSRID(ST_MakePoint($%d, $%d), 4326)::geography,
		       COALESCE(pp.service_radius_km, 50) * 1000.0
		     )`, argN, argN+1)
		args = append(args, matchCtx.Lng, matchCtx.Lat)
	}
	q += `
		)`

	var ok bool
	if err := h.db.QueryRow(ctx, q, args...).Scan(&ok); err != nil {
		// Fail-open on SQL errors so a flaky PostGIS path does not blank the inbox.
		slog.WarnContext(ctx, "instant match: provider job-match check failed (fail-open)",
			"provider_id", providerUserID,
			"error", err,
		)
		return true
	}
	return ok
}

// notifyInstantOfferToProviders fans out job_matched in-app notifications to
// Instant-eligible providers. Fail-soft; returns how many recipients were
// notified (eligibility + emit call).
//
// Prefilter (SQL): instant_enabled, active user, not under_review trust,
// optional category match, optional geo radius (provider service_radius_km).
// Then schedule gate via providerEligibleForInstantFanOut (same as List).
func (h *InstantMatchHandler) notifyInstantOfferToProviders(
	ctx context.Context,
	customerID, jobID, jobTitle string,
	amountCents int64,
	expiresAt time.Time,
	matchCtx instantJobMatchContext,
) int {
	if h.db == nil || jobID == "" {
		return 0
	}
	// Cap fan-out so Instant opt-in cannot stall the HTTP request.
	const maxFanOut = 100

	// Build filtered candidate query. Category/geo clauses are optional fail-soft.
	// provider_service_categories.provider_id = provider_profiles.id (not user_id).
	q := `
		SELECT pp.user_id::text
		  FROM provider_profiles pp
		  JOIN users u ON u.id = pp.user_id
		  LEFT JOIN trust_scores ts
		    ON ts.user_id = pp.user_id AND ts.role = 'provider'
		 WHERE pp.instant_enabled = true
		   AND u.deleted_at IS NULL
		   AND u.status = 'active'
		   AND COALESCE(ts.tier, 'new') <> 'under_review'`
	args := []interface{}{}
	argN := 1

	if len(matchCtx.CategoryIDs) > 0 {
		q += fmt.Sprintf(`
		   AND EXISTS (
		     SELECT 1 FROM provider_service_categories psc
		     WHERE psc.provider_id = pp.id
		       AND psc.category_id = ANY($%d::uuid[])
		   )`, argN)
		args = append(args, matchCtx.CategoryIDs)
		argN++
	}
	if matchCtx.HasGeo {
		q += fmt.Sprintf(`
		   AND pp.service_location IS NOT NULL
		   AND ST_DWithin(
		     pp.service_location::geography,
		     ST_SetSRID(ST_MakePoint($%d, $%d), 4326)::geography,
		     COALESCE(pp.service_radius_km, 50) * 1000.0
		   )`, argN, argN+1)
		args = append(args, matchCtx.Lng, matchCtx.Lat)
		argN += 2
	}

	// Prefer nearer providers when the job has geo; otherwise trust-first.
	// Distance reuses the same MakePoint params already bound for ST_DWithin.
	if matchCtx.HasGeo {
		lngParam, latParam := argN-2, argN-1
		q += fmt.Sprintf(`
		 ORDER BY ST_Distance(
		   pp.service_location::geography,
		   ST_SetSRID(ST_MakePoint($%d, $%d), 4326)::geography
		 ) ASC,
		 COALESCE(ts.overall_score, 50.0) DESC,
		 pp.user_id
		 LIMIT $%d`, lngParam, latParam, argN)
	} else {
		q += fmt.Sprintf(`
		 ORDER BY COALESCE(ts.overall_score, 50.0) DESC, pp.user_id
		 LIMIT $%d`, argN)
	}
	args = append(args, maxFanOut)

	rows, err := h.db.Query(ctx, q, args...)
	if err != nil {
		slog.WarnContext(ctx, "instant match: provider fan-out query failed",
			"job_id", jobID,
			"has_geo", matchCtx.HasGeo,
			"category_count", len(matchCtx.CategoryIDs),
			"error", err,
		)
		return 0
	}
	defer rows.Close()

	title := "Instant job available"
	body := "A customer needs help now"
	if jobTitle != "" {
		body = fmt.Sprintf("%s — Instant accept at $%.2f", jobTitle, float64(amountCents)/100)
	} else if amountCents > 0 {
		body = fmt.Sprintf("Instant accept at $%.2f", float64(amountCents)/100)
	}
	actionURL := "/provider/offers"
	_ = expiresAt

	notified := 0
	for rows.Next() {
		var providerID string
		if scanErr := rows.Scan(&providerID); scanErr != nil {
			continue
		}
		if providerID == "" || providerID == customerID {
			continue
		}
		if !h.providerEligibleForInstantFanOut(ctx, providerID) {
			continue
		}
		emitNotification(ctx, h.db, customerID, providerID, "job_matched",
			title, body, actionURL, "job", jobID)
		notified++
	}
	if err := rows.Err(); err != nil {
		slog.WarnContext(ctx, "instant match: provider fan-out rows error",
			"job_id", jobID,
			"error", err,
		)
	}
	slog.InfoContext(ctx, "instant match: notify fan-out complete",
		"job_id", jobID,
		"has_geo", matchCtx.HasGeo,
		"category_count", len(matchCtx.CategoryIDs),
		"providers_notified", notified,
	)
	return notified
}

// notifyInstantAcceptedToCustomer emits offer_accepted / bid_awarded-style
// notice to the job owner when Instant is claimed.
//
// Body is enriched with provider business_name (or display_name) and trust tier
// when userClient/db can load them — e.g. "Acme Plumbing (Trusted) accepted
// your Instant request at $X.". Fail-soft: any lookup error keeps the generic
// body so the award notification still lands.
func (h *InstantMatchHandler) notifyInstantAcceptedToCustomer(
	ctx context.Context,
	providerID, customerID, jobID, contractID string,
	amountCents int64,
) {
	if customerID == "" {
		return
	}
	title := "Instant match accepted"
	body := "A provider accepted your Instant request."
	if amountCents > 0 {
		body = fmt.Sprintf("A provider accepted your Instant request at $%.2f.", float64(amountCents)/100)
	}
	if enriched := h.instantAcceptedNotificationBody(ctx, providerID, amountCents); enriched != "" {
		body = enriched
	}
	actionURL := "/jobs/" + jobID
	entityType, entityID := "job", jobID
	if contractID != "" {
		actionURL = "/contracts/" + contractID
		entityType, entityID = "contract", contractID
	}
	// offer_accepted is a known NOTIFICATION_TYPE; bid_awarded used for auction awards.
	emitNotification(ctx, h.db, providerID, customerID, "offer_accepted",
		title, body, actionURL, entityType, entityID)
}

// instantAcceptedNotificationBody builds an enriched accept body when the
// provider's public name can be resolved. Empty string means "use generic".
func (h *InstantMatchHandler) instantAcceptedNotificationBody(
	ctx context.Context,
	providerID string,
	amountCents int64,
) string {
	name, tierLabel := h.loadInstantProviderNotifyIdentity(ctx, providerID)
	if name == "" {
		return ""
	}
	if tierLabel != "" {
		if amountCents > 0 {
			return fmt.Sprintf("%s (%s) accepted your Instant request at $%.2f.",
				name, tierLabel, float64(amountCents)/100)
		}
		return fmt.Sprintf("%s (%s) accepted your Instant request.", name, tierLabel)
	}
	if amountCents > 0 {
		return fmt.Sprintf("%s accepted your Instant request at $%.2f.",
			name, float64(amountCents)/100)
	}
	return fmt.Sprintf("%s accepted your Instant request.", name)
}

// loadInstantProviderNotifyIdentity resolves a provider's public label + trust
// tier for the customer accept notification. Prefer userClient (profile
// business_name + trust, display_name fallback); fall back to a single SQL
// join when only db is available. Fail-soft on every error path.
func (h *InstantMatchHandler) loadInstantProviderNotifyIdentity(
	ctx context.Context,
	providerID string,
) (name, tierLabel string) {
	if providerID == "" {
		return "", ""
	}

	if h.userClient != nil {
		resp, err := h.userClient.GetProviderProfile(ctx, &userv1.GetProviderProfileRequest{
			UserId: providerID,
		})
		if err != nil {
			slog.WarnContext(ctx, "instant match: provider profile for accept notify failed",
				"provider_id", providerID,
				"error", err,
			)
		} else if p := resp.GetProfile(); p != nil {
			name = strings.TrimSpace(p.GetBusinessName())
			if ts := p.GetTrustScore(); ts != nil {
				tierLabel = trustTierNotifyLabel(ts.GetTier())
			}
		}
		if name == "" {
			if names, nameErr := batchGetDisplayNames(ctx, h.userClient, []string{providerID}); nameErr != nil {
				slog.WarnContext(ctx, "instant match: provider display name for accept notify failed",
					"provider_id", providerID,
					"error", nameErr,
				)
			} else {
				name = strings.TrimSpace(names[providerID])
			}
		}
		if name != "" {
			return name, tierLabel
		}
	}

	if h.db == nil {
		return "", ""
	}
	var businessName, displayName, tier *string
	err := h.db.QueryRow(ctx, `
		SELECT pp.business_name, u.display_name, ts.tier
		  FROM users u
		  LEFT JOIN provider_profiles pp ON pp.user_id = u.id
		  LEFT JOIN trust_scores ts
		    ON ts.user_id = u.id AND ts.role = 'provider'
		 WHERE u.id = $1 AND u.deleted_at IS NULL`,
		providerID,
	).Scan(&businessName, &displayName, &tier)
	if err != nil {
		slog.WarnContext(ctx, "instant match: provider notify identity SQL failed",
			"provider_id", providerID,
			"error", err,
		)
		return "", ""
	}
	if businessName != nil && strings.TrimSpace(*businessName) != "" {
		name = strings.TrimSpace(*businessName)
	} else if displayName != nil {
		name = strings.TrimSpace(*displayName)
	}
	if tier != nil {
		tierLabel = trustTierStringNotifyLabel(*tier)
	}
	return name, tierLabel
}

// trustTierNotifyLabel is the customer-facing trust label used in Instant
// accept notifications (e.g. "Trusted"). Empty for unspecified / under_review.
func trustTierNotifyLabel(t commonv1.TrustTier) string {
	switch t {
	case commonv1.TrustTier_TRUST_TIER_NEW:
		return "New"
	case commonv1.TrustTier_TRUST_TIER_RISING:
		return "Rising"
	case commonv1.TrustTier_TRUST_TIER_TRUSTED:
		return "Trusted"
	case commonv1.TrustTier_TRUST_TIER_TOP_RATED:
		return "Top Rated"
	default:
		return ""
	}
}

// trustTierStringNotifyLabel maps DB tier text to the same customer-facing labels.
func trustTierStringNotifyLabel(tier string) string {
	switch strings.ToLower(strings.TrimSpace(tier)) {
	case "new":
		return "New"
	case "rising":
		return "Rising"
	case "trusted":
		return "Trusted"
	case "top_rated":
		return "Top Rated"
	default:
		return ""
	}
}

// loadProviderServiceCoords returns the provider profile service_location WGS84
// point used for Instant geo matching. ok=false when missing or unreadable.
func (h *InstantMatchHandler) loadProviderServiceCoords(
	ctx context.Context,
	userID string,
) (lat, lng float64, ok bool) {
	if h.db == nil || userID == "" {
		return 0, 0, false
	}
	var plat, plng *float64
	err := h.db.QueryRow(ctx, `
		SELECT ST_Y(service_location), ST_X(service_location)
		  FROM provider_profiles
		 WHERE user_id = $1
		   AND service_location IS NOT NULL`,
		userID,
	).Scan(&plat, &plng)
	if err != nil || plat == nil || plng == nil {
		return 0, 0, false
	}
	if *plat == 0 && *plng == 0 {
		return 0, 0, false
	}
	if *plat < -90 || *plat > 90 || *plng < -180 || *plng > 180 {
		return 0, 0, false
	}
	return *plat, *plng, true
}

// buildProviderInstantOffer assembles one inbox row. When both provider and job
// have coordinates, includes approx_travel_minutes (haversine → urban-drive
// heuristic) plus approx_lat/lng for clients that want MapKit. Label on clients
// must read "approx. travel" — never "live GPS tracking".
func buildProviderInstantOffer(
	jobID string,
	rec instantMatchRecord,
	matchCtx instantJobMatchContext,
	provLat, provLng float64,
	hasProvGeo bool,
) map[string]interface{} {
	offer := map[string]interface{}{
		"job_id":       jobID,
		"job_title":    rec.JobTitle,
		"expires_at":   rec.ExpiresAt,
		"amount_cents": rec.AmountCents,
	}
	if !matchCtx.HasGeo {
		return offer
	}
	offer["approx_lat"] = matchCtx.Lat
	offer["approx_lng"] = matchCtx.Lng
	if hasProvGeo {
		meters := haversineMeters(provLat, provLng, matchCtx.Lat, matchCtx.Lng)
		offer["approx_travel_minutes"] = approxDriveMinutes(meters)
	}
	return offer
}

// approxDriveMinutes converts great-circle meters to a soft urban drive ETA.
// Rule of thumb: ~2 minutes per mile (~30 mph average with lights / routing
// overhead). Bounds [1, 999]. Not live traffic / not GPS tracking.
func approxDriveMinutes(meters float64) int {
	if meters <= 0 || math.IsNaN(meters) || math.IsInf(meters, 0) {
		return 1
	}
	miles := meters / 1609.344
	minutes := int(math.Round(miles * 2.0))
	if minutes < 1 {
		return 1
	}
	if minutes > 999 {
		return 999
	}
	return minutes
}
