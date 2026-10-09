package middleware

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

// Role-based idle session timeouts (CLAUDE.md §6). A session that makes no
// authenticated request (and no WebSocket heartbeat) for longer than its role's
// window is considered idle and is rejected at the next token refresh.
//
// When a user holds multiple roles we apply the MOST RESTRICTIVE (smallest)
// window — an admin who is also a customer is held to the 30-minute admin
// timeout, never relaxed to the 60-minute customer one. This fails toward
// tighter security, not looser.
const (
	idleTimeoutCustomer = 60 * time.Minute
	idleTimeoutProvider = 120 * time.Minute
	idleTimeoutAdmin    = 30 * time.Minute

	// idleTimeoutDefault is used when a session carries no recognized role.
	// We pick the most restrictive known window so an unexpected/empty role set
	// never grants a longer-than-admin idle budget.
	idleTimeoutDefault = idleTimeoutAdmin
)

// idleTTLForRoles returns the idle-session TTL for a set of roles, using the
// MOST RESTRICTIVE (smallest) window across all recognized roles. Unrecognized
// roles are ignored. If no role is recognized (empty/unknown), it returns the
// restrictive default (admin window) — never a longer budget.
func idleTTLForRoles(roles []string) time.Duration {
	ttl := time.Duration(0)
	for _, r := range roles {
		var cand time.Duration
		switch r {
		case "customer":
			cand = idleTimeoutCustomer
		case "provider":
			cand = idleTimeoutProvider
		case "admin":
			cand = idleTimeoutAdmin
		default:
			continue
		}
		if ttl == 0 || cand < ttl {
			ttl = cand
		}
	}
	if ttl == 0 {
		return idleTimeoutDefault
	}
	return ttl
}

// idleSessionKey builds the Redis key tracking a user's last-activity sliding
// window: nomarkup:sess:idle:{userID}.
func idleSessionKey(userID string) string {
	return cache.Key("sess", "idle", userID)
}

// touchIdleSession (re)sets the sliding idle-activity key for a user with the
// TTL derived from their roles. Called on every authenticated request, on a
// fresh login, and on WebSocket heartbeats — each touch resets the window.
//
// FAIL OPEN: a nil cache (Redis disabled/unavailable) or any Redis error is a
// no-op. The idle timeout is a defense-in-depth layer, never the primary gate,
// so a cache outage must never lock users out.
func touchIdleSession(ctx context.Context, c *cache.Client, userID string, roles []string) {
	if c == nil || userID == "" {
		return
	}
	ttl := idleTTLForRoles(roles)
	if err := c.Redis().Set(ctx, idleSessionKey(userID), strconv.FormatInt(time.Now().Unix(), 10), ttl).Err(); err != nil {
		// Fail open: log and move on. Never block the request on a cache error.
		slog.WarnContext(ctx, "idle session touch failed (failing open)", "user_id", userID, "error", err)
	}
}

// idleSessionActive reports whether a user's idle-session key still exists
// (i.e. they have NOT been idle past their role window).
//
// The boolean result is only meaningful when ok is true. FAIL OPEN: if the
// cache is nil/unavailable or the EXISTS probe errors, ok is false and the
// caller MUST NOT enforce the timeout — treat the session as still active.
func idleSessionActive(ctx context.Context, c *cache.Client, userID string) (active bool, ok bool) {
	if c == nil || userID == "" {
		return false, false
	}
	n, err := c.Redis().Exists(ctx, idleSessionKey(userID)).Result()
	if err != nil {
		slog.WarnContext(ctx, "idle session probe failed (failing open)", "user_id", userID, "error", err)
		return false, false
	}
	return n > 0, true
}

// TouchIdleSession exposes touchIdleSession for callers outside this package
// (the auth handler's Login/Refresh paths and the WebSocket heartbeat). It is a
// method on AuthMiddleware so callers reuse the already-wired cache client.
func (m *AuthMiddleware) TouchIdleSession(ctx context.Context, userID string, roles []string) {
	touchIdleSession(ctx, m.cache, userID, roles)
}

// IdleSessionActive exposes idleSessionActive for the refresh-enforcement path.
// See idleSessionActive for the fail-open contract.
func (m *AuthMiddleware) IdleSessionActive(ctx context.Context, userID string) (active bool, ok bool) {
	return idleSessionActive(ctx, m.cache, userID)
}
