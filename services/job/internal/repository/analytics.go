package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// --- AnalyticsRepository methods on PostgresRepository ---

// marketRangeMaxRadiusMeters is ~50 miles. Coordinates farther than this from
// every zip_codes centroid return ErrMarketRangeNotFound — never a fake range.
const marketRangeMaxRadiusMeters = 80_000.0

func marketRangeLookupID(categoryID string, subcategoryID, serviceTypeID *string) string {
	lookupID := categoryID
	if subcategoryID != nil && *subcategoryID != "" {
		lookupID = *subcategoryID
	}
	if serviceTypeID != nil && *serviceTypeID != "" {
		lookupID = *serviceTypeID
	}
	return lookupID
}

func marketRangeRadiusMeters(radiusKm float64) float64 {
	meters := radiusKm * 1000
	if meters <= 0 || meters > marketRangeMaxRadiusMeters {
		return marketRangeMaxRadiusMeters
	}
	return meters
}

// normalizeUSZip trims and, for ZIP+4, keeps the 5-digit routing ZIP that
// market_ranges.zip_code and zip_codes.zip store.
func normalizeUSZip(zip string) string {
	zip = strings.TrimSpace(zip)
	if len(zip) >= 10 && zip[5] == '-' {
		zip = zip[:5]
	}
	return zip
}

func scanMarketRange(row pgx.Row) (*domain.MarketRange, error) {
	mr := &domain.MarketRange{}
	err := row.Scan(
		&mr.ID, &mr.ServiceTypeID, &mr.ZipCode,
		&mr.City, &mr.State,
		&mr.LowCents, &mr.MedianCents, &mr.HighCents,
		&mr.DataPoints, &mr.Source, &mr.Confidence,
		&mr.Season, &mr.ComputedAt, &mr.ValidUntil,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get market range: %w", domain.ErrMarketRangeNotFound)
		}
		return nil, fmt.Errorf("get market range: %w", err)
	}
	return mr, nil
}

func (r *PostgresRepository) GetMarketRange(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, zipCode string) (*domain.MarketRange, error) {
	zipCode = normalizeUSZip(zipCode)
	if zipCode == "" {
		return nil, fmt.Errorf("get market range: %w", domain.ErrMarketRangeNotFound)
	}

	return scanMarketRange(r.pool.QueryRow(ctx, `
		SELECT id, service_type_id, zip_code,
		       COALESCE(city, ''), COALESCE(state, ''),
		       low_cents, median_cents, high_cents,
		       data_points, source, confidence,
		       season, computed_at, valid_until
		FROM market_ranges
		WHERE service_type_id = $1 AND zip_code = $2
		ORDER BY computed_at DESC
		LIMIT 1`, marketRangeLookupID(categoryID, subcategoryID, serviceTypeID), zipCode))
}

// GetMarketRangeAt snaps (lat,lng) to the nearest market_ranges row by joining
// zip_code onto zip_codes centroids (migration 039). market_ranges.zip_code
// stores real US ZIPs (seed: 78701), not market slugs or coordinate strings.
func (r *PostgresRepository) GetMarketRangeAt(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, lat, lng, radiusKm float64) (*domain.MarketRange, error) {
	meters := marketRangeRadiusMeters(radiusKm)
	return scanMarketRange(r.pool.QueryRow(ctx, `
		SELECT mr.id, mr.service_type_id, mr.zip_code,
		       COALESCE(mr.city, ''), COALESCE(mr.state, ''),
		       mr.low_cents, mr.median_cents, mr.high_cents,
		       mr.data_points, mr.source, mr.confidence,
		       mr.season, mr.computed_at, mr.valid_until
		FROM market_ranges mr
		JOIN zip_codes z ON z.zip = mr.zip_code
		WHERE mr.service_type_id = $1
		  AND ST_DWithin(
		        z.location,
		        ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
		        $4)
		ORDER BY z.location <-> ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
		         mr.computed_at DESC
		LIMIT 1`,
		marketRangeLookupID(categoryID, subcategoryID, serviceTypeID), lng, lat, meters))
}

// NearestZip returns the closest zip_codes.zip to (lat,lng) within radiusKm.
func (r *PostgresRepository) NearestZip(ctx context.Context, lat, lng, radiusKm float64) (string, error) {
	meters := marketRangeRadiusMeters(radiusKm)
	var zip string
	err := r.pool.QueryRow(ctx, `
		SELECT zip
		FROM zip_codes
		WHERE ST_DWithin(
		        location,
		        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
		        $3)
		ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
		LIMIT 1`, lng, lat, meters).Scan(&zip)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("nearest zip: %w", domain.ErrMarketRangeNotFound)
		}
		return "", fmt.Errorf("nearest zip: %w", err)
	}
	return zip, nil
}

// clearedPriceWindowDays bounds the candidate set to a recent window so the
// engine's recency decay operates on relevant data and the scan stays cheap.
const clearedPriceWindowDays = 540

// clearedPriceRowLimit caps the candidate set returned to the pricing engine.
const clearedPriceRowLimit = 5000

