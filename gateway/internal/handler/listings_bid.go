package handler

// Buyer-side and seller-side write paths for the goods marketplace.
// Read paths live in listings.go; this file is the bid placement loop +
// "my listings" + create-listing surface.
//
// All routes here require an authenticated user. Bid placement broadcasts
// a `listing:{id}` Redis event consumed by the marketplace spectator
// WebSocket (gateway/internal/handler/marketplace_spectator_ws.go).
//
// Why direct SQL in the gateway: the job service does not yet expose a
// gRPC listing surface (the proto exists but no server impl). The
// transactional bid placement here mirrors the reference implementation
// in services/job/internal/repository/listing_repo.go (FOR UPDATE on the
// listings row + insert into listing_bids + atomic counter update).

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const (
	// snipeWindow: bids placed within this much of the deadline trigger
	// a snipe extension. Matches services/job repo behavior.
	listingSnipeWindow = 60 * time.Second

	// snipeExtension: how much time the auction is bumped on a snipe.
	listingSnipeExtension = 30 * time.Second

	// maxSnipeExtensions caps how many times anti-snipe may bump the deadline.
	// Without it, repeated last-second bids extend the auction forever (griefing
	// / closeout DoS). Matches the Rust forward.rs MAX_SNIPE_EXTENSIONS. After the
	// cap, late bids still register but no longer extend the deadline.
	listingMaxSnipeExtensions = 5

	// listingMinIncrementCents is the legacy fallback. Prefer listingMinIncrementForPrice.
	listingMinIncrementCents int64 = 100
)

// listingMinIncrementForPrice returns the minimum bid step for a given current
// (or starting) price in cents. Scaled tiers match best-in-class expectations
// (eBay/StockX style) and close the corresponding gap in the best-in-class audit.
// Tiers (example):
//   < $50   → $1
//   < $200  → $5
//   < $1k   → $10
//   < $5k   → $25
//   >= $5k  → $50
func listingMinIncrementForPrice(priceCents int64) int64 {
	switch {
	case priceCents < 5_000:
		return 100
	case priceCents < 20_000:
		return 500
	case priceCents < 100_000:
		return 1_000
	case priceCents < 500_000:
		return 2_500
	default:
		return 5_000
	}
}

const (
	// listingPlatformFeeBps is the total seller-side marketplace fee in basis
	// points (MON-20). Product rate card is 8% platform + 2% guarantee =
	// 10% total (1000 bps). listing_orders only has a single fee_cents column
	// (no split platform/guarantee fields on goods orders), so we store the
	// combined 1000 bps. Services-side jobs use separate platform_fee_cents +
	// guarantee_fee_cents (800+200); goods use this single total.
	// Must match services/job listing_repo closeout fee.
	listingPlatformFeeBps int64 = 1000 // 8% platform + 2% guarantee
)

// listingPlatformFeeCents computes the platform fee on a closeout amount,
// rounding any fractional cent UP (so the platform never under-charges).
// Mirrors the auction-close computation exactly. amountCents must be > 0;
// a non-positive amount yields 0.
func listingPlatformFeeCents(amountCents int64) int64 {
	if amountCents <= 0 {
		return 0
	}
	fee := amountCents * listingPlatformFeeBps / 10000
	if amountCents*listingPlatformFeeBps%10000 != 0 {
		fee++
	}
	return fee
}

type placeListingBidRequest struct {
	AmountCents    int64  `json:"amount_cents"`
	MaxBidCents    *int64 `json:"max_bid_cents,omitempty"`
}

// autoBidStep is one rung in the proxy-bid cascade. The cascade is
// computed in-memory by computeAutoBidCascade, then each step is
// inserted into listing_bids by placeBidTx in order.
type autoBidStep struct {
	BidderID    string
	AmountCents int64
	// MaxBidCents is the bidder's confidential ceiling, persisted with
	// the row so future cascades can find it. nil = no ceiling.
	MaxBidCents *int64
}

// cascadeOutcome describes the final state after the auto-bid loop.
type cascadeOutcome struct {
	Steps        []autoBidStep
	FinalAmount  int64
	FinalBidder  string
}

// computeAutoBidCascade simulates the eBay-style proxy bidding loop in
// a single pure function so it is straightforward to unit test.
//
// Invariants:
//   - newBidder always places the first step at newBidAmount (their
//     visible bid). newBidderMax (if non-nil) is their confidential
//     ceiling and must be >= newBidAmount.
//   - competingMax (if non-nil) belongs to competingBidderID, the
//     highest standing competing max-bidder on this listing. If
//     competingBidderID == "" or competingMax == nil, no competitor
//     auto-bids — the cascade is just the new bid.
//   - increment is the minimum bid step in cents.
//   - The loop is capped at maxIterations steps to defend against
//     pathological inputs.
//
// Final-state semantics match eBay: the higher max wins, at a price of
// min(winnerMax, loserMax + increment). When the maxes tie, the earlier
// bidder (competing) keeps the lead at their max.
//
// Implementation note: rather than simulate increment-by-increment
// (which yields off-by-one results when the loser's max isn't aligned
// to the increment grid), we compute the analytic outcome directly,
// then materialize a small step trail (visible bid → counter → final
// raise) so the bid history reflects what actually happened.
func computeAutoBidCascade(
	currentTop int64,
	increment int64,
	newBidderID string,
	newBidAmount int64,
	newBidderMax *int64,
	competingBidderID string,
	competingMax *int64,
	maxIterations int,
) cascadeOutcome {
	if increment <= 0 {
		increment = listingMinIncrementForPrice(currentTop)
	}
	if maxIterations <= 0 {
		maxIterations = 50
	}
	_ = currentTop // documented invariant: newBidAmount > currentTop is enforced upstream.

	steps := make([]autoBidStep, 0, 3)
	// Step 1: the buyer's own visible bid is always inserted.
	steps = append(steps, autoBidStep{
		BidderID:    newBidderID,
		AmountCents: newBidAmount,
		MaxBidCents: newBidderMax,
	})

	// No competitor with a max → cascade ends after the visible bid.
	if competingBidderID == "" || competingMax == nil {
		return cascadeOutcome{
			Steps:       steps,
			FinalAmount: newBidAmount,
			FinalBidder: newBidderID,
		}
	}

	// Effective new-bidder ceiling (nil = no autobid headroom).
	effectiveNewMax := newBidAmount
	if newBidderMax != nil {
		effectiveNewMax = *newBidderMax
	}
	competingCeiling := *competingMax

	// Decide who wins.
	//
	// Case A — competing has higher max (or tie, where competing
	// retains the lead): competing wins. Price = min(competingMax,
	// effectiveNewMax + increment). If competingMax can't reach
	// newBidAmount + increment they cannot even match the visible bid,
	// in which case newBidder wins outright at newBidAmount.
	//
	// Case B — newBidder has the strictly higher max: newBidder wins.
	// Price = min(newBidderMax, competingMax + increment).
	if competingCeiling >= effectiveNewMax {
		// Competing wins (ties favor incumbent).
		needed := newBidAmount + increment
		if competingCeiling < needed {
			// Competing can't beat the visible bid; new bidder wins.
			return cascadeOutcome{
				Steps:       steps,
				FinalAmount: newBidAmount,
				FinalBidder: newBidderID,
			}
		}
		price := effectiveNewMax + increment
		if price > competingCeiling {
			price = competingCeiling
		}
		// At minimum price must beat the visible bid by one increment.
		if price < needed {
			price = needed
		}
		steps = append(steps, autoBidStep{
			BidderID:    competingBidderID,
			AmountCents: price,
			MaxBidCents: &competingCeiling,
		})
		// Cap step count just in case (defensive, never reached today).
		if len(steps) > maxIterations {
			steps = steps[:maxIterations]
		}
		return cascadeOutcome{
			Steps:       steps,
			FinalAmount: price,
			FinalBidder: competingBidderID,
		}
	}

	// Case B: newBidder has strictly higher max → newBidder wins.
	// First materialize competing's defensive raise to their max so
	// the bid history reflects the volley. Then newBidder posts the
	// final winning bid one increment above competing's max.
	if competingCeiling > newBidAmount {
		steps = append(steps, autoBidStep{
			BidderID:    competingBidderID,
			AmountCents: competingCeiling,
			MaxBidCents: &competingCeiling,
		})
	}
	price := competingCeiling + increment
	if price > effectiveNewMax {
		price = effectiveNewMax
	}
	if price <= newBidAmount {
		// Already covered by the visible bid — nothing more to insert.
		return cascadeOutcome{
			Steps:       steps,
			FinalAmount: steps[len(steps)-1].AmountCents,
			FinalBidder: steps[len(steps)-1].BidderID,
		}
	}
	steps = append(steps, autoBidStep{
		BidderID:    newBidderID,
		AmountCents: price,
		MaxBidCents: newBidderMax,
	})
	if len(steps) > maxIterations {
		steps = steps[:maxIterations]
	}
	return cascadeOutcome{
		Steps:       steps,
		FinalAmount: price,
		FinalBidder: newBidderID,
	}
}

