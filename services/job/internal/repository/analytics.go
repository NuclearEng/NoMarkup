package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// --- AnalyticsRepository methods on PostgresRepository ---

func (r *PostgresRepository) GetMarketRange(ctx context.Context, categoryID string, subcategoryID, serviceTypeID *string, zipCode string) (*domain.MarketRange, error) {
	// Use service_type_id if provided, otherwise fall back to subcategory/category.
	lookupID := categoryID
	if subcategoryID != nil && *subcategoryID != "" {
		lookupID = *subcategoryID
	}
	if serviceTypeID != nil && *serviceTypeID != "" {
		lookupID = *serviceTypeID
	}

	mr := &domain.MarketRange{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, service_type_id, zip_code,
		       COALESCE(city, ''), COALESCE(state, ''),
		       low_cents, median_cents, high_cents,
		       data_points, source, confidence,
		       season, computed_at, valid_until
		FROM market_ranges
		WHERE service_type_id = $1 AND zip_code = $2
		ORDER BY computed_at DESC
		LIMIT 1`, lookupID, zipCode).Scan(
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

	// Reviews.
	err = r.pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(rating), 0),
		       COUNT(*)::int
		FROM reviews
		WHERE reviewee_id = $1
		  AND created_at >= $2 AND created_at <= $3`,
		providerID, startDate, endDate).Scan(&a.AverageRating, &a.TotalReviews)
	if err != nil {
		return nil, fmt.Errorf("provider analytics reviews: %w", err)
	}

	// Category breakdown.
	catRows, err := r.pool.Query(ctx, `
		SELECT j.category_id,
		       COALESCE(sc.name, '') AS category_name,
		       COUNT(*)::int AS jobs_completed,
		       COALESCE(SUM(p.provider_payout_cents), 0)::bigint AS total_earnings,
		       COALESCE(AVG(r.rating), 0) AS avg_rating
		FROM contracts c
		JOIN jobs j ON j.id = c.job_id
		LEFT JOIN service_categories sc ON sc.id = j.category_id
		LEFT JOIN payments p ON p.contract_id = c.id AND p.status IN ('completed', 'released')
		LEFT JOIN reviews r ON r.contract_id = c.id AND r.reviewee_id = $1
		WHERE c.provider_id = $1
		  AND c.status = 'completed'
		  AND c.created_at >= $2 AND c.created_at <= $3
		GROUP BY j.category_id, sc.name
		ORDER BY total_earnings DESC`, providerID, startDate, endDate)
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

	query := fmt.Sprintf(`
		SELECT date_trunc('%s', p.created_at) AS period_start,
		       COALESCE(SUM(p.provider_payout_cents), 0)::bigint AS earnings,
		       COALESCE(SUM(p.platform_fee_cents), 0)::bigint AS fees,
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

func (r *PostgresRepository) GetCustomerSpending(ctx context.Context, customerID string, startDate, endDate time.Time, groupBy string) ([]domain.SpendingDataPoint, []domain.CategorySpending, int64, error) {
	truncUnit := "month"
	switch groupBy {
	case "day":
		truncUnit = "day"
	case "week":
		truncUnit = "week"
	case "month":
		truncUnit = "month"
	}

	// Time series spending.
	query := fmt.Sprintf(`
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

	rows, err := r.pool.Query(ctx, query, customerID, startDate, endDate)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("customer spending: %w", err)
	}
	defer rows.Close()

	var points []domain.SpendingDataPoint
	for rows.Next() {
		var dp domain.SpendingDataPoint
		err := rows.Scan(&dp.PeriodStart, &dp.AmountCents, &dp.JobCount)
		if err != nil {
			return nil, nil, 0, fmt.Errorf("customer spending scan: %w", err)
		}
		points = append(points, dp)
	}

	// Category breakdown.
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
		  AND p.created_at <= $3
		GROUP BY j.category_id, sc.name
		ORDER BY total_spent DESC`,
		customerID, startDate, endDate)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("customer spending categories: %w", err)
	}
	defer catRows.Close()

	var categories []domain.CategorySpending
	for catRows.Next() {
		var cs domain.CategorySpending
		err := catRows.Scan(&cs.CategoryID, &cs.CategoryName, &cs.TotalSpentCents, &cs.JobCount)
		if err != nil {
			return nil, nil, 0, fmt.Errorf("customer spending categories scan: %w", err)
		}
		categories = append(categories, cs)
	}

	// Total spending.
	var totalSpending int64
	err = r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_cents), 0)::bigint
		FROM payments
		WHERE customer_id = $1
		  AND status IN ('completed', 'released', 'escrow')
		  AND created_at >= $2 AND created_at <= $3`,
		customerID, startDate, endDate).Scan(&totalSpending)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("customer spending total: %w", err)
	}

	return points, categories, totalSpending, nil
}

