package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const (
	backgroundCheckRequiredMsg = "background check required"
	backgroundChecksFlagKey    = "background_checks"
)

// backgroundCheckBidGate is the F4 bid gate: when feature_flags.background_checks
// is ON, a provider may place a job or listing bid only if their latest
// provider_background_checks.status is clear or consider.
//
// DB only — never calls Checkr. Flag OFF (or unknown without a DB) → no gate.
// Test stubs (disabled / latest) keep unit tests off Postgres.
type backgroundCheckBidGate struct {
	db    *pgxpool.Pool
	cache *cache.Client
	// disabled, when set, overrides IsFeatureDisabled (unit tests).
	disabled func(ctx context.Context) bool
	// latest, when set, overrides the SQL lookup (unit tests).
	latest func(ctx context.Context, userID string) (status string, found bool, err error)
}

func newBackgroundCheckBidGate(db *pgxpool.Pool, cacheClient *cache.Client) backgroundCheckBidGate {
	return backgroundCheckBidGate{db: db, cache: cacheClient}
}

// deny returns a non-zero HTTP status when the bid must be blocked.
func (g *backgroundCheckBidGate) deny(ctx context.Context, userID string) (int, string) {
	if g == nil || g.flagOff(ctx) {
		return 0, ""
	}
	status, found, err := g.loadLatest(ctx, userID)
	if err != nil {
		slog.ErrorContext(ctx, "background_check bid gate: status lookup failed",
			"user_id", userID, "error", err)
		return http.StatusServiceUnavailable, "temporarily unavailable"
	}
	if !backgroundCheckAllowsBid(status, found) {
		return http.StatusForbidden, backgroundCheckRequiredMsg
	}
	return 0, ""
}

func (g *backgroundCheckBidGate) flagOff(ctx context.Context) bool {
	if g.disabled != nil {
		return g.disabled(ctx)
	}
	// No DB: cannot read an explicit enabled=true row. Skip the gate
	// (production + nil DB already treats the flag as disabled).
	if g.db == nil {
		return true
	}
	return middleware.IsFeatureDisabled(ctx, g.db, g.cache, backgroundChecksFlagKey)
}

func (g *backgroundCheckBidGate) loadLatest(ctx context.Context, userID string) (string, bool, error) {
	if g.latest != nil {
		return g.latest(ctx, userID)
	}
	if g.db == nil {
		return "", false, nil
	}
	var status string
	err := g.db.QueryRow(ctx, `
		SELECT status
		FROM provider_background_checks
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, userID).Scan(&status)
	if err != nil {
		if err == pgx.ErrNoRows || strings.Contains(err.Error(), "no rows") {
			return "", false, nil
		}
		return "", false, err
	}
	return status, true, nil
}

// backgroundCheckAllowsBid is true only for vendor clear/consider.
// No row, pending, complete, suspended, canceled, dispute, or any other
// value (including invented pass/passed/failed) is a deny.
func backgroundCheckAllowsBid(status string, found bool) bool {
	if !found {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "clear", "consider":
		return true
	default:
		return false
	}
}
