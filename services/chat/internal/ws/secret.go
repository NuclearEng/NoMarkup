package ws

import (
	"crypto/subtle"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
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

// isDevelopmentEnv is true when either ENVIRONMENT or APP_ENV is "development".
// Matches the gateway convention so local dev works under either name.
func isDevelopmentEnv() bool {
	return strings.EqualFold(os.Getenv("ENVIRONMENT"), "development") ||
		strings.EqualFold(os.Getenv("APP_ENV"), "development")
}

// emptySecretDevWarnOnce ensures the empty-secret development fallback is logged
// loudly at most once per process (verify path).
var emptySecretDevWarnOnce sync.Once

// RequireInternalWSSecret refuses non-development startup without a shared
// secret. In development an empty secret is allowed but warned about once.
// Call from main before accepting any WebSocket traffic (SEC-03 / GAP-006).
func RequireInternalWSSecret() error {
	if InternalWSSecret() != "" {
		return nil
	}
	if isDevelopmentEnv() {
		slog.Warn("INTERNAL_WS_SECRET is empty: chat WebSocket will trust gateway-supplied user_id without verifying a shared secret (development only)")
		return nil
	}
	return fmt.Errorf("INTERNAL_WS_SECRET (or GATEWAY_CHAT_SECRET) must be set when ENVIRONMENT is not development")
}

// verifyInternalSecret enforces the gateway->chat shared-secret handshake on an
// incoming WebSocket upgrade request. It is defense-in-depth: gateway-level JWT
// auth is the primary control, but if the chat WS port is ever reachable
// directly, this prevents an attacker from impersonating any user via the
// trusted ?user_id= query parameter.
//
// When no secret is configured (expected == ""):
//   - production / non-development: reject (fail closed)
//   - development: allow with a single loud warn so local work without the env
//     var keeps working
//
// When a secret IS configured, the request must present a matching value
// (header or query param) using a constant-time comparison.
func verifyInternalSecret(r *http.Request, expected string) bool {
	if expected == "" {
		if isDevelopmentEnv() {
			emptySecretDevWarnOnce.Do(func() {
				slog.Warn("INTERNAL_WS_SECRET empty: accepting WebSocket upgrades without shared-secret check (development only)")
			})
			return true
		}
		return false
	}
	provided := r.Header.Get(internalSecretHeader)
	if provided == "" {
		provided = r.URL.Query().Get(internalSecretQueryParam)
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

// originPatternsCache + once: WS_ALLOWED_ORIGINS is process-static.
var (
	originPatternsCache []string
	originPatternsOnce  sync.Once
)

// originPatterns returns host patterns for nhooyr AcceptOptions.OriginPatterns
// (SEC-04). Sources:
//   - WS_ALLOWED_ORIGINS (comma-separated URLs or hosts); production defaults
//     when unset (no-markup.com hosts — owned zone).
//   - localhost variants when ENVIRONMENT/APP_ENV is development.
//
// Gateway→chat dials typically omit Origin; nhooyr allows empty Origin.
// Browser CSWSH against an exposed chat port is blocked unless the Origin host
// matches. Same-host requests are always authorized by the library.
func originPatterns() []string {
	originPatternsOnce.Do(func() {
		raw := strings.TrimSpace(os.Getenv("WS_ALLOWED_ORIGINS"))
		var patterns []string
		if raw == "" {
			// Owned production zone is hyphenated no-markup.com (not nomarkup.com).
			patterns = []string{"no-markup.com", "app.no-markup.com"}
		} else {
			for _, p := range strings.Split(raw, ",") {
				p = strings.TrimSpace(p)
				p = stripOriginScheme(p)
				if p != "" {
					patterns = append(patterns, p)
				}
			}
		}
		if isDevelopmentEnv() {
			patterns = append(patterns,
				"localhost:3000", "localhost:3002",
				"127.0.0.1:3000", "127.0.0.1:3002",
			)
		}
		originPatternsCache = patterns
		slog.Info("websocket origin patterns loaded", "patterns", patterns)
	})
	return originPatternsCache
}

func stripOriginScheme(s string) string {
	for _, prefix := range []string{"https://", "http://", "wss://", "ws://"} {
		if strings.HasPrefix(s, prefix) {
			return strings.TrimPrefix(s, prefix)
		}
	}
	return s
}