// GetClearedPriceTransactions returns per-completed-contract cleared prices for
// a category, for the Rust pricing engine. It mirrors the join that the
// fair_price_index materialized view (migration 014) uses — contracts ⋈ bids ⋈
// jobs ⋈ service_categories with status='completed' — but per-transaction and
// richer: it also pulls the category's taxonomy parent and the winning
// provider's trust tier. The cleared price is the winning bid amount
// (b.amount_cents); geo is the job's service zip; settled_at is the contract's
// completed_at. Bounded to the last clearedPriceWindowDays relative to asOf and
// clearedPriceRowLimit rows (most recent first).
//
// market_id is the nearest active markets.slug within 80 km of the job's
// service point (markets.location, migration 051/058). Inactive / ungeocoded
// catalog rows are ignored. If none is in range the engine falls back to
// national hierarchy levels.
//
// GetCategoryIDBySlug resolves a service-category slug to its UUID. Returns an
// empty string (no error) when the slug is unknown, so callers fail soft.
func (r *PostgresRepository) GetCategoryIDBySlug(ctx context.Context, slug string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`SELECT id::text FROM service_categories WHERE slug = $1`,
		slug,
	).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get category id by slug %q: %w", slug, err)
	}
	return id, nil
}

// condition is fixed to 4 (services pass 4 per the engine contract).
func (r *PostgresRepository) GetClearedPriceTransactions(ctx context.Context, categoryID string, asOf time.Time) ([]domain.ClearedPriceTransaction, error) {
	windowStart := asOf.AddDate(0, 0, -clearedPriceWindowDays).UTC()

	// trust_scores.tier is a text enum; map it to the engine's 0..4 tier.
	// Providers with no trust row default to 1 ('new').
	rows, err := r.pool.Query(ctx, `
		SELECT
		    j.category_id::text                       AS category_id,
		    COALESCE(sc.parent_id::text, '')          AS parent_category_id,
		    COALESCE(j.service_zip, '')               AS zip,
		    COALESCE(nearest_market.slug, '')         AS market_id,
		    b.amount_cents                            AS cleared_price_cents,
		    c.completed_at                            AS settled_at,
		    CASE COALESCE(ts.tier, 'new')
		        WHEN 'under_review' THEN 0
		        WHEN 'new'          THEN 1
		        WHEN 'rising'       THEN 2
		        WHEN 'trusted'      THEN 3
		        WHEN 'top_rated'    THEN 4
		        ELSE 1
		    END::int                                  AS trust_tier
		FROM contracts c
		JOIN bids b ON b.id = c.bid_id
		JOIN jobs j ON j.id = c.job_id
		JOIN service_categories sc ON sc.id = j.category_id
		LEFT JOIN trust_scores ts ON ts.user_id = c.provider_id AND ts.role = 'provider'
		LEFT JOIN LATERAL (
		    SELECT m.slug
		    FROM markets m
		    WHERE m.is_active
		      AND m.location IS NOT NULL
		      AND COALESCE(j.service_location, j.approximate_location) IS NOT NULL
		      AND ST_DWithin(
		            m.location,
		            COALESCE(j.service_location, j.approximate_location)::geography,
		            80000)
		    ORDER BY m.location <-> COALESCE(j.service_location, j.approximate_location)::geography
		    LIMIT 1
		) nearest_market ON true
		WHERE c.status = 'completed'
		  AND c.completed_at IS NOT NULL
		  AND c.completed_at >= $2
		  AND c.completed_at <= $3
		  AND b.amount_cents > 0
		  AND j.deleted_at IS NULL
		  AND j.category_id = $1
		ORDER BY c.completed_at DESC
		LIMIT $4`,
		categoryID, windowStart, asOf.UTC(), clearedPriceRowLimit)
	if err != nil {
		return nil, fmt.Errorf("get cleared price transactions: %w", err)
	}
	defer rows.Close()

	var txns []domain.ClearedPriceTransaction
	for rows.Next() {
		var t domain.ClearedPriceTransaction
		var trustTier int32
		if err := rows.Scan(
			&t.CategoryID,
			&t.ParentCategoryID,
			&t.Zip,
			&t.MarketID,
			&t.ClearedPriceCents,
			&t.SettledAt,
			&trustTier,
		); err != nil {
			return nil, fmt.Errorf("get cleared price transactions scan: %w", err)
		}
		t.SettledAt = t.SettledAt.UTC()
		t.TrustTier = uint32(trustTier)
		// Services carry no goods condition; the engine contract wants 4.
		t.Condition = 4
		// instant_match is not modeled on contracts/jobs in this schema yet.
		t.InstantMatch = false
		txns = append(txns, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("get cleared price transactions rows: %w", err)
	}

	return txns, nil
}

func (r *PostgresRepository) GetMarketTrends(ctx context.Context, categoryID string, subcategoryID *string, region *string, startDate, endDate time.Time, groupBy string) ([]domain.PriceTrend, error) {
	truncUnit := "month"
	switch groupBy {
	case "day":
		truncUnit = "day"
	case "week":
		truncUnit = "week"
	case "month":
		truncUnit = "month"
	}

	filterID := categoryID
	if subcategoryID != nil && *subcategoryID != "" {
		filterID = *subcategoryID
	}

	query := fmt.Sprintf(`
		SELECT date_trunc('%s', p.created_at) AS period_start,
		       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.amount_cents) AS median_cents,
		       COUNT(*)::int AS transaction_count
		FROM payments p
		JOIN contracts c ON c.id = p.contract_id
		JOIN jobs j ON j.id = c.job_id
		WHERE j.category_id = $1
		  AND p.status IN ('completed', 'released', 'escrow')
		  AND p.created_at >= $2
		  AND p.created_at <= $3
		GROUP BY period_start
		ORDER BY period_start ASC`, truncUnit)

	rows, err := r.pool.Query(ctx, query, filterID, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("get market trends: %w", err)
	}
	defer rows.Close()

	var trends []domain.PriceTrend
	var prevMedian int64
	for rows.Next() {
		var t domain.PriceTrend
		var median float64
		err := rows.Scan(&t.PeriodStart, &median, &t.TransactionCount)
		if err != nil {
			return nil, fmt.Errorf("get market trends scan: %w", err)
		}
		t.MedianCents = int64(median)
		if prevMedian > 0 {
			t.ChangePercentage = float64(t.MedianCents-prevMedian) / float64(prevMedian) * 100.0
		}
		prevMedian = t.MedianCents
		trends = append(trends, t)
	}

	return trends, nil
}

func (r *PostgresRepository) GetProviderAnalytics(ctx context.Context, providerID string, startDate, endDate time.Time) (*domain.ProviderAnalytics, error) {
	a := &domain.ProviderAnalytics{}

	// Bidding stats.
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int,
		       COUNT(*) FILTER (WHERE status = 'awarded')::int,
		       COALESCE(AVG(amount_cents), 0)::bigint
		FROM bids
		WHERE provider_id = $1
		  AND created_at >= $2 AND created_at <= $3`,
		providerID, startDate, endDate).Scan(&a.TotalBids, &a.BidsWon, &a.AverageBidCents)
	if err != nil {
		return nil, fmt.Errorf("provider analytics bids: %w", err)
	}

	if a.TotalBids > 0 {
		a.WinRate = float64(a.BidsWon) / float64(a.TotalBids)
	}

	// Job stats.
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status = 'completed')::int,
		       COUNT(*) FILTER (WHERE status = 'in_progress')::int
		FROM contracts
		WHERE provider_id = $1
		  AND created_at >= $2 AND created_at <= $3`,
		providerID, startDate, endDate).Scan(&a.JobsCompleted, &a.JobsInProgress)
	if err != nil {
		return nil, fmt.Errorf("provider analytics jobs: %w", err)
	}

	totalJobs := a.JobsCompleted + a.JobsInProgress
	if totalJobs > 0 {
		a.CompletionRate = float64(a.JobsCompleted) / float64(totalJobs)
	}

	// Earnings.
	err = r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(provider_payout_cents), 0)::bigint,
		       COALESCE(AVG(provider_payout_cents), 0)::bigint
		FROM payments
		WHERE provider_id = $1
		  AND status IN ('completed', 'released')
		  AND created_at >= $2 AND created_at <= $3`,
		providerID, startDate, endDate).Scan(&a.TotalEarningsCents, &a.AverageJobValueCents)
	if err != nil {
		return nil, fmt.Errorf("provider analytics earnings: %w", err)
	}

	// Reviews. Column is overall_rating (not rating).
	err = r.pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(overall_rating), 0),
		       COUNT(*)::int
		FROM reviews
		WHERE reviewee_id = $1
		  AND status = 'published'
		  AND created_at >= $2 AND created_at <= $3`,
		providerID, startDate, endDate).Scan(&a.AverageRating, &a.TotalReviews)
	if err != nil {
		return nil, fmt.Errorf("provider analytics reviews: %w", err)
	}

	// Category breakdown. Reviews column is overall_rating (not rating).
	catRows, err := r.pool.Query(ctx, `
		SELECT j.category_id::text,
		       COALESCE(sc.name, '') AS category_name,
		       COUNT(*)::int AS jobs_completed,
		       COALESCE(SUM(p.provider_payout_cents), 0)::bigint AS total_earnings,
		       COALESCE(AVG(r.overall_rating), 0) AS avg_rating
		FROM contracts c
		JOIN jobs j ON j.id = c.job_id
		LEFT JOIN service_categories sc ON sc.id = j.category_id
		LEFT JOIN payments p ON p.contract_id = c.id AND p.status IN ('completed', 'released')
		LEFT JOIN reviews r ON r.contract_id = c.id AND r.reviewee_id = $1
		WHERE c.provider_id = $1
		  AND c.status = 'completed'
		  AND c.created_at >= $2 AND c.created_at <= $3
		GROUP BY j.category_id, sc.name
		ORDER BY total_earnings DESC
		LIMIT 50`, providerID, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("provider analytics categories: %w", err)
	}
	defer catRows.Close()

	for catRows.Next() {
		var ce domain.CategoryEarnings
		err := catRows.Scan(&ce.CategoryID, &ce.CategoryName, &ce.JobsCompleted, &ce.TotalEarningsCents, &ce.AverageRating)
		if err != nil {
			return nil, fmt.Errorf("provider analytics categories scan: %w", err)
		}
		a.CategoryBreakdown = append(a.CategoryBreakdown, ce)
	}

	return a, nil
}

