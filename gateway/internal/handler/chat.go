package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	chatv1 "github.com/nomarkup/nomarkup/proto/chat/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"google.golang.org/protobuf/types/known/timestamppb"
	"nhooyr.io/websocket"
)

// maxMessageContentLen caps chat message length, mirrored from the frontend
// Zod schema in web/src/lib/validations.ts (chatMessageSchema .max(2000)).
// Enforced server-side so an oversized message is rejected with a clean 400
// rather than persisting an unbounded TEXT value (DoS via storage/render).
// Measured in runes, not bytes.
const maxMessageContentLen = 2000

// ChatHandler handles HTTP endpoints for chat channels and messages.
//
// db is optional — when non-nil, the SendMessage path enforces user_blocks
// (Wave 5 / Agent P) before forwarding to the chat gRPC service. With a
// nil pool the block check is skipped (matches the rest of the gateway's
// nil-safe DB pattern; the gRPC service still runs).
type ChatHandler struct {
	chatClient     chatv1.ChatServiceClient
	authMW         *middleware.AuthMiddleware
	chatWSAddr     string
	internalSecret string // shared secret presented to the chat WS backend
	db             *pgxpool.Pool
}

// NewChatHandler creates a new ChatHandler. internalSecret is the shared secret
// presented to the chat WS backend on dial (defense-in-depth so the backend can
// reject connections that did not transit the gateway).
func NewChatHandler(chatClient chatv1.ChatServiceClient, authMW *middleware.AuthMiddleware, chatWSAddr, internalSecret string, db *pgxpool.Pool) *ChatHandler {
	return &ChatHandler{
		chatClient:     chatClient,
		authMW:         authMW,
		chatWSAddr:     chatWSAddr,
		internalSecret: internalSecret,
		db:             db,
	}
}

// internalWSDialHeader builds the dial header carrying the gateway->chat shared
// secret. Returns nil when no secret is configured.
func internalWSDialHeader(secret string) http.Header {
	if secret == "" {
		return nil
	}
	h := http.Header{}
	h.Set("X-Internal-WS-Secret", secret)
	return h
}

