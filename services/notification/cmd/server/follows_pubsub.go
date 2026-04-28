package main

// follows_pubsub.go — fan out new-listing notifications to seller followers.
//
// The job service's listing.CreateListing publishes a JSON payload on
// `notify:seller_new_listing:{seller_id}` whenever a listing flips to
// status='active'. This loop subscribes to the pattern, fetches the
// follower set from Postgres, and queues a `seller_new_listing`
// notification for each one.
//
// Mirrors the runOutbidPubsubLoop pattern in listing_scheduler.go: a
// single goroutine, exponential reconnect backoff, log-and-continue on
// per-message failures so a single bad payload never crashes the loop.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nomarkup/nomarkup/services/notification/internal/service"
)

// sellerNewListingPayload is the shape published by the job service when
// a new listing goes active. Kept in sync with services/job/internal/service/listing.go
// publishListingCreated — extra fields are ignored here.
type sellerNewListingPayload struct {
	Type         string `json:"type"`
	ListingID    string `json:"listing_id"`
	SellerID     string `json:"seller_id"`
	Title        string `json:"title"`
	StartingCents int64 `json:"starting_price_cents,omitempty"`
}

// runFollowsPubsubScheduler subscribes to `notify:seller_new_listing:*`
// and fans each event out to every follower of the publishing seller.
//
// `redisURL` is taken from REDIS_URL. Empty disables this loop.
// `pool` is needed to look up follower IDs.
func runFollowsPubsubScheduler(ctx context.Context, pool *pgxpool.Pool, svc *service.Service, redisURL string) {
	if pool == nil || svc == nil {
		slog.Warn("follows pubsub: missing dependencies, skipping",
			"pool_nil", pool == nil, "svc_nil", svc == nil)
		return
	}
	if redisURL == "" {
		slog.Info("follows pubsub: REDIS_URL not set, skipping")
		return
	}

	go runFollowsPubsubLoop(ctx, pool, svc, redisURL)
}

// runFollowsPubsubLoop is the long-running subscriber. It rebuilds the
// connection on transient failures with exponential backoff capped at 30s.
func runFollowsPubsubLoop(ctx context.Context, pool *pgxpool.Pool, svc *service.Service, redisURL string) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		slog.Error("follows pubsub: invalid REDIS_URL", "error", err)
		return
	}
	rdb := redis.NewClient(opts)
	defer func() { _ = rdb.Close() }()

	const channelPattern = "notify:seller_new_listing:*"
	backoff := time.Second

	for {
		if err := ctx.Err(); err != nil {
			slog.Info("follows pubsub: context cancelled, stopping")
			return
		}

		pubsub := rdb.PSubscribe(ctx, channelPattern)
		slog.Info("follows pubsub: subscribed", "pattern", channelPattern)

		if _, err := pubsub.Receive(ctx); err != nil {
			slog.Warn("follows pubsub: subscription failed", "error", err)
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
				handleSellerNewListingMessage(ctx, pool, svc, msg)
			case <-ctx.Done():
				_ = pubsub.Close()
				return
			}
		}
		_ = pubsub.Close()
	}
}

// handleSellerNewListingMessage parses the payload, looks up followers,
// and dispatches one notification per follower. The seller themselves is
// excluded from the broadcast (the CHECK in seller_follows already blocks
// self-follow, so this is belt-and-suspenders).
func handleSellerNewListingMessage(ctx context.Context, pool *pgxpool.Pool, svc *service.Service, msg *redis.Message) {
	var payload sellerNewListingPayload
	if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
		slog.Warn("follows pubsub: invalid payload", "channel", msg.Channel, "error", err)
		return
	}

	// Prefer the channel suffix as the seller id — it's set by PUBLISH
	// even when the payload is malformed in some other field.
	sellerID := payload.SellerID
	if sellerID == "" {
		if idx := strings.LastIndex(msg.Channel, ":"); idx >= 0 && idx < len(msg.Channel)-1 {
			sellerID = msg.Channel[idx+1:]
		}
	}
	if sellerID == "" {
		slog.Warn("follows pubsub: no seller_id", "channel", msg.Channel)
		return
	}
	if payload.ListingID == "" {
		slog.Warn("follows pubsub: missing listing_id in payload", "channel", msg.Channel)
		return
	}

	// Bound the lookup so a slow Postgres can't wedge the whole subscriber.
	queryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	rows, err := pool.Query(queryCtx, `
		SELECT follower_id::text
		  FROM seller_follows
		 WHERE seller_id = $1`, sellerID)
	if err != nil {
		slog.Warn("follows pubsub: follower lookup failed",
			"seller_id", sellerID, "error", err)
		return
	}
	defer rows.Close()

	followerIDs := make([]string, 0)
	for rows.Next() {
		var fid string
		if err := rows.Scan(&fid); err != nil {
			continue
		}
		if fid != "" && fid != sellerID {
			followerIDs = append(followerIDs, fid)
		}
	}

	if len(followerIDs) == 0 {
		return
	}

	const notifType = "seller_new_listing"
	title := "A seller you follow listed something new"
	body := payload.Title
	if body == "" {
		body = "A seller you follow just put a new auction live. Take a look before someone else does."
	} else {
		body = fmt.Sprintf("%s — Just listed by a seller you follow.", body)
	}
	actionURL := fmt.Sprintf("/marketplace/%s", payload.ListingID)
	data := map[string]string{
		"entity_type": "listing",
		"entity_id":   payload.ListingID,
	}

	for _, fid := range followerIDs {
		if _, _, err := svc.SendNotification(queryCtx, fid, notifType, title, body, actionURL, data, nil); err != nil {
			slog.Warn("follows pubsub: send failed",
				"follower_id", fid, "seller_id", sellerID, "listing_id", payload.ListingID, "error", err)
		}
	}

	slog.InfoContext(queryCtx, "follows pubsub: fan-out complete",
		"seller_id", sellerID, "listing_id", payload.ListingID, "followers", len(followerIDs))
}
