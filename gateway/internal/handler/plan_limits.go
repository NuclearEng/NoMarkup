package handler

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	planLimitMaxActiveBidsMsg        = "plan limit: max active bids reached"
	planLimitMaxServiceCategoriesMsg = "plan limit: max service categories reached"
	planLimitMaxPortfolioImagesMsg   = "plan limit: max portfolio images reached"
	planLimitUnavailableMsg          = "temporarily unavailable"
)

// usageSnapshot is the current usage vs plan caps for a provider.
// Max of 0 means unlimited (do not reject).
type usageSnapshot struct {
	ActiveBids, MaxActiveBids               int32
	ServiceCategories, MaxServiceCategories int32
	PortfolioImages, MaxPortfolioImages     int32
}

// PlanLimitGuard enforces subscription digital caps on PlaceBid,
// UpdateCategories, and UpdatePortfolio. Nil db and a nil usageFn skip
// the check (local tests / current BidHandler nil-db). Query errors fail
// closed with HTTP 503.
type PlanLimitGuard struct {
	db *pgxpool.Pool
	// usageFn, when set, overrides SQL (unit tests).
	usageFn func(ctx context.Context, userID string) (usageSnapshot, error)
}

func newPlanLimitGuard(db *pgxpool.Pool) PlanLimitGuard {
	return PlanLimitGuard{db: db}
}

func (g *PlanLimitGuard) skip() bool {
	return g == nil || (g.usageFn == nil && g.db == nil)
}

func (g *PlanLimitGuard) snapshot(r *http.Request, userID string) (usageSnapshot, int, string, bool) {
	if g.skip() {
		return usageSnapshot{}, 0, "", true
	}

	ctx := context.Background()
	if r != nil {
		ctx = r.Context()
	}

	var (
		snap usageSnapshot
		err  error
	)
	if g.usageFn != nil {
		snap, err = g.usageFn(ctx, userID)
	} else {
		snap, err = g.queryUsage(ctx, userID)
	}
	if err != nil {
		slog.ErrorContext(ctx, "plan limit: usage lookup failed", "user_id", userID, "error", err)
		return usageSnapshot{}, http.StatusServiceUnavailable, planLimitUnavailableMsg, false
	}

	if isIOSClientWithoutIAPVerify(r) {
		snap.MaxActiveBids = iosFreeMaxActiveBids
		snap.MaxServiceCategories = iosFreeMaxServiceCategories
		snap.MaxPortfolioImages = iosFreeMaxPortfolioImages
	}
	return snap, 0, "", false
}

func (g *PlanLimitGuard) queryUsage(ctx context.Context, userID string) (usageSnapshot, error) {
	var snap usageSnapshot
	err := g.db.QueryRow(ctx, `
		WITH caps AS (
			SELECT t.max_active_bids, t.max_service_categories, t.portfolio_image_limit
			  FROM subscriptions s
			  JOIN subscription_tiers t ON t.id = s.tier_id
			 WHERE s.user_id = $1
			   AND s.status IN ('active', 'trialing', 'past_due')
			 ORDER BY s.created_at DESC
			 LIMIT 1
		)
		SELECT
			(SELECT COUNT(*)::int FROM bids WHERE provider_id = $1 AND status IN ('active', 'pending')),
			COALESCE((SELECT max_active_bids FROM caps), 3),
			(SELECT COUNT(DISTINCT category_id)::int FROM provider_service_categories WHERE provider_id = $1),
			COALESCE((SELECT max_service_categories FROM caps), 1),
			(SELECT COUNT(*)::int FROM provider_portfolio_images WHERE provider_id = $1),
			COALESCE((SELECT portfolio_image_limit FROM caps), 5)`,
		userID,
	).Scan(
		&snap.ActiveBids,
		&snap.MaxActiveBids,
		&snap.ServiceCategories,
		&snap.MaxServiceCategories,
		&snap.PortfolioImages,
		&snap.MaxPortfolioImages,
	)
	if err != nil {
		return usageSnapshot{}, err
	}
	return snap, nil
}

func (g *PlanLimitGuard) denyActiveBid(r *http.Request, userID string) (int, string) {
	snap, code, msg, skipped := g.snapshot(r, userID)
	if skipped {
		return 0, ""
	}
	if code != 0 {
		return code, msg
	}
	if snap.MaxActiveBids > 0 && snap.ActiveBids >= snap.MaxActiveBids {
		return http.StatusForbidden, planLimitMaxActiveBidsMsg
	}
	return 0, ""
}

func (g *PlanLimitGuard) denyCategories(r *http.Request, userID string, count int) (int, string) {
	snap, code, msg, skipped := g.snapshot(r, userID)
	if skipped {
		return 0, ""
	}
	if code != 0 {
		return code, msg
	}
	if snap.MaxServiceCategories > 0 && int32(count) > snap.MaxServiceCategories {
		return http.StatusForbidden, planLimitMaxServiceCategoriesMsg
	}
	return 0, ""
}

func (g *PlanLimitGuard) denyPortfolio(r *http.Request, userID string, count int) (int, string) {
	snap, code, msg, skipped := g.snapshot(r, userID)
	if skipped {
		return 0, ""
	}
	if code != 0 {
		return code, msg
	}
	if snap.MaxPortfolioImages > 0 && int32(count) > snap.MaxPortfolioImages {
		return http.StatusForbidden, planLimitMaxPortfolioImagesMsg
	}
	return 0, ""
}
