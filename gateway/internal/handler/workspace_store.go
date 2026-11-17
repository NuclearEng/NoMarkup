package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
)

// workSessionStore is the durable home of provider check-in / check-out
// records (contract_work_sessions, migration 123). It is the ONLY authority for
// work sessions: Redis holds no copy as of migration 138 (production Redis is
// volatile-lru, so any TTL'd key is evictable — check-in is dispute evidence
// and must not be). The release gate (workspace_evidence.go) reads the same
// table.
type workSessionStore interface {
	// RecordCheckIn opens a session, or refreshes the open one (new check-in
	// time and point, check-out cleared).
	RecordCheckIn(ctx context.Context, contractID, providerID string, lat, lng float64, at time.Time) error
	// RecordCheckOut closes the open session. With no open session it inserts
	// a closed one from checkedInAt so release still has durable evidence.
	RecordCheckOut(ctx context.Context, contractID, providerID string, lat, lng float64, at time.Time, durationMinutes int, checkedInAt time.Time) error
	// OpenCheckIn returns the check-in time of the open session, if any.
	OpenCheckIn(ctx context.Context, contractID, providerID string) (time.Time, bool, error)
	// Latest returns the most recent session for (contract, provider).
	Latest(ctx context.Context, contractID, providerID string) (persistedWorkSession, bool, error)
}

type persistedWorkSession struct {
	checkedInAt     time.Time
	checkedOutAt    *time.Time
	durationMinutes int
}

// pgWorkSessionStore implements workSessionStore on contract_work_sessions.
//
// Coordinates are PII (geo-fenced to within 500 m of a customer home, and a
// timestamped trace of a named provider — migration 138). They are written
// ONLY to check_{in,out}_location_encrypted as secretbox("<lat>,<lng>"), the
// jobs.service_location_encrypted wire format, and NULL is written to the
// legacy check_*_lat/lng columns. With no cipher the point is dropped (NULL)
// rather than stored in clear: the timestamps, which are what the release gate
// and the API read, are still recorded.
type pgWorkSessionStore struct {
	db     *pgxpool.Pool
	cipher *crypto.Cipher
}

// formatWorkSessionPoint renders a point exactly like
// services/job/internal/domain.FormatExactPoint and the encrypt-pii backfill
// ("<lat>,<lng>", 7 decimals), so live writes and backfilled rows share one
// plaintext format that parseExactPoint reads back.
func formatWorkSessionPoint(lat, lng float64) string {
	return strconv.FormatFloat(lat, 'f', 7, 64) + "," + strconv.FormatFloat(lng, 'f', 7, 64)
}

// sealPoint encrypts a point, returning nil (SQL NULL) when no cipher is wired.
func (s pgWorkSessionStore) sealPoint(ctx context.Context, lat, lng float64) (*string, error) {
	if s.cipher == nil {
		slog.ErrorContext(ctx, "workspace: no PII cipher; work-session coordinates are not stored (timestamps are)")
		return nil, nil
	}
	ct, err := s.cipher.EncryptString(formatWorkSessionPoint(lat, lng))
	if err != nil {
		return nil, fmt.Errorf("encrypt work-session point: %w", err)
	}
	return &ct, nil
}

func (s pgWorkSessionStore) RecordCheckIn(ctx context.Context, contractID, providerID string, lat, lng float64, at time.Time) error {
	point, err := s.sealPoint(ctx, lat, lng)
	if err != nil {
		return fmt.Errorf("record check-in: %w", err)
	}

	updated, err := s.refreshOpenCheckIn(ctx, contractID, providerID, point, at)
	if err != nil {
		return fmt.Errorf("record check-in: %w", err)
	}
	if updated {
		return nil
	}

	_, err = s.db.Exec(ctx, `
		INSERT INTO contract_work_sessions (
			contract_id, provider_id, checked_in_at, check_in_location_encrypted
		) VALUES ($1, $2, $3, $4)`,
		contractID, providerID, at, point)
	if err == nil {
		return nil
	}
	// Concurrent check-in won the unique-open index — refresh that row.
	if isUniqueViolation(err) {
		updated, retryErr := s.refreshOpenCheckIn(ctx, contractID, providerID, point, at)
		if retryErr != nil {
			return fmt.Errorf("record check-in retry: %w", retryErr)
		}
		if updated {
			return nil
		}
		return errors.New("record check-in: open session vanished after unique conflict")
	}
	return fmt.Errorf("record check-in insert: %w", err)
}

