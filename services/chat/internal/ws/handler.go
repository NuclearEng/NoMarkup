package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
	"github.com/nomarkup/nomarkup/services/chat/internal/service"
	"github.com/redis/go-redis/v9"
	"nhooyr.io/websocket"
)

const (
	// maxMessageSize is the maximum size of a WebSocket message from the client.
	maxMessageSize = 4096

	// writeTimeout is the timeout for writing a message to the WebSocket.
	writeTimeout = 10 * time.Second

	// pingInterval is how often the server sends pings to keep the connection alive.
	pingInterval = 30 * time.Second

	// pongTimeout is how long the server waits for a pong response before closing.
	pongTimeout = 60 * time.Second
)

// ClientMessage represents a message sent from the client to the server.
type ClientMessage struct {
	Type      string `json:"type"`
	ChannelID string `json:"channel_id"`
}

// ServerMessage represents a message sent from the server to the client.
type ServerMessage struct {
	Type        string          `json:"type"`
	ChannelID   string          `json:"channel_id,omitempty"`
	Message     json.RawMessage `json:"message,omitempty"`
	UserID      string          `json:"user_id,omitempty"`
	UnreadCount int             `json:"unread_count,omitempty"`
	Error       string          `json:"error,omitempty"`
}

// channelSub tracks a Redis subscription for a single channel.
type channelSub struct {
	redisSub *redis.PubSub
	cancel   context.CancelFunc
}

// Connection represents a single WebSocket connection for a user.
type Connection struct {
	conn       *websocket.Conn
	userID     string
	hub        *Hub
	pubsub     *service.PubSub
	subs       map[string]*channelSub // channelID -> subscription
	subsMu     sync.Mutex
	sendCh     chan []byte
	closeCh    chan struct{}
	closeOnce  sync.Once
}

// Hub manages all active WebSocket connections, keyed by user ID.
type Hub struct {
	mu          sync.RWMutex
	connections map[string][]*Connection // userID -> connections
}

// NewHub creates a new connection hub.
func NewHub() *Hub {
	return &Hub{
		connections: make(map[string][]*Connection),
	}
}

// Register adds a connection to the hub.
func (h *Hub) Register(conn *Connection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.connections[conn.userID] = append(h.connections[conn.userID], conn)
	slog.Info("ws connection registered",
		"user_id", conn.userID,
		"total_connections", len(h.connections[conn.userID]),
	)
}

// Unregister removes a connection from the hub.
func (h *Hub) Unregister(conn *Connection) {
	h.mu.Lock()
	defer h.mu.Unlock()

	conns := h.connections[conn.userID]
	for i, c := range conns {
		if c == conn {
			h.connections[conn.userID] = append(conns[:i], conns[i+1:]...)
			break
		}
	}
	if len(h.connections[conn.userID]) == 0 {
		delete(h.connections, conn.userID)
	}
	slog.Info("ws connection unregistered",
		"user_id", conn.userID,
		"remaining_connections", len(h.connections[conn.userID]),
	)
}

// CloseAll closes all connections in the hub. Used during graceful shutdown.
func (h *Hub) CloseAll() {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, conns := range h.connections {
		for _, c := range conns {
			c.Close(websocket.StatusGoingAway, "server shutting down")
		}
	}
}

// Handler manages WebSocket connections for real-time chat messaging.
type Handler struct {
	hub    *Hub
	pubsub *service.PubSub
}

// NewHandler creates a new WebSocket handler with a connection hub and pub/sub service.
func NewHandler(hub *Hub, pubsub *service.PubSub) *Handler {
	return &Handler{
		hub:    hub,
		pubsub: pubsub,
	}
}

