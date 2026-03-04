package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Client wraps a Redis client with typed get/set operations and TTL management.
type Client struct {
	rdb *redis.Client
}

// New creates a cache Client from a Redis URL (e.g. "redis://localhost:6379").
// Returns nil if the URL is empty or the connection fails — callers should
// treat nil as "caching disabled" and fall through to the origin.
func New(redisURL string) *Client {
	if redisURL == "" {
		return nil
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		slog.Warn("cache: invalid redis URL, caching disabled", "error", err)
		return nil
	}

	rdb := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Warn("cache: redis unreachable, caching disabled", "error", err)
		return nil
	}

	slog.Info("cache: redis connected", "addr", opts.Addr)
	return &Client{rdb: rdb}
}

// Redis returns the underlying Redis client for direct access (e.g., rate limiting).
func (c *Client) Redis() *redis.Client {
	return c.rdb
}

// GetJSON retrieves a cached value and unmarshals it into dest.
// Returns false if the key is missing or on any error.
func (c *Client) GetJSON(ctx context.Context, key string, dest interface{}) bool {
	if c == nil {
		return false
	}

	data, err := c.rdb.Get(ctx, key).Bytes()
	if err != nil {
		return false
	}

	if err := json.Unmarshal(data, dest); err != nil {
		slog.Warn("cache: unmarshal error", "key", key, "error", err)
		return false
	}

	return true
}

// SetJSON marshals value as JSON and stores it with the given TTL.
func (c *Client) SetJSON(ctx context.Context, key string, value interface{}, ttl time.Duration) {
	if c == nil {
		return
	}

	data, err := json.Marshal(value)
	if err != nil {
		slog.Warn("cache: marshal error", "key", key, "error", err)
		return
	}

	if err := c.rdb.Set(ctx, key, data, ttl).Err(); err != nil {
		slog.Warn("cache: set error", "key", key, "error", err)
	}
}

// Delete removes one or more keys from the cache.
func (c *Client) Delete(ctx context.Context, keys ...string) {
	if c == nil || len(keys) == 0 {
		return
	}

	if err := c.rdb.Del(ctx, keys...).Err(); err != nil {
		slog.Warn("cache: delete error", "keys", keys, "error", err)
	}
}

// Key builds a namespaced cache key.
func Key(parts ...string) string {
	result := "nomarkup"
	for _, p := range parts {
		result += ":" + p
	}
	return result
}

// --- Rate Limiting via Redis Sorted Sets ---

// RateLimitCheck performs a sliding-window rate limit check using Redis sorted sets.
// Returns (allowed bool, retryAfterSeconds int).
// If Redis is unavailable, it returns (true, 0) to fail open.
func (c *Client) RateLimitCheck(ctx context.Context, key string, limit int, window time.Duration) (bool, int) {
	if c == nil {
		return true, 0
	}

	now := time.Now()
	nowMicro := float64(now.UnixMicro())
	cutoff := float64(now.Add(-window).UnixMicro())
	member := fmt.Sprintf("%d", now.UnixNano()) // unique member per request

	pipe := c.rdb.Pipeline()
	// Remove entries outside the window.
	pipe.ZRemRangeByScore(ctx, key, "-inf", fmt.Sprintf("%f", cutoff))
	// Count current entries.
	countCmd := pipe.ZCard(ctx, key)
	// Add the new entry.
	pipe.ZAdd(ctx, key, redis.Z{Score: nowMicro, Member: member})
	// Set expiry on the key so it auto-cleans.
	pipe.Expire(ctx, key, window+time.Second)

	if _, err := pipe.Exec(ctx); err != nil {
		slog.Warn("cache: rate limit pipeline error, failing open", "error", err)
		return true, 0
	}

	count := countCmd.Val()
	if count >= int64(limit) {
		// Find the oldest entry to calculate retry-after.
		oldest, err := c.rdb.ZRangeWithScores(ctx, key, 0, 0).Result()
		retryAfter := 1
		if err == nil && len(oldest) > 0 {
			oldestTime := time.UnixMicro(int64(oldest[0].Score))
			retryAfter = int(oldestTime.Add(window).Sub(now).Seconds()) + 1
			if retryAfter < 1 {
				retryAfter = 1
			}
		}
		return false, retryAfter
	}

	return true, 0
}

// Close shuts down the Redis connection.
func (c *Client) Close() error {
	if c == nil {
		return nil
	}
	return c.rdb.Close()
}
