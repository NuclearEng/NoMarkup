package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"nhooyr.io/websocket"
)

// JobAuthorizer verifies that a user is a party to a job (owner or bidder) and
// is therefore allowed to receive that job's privileged, real-time auction
// feed. Implemented by the chat service.
type JobAuthorizer interface {
	IsJobParticipant(ctx context.Context, jobID, userID string) (bool, error)
}

// AuctionHandler manages WebSocket connections for live auction streaming.
type AuctionHandler struct {
	rdb        *redis.Client
	authorizer JobAuthorizer

	mu          sync.RWMutex
	subscribers map[string]map[*websocket.Conn]context.CancelFunc // jobID -> set of connections
}

// NewAuctionHandler creates a new auction WebSocket handler. The authorizer is
// used to ensure only job participants (owner/bidder) receive the real-time,
// un-delayed, un-anonymized auction feed; anonymous spectators must use the
// gateway's public spectator endpoint, which delays and PII-strips events.
func NewAuctionHandler(rdb *redis.Client, authorizer JobAuthorizer) *AuctionHandler {
	return &AuctionHandler{
		rdb:         rdb,
		authorizer:  authorizer,
		subscribers: make(map[string]map[*websocket.Conn]context.CancelFunc),
	}
}

// auctionClientMsg is the message format from the client.
type auctionClientMsg struct {
	Type  string `json:"type"`
	JobID string `json:"job_id"`
}

// auctionServerMsg is the message format sent to the client.
type auctionServerMsg struct {
	Type  string          `json:"type"`
	JobID string          `json:"job_id,omitempty"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error string          `json:"error,omitempty"`
}

// HandleWebSocket handles an incoming auction WebSocket connection.
func (h *AuctionHandler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	jobID := r.URL.Query().Get("job_id")

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // CORS handled by gateway
	})
	if err != nil {
		slog.Error("auction ws accept failed", "error", err)
		return
	}
	defer conn.CloseNow()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	slog.Info("auction ws connected", "user_id", userID, "job_id", jobID)

	// The gateway proxy authenticates the JWT and forwards the user_id. A
	// connection without a user_id is unauthenticated and must not receive the
	// privileged real-time feed. Fail closed.
	if userID == "" {
		slog.Warn("auction ws rejected: missing user_id", "remote_addr", r.RemoteAddr)
		h.sendError(ctx, conn, "authentication required")
		conn.Close(websocket.StatusPolicyViolation, "authentication required")
		return
	}

	if jobID != "" {
		if h.subscribe(ctx, userID, jobID, conn, cancel) {
			defer h.unsubscribe(jobID, conn)
		}
	}

	// Read pump — handle client messages
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) != websocket.StatusNormalClosure {
				slog.Warn("auction ws read error", "user_id", userID, "error", err)
			}
			return
		}

		var msg auctionClientMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Warn("auction ws invalid message", "user_id", userID, "error", err)
			continue
		}

		switch msg.Type {
		case "subscribe_auction":
			if msg.JobID != "" {
				h.subscribe(ctx, userID, msg.JobID, conn, cancel)
			}
		case "unsubscribe_auction":
			if msg.JobID != "" {
				h.unsubscribe(msg.JobID, conn)
			}
		}
	}
}

// subscribe authorizes the user for the job's real-time feed and, on success,
// registers the connection. Returns true if the subscription was established.
// Authorization is effectively cached per (connection, job): an already-
// subscribed connection short-circuits before re-querying.
func (h *AuctionHandler) subscribe(ctx context.Context, userID, jobID string, conn *websocket.Conn, cancel context.CancelFunc) bool {
	// Fast path: already subscribed (and therefore already authorized).
	h.mu.RLock()
	if subs, ok := h.subscribers[jobID]; ok {
		if _, already := subs[conn]; already {
			h.mu.RUnlock()
			return true
		}
	}
	h.mu.RUnlock()

	// Authorize: only a participant of the job (owner or bidder) may receive
	// the un-delayed, un-anonymized authed feed. Anonymous/non-party users
	// must use the gateway spectator path. Fail closed.
	if h.authorizer == nil {
		slog.Error("auction ws subscribe denied: no authorizer configured",
			"user_id", userID, "job_id", jobID)
		h.sendError(ctx, conn, "subscription unavailable")
		return false
	}
	allowed, err := h.authorizer.IsJobParticipant(ctx, jobID, userID)
	if err != nil {
		slog.Error("auction ws participant check failed",
			"user_id", userID, "job_id", jobID, "error", err)
		h.sendError(ctx, conn, "subscription unavailable")
		return false
	}
	if !allowed {
		slog.Warn("auction ws subscribe denied: not a job participant",
			"user_id", userID, "job_id", jobID)
		h.sendError(ctx, conn, "not authorized for this auction")
		return false
	}

	h.mu.Lock()
	if h.subscribers[jobID] == nil {
		h.subscribers[jobID] = make(map[*websocket.Conn]context.CancelFunc)

		// Start Redis subscription for this job
		go h.listenRedis(jobID)
	}
	h.subscribers[jobID][conn] = cancel
	h.mu.Unlock()

	slog.Info("auction ws subscribed", "user_id", userID, "job_id", jobID)
	return true
}

// sendError sends a best-effort error frame to the client.
func (h *AuctionHandler) sendError(ctx context.Context, conn *websocket.Conn, msg string) {
	data, err := json.Marshal(auctionServerMsg{Type: "error", Error: msg})
	if err != nil {
		return
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_ = conn.Write(writeCtx, websocket.MessageText, data)
}

func (h *AuctionHandler) unsubscribe(jobID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if subs, ok := h.subscribers[jobID]; ok {
		delete(subs, conn)
		if len(subs) == 0 {
			delete(h.subscribers, jobID)
		}
	}
}

func (h *AuctionHandler) listenRedis(jobID string) {
	topic := fmt.Sprintf("auction:%s", jobID)
	sub := h.rdb.Subscribe(context.Background(), topic)
	defer sub.Close()

	ch := sub.Channel()
	for msg := range ch {
		h.mu.RLock()
		subs, ok := h.subscribers[jobID]
		if !ok || len(subs) == 0 {
			h.mu.RUnlock()
			return // No more subscribers, stop listening
		}

		serverMsg := auctionServerMsg{
			Type:  "bid_event",
			JobID: jobID,
			Data:  json.RawMessage(msg.Payload),
		}
		data, err := json.Marshal(serverMsg)
		if err != nil {
			h.mu.RUnlock()
			continue
		}

		for conn := range subs {
			if err := conn.Write(context.Background(), websocket.MessageText, data); err != nil {
				slog.Warn("auction ws write error", "job_id", jobID, "error", err)
			}
		}
		h.mu.RUnlock()
	}
}
