package ws

import (
	"crypto/subtle"
	"net/http"
	"os"
)

// internalSecretHeader is the HTTP header the gateway sets on its WS dial to
// the chat service, carrying the shared internal secret. It is also accepted as
// a query parameter (?internal_secret=) so the same handshake works for clients
// (like nhooyr.io/websocket.Dial) where setting headers on the upgrade request
// is awkward.
const internalSecretHeader = "X-Internal-WS-Secret"

// internalSecretQueryParam mirrors internalSecretHeader for transports that can
// only pass the secret in the URL.
const internalSecretQueryParam = "internal_secret"

// InternalWSSecret returns the configured shared secret used to authenticate the
// gateway -> chat WebSocket dial. It reads INTERNAL_WS_SECRET, falling back to
// GATEWAY_CHAT_SECRET for naming compatibility. An empty result means no secret
// is configured.
func InternalWSSecret() string {
	if s := os.Getenv("INTERNAL_WS_SECRET"); s != "" {
		return s
	}
	return os.Getenv("GATEWAY_CHAT_SECRET")
}

// verifyInternalSecret enforces the gateway->chat shared-secret handshake on an
// incoming WebSocket upgrade request. It is defense-in-depth: gateway-level JWT
// auth is the primary control, but if the chat WS port is ever reachable
// directly, this prevents an attacker from impersonating any user via the
// trusted ?user_id= query parameter.
//
// When no secret is configured (expected == ""), the check is skipped so local
// development without the env var keeps working. When a secret IS configured,
// the request must present a matching value (header or query param) using a
// constant-time comparison. Returns true if the request is authorized.
func verifyInternalSecret(r *http.Request, expected string) bool {
	if expected == "" {
		// No secret configured: fall back to gateway-only enforcement.
		return true
	}
	provided := r.Header.Get(internalSecretHeader)
	if provided == "" {
		provided = r.URL.Query().Get(internalSecretQueryParam)
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}
