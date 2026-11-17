package service

// One-time drain of the legacy Redis ZSET `search:retry` into
// search_retry_outbox (migration 141).
//
// REMOVAL NOTE: delete this file, its test, and the DrainLegacySearchRetryRedis
// call in cmd/server/main.go one release after the outbox ships, once
// `EXISTS search:retry` returns 0 against production Redis. Nothing writes the
// key any more, so after one successful drain on any replica it stays empty.
//
// Safe to run on every replica at every start: a member is ZREMed only after
// its row is inserted (or found already pending), and duplicate inserts dedupe
// on the pending unique index. A crash between insert and ZREM re-imports the
// member next start, which is a no-op.

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// legacySearchRetryRedisKey is the ZSET the Redis-backed queue used. Score =
// next attempt unix seconds; member = JSON SearchRetryTask.
const legacySearchRetryRedisKey = "search:retry"

// legacySearchRetryDrainBatch bounds one ZRANGE.
const legacySearchRetryDrainBatch = 500

// searchRetryDrainStats reports one drain.
type searchRetryDrainStats struct {
	Seen      int
	Imported  int
	Duplicate int
	Corrupt   int
	Failed    int
}

// decodeLegacySearchRetryMember parses a ZSET member + score into a task and
// its due time. Rejects anything the outbox cannot hold (non-UUID entity).
func decodeLegacySearchRetryMember(member string, score float64) (SearchRetryTask, time.Time, error) {
	task, err := unmarshalSearchRetryMember(member)
	if err != nil {
		return SearchRetryTask{}, time.Time{}, err
	}
	if _, err := uuid.Parse(task.EntityID); err != nil {
		return SearchRetryTask{}, time.Time{}, fmt.Errorf("legacy search retry member: entity id is not a uuid: %w", err)
	}
	if task.Attempts < 0 {
		task.Attempts = 0
	}
	// A member at/over the budget would dead-letter on its first claim; give it
	// one last attempt rather than dropping it on import.
	if task.Attempts >= maxSearchRetryDurableAttempts {
		task.Attempts = maxSearchRetryDurableAttempts - 1
	}
	due := time.Now().UTC()
	if !math.IsNaN(score) && !math.IsInf(score, 0) && score > 0 {
		due = time.Unix(int64(score), 0).UTC()
	}
	return task, due, nil
}

// DrainLegacySearchRetryRedis moves every member of the legacy ZSET into the
// outbox. Errors on individual members are logged and left in Redis for the
// next start; only a Redis read failure aborts.
func (q *SearchRetryQueue) DrainLegacySearchRetryRedis(ctx context.Context, rdb *redis.Client) (searchRetryDrainStats, error) {
	var st searchRetryDrainStats
	if q == nil || q.store == nil || rdb == nil {
		return st, nil
	}
	// Members that failed to import stay in the ZSET; skip past them so the
	// loop terminates.
	offset := int64(0)
	for {
		zs, err := rdb.ZRangeWithScores(ctx, legacySearchRetryRedisKey, offset, offset+legacySearchRetryDrainBatch-1).Result()
		if err != nil {
			return st, fmt.Errorf("legacy search retry drain: zrange: %w", err)
		}
		if len(zs) == 0 {
			return st, nil
		}
		for _, z := range zs {
			st.Seen++
			member, ok := z.Member.(string)
			if !ok {
				st.Corrupt++
				_ = rdb.ZRem(ctx, legacySearchRetryRedisKey, z.Member).Err()
				continue
			}
			task, due, derr := decodeLegacySearchRetryMember(member, z.Score)
			if derr != nil {
				st.Corrupt++
				slog.Error("legacy search retry drain: corrupt member dropped", "error", derr)
				if rerr := rdb.ZRem(ctx, legacySearchRetryRedisKey, member).Err(); rerr != nil {
					offset++
				}
				continue
			}
			inserted, ierr := q.store.Import(ctx, task, due)
			if ierr != nil {
				st.Failed++
				offset++
				slog.Error("legacy search retry drain: import failed; member left in Redis for next start",
					"index", task.Index, "op", task.Op, "entity_id", task.EntityID, "error", ierr)
				continue
			}
			if inserted {
				st.Imported++
			} else {
				st.Duplicate++
			}
			if rerr := rdb.ZRem(ctx, legacySearchRetryRedisKey, member).Err(); rerr != nil {
				offset++
				slog.Warn("legacy search retry drain: zrem failed; member will be re-imported (no-op) next start",
					"entity_id", task.EntityID, "error", rerr)
			}
		}
	}
}