// refreshOpenCheckIn rewrites the open session. The legacy plaintext columns
// are cleared on every write, so a row an old pod wrote in clear stops being
// plaintext the moment a new pod touches it.
func (s pgWorkSessionStore) refreshOpenCheckIn(ctx context.Context, contractID, providerID string, point *string, at time.Time) (bool, error) {
	tag, err := s.db.Exec(ctx, `
		UPDATE contract_work_sessions
		   SET checked_in_at = $3,
		       check_in_location_encrypted = $4,
		       check_in_lat = NULL,
		       check_in_lng = NULL,
		       checked_out_at = NULL,
		       check_out_location_encrypted = NULL,
		       check_out_lat = NULL,
		       check_out_lng = NULL,
		       duration_minutes = NULL
		 WHERE contract_id = $1
		   AND provider_id = $2
		   AND checked_out_at IS NULL`,
		contractID, providerID, at, point)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s pgWorkSessionStore) RecordCheckOut(
	ctx context.Context,
	contractID, providerID string,
	lat, lng float64,
	at time.Time,
	durationMinutes int,
	checkedInAt time.Time,
) error {
	point, err := s.sealPoint(ctx, lat, lng)
	if err != nil {
		return fmt.Errorf("record check-out: %w", err)
	}

	tag, err := s.db.Exec(ctx, `
		UPDATE contract_work_sessions
		   SET checked_out_at = $3,
		       check_out_location_encrypted = $4,
		       check_out_lat = NULL,
		       check_out_lng = NULL,
		       duration_minutes = $5
		 WHERE contract_id = $1
		   AND provider_id = $2
		   AND checked_out_at IS NULL`,
		contractID, providerID, at, point, durationMinutes)
	if err != nil {
		return fmt.Errorf("record check-out: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return nil
	}

	_, err = s.db.Exec(ctx, `
		INSERT INTO contract_work_sessions (
			contract_id, provider_id, checked_in_at,
			checked_out_at, check_out_location_encrypted, duration_minutes
		) VALUES ($1, $2, $3, $4, $5, $6)`,
		contractID, providerID, checkedInAt, at, point, durationMinutes)
	if err != nil {
		return fmt.Errorf("record check-out insert: %w", err)
	}
	return nil
}

func (s pgWorkSessionStore) OpenCheckIn(ctx context.Context, contractID, providerID string) (time.Time, bool, error) {
	var at time.Time
	err := s.db.QueryRow(ctx, `
		SELECT checked_in_at
		  FROM contract_work_sessions
		 WHERE contract_id = $1
		   AND provider_id = $2
		   AND checked_out_at IS NULL`,
		contractID, providerID).Scan(&at)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, false, nil
		}
		return time.Time{}, false, fmt.Errorf("open session check-in: %w", err)
	}
	return at, true, nil
}

func (s pgWorkSessionStore) Latest(ctx context.Context, contractID, providerID string) (persistedWorkSession, bool, error) {
	var sess persistedWorkSession
	var duration *int
	err := s.db.QueryRow(ctx, `
		SELECT checked_in_at, checked_out_at, duration_minutes
		  FROM contract_work_sessions
		 WHERE contract_id = $1
		   AND provider_id = $2
		 ORDER BY checked_in_at DESC
		 LIMIT 1`,
		contractID, providerID).Scan(&sess.checkedInAt, &sess.checkedOutAt, &duration)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return persistedWorkSession{}, false, nil
		}
		return persistedWorkSession{}, false, fmt.Errorf("latest work session: %w", err)
	}
	if duration != nil {
		sess.durationMinutes = *duration
	}
	return sess, true, nil
}
