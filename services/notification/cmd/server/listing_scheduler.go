package main

// listing_scheduler.go — goods-marketplace retention notification loop.
//
// Three concurrent passes share one notification.Service instance:
//
//   1. closing-soon (10-minute mark)
//      Every 30s, scan for active listings where auction_ends_at falls
//      inside [now+10min, now+10min+30s). Notify the current high bidder
//      and every user_id in `listing_watchlist` for that listing.
//
//   2. closing-now (60-second mark)
//      Same shape, narrower window [now+60s, now+90s). priority='critical'.
//      Sent in addition to the 10-minute notice — the urgency switches.
//
//   3. outbid pubsub fan-out
//      Subscribe to Redis channel pattern `notify:outbid:*`. Each message
//      carries `{type, listing_id, prev_bidder_id, ...}` published by the
//      gateway's `placeBidTx` path. Queue a `bid_outbid` notification to
//      the targeted user.
//
// The scheduler shares the *pgxpool.Pool with the rest of the notification
// service. Failure modes are logged-and-continue: a single failed query
// does not crash the loop. Cancel the supervised context to stop all
// goroutines on shutdown.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nomarkup/nomarkup/services/notification/internal/service"
)

// listingSchedulerInterval is how often the closing-soon and closing-now
// passes run. 30 seconds is short enough that we always catch the
// 10-minute and 60-second marks (windows are 30s wide), and long enough
// that the queries don't dominate the database.
const listingSchedulerInterval = 30 * time.Second

// runListingNotificationScheduler starts the closing-soon, closing-now,
// and outbid-fanout passes. Each runs in its own goroutine. The function
// returns once goroutines are spawned; cancel `ctx` to stop them.
//
// `redisURL` is read from REDIS_URL when called from main.go. If empty,
// the outbid pubsub pass is skipped (the closing-soon and closing-now
// passes still run from Postgres alone).
func runListingNotificationScheduler(ctx context.Context, pool *pgxpool.Pool, svc *service.Service, redisURL string) {
	if pool == nil || svc == nil {
		slog.Warn("listing scheduler: missing dependencies, skipping", "pool_nil", pool == nil, "svc_nil", svc == nil)
		return
	}

	go runListingClosingSoonLoop(ctx, pool, svc)
	go runListingClosingNowLoop(ctx, pool, svc)

	if redisURL != "" {
		go runOutbidPubsubLoop(ctx, redisURL, svc)
	} else {
		slog.Info("listing scheduler: REDIS_URL not set, outbid pubsub disabled")
	}
}

// runListingClosingSoonLoop is the 10-minute warning pass.
func runListingClosingSoonLoop(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) {
	slog.Info("listing closing-soon scheduler starting", "interval", listingSchedulerInterval.String())
	t := time.NewTicker(listingSchedulerInterval)
	defer t.Stop()

	// Run once immediately.
	runListingClosingTick(ctx, pool, svc, closingSoonConfig())

	for {
		select {
		case <-t.C:
			runListingClosingTick(ctx, pool, svc, closingSoonConfig())
		case <-ctx.Done():
			slog.Info("listing closing-soon scheduler stopping")
			return
		}
	}
}

// runListingClosingNowLoop is the 60-second critical-warning pass.
func runListingClosingNowLoop(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) {
	slog.Info("listing closing-now scheduler starting", "interval", listingSchedulerInterval.String())
	t := time.NewTicker(listingSchedulerInterval)
	defer t.Stop()

	runListingClosingTick(ctx, pool, svc, closingNowConfig())

	for {
		select {
		case <-t.C:
			runListingClosingTick(ctx, pool, svc, closingNowConfig())
		case <-ctx.Done():
			slog.Info("listing closing-now scheduler stopping")
			return
		}
	}
}

// closingTickConfig groups the tunable knobs of a single sweep.
type closingTickConfig struct {
	// Window relative to now() — auctions whose auction_ends_at falls
	// inside [now+lower, now+upper) are notified.
	lower, upper time.Duration
	// Notification metadata fanned out to recipients.
	notifType string
	title     string
	body      string
}

