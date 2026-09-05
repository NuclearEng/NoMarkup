package repository

import (
	"context"
	"fmt"
	"time"
)

// underwriting_features.go holds the windowed, un-forgeable feature queries the
// Rust underwriting engine consumes. Every figure here is derived ONLY from
// escrow-SETTLED money movement (payments.status = 'released') and completed
// service contracts — never from self-reported or client-supplied data — so the
// engine's decision rests on facts the provider cannot inflate.
//
// All windows are anchored on a caller-supplied `asOf` (NOT time.Now) so the
// feature vector is deterministic and reproducible: re-running underwriting for
// the same `asOf` yields the same numbers, which is required for the engine's
// decision hash to be stable and auditable.

// GetUnderwritingEarnings returns the provider's escrow-RELEASED payout totals
// over the trailing 30 / 90 / 365 days plus the count of distinct calendar
// months in the trailing 24 months that had at least one released payment.
//
// "Released" means payments.status = 'released' — funds that actually left
// escrow to the provider, the only earnings the engine trusts. Windows are
// measured against released_at (the escrow-release timestamp) when present, and
// fall back to created_at for legacy rows that predate released_at stamping, so
// a provider with real released earnings is never under-counted by a NULL
// timestamp. Sums are over provider_payout_cents (the provider's net take,
// after platform + guarantee fees), expressed in integer cents.
//
// activeMonths counts DISTINCT (year, month) buckets — calendar months, not
// rolling 30-day chunks — over the trailing 24 months, a tenure/consistency
// signal independent of dollar volume.
func (r *PostgresRepository) GetUnderwritingEarnings(ctx context.Context, providerID string, asOf time.Time) (t30, t90, t365 int64, activeMonths int, err error) {
	// Anchor every window on asOf in UTC for determinism. The settlement
	// timestamp is COALESCE(released_at, created_at): released_at is the true
	// escrow-release instant, created_at is the legacy fallback.
	asOfUTC := asOf.UTC()

	err = r.pool.QueryRow(ctx, `
		WITH released AS (
			SELECT provider_payout_cents,
			       COALESCE(released_at, created_at) AS settled_at
			FROM payments
			WHERE provider_id = $1
			  AND status = 'released'
			  AND COALESCE(released_at, created_at) <= $2
		)
		SELECT
			COALESCE(SUM(provider_payout_cents) FILTER (
				WHERE settled_at > $2 - INTERVAL '30 days'), 0)::BIGINT,
			COALESCE(SUM(provider_payout_cents) FILTER (
				WHERE settled_at > $2 - INTERVAL '90 days'), 0)::BIGINT,
			COALESCE(SUM(provider_payout_cents) FILTER (
				WHERE settled_at > $2 - INTERVAL '365 days'), 0)::BIGINT,
			COUNT(DISTINCT date_trunc('month', settled_at)) FILTER (
				WHERE settled_at > $2 - INTERVAL '24 months')::INTEGER
		FROM released`,
		providerID, asOfUTC,
	).Scan(&t30, &t90, &t365, &activeMonths)
	if err != nil {
		return 0, 0, 0, 0, fmt.Errorf("get underwriting earnings: %w", err)
	}
	return t30, t90, t365, activeMonths, nil
}

// GetProviderDisputeRate90d returns the provider's dispute rate over the trailing
// 90 days: disputes opened AGAINST the provider divided by the provider's jobs
// completed in the same window, clamped to [0.0, 1.0]. Returns 0 (not an error)
// when the provider completed no jobs in the window, guarding divide-by-zero —
// a provider with no completed jobs has no demonstrated dispute behavior, so the
// engine treats that as the neutral (zero-penalty) value rather than a spike.
//
// Disputes source: the `disputes` table (service-contract disputes from the
// initial schema), NOT `marketplace_disputes` (which is goods/listing-order
// only and keyed by listing_order_id, with no provider link). The provider a
// dispute is against is derived by joining disputes.contract_id -> contracts and
// reading contracts.provider_id; the `disputes` table itself only records
// opened_by (the complainant), so the contract join is the authoritative way to
// attribute a dispute to the provider it targets. The dispute window is measured
// on disputes.created_at (when the dispute was opened); completed jobs are
// contracts with status='completed' measured on contracts.completed_at.
func (r *PostgresRepository) GetProviderDisputeRate90d(ctx context.Context, providerID string, asOf time.Time) (rate float64, err error) {
	asOfUTC := asOf.UTC()

	var disputes90d, completed90d int64
	err = r.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*)
			   FROM disputes d
			   JOIN contracts c ON c.id = d.contract_id
			  WHERE c.provider_id = $1
			    AND d.created_at <= $2
			    AND d.created_at > $2 - INTERVAL '90 days'),
			(SELECT COUNT(*)
			   FROM contracts
			  WHERE provider_id = $1
			    AND status = 'completed'
			    AND completed_at IS NOT NULL
			    AND completed_at <= $2
			    AND completed_at > $2 - INTERVAL '90 days')`,
		providerID, asOfUTC,
	).Scan(&disputes90d, &completed90d)
	if err != nil {
		return 0, fmt.Errorf("get provider dispute rate 90d: %w", err)
	}

	if completed90d <= 0 {
		return 0, nil
	}

	rate = float64(disputes90d) / float64(completed90d)
	if rate < 0 {
		rate = 0
	}
	if rate > 1 {
		rate = 1
	}
	return rate, nil
}