// ServeHTTP upgrades HTTP connections to WebSocket for real-time messaging.
// The user ID is expected as a query parameter ?user_id= set by the gateway
// after it validates the JWT token.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		slog.Warn("ws connection attempt without user_id", "remote_addr", r.RemoteAddr)
		http.Error(w, `{"error":"missing user_id parameter"}`, http.StatusUnauthorized)
		return
	}

	wsConn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// The gateway handles CORS; no need to check origin here.
		InsecureSkipVerify: true,
	})
	if err != nil {
		slog.Error("failed to accept websocket", "error", err, "remote_addr", r.RemoteAddr)
		return
	}

	wsConn.SetReadLimit(maxMessageSize)

	conn := &Connection{
		conn:    wsConn,
		userID:  userID,
		hub:     h.hub,
		pubsub:  h.pubsub,
		subs:    make(map[string]*channelSub),
		sendCh:  make(chan []byte, 64),
		closeCh: make(chan struct{}),
	}

	h.hub.Register(conn)
	defer func() {
		conn.cleanupSubscriptions()
		h.hub.Unregister(conn)
	}()

	slog.Info("ws connection established", "user_id", userID, "remote_addr", r.RemoteAddr)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Start the write pump in a goroutine.
	go conn.writePump(ctx)

	// Start the heartbeat in a goroutine.
	go conn.heartbeat(ctx, cancel)

	// Run the read pump in the current goroutine (blocks until connection closes).
	conn.readPump(ctx, cancel)
}

// readPump reads messages from the WebSocket and processes client commands.
func (c *Connection) readPump(ctx context.Context, cancel context.CancelFunc) {
	defer cancel()

	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure ||
				websocket.CloseStatus(err) == websocket.StatusGoingAway {
				slog.Info("ws connection closed normally", "user_id", c.userID)
			} else {
				slog.Warn("ws read error", "user_id", c.userID, "error", err)
			}
			return
		}

		var msg ClientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			c.sendError("invalid message format")
			continue
		}

		switch msg.Type {
		case "subscribe":
			c.handleSubscribe(ctx, msg.ChannelID)
		case "unsubscribe":
			c.handleUnsubscribe(msg.ChannelID)
		case "typing":
			c.handleTyping(ctx, msg.ChannelID)
		default:
			c.sendError(fmt.Sprintf("unknown message type: %s", msg.Type))
		}
	}
}

// writePump sends messages from the sendCh to the WebSocket connection.
func (c *Connection) writePump(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closeCh:
			return
		case data, ok := <-c.sendCh:
			if !ok {
				return
			}
			writeCtx, writeCancel := context.WithTimeout(ctx, writeTimeout)
			err := c.conn.Write(writeCtx, websocket.MessageText, data)
			writeCancel()
			if err != nil {
				slog.Warn("ws write error", "user_id", c.userID, "error", err)
				return
			}
		}
	}
}

// heartbeat sends periodic pings to keep the connection alive.
func (c *Connection) heartbeat(ctx context.Context, cancel context.CancelFunc) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closeCh:
			return
		case <-ticker.C:
			pingCtx, pingCancel := context.WithTimeout(ctx, pongTimeout)
			err := c.conn.Ping(pingCtx)
			pingCancel()
			if err != nil {
				slog.Warn("ws ping failed, closing connection",
					"user_id", c.userID,
					"error", err,
				)
				cancel()
				return
			}
		}
	}
}

// handleSubscribe subscribes the connection to a channel's Redis pub/sub topics.
func (c *Connection) handleSubscribe(ctx context.Context, channelID string) {
	if channelID == "" {
		c.sendError("channel_id is required for subscribe")
		return
	}

	c.subsMu.Lock()
	defer c.subsMu.Unlock()

	// Already subscribed.
	if _, exists := c.subs[channelID]; exists {
		return
	}

	subCtx, subCancel := context.WithCancel(ctx)

	// Subscribe to both message and typing topics.
	messageTopic := fmt.Sprintf("chat:%s", channelID)
	typingTopic := fmt.Sprintf("chat:%s:typing", channelID)

	redisSub := c.pubsub.SubscribeTopics(subCtx, messageTopic, typingTopic)

	c.subs[channelID] = &channelSub{
		redisSub: redisSub,
		cancel:   subCancel,
	}

	// Start listening for messages in a goroutine.
	go c.listenRedis(subCtx, channelID, redisSub)

	slog.Info("ws subscribed to channel",
		"user_id", c.userID,
		"channel_id", channelID,
	)
}

