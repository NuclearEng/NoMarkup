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
