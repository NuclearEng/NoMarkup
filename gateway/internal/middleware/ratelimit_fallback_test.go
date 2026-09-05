package middleware

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

// stubBackend is a rate-limit backend whose health can be flipped mid-flight,
// simulating a Redis that dies after the gateway has already booted with it.
type stubBackend struct {
	healthy atomic.Bool
	calls   atomic.Int64
	// allowed is what the backend reports while healthy.
	allowed atomic.Bool
}

func newStubBackend() *stubBackend {
	s := &stubBackend{}
	s.healthy.Store(true)
	s.allowed.Store(true)
	return s
}

func (s *stubBackend) RateLimitCheckErr(_ context.Context, _ string, _ int, _ time.Duration) (bool, int, error) {
	s.calls.Add(1)
	if !s.healthy.Load() {
		return true, 0, fmt.Errorf("%w: dial tcp 10.0.0.5:6379: connect: connection refused", cache.ErrRateLimitUnavailable)
	}
	if s.allowed.Load() {
		return true, 0, nil
	}
	return false, 42, nil
}

// newTestRateLimiter builds a RateLimiter wired to backend, with production
// limits (no dev multiplier) so the auth tier is the documented 5/15min.
func newTestRateLimiter(t *testing.T, backend rateLimitBackend) *RateLimiter {
	t.Helper()

	rl := NewRateLimiter(nil, true, 0)
	rl.cache = backend
	// Reset the log throttle so each test observes deterministic behaviour.
	rl.lastFallbackLog.Store(0)
	return rl
}

// TestRateLimiterFallsBackOnRuntimeRedisFailure is the regression test for
// SEC-05. A Redis that dies AFTER boot used to leave rl.fallback unreachable
// while every pipeline error was reported as "allowed" — so the auth tier
// (5 attempts / 15 min, the only brute-force defense; there is no DB-level
// account lockout) permitted unlimited attempts.
func TestRateLimiterFallsBackOnRuntimeRedisFailure(t *testing.T) {
	tests := []struct {
		name  string
		tier  RateLimitTier
		limit int
	}{
		{name: "auth tier keeps its brute-force ceiling", tier: TierAuth, limit: defaultAuthLimit},
		{name: "strict tier keeps limiting", tier: TierStrict, limit: defaultStrictLimit},
		{name: "standard tier keeps limiting", tier: TierStandard, limit: defaultStandardLimit},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			backend := newStubBackend()
			rl := newTestRateLimiter(t, backend)

			limit := rl.limitForTier(tt.tier)
			if limit != tt.limit {
				t.Fatalf("limitForTier(%v) = %d, want %d", tt.tier, limit, tt.limit)
			}
			window := windowForTier(tt.tier)
			key := tierString(tt.tier) + ":ip:203.0.113.7"

			// Phase 1: Redis healthy — decisions come from the shared window.
			if allowed, _ := rl.allow(key, limit, window); !allowed {
				t.Fatal("healthy backend should have allowed the request")
			}
			if backend.calls.Load() != 1 {
				t.Fatalf("backend calls = %d, want 1", backend.calls.Load())
			}

			// Phase 2: Redis dies mid-flight.
			backend.healthy.Store(false)

			var denied int
			// Send limit+5 requests. The in-memory window must start denying
			// once `limit` have been recorded.
			for i := 0; i < limit+5; i++ {
				allowed, retryAfter := rl.allow(key, limit, window)
				if !allowed {
					denied++
					if retryAfter < 1 {
						t.Errorf("denied request returned retry_after=%d, want >= 1", retryAfter)
					}
				}
			}

			if denied == 0 {
				t.Fatalf("tier %s failed open during the outage: %d requests, none denied",
					tierString(tt.tier), limit+5)
			}
			// Exactly the requests past the limit should be denied (the phase-1
			// request went to Redis and is not in the local window).
			if want := 5; denied != want {
				t.Errorf("denied = %d, want %d", denied, want)
			}
		})
	}
}

