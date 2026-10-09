package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testWSJWT = "eyJhbGciOiJSUzI1NiJ9.payload.signature"

func TestTokenFromWSProtocols(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		protocols []string
		want      string
	}{
		{
			name:      "name then jwt",
			protocols: []string{wsBearerProtocol, testWSJWT},
			want:      testWSJWT,
		},
		{
			name:      "jwt then name",
			protocols: []string{testWSJWT, wsBearerProtocol},
			want:      testWSJWT,
		},
		{
			name:      "name only",
			protocols: []string{wsBearerProtocol},
			want:      "",
		},
		{
			name:      "jwt without name is ignored",
			protocols: []string{testWSJWT},
			want:      "",
		},
		{
			name:      "empty list",
			protocols: nil,
			want:      "",
		},
		{
			name:      "first non-name is the jwt",
			protocols: []string{wsBearerProtocol, testWSJWT, "extra.protocol"},
			want:      testWSJWT,
		},
		{
			name:      "name match is case-insensitive",
			protocols: []string{"Nomarkup.Bearer.v1", testWSJWT},
			want:      testWSJWT,
		},
		{
			name:      "blank entries skipped",
			protocols: []string{"", wsBearerProtocol, "", testWSJWT},
			want:      testWSJWT,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, tokenFromWSProtocols(tt.protocols))
		})
	}
}

func TestWSAcceptOptions_subprotocolIsNameOnly(t *testing.T) {
	t.Parallel()

	opts := wsAcceptOptions()
	require.NotNil(t, opts)
	require.Equal(t, []string{wsBearerProtocol}, opts.Subprotocols)
	assert.Equal(t, []string{"nomarkup.bearer.v1"}, opts.Subprotocols)
}

func TestExtractWSToken(t *testing.T) {
	t.Parallel()

	const (
		headerJWT   = "header.jwt.token"
		cookieJWT   = "cookie.jwt.token"
		protocolJWT = "protocol.jwt.token"
		queryJWT    = "query.jwt.token"
	)

	tests := []struct {
		name string
		req  func() *http.Request
		want string
	}{
		{
			name: "authorization bearer",
			req: func() *http.Request {
				r := httptest.NewRequest(http.MethodGet, "/ws/chat", nil)
				r.Header.Set("Authorization", "Bearer "+headerJWT)
				return r
			},
			want: headerJWT,
		},
		{
			name: "access_token cookie",
			req: func() *http.Request {
				r := httptest.NewRequest(http.MethodGet, "/ws/chat", nil)
				r.AddCookie(&http.Cookie{Name: "access_token", Value: cookieJWT})
				return r
			},
			want: cookieJWT,
		},
		{
			name: "sec-websocket-protocol name plus jwt",
			req: func() *http.Request {
				r := httptest.NewRequest(http.MethodGet, "/ws/chat", nil)
				r.Header.Set("Sec-WebSocket-Protocol", wsBearerProtocol+", "+protocolJWT)
				return r
			},
			want: protocolJWT,
		},
		{
			name: "header wins over cookie protocol and query",
			req: func() *http.Request {
				r := httptest.NewRequest(http.MethodGet, "/ws/chat?token="+queryJWT, nil)
				r.Header.Set("Authorization", "Bearer "+headerJWT)
				r.AddCookie(&http.Cookie{Name: "access_token", Value: cookieJWT})
				r.Header.Set("Sec-WebSocket-Protocol", wsBearerProtocol+", "+protocolJWT)
				return r
			},
			want: headerJWT,
		},
		{
			name: "cookie wins over protocol and query",
			req: func() *http.Request {
				r := httptest.NewRequest(http.MethodGet, "/ws/chat?token="+queryJWT, nil)
				r.AddCookie(&http.Cookie{Name: "access_token", Value: cookieJWT})
				r.Header.Set("Sec-WebSocket-Protocol", wsBearerProtocol+", "+protocolJWT)
				return r
			},
			want: cookieJWT,
		},
		{
			name: "protocol wins over query",
			req: func() *http.Request {
				r := httptest.NewRequest(http.MethodGet, "/ws/chat?token="+queryJWT, nil)
				r.Header.Set("Sec-WebSocket-Protocol", wsBearerProtocol+", "+protocolJWT)
				return r
			},
			want: protocolJWT,
		},
		{
			name: "empty bearer falls through to cookie",
			req: func() *http.Request {
				r := httptest.NewRequest(http.MethodGet, "/ws/chat", nil)
				r.Header.Set("Authorization", "Bearer ")
				r.AddCookie(&http.Cookie{Name: "access_token", Value: cookieJWT})
				return r
			},
			want: cookieJWT,
		},
		{
			name: "protocol without name is not a token",
			req: func() *http.Request {
				r := httptest.NewRequest(http.MethodGet, "/ws/chat", nil)
				r.Header.Set("Sec-WebSocket-Protocol", protocolJWT)
				return r
			},
			want: "",
		},
		{
			name: "missing everything",
			req: func() *http.Request {
				return httptest.NewRequest(http.MethodGet, "/ws/chat", nil)
			},
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, extractWSToken(tt.req()))
		})
	}
}

func TestExtractWSToken_productionRejectsQueryOnly(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")

	const (
		headerJWT   = "header.jwt.token"
		protocolJWT = "protocol.jwt.token"
		queryJWT    = "query.jwt.token"
	)

	t.Run("only query token is empty", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/ws/chat?token="+queryJWT, nil)
		assert.Empty(t, extractWSToken(r))
	})

	t.Run("bearer still works", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/ws/chat", nil)
		r.Header.Set("Authorization", "Bearer "+headerJWT)
		assert.Equal(t, headerJWT, extractWSToken(r))
	})

	t.Run("subprotocol still works", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/ws/chat", nil)
		r.Header.Set("Sec-WebSocket-Protocol", wsBearerProtocol+", "+protocolJWT)
		assert.Equal(t, protocolJWT, extractWSToken(r))
	})
}

func TestExtractWSToken_queryAllowedOutsideProduction(t *testing.T) {
	const queryJWT = "query.jwt.token"

	for _, env := range []string{"development", "staging", ""} {
		name := env
		if name == "" {
			name = "unset"
		}
		t.Run(name, func(t *testing.T) {
			t.Setenv("ENVIRONMENT", env)
			r := httptest.NewRequest(http.MethodGet, "/ws/chat?token="+queryJWT, nil)
			assert.Equal(t, queryJWT, extractWSToken(r))
		})
	}
}

func TestChatWebSocket_missingToken(t *testing.T) {
	t.Parallel()

	h := NewChatHandler(nil, nil, nil, "localhost:0", "secret", nil)
	req := httptest.NewRequest(http.MethodGet, "/ws/chat", nil)
	rec := httptest.NewRecorder()

	h.WebSocket(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "missing authentication token")
}

func TestAuctionWebSocket_missingToken(t *testing.T) {
	t.Setenv("ENABLE_LIVE_AUCTION", "true")

	h := NewAuctionWSHandler(nil, "localhost:0", "secret")
	req := httptest.NewRequest(http.MethodGet, "/ws/auction/job-1", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("jobId", "job-1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()

	h.WebSocket(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), "missing authentication token")
}
