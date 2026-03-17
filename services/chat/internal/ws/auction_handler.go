package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/redis/go-redis/v9"
	"nhooyr.io/websocket"
)

// AuctionHandler manages WebSocket connections for live auction streaming.
type AuctionHandler struct {
	rdb *redis.Client

	mu          sync.RWMutex
	subscribers map[string]map[*websocket.Conn]context.CancelFunc // jobID -> set of connections
}

// NewAuctionHandler creates a new auction WebSocket handler.
func NewAuctionHandler(rdb *redis.Client) *AuctionHandler {
	return &AuctionHandler{
		rdb:         rdb,
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

	if jobID != "" {
		h.subscribe(ctx, jobID, conn, cancel)
		defer h.unsubscribe(jobID, conn)
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
				h.subscribe(ctx, msg.JobID, conn, cancel)
			}
		case "unsubscribe_auction":
			if msg.JobID != "" {
				h.unsubscribe(msg.JobID, conn)
			}
		}
	}
}

func (h *AuctionHandler) subscribe(ctx context.Context, jobID string, conn *websocket.Conn, cancel context.CancelFunc) {
	h.mu.Lock()
	if h.subscribers[jobID] == nil {
		h.subscribers[jobID] = make(map[*websocket.Conn]context.CancelFunc)

		// Start Redis subscription for this job
		go h.listenRedis(jobID)
	}
	h.subscribers[jobID][conn] = cancel
	h.mu.Unlock()

	slog.Info("auction ws subscribed", "job_id", jobID)
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
