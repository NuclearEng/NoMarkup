package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func allowUnblockedChat(h *ChatHandler) {
	h.blockDB = &fakeBlockDB{row: fakeBlockRow{blocked: false}}
}

func TestSendMessage_BlockCheckFailClosed(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		db       *fakeBlockDB
		wantCode int
		wantCall int
	}{
		{name: "nil db", wantCode: http.StatusServiceUnavailable, wantCall: 0},
		{name: "blocked", db: &fakeBlockDB{row: fakeBlockRow{blocked: true}}, wantCode: http.StatusForbidden, wantCall: 0},
		{name: "query error", db: &fakeBlockDB{row: fakeBlockRow{err: errors.New("db down")}}, wantCode: http.StatusServiceUnavailable, wantCall: 0},
		{name: "not blocked", db: &fakeBlockDB{row: fakeBlockRow{blocked: false}}, wantCode: http.StatusCreated, wantCall: 1},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			cc := &mockSendChatClient{}
			h := NewChatHandler(cc, nil, nil, "", "", nil)
			if tc.db != nil {
				h.blockDB = tc.db
			}
			rec := httptest.NewRecorder()
			sendMessageRouter(h).ServeHTTP(rec, newSendMessageHTTPRequest(t, testChannelID, testCustomerID, `{"content":"hello there","message_type":"text"}`))
			if rec.Code != tc.wantCode {
				t.Fatalf("got %d want %d (body=%s)", rec.Code, tc.wantCode, rec.Body.String())
			}
			if cc.calls != tc.wantCall {
				t.Fatalf("SendMessage calls = %d want %d", cc.calls, tc.wantCall)
			}
		})
	}
}