// ListChannels handles GET /api/v1/channels.
func (h *ChatHandler) ListChannels(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()

	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil {
			pageSize = int32(v)
		}
	}

	resp, err := h.chatClient.ListChannels(r.Context(), &chatv1.ListChannelsRequest{
		UserId: claims.UserID,
		Pagination: &commonv1.PaginationRequest{
			Page:     page,
			PageSize: pageSize,
		},
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	channels := make([]map[string]interface{}, 0, len(resp.GetChannels()))
	for _, ch := range resp.GetChannels() {
		channels = append(channels, protoChannelToJSON(ch))
	}

	result := map[string]interface{}{
		"channels": channels,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"totalCount": pg.GetTotalCount(),
			"page":        pg.GetPage(),
			"pageSize":   pg.GetPageSize(),
			"totalPages": pg.GetTotalPages(),
			"hasNext":    pg.GetHasNext(),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// GetChannel handles GET /api/v1/channels/{id}.
func (h *ChatHandler) GetChannel(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	channelID := chi.URLParam(r, "id")
	if channelID == "" {
		writeError(w, http.StatusBadRequest, "channel id required")
		return
	}
	if !isValidUUID(channelID) {
		writeError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	resp, err := h.chatClient.GetChannel(r.Context(), &chatv1.GetChannelRequest{
		ChannelId: channelID,
		UserId:    claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoChannelToJSON(resp.GetChannel()))
}

// ListMessages handles GET /api/v1/channels/{id}/messages.
func (h *ChatHandler) ListMessages(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	channelID := chi.URLParam(r, "id")
	if channelID == "" {
		writeError(w, http.StatusBadRequest, "channel id required")
		return
	}
	if !isValidUUID(channelID) {
		writeError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	q := r.URL.Query()

	pageSize := int32(50)
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil {
			pageSize = int32(v)
		}
	}

	req := &chatv1.ListMessagesRequest{
		ChannelId: channelID,
		UserId:    claims.UserID,
		Pagination: &commonv1.PaginationRequest{
			PageSize: pageSize,
		},
	}

	if before := q.Get("before"); before != "" {
		t, err := time.Parse(time.RFC3339, before)
		if err == nil {
			req.Before = timestamppb.New(t)
		}
	}

	resp, err := h.chatClient.ListMessages(r.Context(), req)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	messages := make([]map[string]interface{}, 0, len(resp.GetMessages()))
	for _, m := range resp.GetMessages() {
		messages = append(messages, protoMessageToJSON(m))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"messages": messages,
	})
}

type sendMessageRequest struct {
	Content     string `json:"content"`
	MessageType string `json:"message_type"`
}

// SendMessage handles POST /api/v1/channels/{id}/messages.
func (h *ChatHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	channelID := chi.URLParam(r, "id")
	if channelID == "" {
		writeError(w, http.StatusBadRequest, "channel id required")
		return
	}

	var req sendMessageRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	if utf8.RuneCountInString(req.Content) > maxMessageContentLen {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("message must be at most %d characters", maxMessageContentLen))
		return
	}

	// Block check (Wave 5 / Agent P): if EITHER party of this channel has
	// blocked the sender, refuse with 403 before forwarding to the chat
	// service. The query joins chat_channels → user_blocks via the OR over
	// (customer_id, provider_id) so we need just one round-trip.
	if h.db != nil {
		var blocked bool
		err := h.db.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1
				  FROM chat_channels c
				  JOIN user_blocks ub
				    ON (ub.blocker_id = c.customer_id OR ub.blocker_id = c.provider_id)
				   AND ub.blocked_id = $1
				 WHERE c.id = $2
			)`, claims.UserID, channelID).Scan(&blocked)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// No row impossible with EXISTS, but be defensive.
		case err != nil:
			slog.ErrorContext(r.Context(), "send message: block check failed",
				"channel_id", channelID, "sender_id", claims.UserID, "error", err)
			// Fail open here: if the block-check query is broken, prefer
			// chat continuity over a hard block. The chat service still
			// enforces channel membership, so a stranger can't sneak in.
		case blocked:
			writeError(w, http.StatusForbidden, "blocked")
			return
		}
	}

	msgType := stringToProtoChatMessageType(req.MessageType)

	resp, err := h.chatClient.SendMessage(r.Context(), &chatv1.SendMessageRequest{
		ChannelId:   channelID,
		SenderId:    claims.UserID,
		MessageType: msgType,
		Content:     req.Content,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, protoMessageToJSON(resp.GetMessage()))
}

// MarkRead handles POST /api/v1/channels/{id}/read.
func (h *ChatHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	channelID := chi.URLParam(r, "id")
	if channelID == "" {
		writeError(w, http.StatusBadRequest, "channel id required")
		return
	}

	_, err := h.chatClient.MarkRead(r.Context(), &chatv1.MarkReadRequest{
		ChannelId: channelID,
		UserId:    claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GetUnreadCount handles GET /api/v1/channels/unread.
func (h *ChatHandler) GetUnreadCount(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.chatClient.GetUnreadCount(r.Context(), &chatv1.GetUnreadCountRequest{
		UserId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	channels := make([]map[string]interface{}, 0, len(resp.GetChannels()))
	for _, ch := range resp.GetChannels() {
		channels = append(channels, map[string]interface{}{
			"channel_id":   ch.GetChannelId(),
			"unread_count": ch.GetUnreadCount(),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_unread": resp.GetTotalUnread(),
		"channels":     channels,
	})
}

// WebSocket handles GET /ws/chat by upgrading the connection and proxying to the chat service.
// Authentication is done via ?token= query parameter or Authorization header.
func (h *ChatHandler) WebSocket(w http.ResponseWriter, r *http.Request) {
	// Extract token from query param or Authorization header.
	token := r.URL.Query().Get("token")
	if token == "" {
		authHeader := r.Header.Get("Authorization")
		if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			token = authHeader[7:]
		}
	}
	if token == "" {
		// Try reading from cookie.
		if cookie, err := r.Cookie("access_token"); err == nil {
			token = cookie.Value
		}
	}

	if token == "" {
		writeError(w, http.StatusUnauthorized, "missing authentication token")
		return
	}

	// Validate the token.
	claims, err := h.authMW.ValidateToken(token)
	if err != nil {
		slog.Warn("ws auth failed", "error", err, "remote_addr", r.RemoteAddr)
		writeError(w, http.StatusUnauthorized, "invalid or expired token")
		return
	}

	// Accept the WebSocket upgrade from the client. OriginPatterns enforces
	// the Same-Origin policy for WebSocket handshakes, preventing CSWSH
	// (cross-site WebSocket hijacking) via cookie auth on a non-allowlisted origin.
	clientConn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: wsOriginPatterns(),
	})
	if err != nil {
		slog.Error("failed to accept client websocket", "error", err)
		return
	}
	defer clientConn.CloseNow()

	// Connect to the chat service WebSocket endpoint, passing the validated user ID.
	// Use context.Background() for the dial so the backend connection attempt is
	// not canceled if the client disconnects during the handshake (e.g. React
	// StrictMode unmount closing the socket before the backend dial completes).
	backendURL := fmt.Sprintf("ws://%s/ws?user_id=%s", h.chatWSAddr, claims.UserID)

	backendCtx, backendCancel := context.WithTimeout(context.Background(), 10*time.Second)
	backendConn, _, err := websocket.Dial(backendCtx, backendURL, &websocket.DialOptions{
		HTTPHeader: internalWSDialHeader(h.internalSecret),
	})
	backendCancel()
	if err != nil {
		slog.Error("failed to connect to chat service websocket",
			"addr", h.chatWSAddr,
			"user_id", claims.UserID,
			"error", err,
		)
		clientConn.Close(websocket.StatusInternalError, "failed to connect to chat service")
		return
	}
	defer backendConn.CloseNow()

	slog.Info("ws proxy established",
		"user_id", claims.UserID,
		"remote_addr", r.RemoteAddr,
	)

	// Bound the socket lifetime to the token's exp: when the JWT expires we
	// close both conns with a 4001 frame so a revoked/expired session cannot
	// keep receiving chat messages. The web client refreshes + reconnects.
	ctx, cancel := boundWSToTokenExpiry(r.Context(), claims.ExpiresAt, clientConn, backendConn)
	defer cancel()

	// Proxy messages bidirectionally.
	errc := make(chan error, 2)

	// Client -> Backend
	go func() {
		errc <- proxyWebSocket(ctx, clientConn, backendConn)
	}()

	// Backend -> Client
	go func() {
		errc <- proxyWebSocket(ctx, backendConn, clientConn)
	}()

	// Wait for either direction to finish.
	proxyErr := <-errc
	cancel()

	// Determine the close reason.
	closeStatus := websocket.StatusNormalClosure
	closeReason := "connection closed"
	if proxyErr != nil {
		closeStatus = websocket.StatusInternalError
		closeReason = "proxy error"
	}

	clientConn.Close(closeStatus, closeReason)
	backendConn.Close(closeStatus, closeReason)
}

// wsTokenExpiredStatus is the close code sent when an authed WebSocket is
// terminated because its JWT reached `exp`. 4001 is in the library-private
// range (4000-4999); the web clients treat it (and the accompanying reason)
// as a signal to refresh the token and reconnect.
const wsTokenExpiredStatus = websocket.StatusCode(4001)

// boundWSToTokenExpiry bounds an authed WebSocket's lifetime to the token's
// `exp`. It derives a context that is cancelled at expiresAt and, at that
// moment, cleanly closes both conns with a 4001 "token expired" close frame so
// the proxy loop unwinds and a revoked/expired session can no longer stream
// past expiry. The returned stop func cancels the timer/derived context and
// MUST be deferred by the caller.
//
// If expiresAt is zero (token carried no exp) the parent context is returned
// unchanged with a no-op stop. If expiresAt is already in the past, the conns
// are closed immediately (defense in depth — validation should have 401'd).
func boundWSToTokenExpiry(parent context.Context, expiresAt time.Time, conns ...*websocket.Conn) (context.Context, context.CancelFunc) {
	if expiresAt.IsZero() {
		return context.WithCancel(parent)
	}

	ctx, cancel := context.WithDeadline(parent, expiresAt)

	closeExpired := func() {
		for _, c := range conns {
			if c != nil {
				c.Close(wsTokenExpiredStatus, "token expired, reconnect")
			}
		}
	}

	if d := time.Until(expiresAt); d <= 0 {
		// Already expired at connect — close immediately. The deadline context
		// is already Done, so the proxy loop will also unwind on its own.
		closeExpired()
		return ctx, cancel
	} else {
		timer := time.AfterFunc(d, closeExpired)
		stop := func() {
			timer.Stop()
			cancel()
		}
		return ctx, stop
	}
}

// proxyWebSocket copies messages from src to dst until an error occurs or ctx is cancelled.
func proxyWebSocket(ctx context.Context, src, dst *websocket.Conn) error {
	for {
		msgType, data, err := src.Read(ctx)
		if err != nil {
			return err
		}
		writeCtx, writeCancel := context.WithTimeout(ctx, 10*time.Second)
		err = dst.Write(writeCtx, msgType, data)
		writeCancel()
		if err != nil {
			return err
		}
	}
}

// --- Proto to JSON conversion helpers ---

func protoChannelToJSON(ch *chatv1.Channel) map[string]interface{} {
	if ch == nil {
		return map[string]interface{}{}
	}

	result := map[string]interface{}{
		"id":           ch.GetId(),
		"job_id":       ch.GetJobId(),
		"contract_id":  ch.GetContractId(),
		"customer_id":  ch.GetCustomerId(),
		"provider_id":  ch.GetProviderId(),
		"channel_type": chatChannelTypeToString(ch.GetChannelType()),
		"unread_count": ch.GetUnreadCount(),
		"created_at":   formatTimestamp(ch.GetCreatedAt()),
		"updated_at":   formatTimestamp(ch.GetUpdatedAt()),
	}

	if ch.GetLastMessage() != nil {
		result["last_message"] = protoMessageToJSON(ch.GetLastMessage())
	}

	return result
}

func protoMessageToJSON(m *chatv1.Message) map[string]interface{} {
	if m == nil {
		return map[string]interface{}{}
	}

	return map[string]interface{}{
		"id":           m.GetId(),
		"channel_id":   m.GetChannelId(),
		"sender_id":    m.GetSenderId(),
		"message_type": chatMessageTypeToString(m.GetMessageType()),
		"content":      m.GetContent(),
		"is_read":      m.GetIsRead(),
		"created_at":   formatTimestamp(m.GetCreatedAt()),
	}
}

// --- Enum conversions ---

func chatChannelTypeToString(ct chatv1.ChannelType) string {
	switch ct {
	case chatv1.ChannelType_CHANNEL_TYPE_PRE_AWARD:
		return "pre_award"
	case chatv1.ChannelType_CHANNEL_TYPE_CONTRACT:
		return "contract"
	case chatv1.ChannelType_CHANNEL_TYPE_SUPPORT:
		return "support"
	default:
		return "unspecified"
	}
}

func chatMessageTypeToString(mt chatv1.MessageType) string {
	switch mt {
	case chatv1.MessageType_MESSAGE_TYPE_TEXT:
		return "text"
	case chatv1.MessageType_MESSAGE_TYPE_IMAGE:
		return "image"
	case chatv1.MessageType_MESSAGE_TYPE_FILE:
		return "file"
	case chatv1.MessageType_MESSAGE_TYPE_SYSTEM:
		return "system"
	case chatv1.MessageType_MESSAGE_TYPE_CONTACT_SHARE:
		return "contact_share"
	default:
		return "text"
	}
}

func stringToProtoChatMessageType(s string) chatv1.MessageType {
	switch s {
	case "text", "":
		return chatv1.MessageType_MESSAGE_TYPE_TEXT
	case "image":
		return chatv1.MessageType_MESSAGE_TYPE_IMAGE
	case "file":
		return chatv1.MessageType_MESSAGE_TYPE_FILE
	case "system":
		return chatv1.MessageType_MESSAGE_TYPE_SYSTEM
	case "contact_share":
		return chatv1.MessageType_MESSAGE_TYPE_CONTACT_SHARE
	default:
		return chatv1.MessageType_MESSAGE_TYPE_TEXT
	}
}
