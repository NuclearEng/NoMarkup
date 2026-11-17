package handler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPgCalendarFeedStore_nilDB(t *testing.T) {
	t.Parallel()
	s := pgCalendarFeedStore{}
	err := s.Put(context.Background(), "ab", "user-1", calendarFeedTTL)
	assert.True(t, errors.Is(err, errCalendarFeedUnavailable))
	uid, ok := s.Get(context.Background(), "ab")
	assert.False(t, ok)
	assert.Empty(t, uid)
}

func TestNewCalendarExportHandler_storeWiring(t *testing.T) {
	t.Parallel()
	// No database: no durable store, so MintFeed 503s (covered by
	// TestMintFeedUnavailableWithoutStore) and WithCache must NOT fall back to
	// a Redis-only store — a feed token must never again live only in Redis.
	h := NewCalendarExportHandler(nil, nil).WithCache(nil)
	assert.Nil(t, h.feeds)
}

func TestLegacyRedisCalendarFeedStore_nilCache(t *testing.T) {
	t.Parallel()
	uid, ttl, ok := legacyRedisCalendarFeedStore{}.lookup(context.Background(), "ab")
	assert.False(t, ok)
	assert.Empty(t, uid)
	assert.Zero(t, ttl)
	// forget on a nil cache is a no-op, not a panic.
	legacyRedisCalendarFeedStore{}.forget(context.Background(), "ab")
}

func TestMintCalendarFeedSecret_hashShapeMatchesTableCheck(t *testing.T) {
	t.Parallel()
	_, hashHex, err := mintCalendarFeedSecret()
	require.NoError(t, err)
	// calendar_feed_tokens.token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$').
	assert.Regexp(t, `^[0-9a-f]{64}$`, hashHex)
	assert.Equal(t, "nomarkup:calfeed:"+hashHex, legacyCalendarFeedKey(hashHex))
	assert.Equal(t, 90*24*time.Hour, calendarFeedTTL)
}
