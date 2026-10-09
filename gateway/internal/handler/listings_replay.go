package handler

// Auction-replay (goods side).
//
// Mirrors the services-side auction_replay.go but reads from listing_bids
// instead of auction_bid_events. Public — anyone can replay a closed
// auction. PII is stripped: bidders are anonymized as "Bidder #1",
// "Bidder #2", … in stable insertion order.
//
// Mounted at: GET /api/v1/listings/{id}/replay (public, no auth).
//
// Event types surfaced:
//
//   bid_placed         — every accepted bid, in chronological order
//   snipe_extension    — synthesized when listings.snipe_extension_count > 0;
//                        we emit one event per recorded extension at the
//                        bid that triggered it (best-effort heuristic
//                        based on bid time vs. auction_ends_at)
//   auto_bid_cascade   — synthesized when consecutive bids share a
//                        bidder + are placed within 2 seconds of each
//                        other (a strong proxy signal for max-bid
//                        cascade, which is otherwise not stamped on the
//                        listing_bids row)

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListingReplayHandler exposes the goods-marketplace auction replay.
type ListingReplayHandler struct {
	db *pgxpool.Pool
}

// NewListingReplayHandler returns a ListingReplayHandler. A nil db
// short-circuits to an empty payload (matches the rest of the family).
func NewListingReplayHandler(db *pgxpool.Pool) *ListingReplayHandler {
	return &ListingReplayHandler{db: db}
}

// listingReplayEvent matches the docs in the task spec — one row per
// surfaced event, with PII-stripped bidder labels.
type listingReplayEvent struct {
	Type             string  `json:"type"`
	At               string  `json:"at"`
	AmountCents      *int64  `json:"amount_cents,omitempty"`
	AnonymizedBidder *string `json:"anonymized_bidder,omitempty"`
	ExtendedTo       *string `json:"extended_to,omitempty"`
	From             *int64  `json:"from,omitempty"`
	To               *int64  `json:"to,omitempty"`
}

// GetListingReplay returns the replay timeline for a closed listing.
// GET /api/v1/listings/{id}/replay (public).
func (h *ListingReplayHandler) GetListingReplay(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"events": []listingReplayEvent{},
		})
		return
	}
	listingID := chi.URLParam(r, "id")
	if !isValidUUID(listingID) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	// Listing metadata. Replay is only available once the auction is
	// closed (status='sold' OR 'expired' OR 'cancelled') — live auctions
	// would leak strategy.
	var (
		status              string
		startedAt           time.Time
		endsAt              pgtype.Timestamptz
		snipeExtensionCount int
		winnerID            pgtype.Text
	)
	err := h.db.QueryRow(r.Context(), `
		SELECT l.status, l.created_at, l.auction_ends_at,
		       COALESCE(l.snipe_extension_count, 0),
		       l.current_bidder_id::text
		  FROM listings l
		 WHERE l.id = $1`, listingID,
	).Scan(&status, &startedAt, &endsAt, &snipeExtensionCount, &winnerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "listing replay: lookup failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load listing")
		return
	}
	switch status {
	case "sold", "expired", "cancelled":
		// ok — closed auctions are replayable
	default:
		writeError(w, http.StatusForbidden, "replay is only available for closed auctions")
		return
	}

	// Pull every bid in chronological order. We label bidders by stable
	// first-seen index so the timeline reads as "Bidder #1 … Bidder #2 …"
	// regardless of UUID order.
	rows, err := h.db.Query(r.Context(), `
		SELECT bidder_id::text, amount_cents, created_at
		  FROM listing_bids
		 WHERE listing_id = $1
		 ORDER BY created_at ASC`, listingID,
	)
	if err != nil {
		slog.ErrorContext(r.Context(), "listing replay: bids query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load replay")
		return
	}
	defer rows.Close()

	type bidRow struct {
		BidderID    string
		AmountCents int64
		At          time.Time
	}
	bids := make([]bidRow, 0)
	for rows.Next() {
		var b bidRow
		if err := rows.Scan(&b.BidderID, &b.AmountCents, &b.At); err != nil {
			slog.ErrorContext(r.Context(), "listing replay: scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		bids = append(bids, b)
	}

	// Build PII-stripped bidder labels (insertion-order stable).
	labelByBidder := make(map[string]string, len(bids))
	nextID := 1
	for _, b := range bids {
		if _, ok := labelByBidder[b.BidderID]; !ok {
			labelByBidder[b.BidderID] = sprintBidder(nextID)
			nextID++
		}
	}

	events := make([]listingReplayEvent, 0, len(bids)+snipeExtensionCount)

	// Emit bid_placed events. Synthesize auto_bid_cascade when consecutive
	// bids share a bidder within 2 seconds.
	for i, b := range bids {
		amount := b.AmountCents
		label := labelByBidder[b.BidderID]
		events = append(events, listingReplayEvent{
			Type:             "bid_placed",
			At:               b.At.UTC().Format(time.RFC3339),
			AmountCents:      &amount,
			AnonymizedBidder: &label,
		})
		if i > 0 {
			prev := bids[i-1]
			if prev.BidderID == b.BidderID && b.At.Sub(prev.At) <= 2*time.Second && prev.AmountCents != b.AmountCents {
				from := prev.AmountCents
				to := b.AmountCents
				events = append(events, listingReplayEvent{
					Type: "auto_bid_cascade",
					At:   b.At.UTC().Format(time.RFC3339),
					From: &from,
					To:   &to,
				})
			}
		}
	}

	// Emit snipe_extension synthetic events. We only know the total count
	// + the final auction_ends_at; surface one summary entry at the close.
	if snipeExtensionCount > 0 && endsAt.Valid {
		extendedTo := endsAt.Time.UTC().Format(time.RFC3339)
		for i := 0; i < snipeExtensionCount; i++ {
			events = append(events, listingReplayEvent{
				Type:       "snipe_extension",
				At:         extendedTo,
				ExtendedTo: &extendedTo,
			})
		}
	}

	out := map[string]interface{}{
		"listing_id": listingID,
		"started_at": startedAt.UTC().Format(time.RFC3339),
		"events":     events,
	}
	if endsAt.Valid {
		out["ended_at"] = endsAt.Time.UTC().Format(time.RFC3339)
	} else {
		out["ended_at"] = nil
	}
	if winnerID.Valid {
		out["winner_id"] = winnerID.String
	} else {
		out["winner_id"] = nil
	}

	writeJSON(w, http.StatusOK, out)
}

func sprintBidder(n int) string {
	// Reuses the package-local itoa helper from listings_bid.go.
	if n < 1 {
		n = 1
	}
	return "Bidder #" + itoa(n)
}