func (r *PostgresRepository) RecordTransaction(ctx context.Context, transactionID, categoryID, subcategoryID, serviceTypeID, region string, amountCents, platformFeeCents int64, customerID, providerID string, completedAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO analytics_transactions (
			transaction_id, category_id, subcategory_id, service_type_id,
			region, amount_cents, platform_fee_cents,
			customer_id, provider_id, completed_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		transactionID, categoryID, subcategoryID, serviceTypeID,
		region, amountCents, platformFeeCents,
		customerID, providerID, completedAt)
	if err != nil {
		return fmt.Errorf("record transaction: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetPlatformMetrics(ctx context.Context, startDate, endDate time.Time) (*domain.PlatformMetrics, error) {
	m := &domain.PlatformMetrics{}

	// GMV and revenue from analytics_transactions.
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_cents), 0)::bigint,
		       COALESCE(SUM(platform_fee_cents), 0)::bigint
		FROM analytics_transactions
		WHERE completed_at >= $1 AND completed_at <= $2`,
		startDate, endDate).Scan(&m.TotalGMVCents, &m.TotalRevenueCents)
	if err != nil {
		return nil, fmt.Errorf("platform metrics gmv: %w", err)
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

	query := fmt.Sprintf(`
		WITH periods AS (
			SELECT date_trunc('%s', gs) AS period_start
			FROM generate_series($1::timestamptz, $2::timestamptz, '1 %s'::interval) gs
		),
		user_counts AS (
			SELECT date_trunc('%s', created_at) AS period,
			       COUNT(*)::int AS new_users,
			       COUNT(*) FILTER (WHERE role = 'provider')::int AS new_providers
			FROM users
			WHERE created_at >= $1 AND created_at <= $2
			GROUP BY period
		),
		job_counts AS (
			SELECT date_trunc('%s', created_at) AS period,
			       COUNT(*)::int AS jobs_posted
			FROM jobs
			WHERE created_at >= $1 AND created_at <= $2
			GROUP BY period
		),
		completion_counts AS (
			SELECT date_trunc('%s', updated_at) AS period,
			       COUNT(*)::int AS jobs_completed
			FROM jobs
			WHERE status = 'completed' AND updated_at >= $1 AND updated_at <= $2
			GROUP BY period
		),
		transaction_sums AS (
			SELECT date_trunc('%s', completed_at) AS period,
			       COALESCE(SUM(amount_cents), 0)::bigint AS gmv_cents,
			       COALESCE(SUM(platform_fee_cents), 0)::bigint AS revenue_cents
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
		       COALESCE(t.revenue_cents, 0)::bigint
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
	rows, err := r.pool.Query(ctx, `
		SELECT sc.id AS category_id,
		       COALESCE(sc.name, '') AS category_name,
		       COUNT(DISTINCT j.id) FILTER (WHERE j.created_at >= $1 AND j.created_at <= $2)::int AS jobs_posted,
		       COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed' AND j.updated_at >= $1 AND j.updated_at <= $2)::int AS jobs_completed,
		       COALESCE(SUM(at.amount_cents) FILTER (WHERE at.completed_at >= $1 AND at.completed_at <= $2), 0)::bigint AS gmv_cents,
		       CASE WHEN COUNT(DISTINCT j.id) FILTER (WHERE j.created_at >= $1 AND j.created_at <= $2) > 0
		            THEN COUNT(DISTINCT b.id) FILTER (WHERE b.created_at >= $1 AND b.created_at <= $2)::float / COUNT(DISTINCT j.id) FILTER (WHERE j.created_at >= $1 AND j.created_at <= $2)::float
		            ELSE 0 END AS avg_bids_per_job,
		       CASE WHEN COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed' AND j.updated_at >= $1 AND j.updated_at <= $2) > 0
		            THEN COALESCE(SUM(at.amount_cents) FILTER (WHERE at.completed_at >= $1 AND at.completed_at <= $2), 0)::bigint / COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'completed' AND j.updated_at >= $1 AND j.updated_at <= $2)::bigint
		            ELSE 0 END AS avg_job_value_cents,
		       CASE WHEN COUNT(DISTINCT j.id) FILTER (WHERE j.created_at >= $1 AND j.created_at <= $2) > 0
		            THEN COUNT(DISTINCT j.id) FILTER (WHERE j.status IN ('bidding','awarded','in_progress','completed') AND j.created_at >= $1 AND j.created_at <= $2)::float / COUNT(DISTINCT j.id) FILTER (WHERE j.created_at >= $1 AND j.created_at <= $2)::float
		            ELSE 0 END AS fill_rate,
		       COUNT(DISTINCT b.provider_id) FILTER (WHERE b.created_at >= $1 AND b.created_at <= $2)::int AS active_providers
		FROM service_categories sc
		LEFT JOIN jobs j ON j.category_id = sc.id
		LEFT JOIN bids b ON b.job_id = j.id
		LEFT JOIN analytics_transactions at ON at.category_id = sc.id
		GROUP BY sc.id, sc.name
		HAVING COUNT(DISTINCT j.id) FILTER (WHERE j.created_at >= $1 AND j.created_at <= $2) > 0
		ORDER BY gmv_cents DESC`,
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
	rows, err := r.pool.Query(ctx, `
		SELECT at.region,
		       COUNT(DISTINCT at.customer_id)::int AS active_users,
		       COUNT(DISTINCT at.provider_id)::int AS active_providers,
		       COUNT(*)::int AS jobs_posted,
		       COALESCE(SUM(at.amount_cents), 0)::bigint AS gmv_cents
		FROM analytics_transactions at
		WHERE at.completed_at >= $1 AND at.completed_at <= $2
		  AND at.region != ''
		GROUP BY at.region
		ORDER BY gmv_cents DESC`,
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
