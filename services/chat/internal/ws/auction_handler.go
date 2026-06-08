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

const (
	// auctionSendBuffer is the per-connection outbound buffer depth. A connection
	// that falls this far behind is closed so the client reconnects + refetches,
	// rather than head-of-line-blocking fan-out for the whole job.
	auctionSendBuffer = 64

	// auctionWriteTimeout bounds a single write to one auction connection.
	auctionWriteTimeout = 10 * time.Second
)

// JobAuthorizer verifies that a user is a party to a job (owner or bidder) and
// is therefore allowed to receive that job's privileged, real-time auction
// feed. Implemented by the chat service.
type JobAuthorizer interface {
	IsJobParticipant(ctx context.Context, jobID, userID string) (bool, error)
}

// auctionConn is a single subscriber connection with its own bounded send
// channel and writer goroutine. Fan-out enqueues onto sendCh and never blocks
// on a slow client.
type auctionConn struct {
	conn      *websocket.Conn
	cancel    context.CancelFunc
	sendCh    chan []byte
	closeOnce sync.Once
}

// enqueue attempts to buffer data for delivery. It reports false if the buffer
// is full, signalling the caller that this slow connection should be dropped.
func (ac *auctionConn) enqueue(data []byte) bool {
	select {
	case ac.sendCh <- data:
		return true
	default:
		return false
	}
}

// auctionJob tracks the set of subscribers for a single job plus the cancel
// func for its single long-lived Redis listener. The listener runs as long as
// there is at least one subscriber (explicit refcounting via len(conns)).
type auctionJob struct {
	conns        map[*websocket.Conn]*auctionConn
	listenCancel context.CancelFunc
}

// AuctionHandler manages WebSocket connections for live auction streaming.
type AuctionHandler struct {
	rdb            *redis.Client
	authorizer     JobAuthorizer
	internalSecret string

	mu   sync.RWMutex
	jobs map[string]*auctionJob // jobID -> subscribers + listener
}

// NewAuctionHandler creates a new auction WebSocket handler. The authorizer is
// used to ensure only job participants (owner/bidder) receive the real-time,
// un-delayed, un-anonymized auction feed; anonymous spectators must use the
// gateway's public spectator endpoint, which delays and PII-strips events.
func NewAuctionHandler(rdb *redis.Client, authorizer JobAuthorizer) *AuctionHandler {
	return &AuctionHandler{
		rdb:            rdb,
		authorizer:     authorizer,
		internalSecret: InternalWSSecret(),
		jobs:           make(map[string]*auctionJob),
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
	// Defense-in-depth: verify the gateway's shared secret before trusting the
	// query-string user_id. Fail closed.
	if !verifyInternalSecret(r, h.internalSecret) {
		slog.Warn("auction ws rejected: invalid internal secret", "remote_addr", r.RemoteAddr)
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

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

	// Each connection gets its own buffered send channel + writer goroutine so a
	// slow client never blocks Redis fan-out for the whole job.
	ac := &auctionConn{
		conn:   conn,
		cancel: cancel,
		sendCh: make(chan []byte, auctionSendBuffer),
	}
	go ac.writePump(ctx)

	if jobID != "" {
		if h.subscribe(ctx, userID, jobID, ac) {
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
				h.subscribe(ctx, userID, msg.JobID, ac)
			}
		case "unsubscribe_auction":
			if msg.JobID != "" {
				h.unsubscribe(msg.JobID, conn)
			}
		}
	}
}

// writePump drains the connection's send channel to the socket. A write error
// or context cancellation tears down the connection.
func (ac *auctionConn) writePump(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case data, ok := <-ac.sendCh:
			if !ok {
				return
			}
			writeCtx, writeCancel := context.WithTimeout(ctx, auctionWriteTimeout)
			err := ac.conn.Write(writeCtx, websocket.MessageText, data)
			writeCancel()
			if err != nil {
				slog.Warn("auction ws write error", "error", err)
				ac.cancel()
				return
			}
		}
	}
}

// subscribe authorizes the user for the job's real-time feed and, on success,
// registers the connection. Returns true if the subscription was established.
// Authorization is effectively cached per (connection, job): an already-
// subscribed connection short-circuits before re-querying.
func (h *AuctionHandler) subscribe(ctx context.Context, userID, jobID string, ac *auctionConn) bool {
	// Fast path: already subscribed (and therefore already authorized).
	h.mu.RLock()
	if job, ok := h.jobs[jobID]; ok {
		if _, already := job.conns[ac.conn]; already {
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
		h.sendError(ctx, ac.conn, "subscription unavailable")
		return false
	}
	allowed, err := h.authorizer.IsJobParticipant(ctx, jobID, userID)
	if err != nil {
		slog.Error("auction ws participant check failed",
			"user_id", userID, "job_id", jobID, "error", err)
		h.sendError(ctx, ac.conn, "subscription unavailable")
		return false
	}
	if !allowed {
		slog.Warn("auction ws subscribe denied: not a job participant",
			"user_id", userID, "job_id", jobID)
		h.sendError(ctx, ac.conn, "not authorized for this auction")
		return false
	}

	h.mu.Lock()
	job, ok := h.jobs[jobID]
	if !ok {
		// First subscriber: start the single long-lived Redis listener. It runs
		// until the last subscriber leaves (refcount via len(job.conns)).
		listenCtx, listenCancel := context.WithCancel(context.Background())
		job = &auctionJob{
			conns:        make(map[*websocket.Conn]*auctionConn),
			listenCancel: listenCancel,
		}
		h.jobs[jobID] = job
		go h.listenRedis(listenCtx, jobID)
	}
	job.conns[ac.conn] = ac
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

	job, ok := h.jobs[jobID]
	if !ok {
		return
	}
	delete(job.conns, conn)
	if len(job.conns) == 0 {
		// Last subscriber gone: stop the long-lived listener and drop the job.
		job.listenCancel()
		delete(h.jobs, jobID)
	}
}

// listenRedis is a single long-lived subscriber for a job's auction topic. It
// runs from the first subscribe until the last unsubscribe (ctx cancelled),
// eliminating the start/stop race where a message arriving during a
// teardown/rebuild gap was dropped. Fan-out enqueues onto each connection's
// bounded buffer; a connection that has fallen behind is closed (it will
// reconnect and refetch) rather than blocking the others.
func (h *AuctionHandler) listenRedis(ctx context.Context, jobID string) {
	topic := fmt.Sprintf("auction:%s", jobID)
	sub := h.rdb.Subscribe(ctx, topic)
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}

			serverMsg := auctionServerMsg{
				Type:  "bid_event",
				JobID: jobID,
				Data:  json.RawMessage(msg.Payload),
			}
			data, err := json.Marshal(serverMsg)
			if err != nil {
				continue
			}

			// Snapshot subscribers under the lock, then enqueue without holding
			// it so a slow client's buffer can't stall the fan-out.
			h.mu.RLock()
			job, ok := h.jobs[jobID]
			if !ok {
				h.mu.RUnlock()
				return
			}
			targets := make([]*auctionConn, 0, len(job.conns))
			for _, ac := range job.conns {
				targets = append(targets, ac)
			}
			h.mu.RUnlock()

			for _, ac := range targets {
				if !ac.enqueue(data) {
					// Buffer full: client fell behind. Close so it reconnects
					// and refetches the current auction state.
					slog.Warn("auction ws send buffer full, dropping connection",
						"job_id", jobID)
					ac.closeOnce.Do(func() {
						ac.conn.Close(websocket.StatusTryAgainLater, "fell behind, reconnect")
						ac.cancel()
					})
				}
			}
		}
	}
}