func closingSoonConfig() closingTickConfig {
	return closingTickConfig{
		lower:     10 * time.Minute,
		upper:     10*time.Minute + listingSchedulerInterval,
		notifType: "auction_closing_soon",
		title:     "Auction closing in 10 minutes",
		body:      "An auction you're following ends soon. Check the listing to place or raise your bid.",
	}
}

func closingNowConfig() closingTickConfig {
	return closingTickConfig{
		lower:     60 * time.Second,
		upper:     60*time.Second + listingSchedulerInterval,
		notifType: "auction_closing_soon", // share the type but flag urgency in body
		title:     "Auction closing in 60 seconds",
		body:      "Last chance — this auction ends in under a minute.",
	}
}

// runListingClosingTick runs ONE sweep of the closing window. It is
// idempotent in practice because each sweep targets a unique 30s window
// of `auction_ends_at`; an auction crosses each window exactly once.
func runListingClosingTick(ctx context.Context, pool *pgxpool.Pool, svc *service.Service, cfg closingTickConfig) {
	tickCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	rows, err := pool.Query(tickCtx, `
		SELECT id, current_bidder_id::text, title
		  FROM listings
		 WHERE status = 'active'
		   AND auction_ends_at IS NOT NULL
		   AND auction_ends_at >= now() + ($1::text)::interval
		   AND auction_ends_at <  now() + ($2::text)::interval`,
		intervalString(cfg.lower), intervalString(cfg.upper),
	)
	if err != nil {
		slog.ErrorContext(tickCtx, "listing scheduler: query failed", "type", cfg.notifType, "error", err)
		return
	}
	defer rows.Close()

	type closingListing struct {
		ID              string
		CurrentBidderID pgtype.Text
		Title           string
	}
	listings := make([]closingListing, 0)
	for rows.Next() {
		var l closingListing
		if err := rows.Scan(&l.ID, &l.CurrentBidderID, &l.Title); err != nil {
			slog.ErrorContext(tickCtx, "listing scheduler: scan failed", "error", err)
			continue
		}
		listings = append(listings, l)
	}
	if err := rows.Err(); err != nil {
		slog.ErrorContext(tickCtx, "listing scheduler: rows iteration failed", "error", err)
	}

	if len(listings) == 0 {
		return
	}

	for _, l := range listings {
		watcherIDs, err := loadWatcherIDs(tickCtx, pool, l.ID)
		if err != nil {
			slog.ErrorContext(tickCtx, "listing scheduler: load watchers failed", "listing_id", l.ID, "error", err)
			watcherIDs = nil
		}

		// Recipients = current bidder ∪ watchers, deduped.
		recipients := make(map[string]struct{}, len(watcherIDs)+1)
		if l.CurrentBidderID.Valid && l.CurrentBidderID.String != "" {
			recipients[l.CurrentBidderID.String] = struct{}{}
		}
		for _, uid := range watcherIDs {
			if uid != "" {
				recipients[uid] = struct{}{}
			}
		}

		actionURL := fmt.Sprintf("/marketplace/%s", l.ID)
		body := cfg.body
		if l.Title != "" {
			body = fmt.Sprintf("%s — %s", l.Title, cfg.body)
		}
		data := map[string]string{
			"entity_type": "listing",
			"entity_id":   l.ID,
		}
		for uid := range recipients {
			if _, _, err := svc.SendNotification(tickCtx, uid, cfg.notifType, cfg.title, body, actionURL, data, nil); err != nil {
				slog.WarnContext(tickCtx, "listing scheduler: send failed",
					"user_id", uid, "listing_id", l.ID, "type", cfg.notifType, "error", err,
				)
			}
		}
	}

	slog.InfoContext(tickCtx, "listing scheduler: tick complete",
		"type", cfg.notifType,
		"listings", len(listings),
	)
}

// loadWatcherIDs fetches every user_id watching the given listing.
// Errors propagate up; the caller decides whether to skip recipients.
func loadWatcherIDs(ctx context.Context, pool *pgxpool.Pool, listingID string) ([]string, error) {
	rows, err := pool.Query(ctx,
		`SELECT user_id::text FROM listing_watchlist WHERE listing_id = $1`,
		listingID,
	)
	if err != nil {
		return nil, fmt.Errorf("query watchlist: %w", err)
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			return nil, fmt.Errorf("scan watchlist row: %w", err)
		}
		out = append(out, uid)
	}
	return out, rows.Err()
}

