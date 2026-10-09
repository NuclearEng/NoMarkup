package middleware

import (
	"context"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestIdleTTLForRoles verifies the role -> idle-TTL mapping and the
// most-restrictive (smallest TTL) selection for multi-role users (CLAUDE.md §6).
func TestIdleTTLForRoles(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		roles []string
		want  time.Duration
	}{
		{"customer only", []string{"customer"}, 60 * time.Minute},
		{"provider only", []string{"provider"}, 120 * time.Minute},
		{"admin only", []string{"admin"}, 30 * time.Minute},
		// Most restrictive wins: admin (30m) over customer (60m).
		{"admin + customer -> admin", []string{"customer", "admin"}, 30 * time.Minute},
		// Most restrictive wins: customer (60m) over provider (120m).
		{"customer + provider -> customer", []string{"provider", "customer"}, 60 * time.Minute},
		// admin still wins against everything.
		{"all three -> admin", []string{"customer", "provider", "admin"}, 30 * time.Minute},
		// Unknown roles are ignored; recognized provider still selected.
		{"unknown + provider -> provider", []string{"ghost", "provider"}, 120 * time.Minute},
		// No recognized role -> restrictive default (admin window), never longer.
		{"empty -> default", []string{}, idleTimeoutDefault},
		{"only unknown -> default", []string{"ghost"}, idleTimeoutDefault},
		{"nil -> default", nil, idleTimeoutDefault},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, idleTTLForRoles(tt.roles))
		})
	}
}

// TestIdleTTLForRoles_DefaultIsMostRestrictive guards the invariant that the
// no-recognized-role default is never more permissive than the tightest known
// window (admin). If a new, tighter role is added, the default must track it.
func TestIdleTTLForRoles_DefaultIsMostRestrictive(t *testing.T) {
	t.Parallel()
	assert.LessOrEqual(t, idleTimeoutDefault, idleTimeoutAdmin)
	assert.LessOrEqual(t, idleTimeoutDefault, idleTimeoutCustomer)
	assert.LessOrEqual(t, idleTimeoutDefault, idleTimeoutProvider)
}

// --- Integration: real Redis round-trip (skips when Redis is unavailable) ---

// idleTestCache mirrors the idempotency tests' helper: connect to a local Redis
// for integration coverage, skip cleanly when it is unreachable.
func idleTestCache(t *testing.T) *cache.Client {
	t.Helper()
	c := cache.New("redis://localhost:6379")
	if c == nil {
		t.Skip("Redis unavailable, skipping idle-session integration test")
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// TestIdleSession_TouchThenActive verifies a touched session reports active, and
// a never-touched (or expired) session reports inactive — the exact signal the
// refresh handler enforces on.
func TestIdleSession_TouchThenActive(t *testing.T) {
	c := idleTestCache(t)
	ctx := context.Background()
	userID := uniqueKey(t) // unique per run to avoid cross-run collisions

	// Never touched -> key absent -> not active (ok=true, the probe succeeded).
	active, ok := idleSessionActive(ctx, c, userID)
	require.True(t, ok)
	assert.False(t, active, "untouched session must be inactive")

	// Touch -> key present -> active.
	touchIdleSession(ctx, c, userID, []string{"customer"})
	active, ok = idleSessionActive(ctx, c, userID)
	require.True(t, ok)
	assert.True(t, active, "touched session must be active")

	// Verify the TTL reflects the role (customer = 60m), within a slack window.
	ttl, err := c.Redis().TTL(ctx, idleSessionKey(userID)).Result()
	require.NoError(t, err)
	assert.Greater(t, ttl, 55*time.Minute)
	assert.LessOrEqual(t, ttl, 60*time.Minute)

	// Most-restrictive role drives a shorter TTL on re-touch (admin = 30m).
	touchIdleSession(ctx, c, userID, []string{"customer", "admin"})
	ttl, err = c.Redis().TTL(ctx, idleSessionKey(userID)).Result()
	require.NoError(t, err)
	assert.Greater(t, ttl, 25*time.Minute)
	assert.LessOrEqual(t, ttl, 30*time.Minute)

	// Cleanup.
	c.Redis().Del(ctx, idleSessionKey(userID))
}

// TestIdleSession_FailOpen verifies a nil cache never enforces: touch is a
// no-op and the activity probe returns ok=false so callers skip enforcement.
func TestIdleSession_FailOpen(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	// nil cache: touch must not panic.
	touchIdleSession(ctx, nil, "user-1", []string{"customer"})

	// nil cache: probe returns ok=false -> caller must NOT enforce.
	active, ok := idleSessionActive(ctx, nil, "user-1")
	assert.False(t, ok, "nil cache must report ok=false (fail open)")
	assert.False(t, active)
}
