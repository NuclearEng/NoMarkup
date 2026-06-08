package handler

// Route registration (for router.go):
//   r.Get("/ws/auction/{jobId}/spectate", spectatorWSHandler.SpectateAuction)
// This route should be PUBLIC (no auth middleware). The spectatorWSHandler
// should be passed to router.New alongside the existing auctionWSHandler.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"nhooyr.io/websocket"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const (
	// maxSpectatorsPerAuction is the maximum number of concurrent spectators per auction.
	maxSpectatorsPerAuction = 500

	// maxSpectatorConnectionsPerIP is the maximum number of concurrent spectator connections
	// from a single IP address.
	maxSpectatorConnectionsPerIP = 5

	// spectatorEventDelay is the delay applied to events before forwarding to spectators.
	// This prevents real-time front-running while still providing a live feel.
	spectatorEventDelay = 3 * time.Second

	// spectatorKeyTTL is how long the Redis spectator tracking set persists.
	spectatorKeyTTL = 2 * time.Hour

	// spectatorIPKeyTTL is how long the per-IP connection counter persists.
	spectatorIPKeyTTL = 5 * time.Minute

	// spectatorPingInterval is how often the server pings spectator connections.
	spectatorPingInterval = 30 * time.Second

	// spectatorWriteTimeout is the timeout for writing a single message.
	spectatorWriteTimeout = 10 * time.Second
)

// piiFields are the fields stripped from auction events before forwarding to spectators.
var piiFields = []string{
	"provider_id",
	"provider_name",
	"provider_business_name",
	"provider_avatar_url",
	"user_id",
	"bidder_id",
	"email",
	"phone",
}

// SpectatorWSHandler handles anonymous WebSocket connections for auction spectators.
type SpectatorWSHandler struct {
	cache *cache.Client

	mu             sync.RWMutex
	spectatorCount map[string]int // jobID -> count (in-memory fallback when Redis is nil)
}

// NewSpectatorWSHandler creates a new SpectatorWSHandler.
func NewSpectatorWSHandler(cacheClient *cache.Client) *SpectatorWSHandler {
	return &SpectatorWSHandler{
		cache:          cacheClient,
		spectatorCount: make(map[string]int),
	}
}