func (r *PostgresRepository) GetProviderEarnings(ctx context.Context, providerID string, startDate, endDate time.Time, groupBy string) ([]domain.EarningsDataPoint, error) {
	truncUnit := "month"
	switch groupBy {
	case "day":
		truncUnit = "day"
	case "week":
		truncUnit = "week"
	case "month":
		truncUnit = "month"
	}

	// Earnings here is the provider-side GROSS basis (payout + provider-borne
	// fees), and fees is the sum of those same provider-borne fees, so that the
	// server's net = earnings - fees lands exactly on provider_payout_cents (the
	// money the provider actually receives). Sourcing earnings from
	// provider_payout_cents directly — which is already net of every fee — and
	// then subtracting fees again double-counted the platform fee and understated
	// both displayed net earnings and the provider's taxable 1099 income.
	// provider_payout = amount - platform_fee - guarantee_fee - lead_gen_fee
	// (see services/payment fee model), and lead_gen has no column here, so the
	// provider-borne fees we can attribute are platform_fee + guarantee_fee.
	query := fmt.Sprintf(`
		SELECT date_trunc('%s', p.created_at) AS period_start,
		       COALESCE(SUM(p.provider_payout_cents + p.platform_fee_cents + p.guarantee_fee_cents), 0)::bigint AS earnings,
		       COALESCE(SUM(p.platform_fee_cents + p.guarantee_fee_cents), 0)::bigint AS fees,
		       COUNT(*)::int AS job_count
		FROM payments p
		WHERE p.provider_id = $1
		  AND p.status IN ('completed', 'released')
		  AND p.created_at >= $2
		  AND p.created_at <= $3
		GROUP BY period_start
		ORDER BY period_start ASC`, truncUnit)

	rows, err := r.pool.Query(ctx, query, providerID, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("provider earnings: %w", err)
	}
	defer rows.Close()

	var points []domain.EarningsDataPoint
	for rows.Next() {
		var dp domain.EarningsDataPoint
		err := rows.Scan(&dp.PeriodStart, &dp.EarningsCents, &dp.FeesCents, &dp.JobCount)
		if err != nil {
			return nil, fmt.Errorf("provider earnings scan: %w", err)
		}
		points = append(points, dp)
	}

	return points, nil
}

