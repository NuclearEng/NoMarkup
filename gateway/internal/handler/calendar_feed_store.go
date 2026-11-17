package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

// errCalendarFeedUnavailable is returned when no durable store can persist a
// feed hash.
var errCalendarFeedUnavailable = errors.New("calendar feed store unavailable")

// calendarFeedPruneBatch bounds the opportunistic expired-row prune that runs
// on every mint (the notification_send_ledger pattern: no dedicated sweeper).
const calendarFeedPruneBatch = 500

// pgCalendarFeedStore keeps feed tokens in calendar_feed_tokens (migration
// 140). Production Redis is volatile-lru, so the previous Redis-only store
// could evict a user's subscription and silently break their calendar; a
// credential configured once in a third-party app belongs in Postgres.
//
// Only SHA-256(secret) is stored. The 90-day expiry is enforced on READ
// (expires_at > now()), so an expired row is dead before it is pruned.
type pgCalendarFeedStore struct {
	db *pgxpool.Pool
}

func (s pgCalendarFeedStore) Put(ctx context.Context, hashHex, userID string, ttl time.Duration) error {
	if s.db == nil {
		return errCalendarFeedUnavailable
	}
	if ttl <= 0 {
		return fmt.Errorf("store calendar feed: non-positive ttl %s", ttl)
	}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO calendar_feed_tokens (token_hash, user_id, expires_at)
		VALUES ($1, $2, now() + make_interval(secs => $3))`,
		hashHex, userID, ttl.Seconds()); err != nil {
		return fmt.Errorf("store calendar feed: %w", err)
	}
	s.pruneExpired(ctx)
	return nil
}

// pruneExpired deletes a bounded batch of expired tokens. Best-effort: the
// mint already succeeded, and the next mint retries.
func (s pgCalendarFeedStore) pruneExpired(ctx context.Context) {
	if _, err := s.db.Exec(ctx, `
		DELETE FROM calendar_feed_tokens
		 WHERE token_hash IN (
		       SELECT token_hash FROM calendar_feed_tokens
		        WHERE expires_at <= now()
		        LIMIT $1)`, calendarFeedPruneBatch); err != nil {
		slog.WarnContext(ctx, "calendar feed: expired-token prune failed", "error", err)
	}
}

func (s pgCalendarFeedStore) Get(ctx context.Context, hashHex string) (string, bool) {
	userID, ok, err := s.lookup(ctx, hashHex)
	if err != nil {
		slog.ErrorContext(ctx, "calendar feed: token lookup failed", "error", err)
		return "", false
	}
	return userID, ok
}

func (s pgCalendarFeedStore) lookup(ctx context.Context, hashHex string) (string, bool, error) {
	if s.db == nil {
		return "", false, nil
	}
	var userID string
	err := s.db.QueryRow(ctx, `
		SELECT user_id::text
		  FROM calendar_feed_tokens
		 WHERE token_hash = $1
		   AND expires_at > now()`, hashHex).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("lookup calendar feed: %w", err)
	}
	return userID, true, nil
}

// adoptLegacy copies a pre-140 Redis token into Postgres with the TTL it had
// left. A user whose erasure has been finalized is not resurrected (adopted is
// false). A token that is already present is left alone (adopted is true: the
// row exists either way).
func (s pgCalendarFeedStore) adoptLegacy(ctx context.Context, hashHex, userID string, remaining time.Duration) (bool, error) {
	tag, err := s.db.Exec(ctx, `
		INSERT INTO calendar_feed_tokens (token_hash, user_id, expires_at)
		SELECT $1, u.id, now() + make_interval(secs => $3)
		  FROM users u
		 WHERE u.id = $2
		   AND u.deletion_finalized_at IS NULL
		ON CONFLICT (token_hash) DO NOTHING`,
		hashHex, userID, remaining.Seconds())
	if err != nil {
		return false, fmt.Errorf("adopt legacy calendar feed: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return true, nil
	}
	// Either the row already existed (fine) or the user is gone / erased.
	_, exists, lookupErr := s.lookup(ctx, hashHex)
	if lookupErr != nil {
		return false, lookupErr
	}
	return exists, nil
}

// ── LEGACY: read-only fallback to pre-migration-140 Redis feed tokens ───────
//
// Before migration 140 a feed lived only in Redis as nomarkup:calfeed:{hash}
// with a 90-day TTL. Those subscriptions are still configured in users'
// calendar apps, so a Postgres miss consults Redis once; a hit is adopted into
// calendar_feed_tokens with the TTL it had left and the Redis key is deleted,
// so each legacy token is migrated on its first poll after the deploy.
//
// REMOVAL NOTE: delete legacyRedisCalendarFeedStore,
// calendarFeedStoreWithLegacy and CalendarExportHandler.WithCache (and its
// call in router.go) 90 days after the release that ships migration 140 — the
// last legacy key has expired by then. Before removing, `SCAN 0 MATCH
// nomarkup:calfeed:*` in production should return nothing. Tracking:
// docs/operations/redis-state.md.

type legacyRedisCalendarFeedStore struct {
	cache *cache.Client
}

func legacyCalendarFeedKey(hashHex string) string {
	return cache.Key("calfeed", hashHex)
}

// lookup returns the user and remaining TTL of a legacy key. A key without a
// positive TTL is treated as absent: every legacy key was written with one.
func (s legacyRedisCalendarFeedStore) lookup(ctx context.Context, hashHex string) (string, time.Duration, bool) {
	if s.cache == nil || s.cache.Redis() == nil {
		return "", 0, false
	}
	rdb := s.cache.Redis()
	key := legacyCalendarFeedKey(hashHex)
	pipe := rdb.Pipeline()
	getCmd := pipe.Get(ctx, key)
	ttlCmd := pipe.PTTL(ctx, key)
	if _, err := pipe.Exec(ctx); err != nil {
		if !errors.Is(err, redis.Nil) {
			slog.WarnContext(ctx, "calendar feed: legacy redis lookup failed", "error", err)
		}
		return "", 0, false
	}
	userID := getCmd.Val()
	remaining := ttlCmd.Val()
	if userID == "" || remaining <= 0 {
		return "", 0, false
	}
	return userID, remaining, true
}

func (s legacyRedisCalendarFeedStore) forget(ctx context.Context, hashHex string) {
	s.cache.Delete(ctx, legacyCalendarFeedKey(hashHex))
}

// calendarFeedStoreWithLegacy writes to Postgres only and reads Postgres
// first, then the legacy Redis key (see the removal note above).
type calendarFeedStoreWithLegacy struct {
	primary pgCalendarFeedStore
	legacy  legacyRedisCalendarFeedStore
}

func (s calendarFeedStoreWithLegacy) Put(ctx context.Context, hashHex, userID string, ttl time.Duration) error {
	return s.primary.Put(ctx, hashHex, userID, ttl)
}

func (s calendarFeedStoreWithLegacy) Get(ctx context.Context, hashHex string) (string, bool) {
	userID, ok, err := s.primary.lookup(ctx, hashHex)
	if err != nil {
		// Do not fall through to Redis on a DB error: an erased user's legacy
		// key must not be honoured just because Postgres blinked.
		slog.ErrorContext(ctx, "calendar feed: token lookup failed", "error", err)
		return "", false
	}
	if ok {
		return userID, true
	}

	legacyUser, remaining, found := s.legacy.lookup(ctx, hashHex)
	if !found {
		return "", false
	}
	adopted, err := s.primary.adoptLegacy(ctx, hashHex, legacyUser, remaining)
	if err != nil {
		slog.ErrorContext(ctx, "calendar feed: adopting legacy token failed; key left in redis", "error", err)
		return "", false
	}
	// Adopted or refused (erased user), the Redis copy has served its purpose.
	s.legacy.forget(ctx, hashHex)
	if !adopted {
		return "", false
	}
	slog.InfoContext(ctx, "calendar feed: legacy redis token adopted into postgres")
	return legacyUser, true
}
