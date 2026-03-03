package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	chatv1 "github.com/nomarkup/nomarkup/proto/chat/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ChatHandler handles HTTP endpoints for chat channels and messages.
type ChatHandler struct {
	chatClient chatv1.ChatServiceClient
}

// NewChatHandler creates a new ChatHandler.
func NewChatHandler(chatClient chatv1.ChatServiceClient) *ChatHandler {
	return &ChatHandler{chatClient: chatClient}
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
			"total_count": pg.GetTotalCount(),
			"page":        pg.GetPage(),
			"page_size":   pg.GetPageSize(),
			"total_pages": pg.GetTotalPages(),
			"has_next":    pg.GetHasNext(),
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
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

// WebSocketStub handles GET /ws/chat with a 501 response.
func (h *ChatHandler) WebSocketStub(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "WebSocket support coming soon")
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
