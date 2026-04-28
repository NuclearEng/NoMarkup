package handler

// Marketplace (goods) spectator WebSocket. Mirrors spectator_ws.go (the
// services-side auction spectator) but keyed on `listingId` and subscribed
// to the `listing:{id}` Redis channel published by the job service when a
// forward-auction bid is placed.
//
// Route (mounted in router.go, public/no-auth):
//   r.Get("/ws/marketplace/{listingId}/spectate", marketplaceSpectatorWSHandler.Spectate)
//
// Messages sent to the client:
//
//   { "type":"bid_event",       "listing_id":"...", "data": { ...anonymized... } }
//   { "type":"spectator_count", "listing_id":"...", "spectator_count": 47 }
//
// The 3-second event delay matches the services side and prevents
// real-time front-running by spectators.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"nhooyr.io/websocket"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

const (
	maxSpectatorsPerListing       = 500
	maxListingSpectatorPerIP      = 5
	listingSpectatorEventDelay    = 3 * time.Second
	listingSpectatorKeyTTL        = 2 * time.Hour
	listingSpectatorIPKeyTTL      = 5 * time.Minute
	listingSpectatorPingInterval  = 30 * time.Second
	listingSpectatorWriteTimeout  = 10 * time.Second
	listingSpectatorCountInterval = 10 * time.Second
)

// listingPiiFields are stripped from listing-bid events before forwarding.
// `bidder_id` is anonymized so spectators see "someone bid" without
// learning who; the server log retains the full identity.
var listingPiiFields = []string{
	"bidder_id",
	"buyer_id",
	"seller_id",
	"email",
	"phone",
	"display_name",
	"avatar_url",
}

// MarketplaceSpectatorWSHandler handles anonymous spectator connections
// for goods-marketplace listings.
type MarketplaceSpectatorWSHandler struct {
	cache *cache.Client

	mu             sync.RWMutex
	spectatorCount map[string]int // listingID -> count (in-memory fallback when Redis is nil)
}

// NewMarketplaceSpectatorWSHandler wires a handler against the cache client.
func NewMarketplaceSpectatorWSHandler(cacheClient *cache.Client) *MarketplaceSpectatorWSHandler {
	return &MarketplaceSpectatorWSHandler{
		cache:          cacheClient,
		spectatorCount: make(map[string]int),
	}
}

// listingSpectatorMsg is the wire format sent to clients.
type listingSpectatorMsg struct {
	Type           string          `json:"type"`
	ListingID      string          `json:"listing_id,omitempty"`
	Data           json.RawMessage `json:"data,omitempty"`
	SpectatorCount int             `json:"spectator_count,omitempty"`
}

// Spectate handles an incoming WebSocket connection. Public route, no auth.
func (h *MarketplaceSpectatorWSHandler) Spectate(w http.ResponseWriter, r *http.Request) {
	listingID := chi.URLParam(r, "listingId")
	if listingID == "" {
		writeError(w, http.StatusBadRequest, "listing ID required")
		return
	}

	ip := extractClientIP(r)

	if !h.checkListingCapacity(r.Context(), listingID) {
		writeError(w, http.StatusServiceUnavailable, "listing spectator limit reached")
		return
	}
	if !h.checkIPLimit(r.Context(), ip) {
		writeError(w, http.StatusTooManyRequests, "too many spectator connections from this IP")
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: wsOriginPatterns(),
	})
	if err != nil {
		slog.Error("marketplace spectator ws accept failed",
			"error", err, "remote_addr", r.RemoteAddr)
		return
	}
	defer conn.CloseNow()

	conn.SetReadLimit(256)

	spectatorID := fmt.Sprintf("%s:%d", ip, time.Now().UnixNano())
	h.registerSpectator(r.Context(), listingID, spectatorID)
	defer h.unregisterSpectator(listingID, spectatorID)

	slog.Info("marketplace spectator ws connected",
		"listing_id", listingID, "remote_addr", r.RemoteAddr)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	rdb := h.redisClient()
	if rdb == nil {
		slog.Error("marketplace spectator ws: redis unavailable")
		conn.Close(websocket.StatusInternalError, "service unavailable")
		return
	}

	pubsub := rdb.Subscribe(ctx, fmt.Sprintf("listing:%s", listingID))
	defer pubsub.Close()
	ch := pubsub.Channel()

	// Initial spectator count.
	h.sendSpectatorCount(ctx, conn, listingID, h.getSpectatorCount(ctx, listingID))

	// Read pump (discard everything; spectators are read-only).
	go func() {
		defer cancel()
		for {
			if _, _, readErr := conn.Read(ctx); readErr != nil {
				return
			}
		}
	}()

	// Heartbeat.
	go func() {
		ticker := time.NewTicker(listingSpectatorPingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				pingCtx, pingCancel := context.WithTimeout(ctx, listingSpectatorWriteTimeout)
				if pingErr := conn.Ping(pingCtx); pingErr != nil {
					pingCancel()
					cancel()
					return
				}
				pingCancel()
			}
		}
	}()

	// Spectator-count broadcaster.
	go func() {
		ticker := time.NewTicker(listingSpectatorCountInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.sendSpectatorCount(ctx, conn, listingID, h.getSpectatorCount(ctx, listingID))
			}
		}
	}()

	// Write pump: 3-second-delayed, anonymized bid events.
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(listingSpectatorEventDelay):
			}

			anonymized := anonymizeListingEvent(msg.Payload)
			envelope := listingSpectatorMsg{
				Type:      "bid_event",
				ListingID: listingID,
				Data:      json.RawMessage(anonymized),
			}
			data, marshalErr := json.Marshal(envelope)
			if marshalErr != nil {
				continue
			}
			writeCtx, writeCancel := context.WithTimeout(ctx, listingSpectatorWriteTimeout)
			if writeErr := conn.Write(writeCtx, websocket.MessageText, data); writeErr != nil {
				writeCancel()
				return
			}
			writeCancel()
		}
	}
}

