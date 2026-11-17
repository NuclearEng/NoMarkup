package handler

// ── LEGACY: read-only fallback to pre-migration-138 Redis work-session keys ──
//
// Until migration 138 the gateway wrote every check-in / check-out (and the
// completion-photo metadata) to Redis as well as to Postgres, under
//
//	contract:checkin:{contract}:{user}   (24 h TTL)
//	contract:checkout:{contract}:{user}  (24 h TTL)
//	contract:photo:{contract}:{user}:{phase} (24 h TTL, never read)
//
// Production Redis is volatile-lru, so those keys were evictable evidence.
// From 138 nothing writes them: contract_work_sessions / contract_completion_
// photos (migration 123) are the only stores. Postgres has been written FIRST
// on every check-in since 123 (a failed Postgres write 503s before Redis is
// touched), so in production this fallback can only ever surface a key whose
// Postgres row is also present — it exists to honour the rollout rule "reads
// fall back to Redis for records written before the deploy", and for a
// development gateway started without DATABASE_URL.
//
// REMOVAL NOTE: delete this file, its two call sites in workspace.go
// (CheckOut, GetWorkSession) and the forget() call in CheckIn once 24 hours
// have passed since the release that ships migration 138 — every key it can
// read has expired by then. Tracking: docs/operations/redis-state.md.

import (
	"context"
	"fmt"
	"time"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

// checkInData is the legacy Redis check-in record.
type checkInData struct {
	Lat       float64   `json:"lat"`
	Lng       float64   `json:"lng"`
	Timestamp time.Time `json:"timestamp"`
}

// checkOutData is the legacy Redis check-out record.
type checkOutData struct {
	Lat             float64   `json:"lat"`
	Lng             float64   `json:"lng"`
	Timestamp       time.Time `json:"timestamp"`
	DurationMinutes int       `json:"duration_minutes"`
}

func legacyCheckInKey(contractID, userID string) string {
	return fmt.Sprintf("contract:checkin:%s:%s", contractID, userID)
}

func legacyCheckOutKey(contractID, userID string) string {
	return fmt.Sprintf("contract:checkout:%s:%s", contractID, userID)
}

// legacyWorkSessionCache reads the pre-138 keys. Every method is nil-safe
// (cache.Client methods treat a nil receiver as "caching disabled").
type legacyWorkSessionCache struct {
	cache *cache.Client
}

func (l legacyWorkSessionCache) checkIn(ctx context.Context, contractID, userID string) (checkInData, bool) {
	var d checkInData
	ok := l.cache.GetJSON(ctx, legacyCheckInKey(contractID, userID), &d)
	return d, ok
}

func (l legacyWorkSessionCache) checkOut(ctx context.Context, contractID, userID string) (checkOutData, bool) {
	var d checkOutData
	ok := l.cache.GetJSON(ctx, legacyCheckOutKey(contractID, userID), &d)
	return d, ok
}

// forget drops both legacy keys once a durable session has been written, so the
// fallback can never resurrect a superseded session.
func (l legacyWorkSessionCache) forget(ctx context.Context, contractID, userID string) {
	l.cache.Delete(ctx, legacyCheckInKey(contractID, userID), legacyCheckOutKey(contractID, userID))
}

// legacyWorkSessionResult renders the legacy keys in the GET work-session
// shape. found is false when neither key exists.
func legacyWorkSessionResult(in checkInData, hasIn bool, out checkOutData, hasOut bool) (map[string]interface{}, bool) {
	result := map[string]interface{}{
		"status":           "not_started",
		"checked_in_at":    nil,
		"checked_out_at":   nil,
		"duration_minutes": nil,
	}
	if hasIn {
		result["checked_in_at"] = in.Timestamp.UTC().Format(time.RFC3339)
		result["status"] = "checked_in"
	}
	if hasOut {
		result["checked_out_at"] = out.Timestamp.UTC().Format(time.RFC3339)
		result["duration_minutes"] = out.DurationMinutes
		result["status"] = "checked_out"
	}
	return result, hasIn || hasOut
}
