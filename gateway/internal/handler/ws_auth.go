package handler

import (
	"log/slog"
	"net/http"
	"os"
	"strings"

	"nhooyr.io/websocket"
)

// wsBearerProtocol is the named WebSocket subprotocol used to carry a JWT
// when the browser cannot set an Authorization header. The client offers
// [wsBearerProtocol, <jwt>]; Accept must negotiate only this name so the
// response never echoes the token.
const wsBearerProtocol = "nomarkup.bearer.v1"

// wsAcceptOptions is the Accept config for authed chat/auction sockets.
// Subprotocols is the short name only — never the JWT — so nhooyr's
// selectSubprotocol echoes only nomarkup.bearer.v1.
func wsAcceptOptions() *websocket.AcceptOptions {
	return &websocket.AcceptOptions{
		OriginPatterns: wsOriginPatterns(),
		Subprotocols:   []string{wsBearerProtocol},
	}
}

// extractWSToken returns the access JWT from an incoming WebSocket request.
// Order: Authorization Bearer, access_token cookie, Sec-WebSocket-Protocol,
// then ?token= (non-production deprecated compat only; ignored in production).
func extractWSToken(r *http.Request) string {
	if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
		if tok := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer ")); tok != "" {
			return tok
		}
	}

	if cookie, err := r.Cookie("access_token"); err == nil {
		if tok := strings.TrimSpace(cookie.Value); tok != "" {
			return tok
		}
	}

	if tok := tokenFromWSProtocols(secWebSocketProtocols(r)); tok != "" {
		return tok
	}

	if tok := r.URL.Query().Get("token"); tok != "" {
		// Query tokens leak into access logs and Referer. Production rejects
		// them; non-prod keeps the fallback for mid-deploy clients.
		if strings.EqualFold(strings.TrimSpace(os.Getenv("ENVIRONMENT")), "production") {
			return ""
		}
		slog.Debug("ws query token auth is deprecated", "path", r.URL.Path)
		return tok
	}

	return ""
}

// tokenFromWSProtocols returns the JWT offered alongside wsBearerProtocol.
// The named protocol must be present so a random subprotocol is not treated
// as a token. The first non-name entry is the JWT.
func tokenFromWSProtocols(protocols []string) string {
	foundName := false
	jwt := ""
	for _, p := range protocols {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.EqualFold(p, wsBearerProtocol) {
			foundName = true
			continue
		}
		if jwt == "" {
			jwt = p
		}
	}
	if !foundName {
		return ""
	}
	return jwt
}

func secWebSocketProtocols(r *http.Request) []string {
	var out []string
	for _, line := range r.Header.Values("Sec-WebSocket-Protocol") {
		for _, p := range strings.Split(line, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				out = append(out, p)
			}
		}
	}
	return out
}