// anonymizeListingEvent strips PII from a bid-event payload before
// forwarding it to spectators.
func anonymizeListingEvent(payload string) string {
	var event map[string]interface{}
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		return `{"type":"bid_event"}`
	}
	for _, f := range listingPiiFields {
		delete(event, f)
	}
	result, err := json.Marshal(event)
	if err != nil {
		return `{"type":"bid_event"}`
	}
	return string(result)
}

func (h *MarketplaceSpectatorWSHandler) redisClient() *redis.Client {
	if h.cache == nil {
		return nil
	}
	return h.cache.Redis()
}

func (h *MarketplaceSpectatorWSHandler) checkListingCapacity(ctx context.Context, listingID string) bool {
	rdb := h.redisClient()
	if rdb == nil {
		h.mu.RLock()
		count := h.spectatorCount[listingID]
		h.mu.RUnlock()
		return count < maxSpectatorsPerListing
	}
	key := cache.Key("listing_spectators", listingID)
	count, err := rdb.SCard(ctx, key).Result()
	if err != nil {
		return true
	}
	return count < maxSpectatorsPerListing
}

func (h *MarketplaceSpectatorWSHandler) checkIPLimit(ctx context.Context, ip string) bool {
	rdb := h.redisClient()
	if rdb == nil {
		return true
	}
	key := cache.Key("listing_spectator_ip", ip)
	count, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		return true
	}
	if count == 1 {
		rdb.Expire(ctx, key, listingSpectatorIPKeyTTL)
	}
	return count <= maxListingSpectatorPerIP
}

func (h *MarketplaceSpectatorWSHandler) registerSpectator(ctx context.Context, listingID, spectatorID string) {
	rdb := h.redisClient()
	if rdb == nil {
		h.mu.Lock()
		h.spectatorCount[listingID]++
		h.mu.Unlock()
		return
	}
	key := cache.Key("listing_spectators", listingID)
	rdb.SAdd(ctx, key, spectatorID)
	rdb.Expire(ctx, key, listingSpectatorKeyTTL)
}

func (h *MarketplaceSpectatorWSHandler) unregisterSpectator(listingID, spectatorID string) {
	ctx := context.Background()
	rdb := h.redisClient()
	if rdb == nil {
		h.mu.Lock()
		h.spectatorCount[listingID]--
		if h.spectatorCount[listingID] <= 0 {
			delete(h.spectatorCount, listingID)
		}
		h.mu.Unlock()
		return
	}
	key := cache.Key("listing_spectators", listingID)
	rdb.SRem(ctx, key, spectatorID)
	if idx := lastIndexByte(spectatorID, ':'); idx > 0 {
		ip := spectatorID[:idx]
		rdb.Decr(ctx, cache.Key("listing_spectator_ip", ip))
	}
}

func (h *MarketplaceSpectatorWSHandler) getSpectatorCount(ctx context.Context, listingID string) int {
	rdb := h.redisClient()
	if rdb == nil {
		h.mu.RLock()
		count := h.spectatorCount[listingID]
		h.mu.RUnlock()
		return count
	}
	key := cache.Key("listing_spectators", listingID)
	count, err := rdb.SCard(ctx, key).Result()
	if err != nil {
		return 0
	}
	return int(count)
}

func (h *MarketplaceSpectatorWSHandler) sendSpectatorCount(ctx context.Context, conn *websocket.Conn, listingID string, count int) {
	msg := listingSpectatorMsg{
		Type:           "spectator_count",
		ListingID:      listingID,
		SpectatorCount: count,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	writeCtx, writeCancel := context.WithTimeout(ctx, listingSpectatorWriteTimeout)
	defer writeCancel()
	conn.Write(writeCtx, websocket.MessageText, data)
}
