package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatv1 "github.com/nomarkup/nomarkup/proto/chat/v1"
)

const testChannelID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

// mockRespondChatClient is a narrow ChatServiceClient for RespondToTerms tests.
type mockRespondChatClient struct {
	chatv1.ChatServiceClient
	respondFn func(ctx context.Context, req *chatv1.RespondToTermsRequest) (*chatv1.RespondToTermsResponse, error)
	calls     int
	lastReq   *chatv1.RespondToTermsRequest
}

func (m *mockRespondChatClient) RespondToTerms(ctx context.Context, req *chatv1.RespondToTermsRequest, _ ...grpc.CallOption) (*chatv1.RespondToTermsResponse, error) {
	m.calls++
	m.lastReq = req
	if m.respondFn != nil {
		return m.respondFn(ctx, req)
	}
	accepted := req.GetAccepted()
	msgType := chatv1.MessageType_MESSAGE_TYPE_TERMS_REJECTED
	content := "Customer rejected the proposed terms."
	if accepted {
		msgType = chatv1.MessageType_MESSAGE_TYPE_TERMS_ACCEPTED
		content = "Customer accepted the proposed terms."
	}
	return &chatv1.RespondToTermsResponse{
		Message: &chatv1.Message{
			Id:          "msg-terms-1",
			ChannelId:   req.GetChannelId(),
			SenderId:    req.GetUserId(),
			MessageType: msgType,
			Content:     content,
			CreatedAt:   timestamppb.Now(),
		},
	}, nil
}

func respondToTermsRouter(h *ChatHandler) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/v1/channels/{id}/terms/respond", h.RespondToTerms)
	return r
}

func newRespondToTermsHTTPRequest(t *testing.T, channelID, userID, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/channels/"+channelID+"/terms/respond", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if userID != "" {
		req = addClaimsToRequest(req, userID, "user@example.com", []string{"customer"})
	}
	return req
}

// TestRespondToTerms_passesClaimsUserID pins customer-only enforcement at the
// gateway boundary: UserId on the gRPC request is claims.UserID, never a body
// field the client can spoof. Chat service then rejects non-customer parties.
func TestRespondToTerms_passesClaimsUserID(t *testing.T) {
	t.Parallel()
	cc := &mockRespondChatClient{}
	h := NewChatHandler(cc, nil, nil, "", "", nil)

	rec := httptest.NewRecorder()
	respondToTermsRouter(h).ServeHTTP(rec, newRespondToTermsHTTPRequest(t, testChannelID, testCustomerID, `{"accepted":true}`))

	require.Equal(t, http.StatusCreated, rec.Code, "body=%s", rec.Body.String())
	require.Equal(t, 1, cc.calls)
	assert.Equal(t, testChannelID, cc.lastReq.GetChannelId())
	assert.Equal(t, testCustomerID, cc.lastReq.GetUserId(), "must forward claims user, not a body spoof")
	assert.True(t, cc.lastReq.GetAccepted())

	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "msg-terms-1", body["id"])
}

// TestRespondToTerms_rejectBodyStillForwardsClaimsUser covers accepted=false
// (explicit reject) with the same identity wiring.
func TestRespondToTerms_rejectBodyStillForwardsClaimsUser(t *testing.T) {
	t.Parallel()
	cc := &mockRespondChatClient{}
	h := NewChatHandler(cc, nil, nil, "", "", nil)

	rec := httptest.NewRecorder()
	respondToTermsRouter(h).ServeHTTP(rec, newRespondToTermsHTTPRequest(t, testChannelID, testCustomerID, `{"accepted":false}`))

	require.Equal(t, http.StatusCreated, rec.Code, "body=%s", rec.Body.String())
	require.Equal(t, 1, cc.calls)
	assert.False(t, cc.lastReq.GetAccepted())
	assert.Equal(t, testCustomerID, cc.lastReq.GetUserId())
}

// TestRespondToTerms_servicePermissionDeniedMapsTo403: when chat service
// enforces customer-only (provider/outsider), gateway must surface 403 — not
// 500 and not a silent accept.
func TestRespondToTerms_servicePermissionDeniedMapsTo403(t *testing.T) {
	t.Parallel()
	cc := &mockRespondChatClient{
		respondFn: func(_ context.Context, _ *chatv1.RespondToTermsRequest) (*chatv1.RespondToTermsResponse, error) {
			return nil, status.Error(codes.PermissionDenied, "only the customer can respond to proposed terms")
		},
	}
	h := NewChatHandler(cc, nil, nil, "", "", nil)

	// Claims may say "customer" role but wrong party for this channel — service decides.
	rec := httptest.NewRecorder()
	respondToTermsRouter(h).ServeHTTP(rec, newRespondToTermsHTTPRequest(t, testChannelID, testCustomerID, `{"accepted":true}`))

	assert.Equal(t, http.StatusForbidden, rec.Code, "body=%s", rec.Body.String())
	require.Equal(t, 1, cc.calls)
}

// TestRespondToTerms_acceptedRequired: missing accepted must 400 — never
// default-accept (consent must be explicit).
func TestRespondToTerms_acceptedRequired(t *testing.T) {
	t.Parallel()

	for _, body := range []string{`{}`, `{"accepted":null}`} {
		body := body
		t.Run(body, func(t *testing.T) {
			t.Parallel()
			// Fresh client per case so call counts stay isolated under parallel.
			local := &mockRespondChatClient{}
			h := NewChatHandler(local, nil, nil, "", "", nil)
			rec := httptest.NewRecorder()
			respondToTermsRouter(h).ServeHTTP(rec, newRespondToTermsHTTPRequest(t, testChannelID, testCustomerID, body))
			assert.Equal(t, http.StatusBadRequest, rec.Code, "body=%s payload=%q", rec.Body.String(), body)
			assert.Equal(t, 0, local.calls, "must not call chat service without explicit accepted")
		})
	}
}

func TestRespondToTerms_requiresAuth(t *testing.T) {
	t.Parallel()
	cc := &mockRespondChatClient{}
	h := NewChatHandler(cc, nil, nil, "", "", nil)
	rec := httptest.NewRecorder()
	respondToTermsRouter(h).ServeHTTP(rec, newRespondToTermsHTTPRequest(t, testChannelID, "", `{"accepted":true}`))
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, 0, cc.calls)
}

func TestRespondToTerms_rejectsInvalidChannelUUID(t *testing.T) {
	t.Parallel()
	cc := &mockRespondChatClient{}
	h := NewChatHandler(cc, nil, nil, "", "", nil)
	rec := httptest.NewRecorder()
	respondToTermsRouter(h).ServeHTTP(rec, newRespondToTermsHTTPRequest(t, "not-a-uuid", testCustomerID, `{"accepted":true}`))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, 0, cc.calls)
}

func TestRespondToTerms_invalidJSON(t *testing.T) {
	t.Parallel()
	cc := &mockRespondChatClient{}
	h := NewChatHandler(cc, nil, nil, "", "", nil)
	rec := httptest.NewRecorder()
	respondToTermsRouter(h).ServeHTTP(rec, newRespondToTermsHTTPRequest(t, testChannelID, testCustomerID, `{not-json`))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, 0, cc.calls)
}