// PlaceListingBid handles POST /api/v1/listings/{id}/bid.
//
// Concurrency safety: SELECT … FOR UPDATE on the listings row serializes
// concurrent bids on the same auction. The increment check happens AFTER
// the lock is acquired so racing bids are forced to compare against a
// committed current_bid_cents.
func (h *ListingsHandler) PlaceListingBid(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	var req placeListingBidRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if msg := validateMoneyCents("amount_cents", req.AmountCents); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	// max_bid_cents is optional; if present it must be >= the visible bid and
	// within the same sane upper bound as the bid itself.
	if req.MaxBidCents != nil {
		if msg := validateMoneyCents("max_bid_cents", *req.MaxBidCents); msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		if *req.MaxBidCents < req.AmountCents {
			writeError(w, http.StatusBadRequest, "max_bid_cents must be >= amount_cents")
			return
		}
	}

	// Capture the previous high bidder BEFORE the cascade runs so the
	// notification scheduler can fan an outbid event out to them. This is
	// best-effort: a missed lookup just suppresses the notify; a slightly
	// stale value is corrected by the next bid's outbid event.
	var prevBidderID string
	{
		var prev pgtype.Text
		_ = h.db.QueryRow(r.Context(),
			`SELECT current_bidder_id::text FROM listings WHERE id = $1`, id,
		).Scan(&prev)
		if prev.Valid {
			prevBidderID = prev.String
		}
	}

	// Idempotency guard (CLAUDE.md §6): an optional client-supplied
	// Idempotency-Key dedups rapid double-submits. Unlike the min-increment
	// rule (which only catches identical-amount resubmits), this catches a
	// double-click that fires two DISTINCT increasing amounts. When the key
	// is empty (older clients) behavior is unchanged — the bid is still
	// serialized by the FOR UPDATE lock + min-increment in placeBidTx. The
	// dedup runs inside that same lock so it is race-free.
	idempotencyKey := r.Header.Get("Idempotency-Key")

	bid, current, bidderCount, snipe, newEnds, requiresBond, bondCents, errCode, errMsg := h.placeBidTx(
		r.Context(), id, claims.UserID, req.AmountCents, req.MaxBidCents, idempotencyKey,
	)
	if errCode != 0 {
		writeError(w, errCode, errMsg)
		return
	}

	// ── Bid bond pre-auth (Wave 4 anti-fraud) ─────────────────────────
	// First-time bidders must post a Stripe SetupIntent-based bond before
	// their first bid is accepted. eBay/Whatnot ship this; we didn't.
	//
	// The check is intentionally cheap: zero history rows in 'released'
	// status AND no 'authorized' bond covering ≥10% of the intended bid
	// for this listing → return 402 with a `requires_bid_bond` flag and
	// the bond amount. The web client follows up with POST /bid-bond to
	// mint the SetupIntent + persist the row, confirms it via Stripe
	// Elements, calls /bid-bond/confirm to flip 'pending'→'authorized',
	// and retries the bid.
	//
	// The gate runs INSIDE placeBidTx, AFTER the listing-existence /
	// seller-self / auction-state / increment validations and BEFORE any
	// bid rows are written (the tx is rolled back when it trips). This way
	// a user is only asked for a bond once their bid is otherwise valid —
	// a below-increment bid 400s, a self-bid 403s, an ended auction 409s,
	// and a nonexistent listing 404s, instead of all returning a
	// misleading 402.
	if requiresBond {
		writeJSON(w, http.StatusPaymentRequired, map[string]interface{}{
			"requires_bid_bond": true,
			"bond_amount_cents": bondCents,
			"error":             "a bid bond is required before your first bid on this listing",
		})
		return
	}

	// Suppress the outbid event when the "previous" bidder ends up being
	// the new winner anyway (e.g. raising their own max).
	if prevBidderID == claims.UserID || prevBidderID == bid.BidderID {
		prevBidderID = ""
	}

	// Publish to spectator stream. Best-effort — bid is already committed.
	// Publish the FINAL cascade outcome so spectators see the resolved
	// price, not the buyer's visible bid.
	h.publishBidPlaced(r.Context(), id, bid.BidderID, current, snipe, newEnds, prevBidderID)

	slog.InfoContext(r.Context(), "listing bid placed",
		"listing_id", id,
		"bidder_id", claims.UserID,
		"amount_cents", req.AmountCents,
		"final_amount_cents", current,
		"final_bidder_id", bid.BidderID,
		"snipe_extension", snipe,
	)

	resp := map[string]interface{}{
		"bid":                     bid,
		"current_bid_cents":       current,
		"bidder_count":            bidderCount,
		"snipe_extension_applied": snipe,
		"new_auction_ends_at":     formatRFC3339OrNull(newEnds),
	}
	writeJSON(w, http.StatusCreated, resp)
}

