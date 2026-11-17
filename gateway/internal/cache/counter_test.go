package cache

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

// counterTestClient connects to a local Redis (REDIS_TEST_URL, default
// localhost:6379) and skips cleanly when none is reachable, like the other
// Redis-backed tests in this module.
func counterTestClient(t *testing.T) *Client {
	t.Helper()
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	c := New(url)
	if c == nil {
		t.Skip("Redis unavailable, skipping counter integration test")
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func counterTestKey(t *testing.T) string {
	t.Helper()
	return Key("test", "counter", t.Name(), fmt.Sprint(time.Now().UnixNano()))
}

func TestIncrWithTTL_AlwaysSetsTTL(t *testing.T) {
	t.Parallel()
	c := counterTestClient(t)
	ctx := context.Background()
	rdb := c.Redis()
	key := counterTestKey(t)
	t.Cleanup(func() { rdb.Del(ctx, key) })

	for want := int64(1); want <= 3; want++ {
		got, err := IncrWithTTL(ctx, rdb, key, time.Minute)
		if err != nil {
			t.Fatalf("IncrWithTTL: %v", err)
		}
		if got != want {
			t.Fatalf("IncrWithTTL = %d, want %d", got, want)
		}
		ttl := rdb.PTTL(ctx, key).Val()
		if ttl <= 0 || ttl > time.Minute {
			t.Fatalf("after incr %d: PTTL = %v, want (0, 1m]", want, ttl)
		}
	}
}

func TestIncrWithTTL_RepairsKeyWithoutTTL(t *testing.T) {
	t.Parallel()
	c := counterTestClient(t)
	ctx := context.Background()
	rdb := c.Redis()
	key := counterTestKey(t)
	t.Cleanup(func() { rdb.Del(ctx, key) })

	// A legacy counter leaked without a TTL (the old INCR-then-EXPIRE hole).
	if err := rdb.Set(ctx, key, 4, 0).Err(); err != nil {
		t.Fatalf("seed: %v", err)
	}
	got, err := IncrWithTTL(ctx, rdb, key, time.Minute)
	if err != nil || got != 5 {
		t.Fatalf("IncrWithTTL = %d, %v; want 5, nil", got, err)
	}
	if ttl := rdb.PTTL(ctx, key).Val(); ttl <= 0 {
		t.Fatalf("PTTL = %v, want a TTL to be applied", ttl)
	}
}

func TestIncrWithTTL_DoesNotExtendExistingTTL(t *testing.T) {
	t.Parallel()
	c := counterTestClient(t)
	ctx := context.Background()
	rdb := c.Redis()
	key := counterTestKey(t)
	t.Cleanup(func() { rdb.Del(ctx, key) })

	if _, err := IncrWithTTL(ctx, rdb, key, 10*time.Second); err != nil {
		t.Fatalf("first incr: %v", err)
	}
	if _, err := IncrWithTTL(ctx, rdb, key, time.Hour); err != nil {
		t.Fatalf("second incr: %v", err)
	}
	if ttl := rdb.PTTL(ctx, key).Val(); ttl > 10*time.Second {
		t.Fatalf("PTTL = %v, want the original window (<= 10s) kept", ttl)
	}
}

func TestDecrIfExists_MissingKeyStaysMissing(t *testing.T) {
	t.Parallel()
	c := counterTestClient(t)
	ctx := context.Background()
	rdb := c.Redis()
	key := counterTestKey(t)
	t.Cleanup(func() { rdb.Del(ctx, key) })

	// Plain DECR here would create the key at -1 with no TTL.
	got, err := DecrIfExists(ctx, rdb, key)
	if err != nil || got != 0 {
		t.Fatalf("DecrIfExists = %d, %v; want 0, nil", got, err)
	}
	if n := rdb.Exists(ctx, key).Val(); n != 0 {
		t.Fatalf("key exists after DecrIfExists on a missing key")
	}
}

func TestDecrIfExists_KeepsTTLAndDeletesAtZero(t *testing.T) {
	t.Parallel()
	c := counterTestClient(t)
	ctx := context.Background()
	rdb := c.Redis()
	key := counterTestKey(t)
	t.Cleanup(func() { rdb.Del(ctx, key) })

	for range 2 {
		if _, err := IncrWithTTL(ctx, rdb, key, time.Minute); err != nil {
			t.Fatalf("incr: %v", err)
		}
	}
	got, err := DecrIfExists(ctx, rdb, key)
	if err != nil || got != 1 {
		t.Fatalf("DecrIfExists = %d, %v; want 1, nil", got, err)
	}
	if ttl := rdb.PTTL(ctx, key).Val(); ttl <= 0 {
		t.Fatalf("PTTL = %v after decr, want TTL kept", ttl)
	}
	got, err = DecrIfExists(ctx, rdb, key)
	if err != nil || got != 0 {
		t.Fatalf("DecrIfExists = %d, %v; want 0, nil", got, err)
	}
	if n := rdb.Exists(ctx, key).Val(); n != 0 {
		t.Fatalf("key still exists at zero; want it deleted")
	}
}
