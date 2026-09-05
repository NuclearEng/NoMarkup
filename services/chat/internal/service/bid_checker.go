package service

// Postgres-backed BidChecker.
//
// FR-8.1 requires that a provider may only open a pre-award chat channel on a
// job they have actually bid on. The check existed in CreateChannel behind
// `channelType == "pre_award" && s.bidChecker != nil` — but SetBidChecker had
// no call sites anywhere in the repo, not even in tests, so bidChecker was
// permanently nil, the condition permanently false, and the guard dead code.
// Any provider could open a pre-award channel on any job without bidding.
//
// Implemented as a direct query rather than a gRPC hop to the bid engine: the
// chat service already holds a pool on the same database, and the mesh is
// currently plaintext with caller-supplied identity, so one fewer trusted hop
// is strictly better. `bids` has a UNIQUE(job_id, provider_id) constraint and
// an idx_bids_job (job_id, status) index, so this is a single index lookup.

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PGBidChecker answers "does this provider hold a live bid on this job?"
// against the primary database.
type PGBidChecker struct {
	pool *pgxpool.Pool
}

// NewPGBidChecker returns a BidChecker backed by the given pool.
func NewPGBidChecker(pool *pgxpool.Pool) *PGBidChecker {
	return &PGBidChecker{pool: pool}
}

// HasActiveBid reports whether the provider has a bid on the job that entitles
// them to a pre-award conversation.
//
// 'active' and 'awarded' both qualify: a provider who has already won the job
// self-evidently bid on it, and withdrawn/rejected bids do not qualify. An
// error is returned rather than a false negative so the caller can fail
// closed — a database blip must not silently open the channel, and it must not
// silently deny a legitimate provider either.
func (c *PGBidChecker) HasActiveBid(ctx context.Context, jobID, providerID string) (bool, error) {
	if c.pool == nil {
		return false, fmt.Errorf("bid checker: no database pool configured")
	}

	var exists bool
	err := c.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			  FROM bids
			 WHERE job_id = $1
			   AND provider_id = $2
			   AND status IN ('active', 'awarded')
			   AND withdrawn_at IS NULL
		)`, jobID, providerID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("bid checker: query active bid: %w", err)
	}
	return exists, nil
}