func (r *PostgresRepository) GetCustomerSpending(ctx context.Context, customerID string, startDate, endDate time.Time, groupBy string, propertyID string) ([]domain.SpendingDataPoint, []domain.CategorySpending, int64, int64, error) {
	truncUnit := "month"
	switch groupBy {
	case "day":
		truncUnit = "day"
	case "week":
		truncUnit = "week"
	case "month":
		truncUnit = "month"
	}

	// Optional property scope: payments → contracts → jobs.property_id.
	// idx_jobs_property / idx_jobs_property_fk cover the filter; payments
	// already constrained by customer_id + status + date.
	propertyID = strings.TrimSpace(propertyID)
	var (
		propertyFilter string
		baseArgs       []interface{}
	)
	if propertyID != "" {
		propertyFilter = " AND j.property_id = $4"
		baseArgs = []interface{}{customerID, startDate, endDate, propertyID}
	} else {
		baseArgs = []interface{}{customerID, startDate, endDate}
	}

	// Time series spending.
	// When property-scoped we must join jobs; account-wide keeps the lean payments scan.
	var query string
	if propertyID != "" {
		query = fmt.Sprintf(`
		SELECT date_trunc('%s', p.created_at) AS period_start,
		       COALESCE(SUM(p.amount_cents), 0)::bigint AS amount,
		       COUNT(*)::int AS job_count
		FROM payments p
		JOIN contracts c ON c.id = p.contract_id
		JOIN jobs j ON j.id = c.job_id
		WHERE p.customer_id = $1
		  AND p.status IN ('completed', 'released', 'escrow')
		  AND p.created_at >= $2
		  AND p.created_at <= $3
		  AND j.property_id = $4
		GROUP BY period_start
		ORDER BY period_start ASC`, truncUnit)
	} else {
		query = fmt.Sprintf(`
		SELECT date_trunc('%s', p.created_at) AS period_start,
		       COALESCE(SUM(p.amount_cents), 0)::bigint AS amount,
		       COUNT(*)::int AS job_count
		FROM payments p
		WHERE p.customer_id = $1
		  AND p.status IN ('completed', 'released', 'escrow')
		  AND p.created_at >= $2
		  AND p.created_at <= $3
		GROUP BY period_start
		ORDER BY period_start ASC`, truncUnit)
	}

	rows, err := r.pool.Query(ctx, query, baseArgs...)
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("customer spending: %w", err)
	}
	defer rows.Close()

	var points []domain.SpendingDataPoint
	for rows.Next() {
		var dp domain.SpendingDataPoint
		err := rows.Scan(&dp.PeriodStart, &dp.AmountCents, &dp.JobCount)
		if err != nil {
			return nil, nil, 0, 0, fmt.Errorf("customer spending scan: %w", err)
		}
		points = append(points, dp)
	}

	// Category breakdown (always joins jobs; append property filter when set).
	catRows, err := r.pool.Query(ctx, `
		SELECT j.category_id,
		       COALESCE(sc.name, '') AS category_name,
		       COALESCE(SUM(p.amount_cents), 0)::bigint AS total_spent,
		       COUNT(*)::int AS job_count
		FROM payments p
		JOIN contracts c ON c.id = p.contract_id
		JOIN jobs j ON j.id = c.job_id
		LEFT JOIN service_categories sc ON sc.id = j.category_id
		WHERE p.customer_id = $1
		  AND p.status IN ('completed', 'released', 'escrow')
		  AND p.created_at >= $2
		  AND p.created_at <= $3`+propertyFilter+`
		GROUP BY j.category_id, sc.name
		ORDER BY total_spent DESC
		LIMIT 50`,
		baseArgs...)
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("customer spending categories: %w", err)
	}
	defer catRows.Close()

	var categories []domain.CategorySpending
	for catRows.Next() {
		var cs domain.CategorySpending
		err := catRows.Scan(&cs.CategoryID, &cs.CategoryName, &cs.TotalSpentCents, &cs.JobCount)
		if err != nil {
			return nil, nil, 0, 0, fmt.Errorf("customer spending categories scan: %w", err)
		}
		categories = append(categories, cs)
	}

	// Total spending.
	var totalSpending int64
	if propertyID != "" {
		err = r.pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(p.amount_cents), 0)::bigint
			FROM payments p
			JOIN contracts c ON c.id = p.contract_id
			JOIN jobs j ON j.id = c.job_id
			WHERE p.customer_id = $1
			  AND p.status IN ('completed', 'released', 'escrow')
			  AND p.created_at >= $2 AND p.created_at <= $3
			  AND j.property_id = $4`,
			baseArgs...).Scan(&totalSpending)
	} else {
		err = r.pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount_cents), 0)::bigint
			FROM payments
			WHERE customer_id = $1
			  AND status IN ('completed', 'released', 'escrow')
			  AND created_at >= $2 AND created_at <= $3`,
			baseArgs...).Scan(&totalSpending)
	}
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("customer spending total: %w", err)
	}

	// Total savings vs. market median. For each paid job, savings is the amount
	// the customer paid below the market median for that job's service type (or
	// category, if no service-type-level range exists), floored at 0 so a job
	// paid above market never reduces the headline number. Jobs with no market
	// reference contribute 0 (LEFT JOIN LATERAL → NULL → COALESCE 0), so the
	// figure is honest: it only credits savings we can actually substantiate
	// against real market data, never a fabricated baseline.
	var totalSavings int64
	err = r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(GREATEST(0, mr.median_cents - p.amount_cents)), 0)::bigint
		FROM payments p
		JOIN contracts c ON c.id = p.contract_id
		JOIN jobs j ON j.id = c.job_id
		LEFT JOIN LATERAL (
			SELECT m.median_cents
			FROM market_ranges m
			WHERE m.service_type_id IN (j.service_type_id, j.category_id)
			ORDER BY m.computed_at DESC
			LIMIT 1
		) mr ON true
		WHERE p.customer_id = $1
		  AND p.status IN ('completed', 'released', 'escrow')
		  AND p.created_at >= $2 AND p.created_at <= $3`+propertyFilter,
		baseArgs...).Scan(&totalSavings)
	if err != nil {
		return nil, nil, 0, 0, fmt.Errorf("customer spending savings: %w", err)
	}

	return points, categories, totalSpending, totalSavings, nil
}

func (r *PostgresRepository) RecordTransaction(ctx context.Context, transactionID, categoryID, subcategoryID, serviceTypeID, region string, amountCents, platformFeeCents int64, customerID, providerID string, completedAt time.Time) error {
	// Schema note: analytics_transactions does not have category_id /
	// subcategory_id / region / platform_fee_cents / transaction_id columns.
	// Required fields are job_id, contract_id, service_type_id, zip/city/state,
	// amount_cents, bid_count, completed_at. We accept the older signature for
	// callers but treat transactionID as job_id, parse "City, ST" from region,
	// and discard fee/category fields. bid_count defaults to 0 if not derivable.
	jobID := transactionID
	city := ""
	state := ""
	zip := ""
	if region != "" {
		// Best-effort split of "City, ST" or "ZIP" forms.
		comma := -1
		for i := 0; i < len(region); i++ {
			if region[i] == ',' {
				comma = i
				break
			}
		}
		if comma > 0 {
			city = region[:comma]
			rest := region[comma+1:]
			for len(rest) > 0 && rest[0] == ' ' {
				rest = rest[1:]
			}
			state = rest
		} else {
			zip = region
		}
	}
	_ = categoryID
	_ = subcategoryID
	_ = platformFeeCents

	// Look up contract_id for this job; fall back to inserting with NULL would
	// fail (contract_id is NOT NULL), so skip if no contract exists.
	var contractID string
	err := r.pool.QueryRow(ctx,
		`SELECT id FROM contracts WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1`, jobID).Scan(&contractID)
	if err != nil {
		return fmt.Errorf("record transaction lookup contract: %w", err)
	}

	_, err = r.pool.Exec(ctx, `
		INSERT INTO analytics_transactions (
			job_id, contract_id, customer_id, provider_id, service_type_id,
			zip_code, city, state,
			amount_cents, bid_count,
			completed_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10)`,
		jobID, contractID, customerID, providerID, serviceTypeID,
		zip, city, state,
		amountCents, completedAt)
	if err != nil {
		return fmt.Errorf("record transaction: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetPlatformMetrics(ctx context.Context, startDate, endDate time.Time) (*domain.PlatformMetrics, error) {
	m := &domain.PlatformMetrics{}

	// GMV from analytics_transactions; platform fee revenue from payments
	// (analytics_transactions has no platform_fee_cents column — see schema).
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_cents), 0)::bigint
		FROM analytics_transactions
		WHERE completed_at >= $1 AND completed_at <= $2`,
		startDate, endDate).Scan(&m.TotalGMVCents)
	if err != nil {
		return nil, fmt.Errorf("platform metrics gmv: %w", err)
	}

	if err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(platform_fee_cents), 0)::bigint
		FROM payments
		WHERE status IN ('completed', 'released')
		  AND created_at >= $1 AND created_at <= $2`,
		startDate, endDate).Scan(&m.TotalRevenueCents); err != nil {
		return nil, fmt.Errorf("platform metrics revenue: %w", err)
	}

	if m.TotalGMVCents > 0 {
		m.EffectiveTakeRate = float64(m.TotalRevenueCents) / float64(m.TotalGMVCents)
	}

	// User counts.
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int,
		       COUNT(*) FILTER (WHERE last_active_at >= $1)::int,
		       COUNT(*) FILTER (WHERE created_at >= $1 AND created_at <= $2)::int
		FROM users`,
		startDate, endDate).Scan(&m.TotalUsers, &m.ActiveUsers, &m.NewUsers)
	if err != nil {
		return nil, fmt.Errorf("platform metrics users: %w", err)
	}

	// Job stats.
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE created_at >= $1 AND created_at <= $2)::int,
		       COUNT(*) FILTER (WHERE status = 'completed' AND updated_at >= $1 AND updated_at <= $2)::int
		FROM jobs`,
		startDate, endDate).Scan(&m.TotalJobsPosted, &m.TotalJobsCompleted)
	if err != nil {
		return nil, fmt.Errorf("platform metrics jobs: %w", err)
	}

	// Job fill rate: jobs that received at least 1 bid / total jobs in range.
	var jobsWithBids int32
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT j.id)::int
		FROM jobs j
		JOIN bids b ON b.job_id = j.id
		WHERE j.created_at >= $1 AND j.created_at <= $2`,
		startDate, endDate).Scan(&jobsWithBids)
	if err != nil {
		return nil, fmt.Errorf("platform metrics fill rate: %w", err)
	}
	if m.TotalJobsPosted > 0 {
		m.JobFillRate = float64(jobsWithBids) / float64(m.TotalJobsPosted)
		m.JobCompletionRate = float64(m.TotalJobsCompleted) / float64(m.TotalJobsPosted)
	}

	// Bid stats.
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int
		FROM bids
		WHERE created_at >= $1 AND created_at <= $2`,
		startDate, endDate).Scan(&m.TotalBids)
	if err != nil {
		return nil, fmt.Errorf("platform metrics bids: %w", err)
	}
	if m.TotalJobsPosted > 0 {
		m.AvgBidsPerJob = float64(m.TotalBids) / float64(m.TotalJobsPosted)
	}

	// Dispute stats.
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE created_at >= $1 AND created_at <= $2)::int,
		       COUNT(*) FILTER (WHERE status = 'resolved' AND updated_at >= $1 AND updated_at <= $2)::int
		FROM disputes`,
		startDate, endDate).Scan(&m.DisputesOpened, &m.DisputesResolved)
	if err != nil {
		// Disputes table may not exist yet; treat as zero.
		m.DisputesOpened = 0
		m.DisputesResolved = 0
	}
	if m.TotalJobsCompleted > 0 {
		m.DisputeRate = float64(m.DisputesOpened) / float64(m.TotalJobsCompleted)
	}

	// Guarantee fund metrics (T4.6) — honest SUM/COUNT from payments + disputes.
	// Fund = accrued guarantee fees on completed/released payments (same basis as
	// payment-service revenue report). Claims/payouts from guarantee disputes only.
	// Soft-fail each query so a missing column/table never zeros the whole response.
	if err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(guarantee_fee_cents), 0)::bigint
		FROM payments
		WHERE status IN ('completed', 'released')
		  AND created_at >= $1 AND created_at <= $2`,
		startDate, endDate).Scan(&m.TotalGuaranteeFundCents); err != nil {
		m.TotalGuaranteeFundCents = 0
	}
	if err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int
		FROM disputes
		WHERE COALESCE(is_guarantee_claim, false) = true
		  AND created_at >= $1 AND created_at <= $2`,
		startDate, endDate).Scan(&m.GuaranteeClaims); err != nil {
		m.GuaranteeClaims = 0
	}
	if err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(refund_amount_cents), 0)::bigint
		FROM disputes
		WHERE COALESCE(is_guarantee_claim, false) = true
		  AND status = 'resolved'
		  AND updated_at >= $1 AND updated_at <= $2`,
		startDate, endDate).Scan(&m.GuaranteePayoutsCents); err != nil {
		m.GuaranteePayoutsCents = 0
	}

	return m, nil
}

func (r *PostgresRepository) GetGrowthMetrics(ctx context.Context, startDate, endDate time.Time, groupBy string) ([]domain.GrowthDataPoint, error) {
	truncUnit := "month"
	switch groupBy {
	case "day":
		truncUnit = "day"
	case "week":
		truncUnit = "week"
	case "month":
		truncUnit = "month"
	}

	// Schema notes:
	//  - users.roles is text[] not a single role column; use ANY()
	//  - analytics_transactions has no platform_fee_cents column —
	//    revenue is reported as 0 here until the fee snapshot is added
	//    (tracked in fees roadmap). amount_cents represents GMV.
	query := fmt.Sprintf(`
		WITH periods AS (
			SELECT date_trunc('%s', gs) AS period_start
			FROM generate_series($1::timestamptz, $2::timestamptz, '1 %s'::interval) gs
		),
		user_counts AS (
			SELECT date_trunc('%s', created_at) AS period,
			       COUNT(*)::int AS new_users,
			       COUNT(*) FILTER (WHERE 'provider' = ANY(roles))::int AS new_providers
			FROM users
			WHERE created_at >= $1 AND created_at <= $2
			  AND deleted_at IS NULL
			GROUP BY period
		),
		job_counts AS (
			SELECT date_trunc('%s', created_at) AS period,
			       COUNT(*)::int AS jobs_posted
			FROM jobs
			WHERE created_at >= $1 AND created_at <= $2
			  AND deleted_at IS NULL
			GROUP BY period
		),
		completion_counts AS (
			SELECT date_trunc('%s', updated_at) AS period,
			       COUNT(*)::int AS jobs_completed
			FROM jobs
			WHERE status = 'completed' AND updated_at >= $1 AND updated_at <= $2
			  AND deleted_at IS NULL
			GROUP BY period
		),
		transaction_sums AS (
			SELECT date_trunc('%s', completed_at) AS period,
			       COALESCE(SUM(amount_cents), 0)::bigint AS gmv_cents
			FROM analytics_transactions
			WHERE completed_at >= $1 AND completed_at <= $2
			GROUP BY period
		)
		SELECT p.period_start,
		       COALESCE(u.new_users, 0)::int,
		       COALESCE(u.new_providers, 0)::int,
		       COALESCE(j.jobs_posted, 0)::int,
		       COALESCE(cc.jobs_completed, 0)::int,
		       COALESCE(t.gmv_cents, 0)::bigint,
		       0::bigint AS revenue_cents
		FROM periods p
		LEFT JOIN user_counts u ON u.period = p.period_start
		LEFT JOIN job_counts j ON j.period = p.period_start
		LEFT JOIN completion_counts cc ON cc.period = p.period_start
		LEFT JOIN transaction_sums t ON t.period = p.period_start
		ORDER BY p.period_start ASC`,
		truncUnit, truncUnit, truncUnit, truncUnit, truncUnit, truncUnit)

	rows, err := r.pool.Query(ctx, query, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("growth metrics: %w", err)
	}
	defer rows.Close()

	var points []domain.GrowthDataPoint
	for rows.Next() {
		var dp domain.GrowthDataPoint
		err := rows.Scan(
			&dp.PeriodStart, &dp.NewUsers, &dp.NewProviders,
			&dp.JobsPosted, &dp.JobsCompleted,
			&dp.GMVCents, &dp.RevenueCents,
		)
		if err != nil {
			return nil, fmt.Errorf("growth metrics scan: %w", err)
		}
		points = append(points, dp)
	}

	return points, nil
}

func (r *PostgresRepository) GetCategoryMetrics(ctx context.Context, startDate, endDate time.Time) ([]domain.CategoryMetrics, error) {
	// Schema note: analytics_transactions has no category_id column — only
	// service_type_id (which references service_categories). We join through
	// jobs.category_id instead, which is the canonical category for the job.
	// jobs.status uses 'active' (not 'bidding') and 'closed' for closed-with-bids,
	// so the fill-rate filter set is updated accordingly.
	//
	// ── Why four pre-aggregated CTEs instead of one wide GROUP BY ────────────
	// The previous shape was a 3-way LEFT JOIN fan-out
	// (service_categories → jobs → bids → analytics_transactions) where the
	// date range appeared ONLY inside `FILTER (...)` aggregate clauses. A
	// FILTER prunes rows AFTER they are read, so nothing bounded the scan:
	// every admin analytics page load re-read the entire GMV ledger plus every
	// bid ever placed (EXPLAIN: `Seq Scan on analytics_transactions`, `Seq Scan
	// on bids`, plus a multi-MB external merge sort). `LIMIT 100` sits above
	// the GROUP BY and bounds nothing.
	//
	// Each metric has its OWN date column — jobs.created_at, jobs.updated_at,
	// bids.created_at, analytics_transactions.completed_at — so no single WHERE
	// on the joined row can bound all four without changing the numbers. Split
	// per source instead: each CTE puts its own range in a WHERE (index-range
	// scan) and aggregates to one row per category before anything is joined.
	//
	// `JOIN job_stats` (inner) reproduces the old
	// `HAVING COUNT(...) FILTER (created_at in window) > 0` exactly: a category
	// with no jobs posted in the window is omitted. Every other join stays LEFT
	// so a category with jobs but no bids / no transactions still appears with
	// zeroes, as before.
	//
	// NOTE — this also FIXES a GMV over-count. In the old shape the bids and
	// analytics_transactions joins multiplied each other, so the non-DISTINCT
	// `SUM(at.amount_cents)` counted every transaction once per bid on the same
	// job. COUNT(DISTINCT ...) hid this for the count columns; SUM had no such
	// protection. Aggregating transactions in their own CTE counts each row
	// once. Reported GMV (and avg_job_value_cents, derived from it) therefore
	// drops to the true value — see the equivalence run in the fix notes.
	rows, err := r.pool.Query(ctx, `
		WITH job_stats AS (
			SELECT j.category_id,
			       COUNT(*)::int AS jobs_posted,
			       COUNT(*) FILTER (
			           WHERE j.status IN ('active','awarded','in_progress','completed')
			       )::int AS jobs_filled
			  FROM jobs j
			 WHERE j.deleted_at IS NULL
			   AND j.created_at >= $1 AND j.created_at <= $2
			 GROUP BY j.category_id
		),
		completed_stats AS (
			SELECT j.category_id, COUNT(*)::int AS jobs_completed
			  FROM jobs j
			 WHERE j.deleted_at IS NULL
			   AND j.status = 'completed'
			   AND j.updated_at >= $1 AND j.updated_at <= $2
			 GROUP BY j.category_id
		),
		bid_stats AS (
			SELECT j.category_id,
			       COUNT(DISTINCT b.id)::int AS bids_placed,
			       COUNT(DISTINCT b.provider_id)::int AS active_providers
			  FROM bids b
			  JOIN jobs j ON j.id = b.job_id AND j.deleted_at IS NULL
			 WHERE b.created_at >= $1 AND b.created_at <= $2
			 GROUP BY j.category_id
		),
		gmv_stats AS (
			SELECT j.category_id,
			       COALESCE(SUM(at.amount_cents), 0)::bigint AS gmv_cents
			  FROM analytics_transactions at
			  JOIN jobs j ON j.id = at.job_id AND j.deleted_at IS NULL
			 WHERE at.completed_at >= $1 AND at.completed_at <= $2
			 GROUP BY j.category_id
		)
		SELECT sc.id AS category_id,
		       COALESCE(sc.name, '') AS category_name,
		       js.jobs_posted,
		       COALESCE(cs.jobs_completed, 0) AS jobs_completed,
		       COALESCE(gs.gmv_cents, 0)::bigint AS gmv_cents,
		       COALESCE(bs.bids_placed, 0)::float
		           / NULLIF(js.jobs_posted::float, 0) AS avg_bids_per_job,
		       CASE WHEN COALESCE(cs.jobs_completed, 0) > 0
		            THEN COALESCE(gs.gmv_cents, 0)::bigint
		                 / NULLIF(cs.jobs_completed, 0)::bigint
		            ELSE 0 END AS avg_job_value_cents,
		       js.jobs_filled::float
		           / NULLIF(js.jobs_posted::float, 0) AS fill_rate,
		       COALESCE(bs.active_providers, 0) AS active_providers
		  FROM job_stats js
		  JOIN service_categories sc ON sc.id = js.category_id
		  LEFT JOIN completed_stats cs ON cs.category_id = js.category_id
		  LEFT JOIN bid_stats      bs ON bs.category_id = js.category_id
		  LEFT JOIN gmv_stats      gs ON gs.category_id = js.category_id
		 ORDER BY gmv_cents DESC
		 LIMIT 100`,
		startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("category metrics: %w", err)
	}
	defer rows.Close()

	var categories []domain.CategoryMetrics
	for rows.Next() {
		var cm domain.CategoryMetrics
		err := rows.Scan(
			&cm.CategoryID, &cm.CategoryName,
			&cm.JobsPosted, &cm.JobsCompleted,
			&cm.GMVCents, &cm.AvgBidsPerJob, &cm.AvgJobValueCents,
			&cm.FillRate, &cm.ActiveProviders,
		)
		if err != nil {
			return nil, fmt.Errorf("category metrics scan: %w", err)
		}
		categories = append(categories, cm)
	}

	return categories, nil
}

