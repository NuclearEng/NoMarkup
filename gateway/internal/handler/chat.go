package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	chatv1 "github.com/nomarkup/nomarkup/proto/chat/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
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
	userClient     userv1.UserServiceClient
	authMW         *middleware.AuthMiddleware
	chatWSAddr     string
	internalSecret string // shared secret presented to the chat WS backend
	db             *pgxpool.Pool
}

// NewChatHandler creates a new ChatHandler. internalSecret is the shared secret
// presented to the chat WS backend on dial (defense-in-depth so the backend can
// reject connections that did not transit the gateway).
//
// userClient is used to resolve the customer/provider display names that enrich
// the channel JSON (so the web client renders a name instead of a raw UUID). It
// is optional — when nil, name enrichment is skipped and the channel list still
// works (fail-soft).
func NewChatHandler(chatClient chatv1.ChatServiceClient, userClient userv1.UserServiceClient, authMW *middleware.AuthMiddleware, chatWSAddr, internalSecret string, db *pgxpool.Pool) *ChatHandler {
	return &ChatHandler{
		chatClient:     chatClient,
		userClient:     userClient,
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

	// Collect every participant id across the page, then resolve unique ids to
	// display names in one batch (dedup avoids N×2 GetUser calls).
	ids := make([]string, 0, len(resp.GetChannels())*2)
	for _, ch := range resp.GetChannels() {
		ids = append(ids, ch.GetCustomerId(), ch.GetProviderId())
	}
	names := h.resolveParticipantNames(r.Context(), ids...)

	channels := make([]map[string]interface{}, 0, len(resp.GetChannels()))
	for _, ch := range resp.GetChannels() {
		channels = append(channels, protoChannelToJSON(ch, names))
	}

	result := map[string]interface{}{
		"channels": channels,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"totalCount": pg.GetTotalCount(),
			"page":       pg.GetPage(),
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

	ch := resp.GetChannel()
	names := h.resolveParticipantNames(r.Context(), ch.GetCustomerId(), ch.GetProviderId())
	writeJSON(w, http.StatusOK, protoChannelToJSON(ch, names))
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
	// Validate the UUID up front like GetChannel/ListMessages do; otherwise a
	// non-UUID id reaches the uuid-typed block-check query and 500s.
	if !isValidUUID(channelID) {
		writeError(w, http.StatusBadRequest, "invalid channel id")
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

	// ASR-1.2.a — pre-post UGC filter (in addition to contact-info detection
	// in the chat service).
	if rejectProhibitedUGC(w, r, req.Content) {
		return
	}

	// Block check (Wave 5 / Agent P / ASR-1.2.c): if EITHER party of this
	// channel has blocked the sender, refuse with 403 before forwarding to
	// the chat service. Fail CLOSED on DB error (503) — App Store UGC safety
	// requires we never deliver through a broken block check.
	// The query joins chat_channels → user_blocks via the OR over
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
			writeError(w, http.StatusServiceUnavailable, "temporarily unavailable")
			return
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

	// Notify the OTHER channel participant of the new message (the single
	// highest-value emission). Fail-soft: a notification failure must never
	// fail the send, so this runs after the 201 path is committed and swallows
	// all errors. We resolve the recipient from the channel's two participants
	// (customer_id/provider_id) and pick the one that is not the sender.
	h.notifyNewMessage(r.Context(), channelID, claims.UserID, req.Content)

	writeJSON(w, http.StatusCreated, protoMessageToJSON(resp.GetMessage()))
}

// notifyNewMessage emits a `new_message` in-app notification to the channel
// participant who is NOT the sender. Entirely fail-soft (see emitNotification):
// any DB error is logged and swallowed so a notification problem can never
// break chat. A nil pool is a no-op (the gateway's nil-safe DB pattern), in
// which case no notification is produced but the message still sent.
func (h *ChatHandler) notifyNewMessage(ctx context.Context, channelID, senderID, content string) {
	if h.db == nil {
		return
	}

	var customerID, providerID string
	err := h.db.QueryRow(ctx,
		`SELECT customer_id::text, provider_id::text FROM chat_channels WHERE id = $1`,
		channelID,
	).Scan(&customerID, &providerID)
	if err != nil {
		slog.ErrorContext(ctx, "new message notification: channel lookup failed",
			"error", err, "channel_id", channelID)
		return
	}

	// Recipient is whichever participant is not the sender.
	recipientID := providerID
	if senderID == providerID {
		recipientID = customerID
	}

	// Resolve the sender's display name for the title (fail-soft → fallback).
	senderName := "Someone"
	if names := h.resolveParticipantNames(ctx, senderID); names != nil {
		if n := names[senderID]; n != "" {
			senderName = n
		}
	}

	// Short, safe preview of the message body (runes, capped). Avoids leaking
	// an unbounded blob into the notification body and keeps the list tidy.
	preview := messagePreview(content)

	emitNotification(ctx, h.db,
		senderID, recipientID,
		"new_message",
		fmt.Sprintf("New message from %s", senderName),
		preview,
		"/messages?channel="+channelID,
		"chat_channel", channelID,
	)
}

// messagePreview returns a short, single-line preview of a chat message body
// for use in a notification. Capped at 140 runes with an ellipsis; image/file
// messages (empty or non-text content) get a generic placeholder.
func messagePreview(content string) string {
	const maxPreview = 140
	trimmed := content
	if trimmed == "" {
		return "Sent you a message"
	}
	if utf8.RuneCountInString(trimmed) > maxPreview {
		runes := []rune(trimmed)
		return string(runes[:maxPreview]) + "…"
	}
	return trimmed
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

// proposedTermsRequest is the REST body for POST …/proposed-terms (provider).
// Free-text fields are UGC-filtered at the gateway before gRPC.
type proposedTermsRequest struct {
	PaymentType string `json:"payment_type"`
	Amount      string `json:"amount"`
	Milestones  string `json:"milestones"`
	Description string `json:"description"`
}

// SendProposedTerms handles POST /api/v1/channels/{id}/proposed-terms.
// Auth required; chat service enforces provider-only. Does not bind contract
// local terms — only posts a proposed_terms message for the customer to Accept/Reject.
func (h *ChatHandler) SendProposedTerms(w http.ResponseWriter, r *http.Request) {
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

	var req proposedTermsRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Cap free-text fields (same rune budget as chat messages).
	for _, field := range []struct {
		name  string
		value string
	}{
		{"payment_type", req.PaymentType},
		{"amount", req.Amount},
		{"milestones", req.Milestones},
		{"description", req.Description},
	} {
		if utf8.RuneCountInString(field.value) > maxMessageContentLen {
			writeError(w, http.StatusBadRequest,
				fmt.Sprintf("%s must be at most %d characters", field.name, maxMessageContentLen))
			return
		}
		// ASR-1.2.a — pre-post UGC filter on free text.
		if rejectProhibitedUGC(w, r, field.value) {
			return
		}
	}

	if h.refuseIfChannelBlocked(w, r, channelID, claims.UserID) {
		return
	}

	resp, err := h.chatClient.SendProposedTerms(r.Context(), &chatv1.SendProposedTermsRequest{
		ChannelId:   channelID,
		SenderId:    claims.UserID,
		PaymentType: strings.TrimSpace(req.PaymentType),
		Amount:      strings.TrimSpace(req.Amount),
		Milestones:  strings.TrimSpace(req.Milestones),
		Description: strings.TrimSpace(req.Description),
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	msg := resp.GetMessage()
	preview := "Proposed terms"
	if msg != nil && msg.GetContent() != "" {
		preview = messagePreview(msg.GetContent())
	}
	h.notifyNewMessage(r.Context(), channelID, claims.UserID, preview)

	slog.InfoContext(r.Context(), "proposed terms posted",
		"channel_id", channelID,
		"sender_id", claims.UserID,
		"binding", false,
	)

	writeJSON(w, http.StatusCreated, protoMessageToJSON(msg))
}

// respondToTermsRequest is the REST body for POST …/terms/respond (customer).
// Accepted must be set explicitly — absence is a 400, never default-accept.
type respondToTermsRequest struct {
	// Accepted is a pointer so missing JSON null/omit is distinguishable from false.
	Accepted *bool `json:"accepted"`
}

// RespondToTerms handles POST /api/v1/channels/{id}/terms/respond.
// Auth required; chat service enforces customer-only. Explicit accept/reject
// only — no binding without accepted=true; reject is accepted=false.
func (h *ChatHandler) RespondToTerms(w http.ResponseWriter, r *http.Request) {
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

	var req respondToTermsRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Accepted == nil {
		writeError(w, http.StatusBadRequest, "accepted is required (true to accept, false to reject)")
		return
	}

	if h.refuseIfChannelBlocked(w, r, channelID, claims.UserID) {
		return
	}

	accepted := *req.Accepted
	resp, err := h.chatClient.RespondToTerms(r.Context(), &chatv1.RespondToTermsRequest{
		ChannelId: channelID,
		UserId:    claims.UserID,
		Accepted:  accepted,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	msg := resp.GetMessage()
	preview := "Terms rejected"
	if accepted {
		preview = "Terms accepted"
	}
	h.notifyNewMessage(r.Context(), channelID, claims.UserID, preview)

	slog.InfoContext(r.Context(), "proposed terms response posted",
		"channel_id", channelID,
		"customer_id", claims.UserID,
		"accepted", accepted,
		// Chat records explicit consent; contract local-terms override is residual.
		"contract_override_applied", false,
	)

	writeJSON(w, http.StatusCreated, protoMessageToJSON(msg))
}

// refuseIfChannelBlocked runs the same block check as SendMessage. Returns true
// when the handler has already written an error response (caller must return).
func (h *ChatHandler) refuseIfChannelBlocked(w http.ResponseWriter, r *http.Request, channelID, userID string) bool {
	if h.db == nil {
		return false
	}
	var blocked bool
	err := h.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1
			  FROM chat_channels c
			  JOIN user_blocks ub
			    ON (ub.blocker_id = c.customer_id OR ub.blocker_id = c.provider_id)
			   AND ub.blocked_id = $1
			 WHERE c.id = $2
		)`, userID, channelID).Scan(&blocked)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return false
	case err != nil:
		slog.ErrorContext(r.Context(), "chat terms: block check failed",
			"channel_id", channelID, "user_id", userID, "error", err)
		writeError(w, http.StatusServiceUnavailable, "temporarily unavailable")
		return true
	case blocked:
		writeError(w, http.StatusForbidden, "blocked")
		return true
	default:
		return false
	}
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

	// Idle-session heartbeat (CLAUDE.md §6): every inbound client frame (the
	// WS heartbeat/ping included) resets the user's role-based idle window so an
	// actively-connected user is not timed out at their next token refresh. The
	// touch reuses authMW's cache client and is fail-open (no-op when Redis is
	// down). We snapshot ctx/userID/roles into the closure.
	touchIdle := func() {
		h.authMW.TouchIdleSession(ctx, claims.UserID, claims.Roles)
	}

	// Proxy messages bidirectionally.
	errc := make(chan error, 2)

	// Client -> Backend (resets the idle window on every inbound frame).
	go func() {
		errc <- proxyWebSocket(ctx, clientConn, backendConn, touchIdle)
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

// proxyWebSocket copies messages from src to dst until an error occurs or ctx is
// cancelled. Optional onInbound callbacks fire after every successfully-read
// frame — used on the client->backend direction to reset the role-based idle
// session window so an actively-connected user (heartbeat pings or any inbound
// frame) is not timed out at their next refresh (CLAUDE.md §6).
func proxyWebSocket(ctx context.Context, src, dst *websocket.Conn, onInbound ...func()) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Server-initiated keepalive: ping the client every 30s and require a pong
	// within 10s. Without this the read loop blocks on src.Read until the token
	// expires (~15 min), so a silent or half-open (TCP-dead) peer holds a
	// goroutine pair + a backend conn (+ a Redis listener for auctions) the whole
	// time. A failed ping cancels ctx, which unblocks src.Read below and tears
	// the proxy down. Mirrors the spectator keepalive (spectator_ws.go).
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				pingCtx, pingCancel := context.WithTimeout(ctx, 10*time.Second)
				err := src.Ping(pingCtx)
				pingCancel()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()

	for {
		msgType, data, err := src.Read(ctx)
		if err != nil {
			return err
		}
		for _, cb := range onInbound {
			if cb != nil {
				cb()
			}
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

// protoChannelToJSON projects a chat Channel into the gateway's JSON shape.
//
// names resolves participant ids → display_name so the web client can render a
// human-readable name instead of a raw UUID. It is built once per request via
// resolveParticipantNames and may be nil/partial (fail-soft): a missing entry
// simply omits customer_name / provider_name for that channel.
func protoChannelToJSON(ch *chatv1.Channel, names map[string]string) map[string]interface{} {
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

	// Per-party MarkRead watermarks — enable read receipts without a peer reply.
	// Omitted when unset (never opened / never marked read).
	if ts := ch.GetCustomerLastReadAt(); ts != nil {
		if s := formatTimestamp(ts); s != "" {
			result["customer_last_read_at"] = s
		}
	}
	if ts := ch.GetProviderLastReadAt(); ts != nil {
		if s := formatTimestamp(ts); s != "" {
			result["provider_last_read_at"] = s
		}
	}

	if names != nil {
		if name := names[ch.GetCustomerId()]; name != "" {
			result["customer_name"] = name
		}
		if name := names[ch.GetProviderId()]; name != "" {
			result["provider_name"] = name
		}
	}

	if ch.GetLastMessage() != nil {
		result["last_message"] = protoMessageToJSON(ch.GetLastMessage())
	}

	return result
}

// resolveParticipantNames resolves a set of user ids to their public display
// names via the user gRPC service. It dedupes ids and resolves them in ONE
// batched round trip (chunked at the server's cap) — a channel list with N
// channels used to cost up to N×2 sequential GetUser calls — and is fail-soft: a
// lookup error or empty display_name leaves that id out of the returned map
// rather than failing the whole channel response. Only the public-safe
// display_name is surfaced — no other PII.
//
// Returns nil when there is no user client configured or no ids to resolve.
func (h *ChatHandler) resolveParticipantNames(ctx context.Context, ids ...string) map[string]string {
	if h.userClient == nil {
		return nil
	}

	unique := dedupeUserIDs(ids)
	if len(unique) == 0 {
		return nil
	}

	names, err := batchGetDisplayNames(ctx, h.userClient, unique)
	if err != nil {
		// fail soft — the failed chunk's names are simply absent.
		slog.WarnContext(ctx, "chat: resolve participant names failed", "error", err)
	}

	return names
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
	case chatv1.MessageType_MESSAGE_TYPE_PROPOSED_TERMS:
		return "proposed_terms"
	case chatv1.MessageType_MESSAGE_TYPE_TERMS_ACCEPTED:
		return "terms_accepted"
	case chatv1.MessageType_MESSAGE_TYPE_TERMS_REJECTED:
		return "terms_rejected"
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
	case "proposed_terms":
		return chatv1.MessageType_MESSAGE_TYPE_PROPOSED_TERMS
	case "terms_accepted":
		return chatv1.MessageType_MESSAGE_TYPE_TERMS_ACCEPTED
	case "terms_rejected":
		return chatv1.MessageType_MESSAGE_TYPE_TERMS_REJECTED
	default:
		return chatv1.MessageType_MESSAGE_TYPE_TEXT
	}
}
