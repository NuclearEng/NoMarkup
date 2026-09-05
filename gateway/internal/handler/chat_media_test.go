package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/nomarkup/nomarkup/proto/chat/v1"
)

func TestAllowedChatMediaURL(t *testing.T) {
	t.Setenv("ENVIRONMENT", "")
	t.Setenv("CHAT_MEDIA_HOSTS", "")
	t.Setenv("S3_PUBLIC_URL", "")
	t.Setenv("S3_ENDPOINT", "")
	t.Setenv("AWS_S3_PUBLIC_URL", "")

	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{name: "localhost minio object", raw: "http://localhost:9000/nomarkup-dev/chat/obj.jpg", want: true},
		{name: "127.0.0.1 minio object", raw: "http://127.0.0.1:9000/nomarkup-dev/chat/obj.jpg", want: true},
		{name: "ipv6 loopback minio", raw: "http://[::1]:9000/nomarkup-dev/chat/obj.jpg", want: true},
		{name: "https localhost object", raw: "https://localhost:9000/nomarkup-dev/chat/obj.jpg", want: true},
		{name: "unsplash fixture", raw: "https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=800", want: true},
		{name: "picsum fixture", raw: "https://picsum.photos/id/1015/800/600", want: true},
		{name: "evil https host", raw: "https://evil.example.com/tracker.png", want: false},
		{name: "suffix confusion", raw: "https://images.unsplash.com.evil.test/p.jpg", want: false},
		{name: "javascript scheme", raw: "javascript:alert(1)", want: false},
		{name: "data uri", raw: "data:image/png;base64,abcd", want: false},
		{name: "relative path", raw: "/nomarkup-dev/chat/obj.jpg", want: false},
		{name: "protocol-relative", raw: "//evil.example.com/phish", want: false},
		{name: "whitespace inside", raw: "http://localhost:9000/nomarkup-dev/chat/obj jpg", want: false},
		{name: "angle brackets", raw: "http://localhost:9000/nomarkup-dev/<script>", want: false},
		{name: "empty", raw: "", want: false},
		{name: "loopback missing object key", raw: "http://localhost:9000/nomarkup-dev", want: false},
		{name: "loopback root", raw: "http://localhost:9000/", want: false},
		{name: "userinfo", raw: "https://user:pass@picsum.photos/id/1/1/1", want: false},
		{name: "too long", raw: "https://picsum.photos/" + strings.Repeat("a", 2000), want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, AllowedChatMediaURL(tc.raw), tc.raw)
		})
	}
}

func TestAllowedChatMediaURL_envHosts(t *testing.T) {
	t.Setenv("ENVIRONMENT", "")
	t.Setenv("CHAT_MEDIA_HOSTS", "cdn.no-markup.com, https://media.example.com/bucket")
	t.Setenv("S3_PUBLIC_URL", "http://192.168.1.101:9000/nomarkup-dev")
	t.Setenv("S3_ENDPOINT", "http://localhost:9000")
	t.Setenv("AWS_S3_PUBLIC_URL", "")

	assert.True(t, AllowedChatMediaURL("https://cdn.no-markup.com/chat/a.jpg"))
	assert.True(t, AllowedChatMediaURL("https://media.example.com/chat/a.jpg"))
	assert.True(t, AllowedChatMediaURL("http://192.168.1.101:9000/nomarkup-dev/chat/a.jpg"))
	assert.False(t, AllowedChatMediaURL("https://evil.example.com/a.jpg"))
}

func TestAllowedChatMediaURL_productionHTTPSOnly(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("CHAT_MEDIA_HOSTS", "")
	t.Setenv("S3_PUBLIC_URL", "https://cdn.no-markup.com")
	t.Setenv("S3_ENDPOINT", "")
	t.Setenv("AWS_S3_PUBLIC_URL", "")

	assert.True(t, AllowedChatMediaURL("https://cdn.no-markup.com/chat/a.jpg"))
	assert.False(t, AllowedChatMediaURL("http://localhost:9000/nomarkup-dev/chat/a.jpg"))
	assert.False(t, AllowedChatMediaURL("http://cdn.no-markup.com/chat/a.jpg"))
}

func TestStringToProtoChatMessageType_rejectsReserved(t *testing.T) {
	t.Parallel()
	assert.Equal(t, chatv1.MessageType_MESSAGE_TYPE_TEXT, stringToProtoChatMessageType("system"))
	assert.Equal(t, chatv1.MessageType_MESSAGE_TYPE_TEXT, stringToProtoChatMessageType("SYSTEM"))
	assert.Equal(t, chatv1.MessageType_MESSAGE_TYPE_TEXT, stringToProtoChatMessageType("terms_accepted"))
	assert.Equal(t, chatv1.MessageType_MESSAGE_TYPE_TEXT, stringToProtoChatMessageType("terms_rejected"))
	assert.Equal(t, chatv1.MessageType_MESSAGE_TYPE_IMAGE, stringToProtoChatMessageType("image"))
	assert.Equal(t, chatv1.MessageType_MESSAGE_TYPE_FILE, stringToProtoChatMessageType("file"))
	assert.Equal(t, chatv1.MessageType_MESSAGE_TYPE_PROPOSED_TERMS, stringToProtoChatMessageType("proposed_terms"))
	assert.Equal(t, chatv1.MessageType_MESSAGE_TYPE_CONTACT_SHARE, stringToProtoChatMessageType("contact_share"))
}