// placeBidTx runs the bid placement inside a transaction. It also runs
// the eBay-style proxy-bidding cascade: if any prior distinct bidder
// has a confidential `max_bid_cents` that exceeds the visible bid, the
// auction inserts auto-bids on their behalf, ping-ponging until one
// side runs out of headroom. Loop is bounded at 50 iterations.
//
// Returns:
//   - bid:        JSON for the LAST bid in the cascade (the row that
//                 currently holds 'active' status).
//   - currentCents: final price after the cascade (== bid.AmountCents).
//   - bidderCount: distinct bidder count post-insert.
//   - snipeApplied / newEnds: snipe extension based on the final bid
//                 timestamp (which is the cascade's last step).
//
// On validation failure, returns errCode != 0 and an errMsg suitable for
// the user.
//
// Idempotency: when idempotencyKey is non-empty, the buyer's visible bid
// row is persisted with that key and a partial UNIQUE index on
// (listing_id, bidder_id, idempotency_key) (migration 056) prevents a
// duplicate. The dedup probe runs inside the FOR UPDATE listings-row lock,
// so a concurrent double-submit is serialized: the first wins, the second
// sees the prior row and returns the SAME result (no second bid recorded).
// An empty key skips the guard entirely — legacy clients are unaffected.
func (h *ListingsHandler) placeBidTx(ctx context.Context, listingID, bidderID string, amountCents int64, maxBidCents *int64, idempotencyKey string) (
	bid listingBidJSON, currentCents int64, bidderCount int, snipeApplied bool, newEnds time.Time, requiresBond bool, bondCents int64, errCode int, errMsg string,
) {
	tx, err := h.db.Begin(ctx)
	if err != nil {
		return bid, 0, 0, false, time.Time{}, false, 0, http.StatusInternalServerError, "failed to start tx"
	}
	defer tx.Rollback(ctx)

	var (
		sellerID         string
		status           string
		startCents       int64
		currentBidCents  pgtype.Int8
		minIncrement     pgtype.Int8
		auctionEndsAt    pgtype.Timestamptz
		snipeCount       int
	)
	err = tx.QueryRow(ctx, `
		SELECT seller_id, status, starting_price_cents,
			current_bid_cents,
			auction_ends_at, COALESCE(snipe_extension_count, 0)
		  FROM listings WHERE id = $1 FOR UPDATE`, listingID,
	).Scan(&sellerID, &status, &startCents, &currentBidCents,
		&auctionEndsAt, &snipeCount)
	_ = minIncrement // legacy schema does not yet have a per-listing column
	if errors.Is(err, pgx.ErrNoRows) {
		return bid, 0, 0, false, time.Time{}, false, 0, http.StatusNotFound, "listing not found"
	}
	if err != nil {
		slog.ErrorContext(ctx, "place bid: select for update failed", "error", err, "listing_id", listingID)
		return bid, 0, 0, false, time.Time{}, false, 0, http.StatusInternalServerError, "failed to lock listing"
	}

	// ── Idempotency dedup ─────────────────────────────────────────────
	// Now holding the listings-row lock (so a concurrent double-submit is
	// serialized behind us), check whether this exact (listing_id,
	// bidder_id, idempotency_key) already produced a bid. If so, return the
	// PRIOR result and do NOT insert a second bid. The probe is the only
	// thing that runs before the validation gates, so a replay short-circuits
	// even if the auction state has since changed (e.g. the auction ended
	// after the original bid committed). Empty key → skip the guard.
	if idempotencyKey != "" {
		var (
			priorID        string
			priorAmount    int64
			priorCreatedAt time.Time
			priorStatus    string
		)
		err = tx.QueryRow(ctx, `
			SELECT id, amount_cents, created_at, status
			  FROM listing_bids
			 WHERE listing_id = $1 AND bidder_id = $2 AND idempotency_key = $3
			 LIMIT 1`, listingID, bidderID, idempotencyKey,
		).Scan(&priorID, &priorAmount, &priorCreatedAt, &priorStatus)
		switch {
		case err == nil:
			// Replay: rebuild the response from the listing's current state +
			// the stored bid. No rows are written; the deferred Rollback
			// releases the lock cleanly.
			var displayName sql.NullString
			if e := tx.QueryRow(ctx,
				`SELECT display_name FROM users WHERE id=$1`, bidderID,
			).Scan(&displayName); e != nil {
				displayName = sql.NullString{String: "Bidder", Valid: true}
			}
			cur := startCents
			if currentBidCents.Valid {
				cur = currentBidCents.Int64
			}
			if e := tx.QueryRow(ctx, `
				SELECT COUNT(DISTINCT bidder_id) FROM listing_bids WHERE listing_id=$1`,
				listingID).Scan(&bidderCount); e != nil {
				bidderCount = 0
			}
			endsAt := time.Time{}
			if auctionEndsAt.Valid {
				endsAt = auctionEndsAt.Time
			}
			bid = listingBidJSON{
				ID:                priorID,
				ListingID:         listingID,
				BidderID:          bidderID,
				BidderDisplayName: displayName.String,
				AmountCents:       priorAmount,
				IsWinning:         priorStatus == "active",
				CreatedAt:         priorCreatedAt,
			}
			slog.InfoContext(ctx, "listing bid idempotency replay",
				"listing_id", listingID, "bidder_id", bidderID, "bid_id", priorID)
			return bid, cur, bidderCount, false, endsAt, false, 0, 0, ""
		case errors.Is(err, pgx.ErrNoRows):
			// First time we've seen this key — fall through to place the bid.
		default:
			slog.ErrorContext(ctx, "place bid: idempotency lookup failed", "error", err, "listing_id", listingID)
			return bid, 0, 0, false, time.Time{}, false, 0, http.StatusInternalServerError, "idempotency lookup failed"
		}
	}

	if sellerID == bidderID {
		return bid, 0, 0, false, time.Time{}, false, 0, http.StatusForbidden, "sellers cannot bid on their own listing"
	}
	if status != "active" {
		return bid, 0, 0, false, time.Time{}, false, 0, http.StatusConflict, "auction is not active"
	}
	if !auctionEndsAt.Valid || auctionEndsAt.Time.Before(time.Now()) {
		return bid, 0, 0, false, time.Time{}, false, 0, http.StatusConflict, "auction has ended"
	}

	// Increment validation.
	prevCents := startCents
	if currentBidCents.Valid {
		prevCents = currentBidCents.Int64
	}
	inc := listingMinIncrementForPrice(prevCents)
	required := startCents
	if currentBidCents.Valid {
		required = prevCents + inc
	}
	if amountCents < required {
		return bid, prevCents, 0, false, auctionEndsAt.Time, false, 0,
			http.StatusBadRequest,
			fmt.Sprintf("bid must be at least %d cents", required)
	}
	// Confidential max validation: if the buyer set a ceiling it must be
	// strictly greater than the current top (otherwise it's pointless
	// and would never trigger a cascade).
	if maxBidCents != nil {
		if *maxBidCents < amountCents {
			return bid, prevCents, 0, false, auctionEndsAt.Time, false, 0,
				http.StatusBadRequest, "max_bid_cents must be >= amount_cents"
		}
		if currentBidCents.Valid && *maxBidCents <= prevCents {
			return bid, prevCents, 0, false, auctionEndsAt.Time, false, 0,
				http.StatusBadRequest, "max_bid_cents must exceed current bid"
		}
	}

	// ── Bid bond gate (Wave 4 anti-fraud) ─────────────────────────────
	// Only now, with the bid established as otherwise valid (listing
	// exists, auction active + not ended, bidder is not the seller, amount
	// clears the increment, max is well-formed), do we ask first-time
	// bidders to post a bond. Running it here — after the validations and
	// before any bid rows are written — means a below-increment bid 400s, a
	// self-bid 403s, an ended auction 409s, and a missing listing 404s,
	// rather than every one of them returning a misleading 402.
	//
	// The check reads bid_bonds on h.db (outside this tx); the tx holds the
	// listings row lock and is rolled back via the deferred Rollback when
	// the gate trips. No bid rows have been inserted yet.
	if needsBond, requiredBond := h.bidBondCheck(ctx, bidderID, listingID, amountCents); needsBond {
		return bid, prevCents, 0, false, auctionEndsAt.Time, true, requiredBond, 0, ""
	}

	// Look up the highest standing competing max-bid (a different
	// bidder, status='active', max_bid_cents IS NOT NULL). The active-
	// max partial index (migration 038) keeps this fast.
	var (
		competingBidder string
		competingMaxRaw pgtype.Int8
	)
	err = tx.QueryRow(ctx, `
		SELECT bidder_id, max_bid_cents
		  FROM listing_bids
		 WHERE listing_id=$1
		   AND bidder_id != $2
		   AND max_bid_cents IS NOT NULL
		   AND status='active'
		 ORDER BY max_bid_cents DESC, created_at ASC
		 LIMIT 1`, listingID, bidderID,
	).Scan(&competingBidder, &competingMaxRaw)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		slog.ErrorContext(ctx, "place bid: lookup competing max failed", "error", err)
		return bid, 0, 0, false, time.Time{}, false, 0, http.StatusInternalServerError, "lookup competing max failed"
	}
	var competingMax *int64
	if competingMaxRaw.Valid {
		v := competingMaxRaw.Int64
		competingMax = &v
	} else {
		competingBidder = ""
	}

	// Compute the cascade outcome before touching any rows.
	cascade := computeAutoBidCascade(
		prevCents,
		listingMinIncrementForPrice(prevCents),
		bidderID,
		amountCents,
		maxBidCents,
		competingBidder,
		competingMax,
		50, // hard ceiling
	)

	// Demote the previous high bid (if any). All cascade rows then
	// insert with status='active'; we'll demote the non-final ones
	// after insertion.
	if currentBidCents.Valid {
		if _, err := tx.Exec(ctx, `
			UPDATE listing_bids SET status='outbid'
			 WHERE listing_id=$1 AND status='active'`, listingID); err != nil {
			slog.ErrorContext(ctx, "place bid: demote outbid failed", "error", err)
			return bid, 0, 0, false, time.Time{}, false, 0, http.StatusInternalServerError, "demote failed"
		}
	}

	// Insert each cascade step. Only the LAST one stays 'active'; all
	// earlier steps are immediately marked 'outbid'.
	type insertedStep struct {
		ID          string
		BidderID    string
		AmountCents int64
		CreatedAt   time.Time
		MaxBidCents *int64
	}
	inserted := make([]insertedStep, 0, len(cascade.Steps))
	for idx, step := range cascade.Steps {
		var newID string
		var createdAt time.Time
		status := "active"
		if idx < len(cascade.Steps)-1 {
			status = "outbid"
		}
		var maxArg interface{}
		if step.MaxBidCents != nil {
			maxArg = *step.MaxBidCents
		} else {
			maxArg = nil
		}
		// Persist the idempotency key ONLY on the buyer's own visible bid
		// (step 0). Proxy-cascade counter-bids belong to other bidders /
		// the auction engine and must not carry this buyer's key — and the
		// partial UNIQUE index would reject a second non-NULL key for the
		// same (listing_id, bidder_id) anyway.
		var keyArg interface{}
		if idempotencyKey != "" && step.BidderID == bidderID && idx == 0 {
			keyArg = idempotencyKey
		} else {
			keyArg = nil
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO listing_bids (listing_id, bidder_id, amount_cents, max_bid_cents, status, idempotency_key, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, now())
			RETURNING id, created_at`,
			listingID, step.BidderID, step.AmountCents, maxArg, status, keyArg,
		).Scan(&newID, &createdAt); err != nil {
			slog.ErrorContext(ctx, "place bid: insert cascade step failed", "error", err, "step_index", idx)
			return bid, 0, 0, false, time.Time{}, false, 0, http.StatusInternalServerError, "insert bid failed"
		}
		inserted = append(inserted, insertedStep{
			ID:          newID,
			BidderID:    step.BidderID,
			AmountCents: step.AmountCents,
			CreatedAt:   createdAt,
			MaxBidCents: step.MaxBidCents,
		})
	}
	if len(inserted) == 0 {
		// Defensive: cascade always inserts at least the visible bid.
		return bid, 0, 0, false, time.Time{}, false, 0, http.StatusInternalServerError, "cascade produced no bids"
	}

	// Snipe extension: based on the LAST cascade step's wall clock. Capped at
	// listingMaxSnipeExtensions so repeated last-second bids can't keep the
	// auction open indefinitely; past the cap the bid still lands but the
	// deadline is left alone.
	now := time.Now()
	endsAt := auctionEndsAt.Time
	snipeApplied = false
	if endsAt.Sub(now) <= listingSnipeWindow && snipeCount < listingMaxSnipeExtensions {
		endsAt = endsAt.Add(listingSnipeExtension)
		snipeApplied = true
		snipeCount++
	}

	finalStep := inserted[len(inserted)-1]
	finalAmount := finalStep.AmountCents
	finalBidder := finalStep.BidderID

	// bid_count is a user-visible "heat" signal counting the bidders on this
	// listing — NOT the number of listing_bids rows. The auto-bid cascade
	// inserts >1 row per visible placement (a proxy counter-bid raises an
	// existing competitor whose original bid is already counted), so counting
	// rows (len(inserted)) inflates and drifts. We instead recompute the
	// canonical definition — distinct, non-retracted bidders — so this path
	// and RetractBid agree exactly. Computed inside the FOR UPDATE tx, so it
	// is consistent under concurrent bids/retractions.
	if _, err := tx.Exec(ctx, `
		UPDATE listings
		   SET current_bid_cents=$2, current_bidder_id=$3,
		       bid_count=(SELECT COUNT(DISTINCT bidder_id) FROM listing_bids
		                   WHERE listing_id=$1 AND retracted_at IS NULL),
		       auction_ends_at=$4, snipe_extension_count=$5,
		       updated_at=now()
		 WHERE id=$1`,
		listingID, finalAmount, finalBidder, endsAt, snipeCount,
	); err != nil {
		slog.ErrorContext(ctx, "place bid: update listing failed", "error", err)
		return bid, 0, 0, false, time.Time{}, false, 0, http.StatusInternalServerError, "update listing failed"
	}

	// Get the FINAL bidder's display name for the response (this is
	// who currently holds the auction — may be the original buyer or
	// the auto-bid competitor, whichever has the highest max).
	var displayName sql.NullString
	if err := tx.QueryRow(ctx,
		`SELECT display_name FROM users WHERE id=$1`, finalBidder,
	).Scan(&displayName); err != nil {
		// Non-fatal — fall back to "Bidder".
		displayName = sql.NullString{String: "Bidder", Valid: true}
	}

	// Refresh bidder count.
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(DISTINCT bidder_id) FROM listing_bids WHERE listing_id=$1`,
		listingID).Scan(&bidderCount); err != nil {
		bidderCount = 0
	}

	if err := tx.Commit(ctx); err != nil {
		slog.ErrorContext(ctx, "place bid: commit failed", "error", err)
		return bid, 0, 0, false, time.Time{}, false, 0, http.StatusInternalServerError, "commit failed"
	}

	bid = listingBidJSON{
		ID:                finalStep.ID,
		ListingID:         listingID,
		BidderID:          finalStep.BidderID,
		BidderDisplayName: displayName.String,
		AmountCents:       finalStep.AmountCents,
		IsWinning:         true,
		CreatedAt:         finalStep.CreatedAt,
	}
	return bid, finalAmount, bidderCount, snipeApplied, endsAt, false, 0, 0, ""
}