// SpectateAuction handles anonymous WebSocket connections for auction spectators.
// This endpoint is publicly accessible (no authentication required).
func (h *SpectatorWSHandler) SpectateAuction(w http.ResponseWriter, r *http.Request) {
	// Check feature flag.
	if os.Getenv("ENABLE_LIVE_AUCTION") != "true" {
		writeError(w, http.StatusNotFound, "live auctions not enabled")
		return
	}

	jobID := chi.URLParam(r, "jobId")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job ID required")
		return
	}

	ip := extractClientIP(r)

	// Check per-auction spectator limit.
	if !h.checkAuctionCapacity(r.Context(), jobID) {
		writeError(w, http.StatusServiceUnavailable, "auction spectator limit reached")
		return
	}

	// Check per-IP connection limit.
	if !h.checkIPLimit(r.Context(), ip) {
		writeError(w, http.StatusTooManyRequests, "too many spectator connections from this IP")
		return
	}

	// Accept the WebSocket connection. OriginPatterns enforces the Same-Origin
	// policy — even for anonymous spectator flows, we fail closed to prevent
	// arbitrary third-party sites from embedding our feed.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: wsOriginPatterns(),
	})
	if err != nil {
		slog.Error("spectator ws accept failed", "error", err, "remote_addr", r.RemoteAddr)
		return
	}
	defer conn.CloseNow()

	// Limit incoming message size (spectators should not send meaningful data).
	conn.SetReadLimit(256)

	// Register spectator.
	spectatorID := fmt.Sprintf("%s:%d", ip, time.Now().UnixNano())
	h.registerSpectator(r.Context(), jobID, spectatorID)
	defer h.unregisterSpectator(jobID, spectatorID)

	slog.Info("spectator ws connected",
		"job_id", jobID,
		"remote_addr", r.RemoteAddr,
	)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Subscribe to auction events via Redis pub/sub.
	rdb := h.redisClient()
	if rdb == nil {
		slog.Error("spectator ws: redis unavailable, cannot stream events")
		conn.Close(websocket.StatusInternalError, "service unavailable")
		return
	}

	pubsub := rdb.Subscribe(ctx, fmt.Sprintf("auction:%s", jobID))
	defer pubsub.Close()

	ch := pubsub.Channel()

	// Send initial spectator count.
	count := h.getSpectatorCount(ctx, jobID)
	h.sendSpectatorCount(ctx, conn, jobID, count)

	// Read pump: discard all incoming messages (spectators are read-only).
	// Close when the client disconnects.
	go func() {
		defer cancel()
		for {
			_, _, readErr := conn.Read(ctx)
			if readErr != nil {
				return
			}
			// All client messages are silently discarded.
		}
	}()

	// Heartbeat pump: keep the connection alive.
	go func() {
		ticker := time.NewTicker(spectatorPingInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				pingCtx, pingCancel := context.WithTimeout(ctx, spectatorWriteTimeout)
				if pingErr := conn.Ping(pingCtx); pingErr != nil {
					pingCancel()
					slog.Debug("spectator ws ping failed",
						"job_id", jobID,
						"error", pingErr,
					)
					cancel()
					return
				}
				pingCancel()
			}
		}
	}()

	// Periodically broadcast updated spectator count.
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c := h.getSpectatorCount(ctx, jobID)
				h.sendSpectatorCount(ctx, conn, jobID, c)
			}
		}
	}()

	// Write pump: forward delayed, anonymized events.
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}

			// Delay events by spectatorEventDelay to prevent real-time front-running.
			select {
			case <-ctx.Done():
				return
			case <-time.After(spectatorEventDelay):
			}

			// Anonymize the event payload.
			anonymized := anonymizeEvent(msg.Payload)

			// Wrap in spectator message envelope.
			envelope := spectatorServerMsg{
				Type:  "bid_event",
				JobID: jobID,
				Data:  json.RawMessage(anonymized),
			}
			data, marshalErr := json.Marshal(envelope)
			if marshalErr != nil {
				slog.Warn("spectator ws marshal error", "error", marshalErr)
				continue
			}

			writeCtx, writeCancel := context.WithTimeout(ctx, spectatorWriteTimeout)
			if writeErr := conn.Write(writeCtx, websocket.MessageText, data); writeErr != nil {
				writeCancel()
				slog.Debug("spectator ws write error",
					"job_id", jobID,
					"error", writeErr,
				)
				return
			}
			writeCancel()
		}
	}
}

// spectatorServerMsg is the message format sent to spectator clients.
type spectatorServerMsg struct {
	Type           string          `json:"type"`
	JobID          string          `json:"job_id,omitempty"`
	Data           json.RawMessage `json:"data,omitempty"`
	SpectatorCount int             `json:"spectator_count,omitempty"`
}

// anonymizeEvent strips PII from auction events for spectator consumption.
func anonymizeEvent(payload string) string {
	var event map[string]interface{}
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		// If we cannot parse, return a minimal safe event.
		return `{"type":"bid_event"}`
	}

	for _, field := range piiFields {
		delete(event, field)
	}

	result, err := json.Marshal(event)
	if err != nil {
		return `{"type":"bid_event"}`
	}
	return string(result)
}

// redisClient returns the underlying Redis client from the cache, or nil.
func (h *SpectatorWSHandler) redisClient() *redis.Client {
	if h.cache == nil {
		return nil
	}
	return h.cache.Redis()
}

// checkAuctionCapacity checks whether the auction can accept another spectator.
func (h *SpectatorWSHandler) checkAuctionCapacity(ctx context.Context, jobID string) bool {
	rdb := h.redisClient()
	if rdb == nil {
		// In-memory fallback.
		h.mu.RLock()
		count := h.spectatorCount[jobID]
		h.mu.RUnlock()
		return count < maxSpectatorsPerAuction
	}

	key := cache.Key("spectators", jobID)
	count, err := rdb.SCard(ctx, key).Result()
	if err != nil {
		slog.Warn("spectator ws: redis SCard error, allowing connection", "error", err)
		return true // Fail open.
	}
	return count < maxSpectatorsPerAuction
}