// handleUnsubscribe removes the subscription for a channel.
func (c *Connection) handleUnsubscribe(channelID string) {
	if channelID == "" {
		c.sendError("channel_id is required for unsubscribe")
		return
	}

	c.subsMu.Lock()
	defer c.subsMu.Unlock()

	sub, exists := c.subs[channelID]
	if !exists {
		return
	}

	sub.cancel()
	if err := sub.redisSub.Close(); err != nil {
		slog.Warn("failed to close redis subscription",
			"user_id", c.userID,
			"channel_id", channelID,
			"error", err,
		)
	}
	delete(c.subs, channelID)

	slog.Info("ws unsubscribed from channel",
		"user_id", c.userID,
		"channel_id", channelID,
	)
}

// handleTyping publishes a typing indicator via Redis.
func (c *Connection) handleTyping(ctx context.Context, channelID string) {
	if channelID == "" {
		c.sendError("channel_id is required for typing")
		return
	}

	if err := c.pubsub.PublishTyping(ctx, channelID, c.userID); err != nil {
		slog.Warn("failed to publish typing indicator",
			"user_id", c.userID,
			"channel_id", channelID,
			"error", err,
		)
	}
}

// listenRedis reads messages from a Redis subscription and forwards them to the WebSocket.
func (c *Connection) listenRedis(ctx context.Context, channelID string, redisSub *redis.PubSub) {
	ch := redisSub.Channel()

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closeCh:
			return
		case redisMsg, ok := <-ch:
			if !ok {
				return
			}
			c.forwardRedisMessage(channelID, redisMsg)
		}
	}
}

// forwardRedisMessage converts a Redis pub/sub message to a ServerMessage and sends it.
func (c *Connection) forwardRedisMessage(channelID string, redisMsg *redis.Message) {
	// Determine type based on the Redis topic.
	isTyping := len(redisMsg.Channel) > len(channelID)+5 &&
		redisMsg.Channel[len(redisMsg.Channel)-7:] == ":typing"

	var serverMsg ServerMessage
	if isTyping {
		// Parse the typing payload to extract user_id.
		var payload struct {
			UserID string `json:"user_id"`
		}
		if err := json.Unmarshal([]byte(redisMsg.Payload), &payload); err != nil {
			slog.Warn("failed to parse typing payload", "error", err)
			return
		}
		// Don't send typing indicators for the user's own typing.
		if payload.UserID == c.userID {
			return
		}
		serverMsg = ServerMessage{
			Type:      "typing",
			ChannelID: channelID,
			UserID:    payload.UserID,
		}
	} else {
		// It's a chat message. Parse to check sender and avoid echo.
		var msgPayload domain.Message
		if err := json.Unmarshal([]byte(redisMsg.Payload), &msgPayload); err != nil {
			slog.Warn("failed to parse message payload", "error", err)
			return
		}
		serverMsg = ServerMessage{
			Type:      "message",
			ChannelID: channelID,
			Message:   json.RawMessage(redisMsg.Payload),
		}
	}

	data, err := json.Marshal(serverMsg)
	if err != nil {
		slog.Warn("failed to marshal server message", "error", err)
		return
	}

	select {
	case c.sendCh <- data:
	default:
		slog.Warn("ws send buffer full, dropping message",
			"user_id", c.userID,
			"channel_id", channelID,
		)
	}
}

// sendError sends an error message to the client.
func (c *Connection) sendError(msg string) {
	serverMsg := ServerMessage{
		Type:  "error",
		Error: msg,
	}
	data, err := json.Marshal(serverMsg)
	if err != nil {
		slog.Warn("failed to marshal error message", "error", err)
		return
	}
	select {
	case c.sendCh <- data:
	default:
		slog.Warn("ws send buffer full, dropping error message", "user_id", c.userID)
	}
}

// Close closes the WebSocket connection with the given status code and reason.
func (c *Connection) Close(code websocket.StatusCode, reason string) {
	c.closeOnce.Do(func() {
		close(c.closeCh)
		c.cleanupSubscriptions()
		c.conn.Close(code, reason)
	})
}

// cleanupSubscriptions closes all Redis subscriptions for this connection.
func (c *Connection) cleanupSubscriptions() {
	c.subsMu.Lock()
	defer c.subsMu.Unlock()

	for channelID, sub := range c.subs {
		sub.cancel()
		if err := sub.redisSub.Close(); err != nil {
			slog.Warn("failed to close redis subscription during cleanup",
				"user_id", c.userID,
				"channel_id", channelID,
				"error", err,
			)
		}
	}
	// Clear the map.
	c.subs = make(map[string]*channelSub)
}