// publishBidPlaced fires the spectator-stream event. Best-effort.
//
// When prevBidderID is non-empty, also fires an outbid event on
// `notify:outbid:{prevBidderID}` — the notification scheduler subscribes
// to that channel pattern and queues a `bid_outbid` push/email.
func (h *ListingsHandler) publishBidPlaced(ctx context.Context, listingID, bidderID string, amountCents int64, snipe bool, newEnds time.Time, prevBidderID string) {
	rdb := h.redisClient()
	if rdb == nil {
		return
	}
	payload := map[string]interface{}{
		"type":                "bid_placed",
		"listing_id":          listingID,
		"bidder_id":           bidderID,
		"amount_cents":        amountCents,
		"snipe_extension":     snipe,
		"new_auction_ends_at": newEnds.UTC().Format(time.RFC3339),
		"timestamp":           time.Now().UTC().Format(time.RFC3339Nano),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	channel := fmt.Sprintf("listing:%s", listingID)
	if err := rdb.Publish(ctx, channel, data).Err(); err != nil {
		slog.WarnContext(ctx, "publish bid_placed failed",
			"listing_id", listingID, "error", err)
	}

	// Outbid fan-out: the notification scheduler in services/notification
	// subscribes to `notify:outbid:*` and queues a `bid_outbid` notice.
	if prevBidderID != "" {
		outbidPayload := map[string]interface{}{
			"type":                "outbid",
			"listing_id":          listingID,
			"prev_bidder_id":      prevBidderID,
			"new_bidder_id":       bidderID,
			"amount_cents":        amountCents,
			"new_auction_ends_at": newEnds.UTC().Format(time.RFC3339),
			"timestamp":           time.Now().UTC().Format(time.RFC3339Nano),
		}
		if outbidData, oerr := json.Marshal(outbidPayload); oerr == nil {
			outChan := fmt.Sprintf("notify:outbid:%s", prevBidderID)
			if err := rdb.Publish(ctx, outChan, outbidData).Err(); err != nil {
				slog.WarnContext(ctx, "publish outbid failed",
					"prev_bidder_id", prevBidderID, "error", err)
			}
		}
	}
}

func formatRFC3339OrNull(t time.Time) interface{} {
	if t.IsZero() {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

// bidBondCheck returns (true, requiredBondCents) iff this user must post a
// bond before placing the bid. The check has three short-circuits:
//
//  1. h.db is nil → returns false (dev/sandbox stacks without DB skip the
//     check; placeBidTx will already 503 on its own guard).
//  2. The user has at least one historical bid_bonds row in 'released'
//     status → trusted; skip the gate forever.
//  3. The user already holds an 'authorized' bond on THIS listing → they
//     have posted + confirmed a bond for this auction and may keep bidding
//     (including raising past 10× the posted amount) without re-gating.
//
// Only a genuine first-time bidder on this listing — no authorized bond at
// all — is gated (return true) and asked to post one.
//
// Errors are treated as "let the bid through" rather than block — the
// audit pipeline still records the bid, and a follow-up cron can clamp
// abuse. We log loudly so ops notices.
func (h *ListingsHandler) bidBondCheck(ctx context.Context, userID, listingID string, intendedBidCents int64) (needsBond bool, requiredCents int64) {
	if h.db == nil {
		return false, 0
	}
	required := requiredBondCents(intendedBidCents)

	var hasReleased bool
	if err := h.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM bid_bonds
			 WHERE user_id = $1 AND status = 'released'
		)`, userID).Scan(&hasReleased); err != nil {
		slog.WarnContext(ctx, "bid bond released-history lookup failed", "error", err, "user_id", userID)
		return false, 0
	}
	if hasReleased {
		return false, 0
	}

	// An existing authorized bond on THIS listing waives the gate — but only
	// up to what the bond actually covers. Bare existence is not enough: a
	// $5 floor bond posted against a $50 opening bid must not silently
	// underwrite a later $10,000 raise, or the bond stops being proportional
	// to what a no-show would cost the seller. A raise past the covered
	// amount re-gates and asks for a bond sized to the new bid.
	covered, err := activeBondCovers(ctx, h.db, userID, listingID, required)
	if err != nil {
		slog.WarnContext(ctx, "bid bond authorized lookup failed", "error", err, "user_id", userID, "listing_id", listingID)
		return false, 0
	}
	if covered {
		return false, 0
	}

	// No authorized bond for this (listing, bidder): genuine first-time
	// bidder on this auction → gate.
	return true, required
}

// MyListings handles GET /api/v1/listings/me — seller's own listings.
func (h *ListingsHandler) MyListings(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"listings":   []listingJSON{},
			"pagination": pageMeta(1, 0, 0),
		})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 20, 100)

	statusFilter := q.Get("status")
	args := []interface{}{claims.UserID}
	where := "l.seller_id = $1"
	if statusFilter != "" {
		args = append(args, statusFilter)
		where += " AND l.status = $2"
	}

	var total int
	if err := h.db.QueryRow(r.Context(),
		"SELECT COUNT(*) FROM listings l WHERE "+where, args...).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "count failed")
		return
	}
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := h.db.Query(r.Context(), `
		SELECT l.id, l.seller_id, l.category_id,
			COALESCE(c.name,''), COALESCE(c.slug,''),
			l.title, COALESCE(l.description,''),
			l.status, l.pickup_zip_code,
			NULL::text, NULL::text, NULL::text,
			ST_Y(l.location), ST_X(l.location),
			l.starting_price_cents,
			COALESCE(l.current_bid_cents, l.starting_price_cents),
			100::bigint,
			COALESCE((SELECT COUNT(DISTINCT bidder_id) FROM listing_bids WHERE listing_id=l.id),0),
			COALESCE(l.bid_count,0),
			l.auction_duration_hours, l.auction_ends_at,
			COALESCE(l.snipe_extension_count,0),
			l.condition,
			l.created_at, l.updated_at
		  FROM listings l
		  LEFT JOIN service_categories c ON c.id = l.category_id
		 WHERE `+where+`
		 ORDER BY l.created_at DESC
		 LIMIT $`+itoa(len(args)-1)+` OFFSET $`+itoa(len(args)), args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	results := make([]listingJSON, 0)
	for rows.Next() {
		var l listingJSON
		var lat, lng pgtype.Float8
		var endsAt pgtype.Timestamptz
		var condition sql.NullString
		if err := rows.Scan(&l.ID, &l.SellerID, &l.CategoryID,
			&l.CategoryName, &l.CategorySlug,
			&l.Title, &l.Description,
			&l.Status, &l.PickupZip,
			&l.PickupCity, &l.PickupState, &l.PickupAddress,
			&lat, &lng,
			&l.StartingPriceCents, &l.CurrentBidCents, &l.MinIncrementCents,
			&l.BidderCount, &l.BidCount,
			&l.AuctionDurationHours, &endsAt,
			&l.SnipeExtensionCount,
			&condition,
			&l.CreatedAt, &l.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		if lat.Valid {
			v := lat.Float64
			l.PickupLat = &v
		}
		if lng.Valid {
			v := lng.Float64
			l.PickupLng = &v
		}
		if endsAt.Valid {
			t := endsAt.Time
			l.AuctionEndsAt = &t
		}
		if condition.Valid {
			s := condition.String
			l.Condition = &s
		}
		// Lazy past-deadline transition (see effectiveListingStatus): a
		// seller's own ended auction reads as 'ended', not a stale 'active'.
		l.Status = effectiveListingStatus(l.Status, l.AuctionEndsAt)
		l.Photos = []listingPhotoJSON{}
		results = append(results, l)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"listings":   results,
		"pagination": pageMeta(page, pageSize, total),
	})
}

// MyListingBids handles GET /api/v1/listings/me/bids — bids the user placed.
func (h *ListingsHandler) MyListingBids(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"bids":       []map[string]interface{}{},
			"pagination": pageMeta(1, 0, 0),
		})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 20, 100)

	rows, err := h.db.Query(r.Context(), `
		SELECT b.id, b.listing_id, b.bidder_id,
			COALESCE(u.display_name,'Bidder'),
			b.amount_cents, (b.status='active'),
			b.created_at,
			l.id, l.seller_id, l.title, l.status,
			COALESCE(l.current_bid_cents, l.starting_price_cents),
			COALESCE(l.bid_count,0),
			l.auction_ends_at
		  FROM listing_bids b
		  JOIN listings l ON l.id = b.listing_id
		  LEFT JOIN users u ON u.id = b.bidder_id
		 WHERE b.bidder_id = $1
		 ORDER BY b.created_at DESC
		 LIMIT $2 OFFSET $3`,
		claims.UserID, pageSize, (page-1)*pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	type myBid struct {
		Bid     listingBidJSON `json:"bid"`
		Listing map[string]interface{} `json:"listing"`
	}
	out := make([]myBid, 0)
	for rows.Next() {
		var b listingBidJSON
		var lid, sid, ltitle, lstatus string
		var lcurrent int64
		var lbidcount int
		var lendsAt pgtype.Timestamptz
		if err := rows.Scan(
			&b.ID, &b.ListingID, &b.BidderID, &b.BidderDisplayName,
			&b.AmountCents, &b.IsWinning, &b.CreatedAt,
			&lid, &sid, &ltitle, &lstatus,
			&lcurrent, &lbidcount, &lendsAt,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		listingMap := map[string]interface{}{
			"id":                lid,
			"seller_id":         sid,
			"title":             ltitle,
			"status":            lstatus,
			"current_bid_cents": lcurrent,
			"bid_count":         lbidcount,
		}
		if lendsAt.Valid {
			listingMap["auction_ends_at"] = lendsAt.Time.UTC().Format(time.RFC3339)
		}
		out = append(out, myBid{Bid: b, Listing: listingMap})
	}

	var total int
	h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM listing_bids WHERE bidder_id=$1`, claims.UserID,
	).Scan(&total)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"bids":       out,
		"pagination": pageMeta(page, pageSize, total),
	})
}