// checkIPLimit checks whether the IP can open another spectator connection.
func (h *SpectatorWSHandler) checkIPLimit(ctx context.Context, ip string) bool {
	rdb := h.redisClient()
	if rdb == nil {
		return true // Cannot enforce IP limits without Redis; fail open.
	}

	key := cache.Key("spectator_ip", ip)
	count, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		slog.Warn("spectator ws: redis Incr error, allowing connection", "error", err)
		return true
	}

	// Set TTL on first increment.
	if count == 1 {
		rdb.Expire(ctx, key, spectatorIPKeyTTL)
	}

	if count > maxSpectatorConnectionsPerIP {
		// Over the cap: this connection is rejected and never registers, so the
		// Decr in unregisterSpectator never runs. Undo the speculative Incr now
		// so a rejected attempt consumes no slot — otherwise sustained over-cap
		// attempts from one IP leak the counter and lock the IP out for the TTL.
		// (We keep the atomic Incr-then-check to avoid a GET/Incr TOCTOU.)
		rdb.Decr(ctx, key)
		return false
	}

	return true
}

// registerSpectator adds a spectator to the tracking set for an auction.
func (h *SpectatorWSHandler) registerSpectator(ctx context.Context, jobID, spectatorID string) {
	rdb := h.redisClient()
	if rdb == nil {
		h.mu.Lock()
		h.spectatorCount[jobID]++
		h.mu.Unlock()
		return
	}

	key := cache.Key("spectators", jobID)
	rdb.SAdd(ctx, key, spectatorID)
	rdb.Expire(ctx, key, spectatorKeyTTL)
}

// unregisterSpectator removes a spectator from the tracking set and decrements the IP counter.
func (h *SpectatorWSHandler) unregisterSpectator(jobID, spectatorID string) {
	ctx := context.Background()

	rdb := h.redisClient()
	if rdb == nil {
		h.mu.Lock()
		h.spectatorCount[jobID]--
		if h.spectatorCount[jobID] <= 0 {
			delete(h.spectatorCount, jobID)
		}
		h.mu.Unlock()
		return
	}

	key := cache.Key("spectators", jobID)
	rdb.SRem(ctx, key, spectatorID)

	// Decrement IP counter. Extract IP from spectatorID (format: "ip:timestamp").
	// We stored the spectatorID as "ip:nano", so split on the last colon is not safe
	// for IPv6. Instead, extract everything before the last ":".
	if idx := lastIndexByte(spectatorID, ':'); idx > 0 {
		ip := spectatorID[:idx]
		ipKey := cache.Key("spectator_ip", ip)
		rdb.Decr(ctx, ipKey)
	}
}

// getSpectatorCount returns the current spectator count for an auction.
func (h *SpectatorWSHandler) getSpectatorCount(ctx context.Context, jobID string) int {
	rdb := h.redisClient()
	if rdb == nil {
		h.mu.RLock()
		count := h.spectatorCount[jobID]
		h.mu.RUnlock()
		return count
	}

	key := cache.Key("spectators", jobID)
	count, err := rdb.SCard(ctx, key).Result()
	if err != nil {
		return 0
	}
	return int(count)
}

// sendSpectatorCount sends a spectator count update to the client.
func (h *SpectatorWSHandler) sendSpectatorCount(ctx context.Context, conn *websocket.Conn, jobID string, count int) {
	msg := spectatorServerMsg{
		Type:           "spectator_count",
		JobID:          jobID,
		SpectatorCount: count,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	writeCtx, writeCancel := context.WithTimeout(ctx, spectatorWriteTimeout)
	defer writeCancel()
	conn.Write(writeCtx, websocket.MessageText, data)
}

// lastIndexByte returns the index of the last occurrence of c in s, or -1.
func lastIndexByte(s string, c byte) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == c {
			return i
		}
	}
	return -1
}

// extractClientIP returns the client IP, honoring proxy headers only when the
// direct peer is a trusted proxy (see middleware.ClientIP).
func extractClientIP(r *http.Request) string {
	return middleware.ClientIP(r)
}