// TestRateLimiterRecoversWhenRedisReturns proves the degradation is not sticky:
// once Redis answers again the shared window is authoritative and the degraded
// gauge clears.
func TestRateLimiterRecoversWhenRedisReturns(t *testing.T) {
	backend := newStubBackend()
	rl := newTestRateLimiter(t, backend)

	backend.healthy.Store(false)
	if _, _ = rl.allow("auth:ip:198.51.100.9", 5, time.Minute); testutil.ToFloat64(rateLimitBackendDegraded) != 1 {
		t.Fatal("degraded gauge should be 1 during the outage")
	}

	backend.healthy.Store(true)
	backend.allowed.Store(false) // Redis says: over the limit
	allowed, retryAfter := rl.allow("auth:ip:198.51.100.9", 5, time.Minute)
	if allowed {
		t.Error("recovered backend's deny decision was not honoured")
	}
	if retryAfter != 42 {
		t.Errorf("retry_after = %d, want the backend's 42", retryAfter)
	}
	if got := testutil.ToFloat64(rateLimitBackendDegraded); got != 0 {
		t.Errorf("degraded gauge = %v after recovery, want 0", got)
	}
}

// TestRateLimiterFallbackIsCounted guards the observability half of the fix:
// a silent degradation is what turns "degraded" into "degraded and undetected".
func TestRateLimiterFallbackIsCounted(t *testing.T) {
	backend := newStubBackend()
	rl := newTestRateLimiter(t, backend)
	backend.healthy.Store(false)

	const key = "auth:ip:192.0.2.44"
	before := testutil.ToFloat64(rateLimitFallbackTotal.WithLabelValues(reasonBackendError, "auth"))

	for i := 0; i < 3; i++ {
		rl.allow(key, defaultAuthLimit, authRateLimitWindow)
	}

	after := testutil.ToFloat64(rateLimitFallbackTotal.WithLabelValues(reasonBackendError, "auth"))
	if delta := after - before; delta != 3 {
		t.Errorf("rate_limit_fallback_total{reason=backend_error,tier=auth} delta = %v, want 3", delta)
	}
}

// TestRateLimiterNilCacheStillLimits covers the boot-time-absent path and the
// typed-nil trap: NewRateLimiter(nil, ...) must leave rl.cache nil-comparable.
func TestRateLimiterNilCacheStillLimits(t *testing.T) {
	t.Parallel()

	var nilClient *cache.Client
	rl := NewRateLimiter(nilClient, true, 0)
	if rl.cache != nil {
		t.Fatal("a nil *cache.Client must not be stored as a non-nil interface")
	}

	const key = "auth:ip:192.0.2.77"
	var denied int
	for i := 0; i < defaultAuthLimit+2; i++ {
		if allowed, _ := rl.allow(key, defaultAuthLimit, authRateLimitWindow); !allowed {
			denied++
		}
	}
	if denied != 2 {
		t.Errorf("denied = %d, want 2", denied)
	}
}

func TestMemoryLimiterCleanupKeepsAuthWindow(t *testing.T) {
	t.Parallel()

	if memoryLimiterRetention() != authRateLimitWindow {
		t.Fatalf("retention = %s, want auth window %s", memoryLimiterRetention(), authRateLimitWindow)
	}

	ml := &memoryLimiter{stopCh: make(chan struct{})}
	key := "auth:ip:203.0.113.9"
	ml.entries.Store(key, &rateLimitEntry{
		timestamps: []time.Time{time.Now().Add(-2 * time.Minute)},
	})

	cutoff := time.Now().Add(-memoryLimiterRetention())
	val, ok := ml.entries.Load(key)
	if !ok {
		t.Fatal("expected stored auth entry")
	}
	entry := val.(*rateLimitEntry)
	entry.timestamps = pruneOld(entry.timestamps, cutoff)
	if len(entry.timestamps) != 1 {
		t.Fatalf("auth timestamps 2 minutes old were pruned; retention=%s count=%d", memoryLimiterRetention(), len(entry.timestamps))
	}
}

func TestErrRateLimitUnavailableWrapsCause(t *testing.T) {
	t.Parallel()

	backend := newStubBackend()
	backend.healthy.Store(false)

	_, _, err := backend.RateLimitCheckErr(context.Background(), "k", 1, time.Minute)
	if !errors.Is(err, cache.ErrRateLimitUnavailable) {
		t.Fatalf("err = %v, want it to wrap cache.ErrRateLimitUnavailable", err)
	}
}

func TestTierLabelFromKey(t *testing.T) {
	t.Parallel()

	tests := []struct {
		key  string
		want string
	}{
		{"auth:ip:1.2.3.4", "auth"},
		{"standard:user:abc", "standard"},
		{"public_read:ip:::1", "public_read"},
		{"malformed", "unknown"},
		{"", "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			t.Parallel()
			if got := tierLabelFromKey(tt.key); got != tt.want {
				t.Errorf("tierLabelFromKey(%q) = %q, want %q", tt.key, got, tt.want)
			}
		})
	}
}