func itoa(i int) string { return fmt.Sprintf("%d", i) }

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/listings/{id}/buy-now — fixed-price closeout
// ─────────────────────────────────────────────────────────────────────────
//
// Skips the auction entirely. The buyer pays the seller's pre-set
// `buy_now_price_cents`; we record a synthetic high bid at that price,
// flip the listing to status='sold', and create a `listing_orders` row
// in escrow_status='pending_payment' (MON-06: never 'held' without a
// PaymentIntent). ChargeListingWinner then attaches the PI; webhook
// capture promotes pending_payment → held.
//
// Concurrency: SELECT … FOR UPDATE on the listings row serializes against
// concurrent regular bids and concurrent buy-now attempts, so the first
// caller wins and the second sees status='sold' and is rejected.
//
// Self-contained — does NOT call placeBidTx (Agent F's extended cascade
// is not the right path for a closeout). The synthetic bid emitted here
// is marked status='awarded' to distinguish it from auction-active bids.
func (h *ListingsHandler) BuyItNow(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tx")
		return
	}
	defer tx.Rollback(r.Context())

	var (
		sellerID      string
		status        string
		buyNowCents   pgtype.Int8
		auctionEndsAt pgtype.Timestamptz
	)
	err = tx.QueryRow(r.Context(), `
		SELECT seller_id, status, buy_now_price_cents, auction_ends_at
		  FROM listings WHERE id = $1 FOR UPDATE`, id,
	).Scan(&sellerID, &status, &buyNowCents, &auctionEndsAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "buy-now: select for update failed",
			"error", err, "listing_id", id)
		writeError(w, http.StatusInternalServerError, "failed to lock listing")
		return
	}

	if sellerID == claims.UserID {
		writeError(w, http.StatusForbidden, "sellers cannot buy their own listing")
		return
	}
	if !buyNowCents.Valid {
		writeError(w, http.StatusBadRequest, "this listing does not have a buy-now price")
		return
	}
	if status != "active" {
		writeError(w, http.StatusConflict, "auction is not active")
		return
	}
	if !auctionEndsAt.Valid || auctionEndsAt.Time.Before(time.Now()) {
		writeError(w, http.StatusConflict, "auction has ended")
		return
	}

	// Demote any prior active bid (regular auction bids) so we don't
	// leave two "active" rows behind. The synthetic buy-now bid below
	// inserts as status='awarded'.
	if _, err := tx.Exec(r.Context(), `
		UPDATE listing_bids SET status='outbid'
		 WHERE listing_id=$1 AND status='active'`, id); err != nil {
		slog.ErrorContext(r.Context(), "buy-now: demote outbid failed", "error", err)
		writeError(w, http.StatusInternalServerError, "demote failed")
		return
	}

	// Synthetic award-bid at the buy-now price.
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO listing_bids (listing_id, bidder_id, amount_cents, status, created_at)
		VALUES ($1, $2, $3, 'awarded', now())`,
		id, claims.UserID, buyNowCents.Int64,
	); err != nil {
		slog.ErrorContext(r.Context(), "buy-now: insert synthetic bid failed", "error", err)
		writeError(w, http.StatusInternalServerError, "insert bid failed")
		return
	}

	// Close the auction.
	if _, err := tx.Exec(r.Context(), `
		UPDATE listings
		   SET status='sold',
		       current_bid_cents=$2,
		       current_bidder_id=$3,
		       bid_count=(SELECT COUNT(DISTINCT bidder_id) FROM listing_bids
		                   WHERE listing_id=$1 AND retracted_at IS NULL),
		       updated_at=now()
		 WHERE id=$1`,
		id, buyNowCents.Int64, claims.UserID,
	); err != nil {
		slog.ErrorContext(r.Context(), "buy-now: update listing failed", "error", err)
		writeError(w, http.StatusInternalServerError, "update listing failed")
		return
	}

	// Create the order row in pending_payment — never held without a PI
	// (MON-06). Pickup/release only apply once ChargeListingWinner +
	// payment_intent.succeeded promote the order to held. Platform fee
	// matches auction-close / accepted-offer (listingPlatformFeeCents).
	feeCents := listingPlatformFeeCents(buyNowCents.Int64)
	var orderID string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO listing_orders (
			listing_id, seller_id, buyer_id,
			amount_cents, fee_cents, escrow_status
		) VALUES ($1, $2, $3, $4, $5, 'pending_payment')
		RETURNING id`,
		id, sellerID, claims.UserID, buyNowCents.Int64, feeCents,
	).Scan(&orderID)
	if err != nil {
		slog.ErrorContext(r.Context(), "buy-now: insert listing_orders failed", "error", err)
		writeError(w, http.StatusInternalServerError, "create order failed")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.ErrorContext(r.Context(), "buy-now: commit failed", "error", err)
		writeError(w, http.StatusInternalServerError, "commit failed")
		return
	}

	// Best-effort spectator stream notification so the live scoreboard
	// closes the auction in real time. No previous bidder context to
	// propagate — this is a closeout, not an outbid event.
	h.publishBidPlaced(r.Context(), id, claims.UserID, buyNowCents.Int64, false, time.Time{}, "")

	slog.InfoContext(r.Context(), "buy-now closeout",
		"listing_id", id, "buyer_id", claims.UserID,
		"order_id", orderID, "amount_cents", buyNowCents.Int64,
		"escrow_status", "pending_payment",
	)

	resp := map[string]interface{}{
		"order_id":      orderID,
		"escrow_status": "pending_payment",
		"listing":       nil,
	}
	if listing, lerr := h.loadListingJSON(r.Context(), id); lerr != nil {
		slog.WarnContext(r.Context(), "buy-now: post-load failed", "error", lerr, "id", id)
	} else {
		resp["listing"] = listing
	}

	// Attach a PaymentIntent when the payment service is wired. Failure here
	// does not roll back the sold listing / pending_payment order — the buyer
	// (or a retry) can re-charge via ChargeListingWinner.
	if piID, clientSecret, cerr := h.chargeListingOrder(r.Context(), orderID); cerr != nil {
		slog.ErrorContext(r.Context(), "buy-now: charge listing winner failed",
			"error", cerr, "order_id", orderID)
		resp["payment_required"] = true
		resp["charge_error"] = "payment setup failed; retry charge for this order"
	} else if piID != "" {
		resp["payment_intent_id"] = piID
		resp["client_secret"] = clientSecret
		resp["payment_required"] = true
	} else {
		// No payment client (dev without payment service): still never
		// pretend the order is held — client must complete payment later.
		resp["payment_required"] = true
	}

	writeJSON(w, http.StatusCreated, resp)
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/listings/{id}/bids/{bidId}/retract — eBay-style 60-second
// retraction window for the leading bidder.
// ─────────────────────────────────────────────────────────────────────────
//
// The retraction window is intentionally narrow:
//
//   - Only the CURRENT high bid (status='active') is retractable. Once a
//     bid has been demoted to 'outbid' it is frozen.
//   - The bid must be < 60 seconds old (now() - created_at < 60s).
//   - The retracting user must own the bid.
//
// Side effects:
//
//   - The bid row flips to status='retracted' with retracted_at = now().
//   - The next-highest non-retracted bid (if any) is promoted to
//     status='active' and becomes the new current_bid_cents on the
//     listing. If the new leader is itself an 'awarded' or 'outbid' row
//     we promote it back to 'active'.
//   - listings.bid_count is recomputed as the number of distinct
//     non-retracted bidders — the same definition placeBidTx writes, so
//     the two paths can never disagree. (Counting rows here would diverge
//     from placeBidTx, which must exclude the auto-bid cascade's proxy
//     rows; counting distinct bidders is cascade-immune because a proxy
//     raise belongs to a bidder already counted.)
//   - When no prior bids remain, current_bid_cents and current_bidder_id
//     are cleared (the listing reverts to "starting price only").
//
// Concurrency: the listing row is locked FOR UPDATE inside the
// transaction, serializing concurrent bids and retractions.
//
// Retracted bids are NOT deleted — they remain in the audit trail so
// admin tooling and fraud heuristics can detect retraction abuse (a
// bidder who repeatedly retracts is sniping the spread).
//
// We recompute the distinct-non-retracted-bidder count rather than
// tracking deltas, because the auto-bid cascade can insert >1 row per
// visible placement — a running row-count delta would inflate. Cheap
// query (single index scan on listing_id).
const listingRetractWindow = 60 * time.Second