type mockSendChatClient struct {
	chatv1.ChatServiceClient
	calls int
	last  *chatv1.SendMessageRequest
}

func (m *mockSendChatClient) SendMessage(_ context.Context, req *chatv1.SendMessageRequest, _ ...grpc.CallOption) (*chatv1.SendMessageResponse, error) {
	m.calls++
	m.last = req
	return &chatv1.SendMessageResponse{
		Message: &chatv1.Message{
			Id:          "msg-send-1",
			ChannelId:   req.GetChannelId(),
			SenderId:    req.GetSenderId(),
			MessageType: req.GetMessageType(),
			Content:     req.GetContent(),
			CreatedAt:   timestamppb.Now(),
		},
	}, nil
}

func sendMessageRouter(h *ChatHandler) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/v1/channels/{id}/messages", h.SendMessage)
	return r
}

func newSendMessageHTTPRequest(t *testing.T, channelID, userID, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/channels/"+channelID+"/messages", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if userID != "" {
		req = addClaimsToRequest(req, userID, "user@example.com", []string{"customer"})
	}
	return req
}

func TestSendMessage_rejectsReservedTypes(t *testing.T) {
	for _, msgType := range []string{"system", "terms_accepted", "terms_rejected", "SYSTEM"} {
		t.Run(msgType, func(t *testing.T) {
			cc := &mockSendChatClient{}
			h := NewChatHandler(cc, nil, nil, "", "", nil)
			body, err := json.Marshal(map[string]string{
				"content":      "Provider joined",
				"message_type": msgType,
			})
			require.NoError(t, err)

			rec := httptest.NewRecorder()
			sendMessageRouter(h).ServeHTTP(rec, newSendMessageHTTPRequest(t, testChannelID, testCustomerID, string(body)))

			assert.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
			assert.Equal(t, 0, cc.calls)
			assert.Contains(t, rec.Body.String(), "reserved")
		})
	}
}

func TestSendMessage_rejectsEvilMediaHost(t *testing.T) {
	t.Setenv("ENVIRONMENT", "")
	t.Setenv("CHAT_MEDIA_HOSTS", "")
	t.Setenv("S3_PUBLIC_URL", "")
	t.Setenv("S3_ENDPOINT", "")
	t.Setenv("AWS_S3_PUBLIC_URL", "")

	cc := &mockSendChatClient{}
	h := NewChatHandler(cc, nil, nil, "", "", nil)
	body := `{"content":"https://evil.example.com/tracker.png","message_type":"image"}`

	rec := httptest.NewRecorder()
	sendMessageRouter(h).ServeHTTP(rec, newSendMessageHTTPRequest(t, testChannelID, testCustomerID, body))

	assert.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, 0, cc.calls)
}

func TestSendMessage_acceptsLocalMinIO(t *testing.T) {
	t.Setenv("ENVIRONMENT", "")
	t.Setenv("CHAT_MEDIA_HOSTS", "")
	t.Setenv("S3_PUBLIC_URL", "")
	t.Setenv("S3_ENDPOINT", "")
	t.Setenv("AWS_S3_PUBLIC_URL", "")

	cc := &mockSendChatClient{}
	h := NewChatHandler(cc, nil, nil, "", "", nil)
	content := "http://localhost:9000/nomarkup-dev/chat/obj.jpg"
	body := `{"content":"` + content + `","message_type":"image"}`

	rec := httptest.NewRecorder()
	sendMessageRouter(h).ServeHTTP(rec, newSendMessageHTTPRequest(t, testChannelID, testCustomerID, body))

	require.Equal(t, http.StatusCreated, rec.Code, "body=%s", rec.Body.String())
	require.Equal(t, 1, cc.calls)
	assert.Equal(t, chatv1.MessageType_MESSAGE_TYPE_IMAGE, cc.last.GetMessageType())
	assert.Equal(t, content, cc.last.GetContent())
}

func TestSendMessage_textDoesNotRequireURL(t *testing.T) {
	cc := &mockSendChatClient{}
	h := NewChatHandler(cc, nil, nil, "", "", nil)
	body := `{"content":"hello there","message_type":"text"}`

	rec := httptest.NewRecorder()
	sendMessageRouter(h).ServeHTTP(rec, newSendMessageHTTPRequest(t, testChannelID, testCustomerID, body))

	require.Equal(t, http.StatusCreated, rec.Code, "body=%s", rec.Body.String())
	require.Equal(t, 1, cc.calls)
	assert.Equal(t, chatv1.MessageType_MESSAGE_TYPE_TEXT, cc.last.GetMessageType())
}