func (r *PostgresRepository) GetGeographicMetrics(ctx context.Context, startDate, endDate time.Time) ([]domain.RegionMetrics, error) {
	// Schema note: analytics_transactions has no `region` column. We synthesize
	// "City, ST" as the region key from the city + state columns we do have.
	rows, err := r.pool.Query(ctx, `
		SELECT (at.city || ', ' || at.state) AS region,
		       COUNT(DISTINCT at.customer_id)::int AS active_users,
		       COUNT(DISTINCT at.provider_id)::int AS active_providers,
		       COUNT(*)::int AS jobs_posted,
		       COALESCE(SUM(at.amount_cents), 0)::bigint AS gmv_cents
		FROM analytics_transactions at
		WHERE at.completed_at >= $1 AND at.completed_at <= $2
		  AND at.city <> '' AND at.state <> ''
		GROUP BY at.city, at.state
		ORDER BY gmv_cents DESC
		LIMIT 200`,
		startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("geographic metrics: %w", err)
	}
	defer rows.Close()

	var regions []domain.RegionMetrics
	for rows.Next() {
		var rm domain.RegionMetrics
		err := rows.Scan(
			&rm.Region, &rm.ActiveUsers, &rm.ActiveProviders,
			&rm.JobsPosted, &rm.GMVCents,
		)
		if err != nil {
			return nil, fmt.Errorf("geographic metrics scan: %w", err)
		}
		// Supply/demand ratio: providers per job.
		if rm.JobsPosted > 0 {
			rm.SupplyDemandRatio = float64(rm.ActiveProviders) / float64(rm.JobsPosted)
		}
		regions = append(regions, rm)
	}

	return regions, nil
}

func (r *PostgresRepository) RecordEvent(ctx context.Context, eventType, userID string, properties map[string]string, occurredAt time.Time) error {
	propsJSON, err := json.Marshal(properties)
	if err != nil {
		propsJSON = []byte("{}")
	}

	_, err = r.pool.Exec(ctx, `
		INSERT INTO analytics_events (
			event_type, user_id, properties, occurred_at
		) VALUES ($1, $2, $3, $4)`,
		eventType, userID, propsJSON, occurredAt)
	if err != nil {
		return fmt.Errorf("record event: %w", err)
	}
	return nil
}