func (h *ListingsHandler) RetractBid(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	listingID := chi.URLParam(r, "id")
	bidID := chi.URLParam(r, "bidId")
	if !isValidUUID(listingID) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}
	if !isValidUUID(bidID) {
		writeError(w, http.StatusBadRequest, "invalid bid id")
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tx")
		return
	}
	defer tx.Rollback(r.Context())

	// Lock the listing row FIRST so concurrent bids/retractions serialize.
	var (
		listingStatus string
		startCents    int64
	)
	err = tx.QueryRow(r.Context(),
		`SELECT status, starting_price_cents
		   FROM listings WHERE id = $1 FOR UPDATE`, listingID,
	).Scan(&listingStatus, &startCents)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "retract: listing lock failed",
			"error", err, "listing_id", listingID)
		writeError(w, http.StatusInternalServerError, "failed to lock listing")
		return
	}

	// Lock the bid row and verify ownership + retraction eligibility.
	var (
		bidListingID string
		bidderID     string
		bidStatus    string
		bidAmount    int64
		bidCreatedAt time.Time
		bidRetracted pgtype.Timestamptz
	)
	err = tx.QueryRow(r.Context(), `
		SELECT listing_id, bidder_id, status, amount_cents, created_at, retracted_at
		  FROM listing_bids WHERE id = $1 FOR UPDATE`, bidID,
	).Scan(&bidListingID, &bidderID, &bidStatus, &bidAmount, &bidCreatedAt, &bidRetracted)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "bid not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "retract: bid lock failed",
			"error", err, "bid_id", bidID)
		writeError(w, http.StatusInternalServerError, "failed to lock bid")
		return
	}

	if bidListingID != listingID {
		writeError(w, http.StatusBadRequest, "bid does not belong to this listing")
		return
	}
	if bidderID != claims.UserID {
		writeError(w, http.StatusForbidden, "only the bidder may retract this bid")
		return
	}
	if bidRetracted.Valid {
		writeError(w, http.StatusConflict, "bid is already retracted")
		return
	}
	// Only the leading 'active' bid can be retracted. Demoted bids
	// (status='outbid') and awarded bids (status='awarded') are frozen.
	if bidStatus != "active" {
		writeError(w, http.StatusConflict,
			"only the current high bid can be retracted; outbid/awarded bids are final")
		return
	}
	// Sold/cancelled/expired listings can't have bids retracted.
	if listingStatus != "active" {
		writeError(w, http.StatusConflict,
			"cannot retract a bid on a "+listingStatus+" listing")
		return
	}

	// 60-second window enforced server-side. We use the database clock
	// (now() in the UPDATE) but the comparison here uses the request
	// wall clock; the values are within microseconds of each other.
	age := time.Since(bidCreatedAt)
	if age >= listingRetractWindow {
		writeError(w, http.StatusConflict,
			"retraction window expired (60s after the bid was placed)")
		return
	}

	// Mark the bid retracted. The status='retracted' enum value was added
	// in migration 040.
	if _, err := tx.Exec(r.Context(), `
		UPDATE listing_bids
		   SET status = 'retracted',
		       retracted_at = now()
		 WHERE id = $1`, bidID,
	); err != nil {
		slog.ErrorContext(r.Context(), "retract: bid update failed",
			"error", err, "bid_id", bidID)
		writeError(w, http.StatusInternalServerError, "failed to retract bid")
		return
	}

	// Find the next-highest non-retracted, non-this-bid candidate to
	// promote. Prefer 'outbid' rows (the legitimate runner-up); skip
	// 'retracted' / 'awarded'.
	var (
		nextID       string
		nextBidder   string
		nextAmount   int64
		hasNext      bool
	)
	err = tx.QueryRow(r.Context(), `
		SELECT id, bidder_id, amount_cents
		  FROM listing_bids
		 WHERE listing_id = $1
		   AND id != $2
		   AND retracted_at IS NULL
		   AND status IN ('active','outbid')
		 ORDER BY amount_cents DESC, created_at ASC
		 LIMIT 1`, listingID, bidID,
	).Scan(&nextID, &nextBidder, &nextAmount)
	switch {
	case err == nil:
		hasNext = true
	case errors.Is(err, pgx.ErrNoRows):
		hasNext = false
	default:
		slog.ErrorContext(r.Context(), "retract: lookup next bid failed",
			"error", err, "listing_id", listingID)
		writeError(w, http.StatusInternalServerError, "failed to find next bid")
		return
	}

	if hasNext {
		// Promote the runner-up to active (it may already be 'active' if
		// it was the original leader before this bid; the UPDATE is still
		// idempotent in that case).
		if _, err := tx.Exec(r.Context(), `
			UPDATE listing_bids
			   SET status = 'active'
			 WHERE id = $1`, nextID,
		); err != nil {
			slog.ErrorContext(r.Context(), "retract: promote next bid failed",
				"error", err, "next_bid_id", nextID)
			writeError(w, http.StatusInternalServerError, "failed to promote next bid")
			return
		}
		if _, err := tx.Exec(r.Context(), `
			UPDATE listings
			   SET current_bid_cents = $2,
			       current_bidder_id = $3,
			       bid_count = (SELECT COUNT(DISTINCT bidder_id) FROM listing_bids
			                     WHERE listing_id = $1 AND retracted_at IS NULL),
			       updated_at = now()
			 WHERE id = $1`,
			listingID, nextAmount, nextBidder,
		); err != nil {
			slog.ErrorContext(r.Context(), "retract: listing update (with next) failed",
				"error", err, "listing_id", listingID)
			writeError(w, http.StatusInternalServerError, "failed to update listing")
			return
		}
	} else {
		// No prior bids — revert the listing to "starting price, no bidder".
		if _, err := tx.Exec(r.Context(), `
			UPDATE listings
			   SET current_bid_cents = NULL,
			       current_bidder_id = NULL,
			       bid_count = 0,
			       updated_at = now()
			 WHERE id = $1`, listingID,
		); err != nil {
			slog.ErrorContext(r.Context(), "retract: listing reset failed",
				"error", err, "listing_id", listingID)
			writeError(w, http.StatusInternalServerError, "failed to reset listing")
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.ErrorContext(r.Context(), "retract: commit failed", "error", err)
		writeError(w, http.StatusInternalServerError, "commit failed")
		return
	}

	slog.InfoContext(r.Context(), "listing bid retracted",
		"listing_id", listingID,
		"bid_id", bidID,
		"bidder_id", claims.UserID,
		"amount_cents", bidAmount,
		"age_ms", age.Milliseconds(),
		"promoted_next", hasNext,
	)

	listing, err := h.loadListingJSON(r.Context(), listingID)
	if err != nil {
		// Listing is already updated; the reload is best-effort.
		slog.WarnContext(r.Context(), "retract: post-load failed",
			"error", err, "id", listingID)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"listing": nil,
			"bid_id":  bidID,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"listing": listing,
		"bid_id":  bidID,
	})
}