// intervalString formats a time.Duration as a Postgres interval literal
// (e.g. "10 minutes 30 seconds"). We use this string-typed form (with
// `('...')::interval` casting in the SQL) so the placeholder can sit at
// the planner-friendly position without a parameter-type mismatch.
func intervalString(d time.Duration) string {
	if d <= 0 {
		return "0 seconds"
	}
	return fmt.Sprintf("%d milliseconds", d.Milliseconds())
}

// ─────────────────────────────────────────────────────────────────────────
// Outbid pubsub fan-out
// ─────────────────────────────────────────────────────────────────────────

// outbidPayload mirrors the JSON published by gateway/internal/handler/listings_bid.go
// in `publishBidPlaced` — kept in sync by convention; new fields are
// simply ignored here.
type outbidPayload struct {
	Type         string `json:"type"`
	ListingID    string `json:"listing_id"`
	PrevBidderID string `json:"prev_bidder_id"`
	NewBidderID  string `json:"new_bidder_id"`
	AmountCents  int64  `json:"amount_cents"`
}

// runOutbidPubsubLoop subscribes to `notify:outbid:*` and queues a
// `bid_outbid` notification each time a payload arrives. Reconnects on
// transient redis errors with a small backoff.
func runOutbidPubsubLoop(ctx context.Context, redisURL string, svc *service.Service) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		slog.Error("outbid pubsub: invalid REDIS_URL", "error", err)
		return
	}
	rdb := redis.NewClient(opts)
	defer func() { _ = rdb.Close() }()

	const channelPattern = "notify:outbid:*"
	backoff := time.Second

	for {
		if err := ctx.Err(); err != nil {
			slog.Info("outbid pubsub: context cancelled, stopping")
			return
		}

		pubsub := rdb.PSubscribe(ctx, channelPattern)
		slog.Info("outbid pubsub: subscribed", "pattern", channelPattern)

		// Block until first reception confirmation — surfaces immediate
		// connection failures rather than silently swallowing them.
		if _, err := pubsub.Receive(ctx); err != nil {
			slog.Warn("outbid pubsub: subscription failed", "error", err)
			_ = pubsub.Close()
			if errors.Is(err, context.Canceled) {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second // reset on success

		ch := pubsub.Channel()
		drained := false
		for !drained {
			select {
			case msg, ok := <-ch:
				if !ok {
					drained = true
					continue
				}
				handleOutbidMessage(ctx, msg, svc)
			case <-ctx.Done():
				_ = pubsub.Close()
				return
			}
		}
		_ = pubsub.Close()
	}
}

// handleOutbidMessage parses a single redis message and queues a
// `bid_outbid` notification. Errors are logged and discarded — the
// notification is best-effort.
func handleOutbidMessage(ctx context.Context, msg *redis.Message, svc *service.Service) {
	var payload outbidPayload
	if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
		slog.Warn("outbid pubsub: invalid payload", "channel", msg.Channel, "error", err)
		return
	}

	// Prefer the channel suffix as the recipient (PUBLISH guarantees the
	// channel name even if the payload is malformed in some other field).
	target := payload.PrevBidderID
	if target == "" {
		// `notify:outbid:{user_id}`
		if idx := strings.LastIndex(msg.Channel, ":"); idx >= 0 && idx < len(msg.Channel)-1 {
			target = msg.Channel[idx+1:]
		}
	}
	if target == "" {
		slog.Warn("outbid pubsub: no target user_id", "channel", msg.Channel)
		return
	}

	const (
		notifType = "bid_outbid"
		title     = "You've been outbid"
		body      = "Someone placed a higher bid on a listing you were winning. Open the auction to bid again."
	)
	actionURL := fmt.Sprintf("/marketplace/%s", payload.ListingID)
	data := map[string]string{
		"entity_type": "listing",
		"entity_id":   payload.ListingID,
	}
	if _, _, err := svc.SendNotification(ctx, target, notifType, title, body, actionURL, data, nil); err != nil {
		slog.Warn("outbid pubsub: send failed",
			"user_id", target, "listing_id", payload.ListingID, "error", err,
		)
	}
}

