package cache

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// Connection counters (e.g. per-IP spectator caps) must always carry a TTL.
// Production Redis runs with maxmemory-policy volatile-lru, under which a key
// without a TTL is never evicted, and a counter that leaks without one also
// locks its subject out (or, once negative, hands out extra slots) forever.
//
// The previous pattern had two holes:
//   - INCR followed by a separate EXPIRE only when count == 1: if the EXPIRE
//     round-trip failed, the key had no TTL for good.
//   - DECR on disconnect after the TTL had already expired: DECR on a missing
//     key creates it at -1 with no TTL.
//
// Both operations are therefore single Lua scripts.

// incrWithTTLScript increments KEYS[1] and gives it a TTL of ARGV[1] ms if it
// has none (new key, or a legacy key left without one).
var incrWithTTLScript = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
if redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return n
`)

// decrIfExistsScript decrements KEYS[1] only if it exists (DECR keeps the
// existing TTL) and deletes it once it reaches zero, so it never goes
// negative and never creates a key without a TTL.
var decrIfExistsScript = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
local n = redis.call('DECR', KEYS[1])
if n <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
return n
`)

// IncrWithTTL atomically increments key and ensures it expires within ttl.
// It returns the new value.
func IncrWithTTL(ctx context.Context, rdb redis.Scripter, key string, ttl time.Duration) (int64, error) {
	ms := ttl.Milliseconds()
	if ms < 1 {
		ms = 1
	}
	return incrWithTTLScript.Run(ctx, rdb, []string{key}, ms).Int64()
}

// DecrIfExists atomically decrements key if it exists, deleting it at zero.
// A missing key is left missing. It returns the remaining value (>= 0).
func DecrIfExists(ctx context.Context, rdb redis.Scripter, key string) (int64, error) {
	return decrIfExistsScript.Run(ctx, rdb, []string{key}).Int64()
}
