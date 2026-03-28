package repository

import (
	"context"
	"fmt"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// QueryMatchingProviders finds providers who serve a given category within a
// geographic radius, scored by trust, proximity, win rate, and response time.
//
// Scoring weights applied in the ORDER BY:
//   - Trust score (0-100 normalized to 0-1):  40%
//   - Geo proximity (inverse of distance):    30%
//   - Category win rate:                      20%
//   - Response time (inverse):                10%
func (r *PostgresRepository) QueryMatchingProviders(ctx context.Context, categoryID string, lat, lng float64, radiusMeters float64, limit int) ([]domain.MatchedProvider, error) {
	if limit <= 0 {
		limit = 5
	}

	query := `
		WITH category_tree AS (
			-- Include the target category and all its descendants so matching
			-- works whether the job specifies a top-level category, subcategory,
			-- or service type.
			SELECT id FROM service_categories
			WHERE id = $1
			UNION ALL
			SELECT sc.id FROM service_categories sc
			INNER JOIN category_tree ct ON sc.parent_id = ct.id
		),
		eligible_providers AS (
			SELECT DISTINCT pp.user_id AS provider_id
			FROM provider_profiles pp
			INNER JOIN provider_service_categories psc ON psc.provider_id = pp.id
			INNER JOIN users u ON u.id = pp.user_id
			WHERE psc.category_id IN (SELECT id FROM category_tree)
			  AND pp.service_location IS NOT NULL
			  AND ST_DWithin(
				  pp.service_location::geography,
				  ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
				  $4
			  )
			  AND u.status = 'active'
			  AND u.deleted_at IS NULL
		),
		provider_metrics AS (
			SELECT
				ep.provider_id,
				u.display_name,
				COALESCE(ts.overall_score, 50.0) AS trust_score,
				COALESCE(ts.tier, 'new') AS trust_tier,
				ST_Distance(
					pp.service_location::geography,
					ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
				) / 1000.0 AS distance_km,
				-- Win rate: completed contracts from bids on jobs in this category tree
				COALESCE(
					(
						SELECT COUNT(*) FILTER (WHERE c.status IN ('completed', 'active'))::float
							/ NULLIF(COUNT(*)::float, 0)
						FROM bids b2
						INNER JOIN jobs j2 ON j2.id = b2.job_id
						LEFT JOIN contracts c ON c.bid_id = b2.id
						WHERE b2.provider_id = ep.provider_id
						  AND j2.category_id IN (SELECT id FROM category_tree)
					), 0
				) AS win_rate,
				COALESCE(pp.avg_response_time_minutes, 1440) AS avg_response_min
			FROM eligible_providers ep
			INNER JOIN provider_profiles pp ON pp.user_id = ep.provider_id
			INNER JOIN users u ON u.id = ep.provider_id
			LEFT JOIN trust_scores ts ON ts.user_id = ep.provider_id AND ts.role = 'provider'
		)
		SELECT
			provider_id,
			display_name,
			trust_score,
			trust_tier,
			distance_km,
			win_rate,
			avg_response_min,
			-- Composite match score (0-1 scale)
			(
				(trust_score / 100.0) * 0.4
				+ (1.0 - LEAST(distance_km / ($4 / 1000.0), 1.0)) * 0.3
				+ win_rate * 0.2
				+ (1.0 - LEAST(avg_response_min::float / 1440.0, 1.0)) * 0.1
			) AS match_score
		FROM provider_metrics
		ORDER BY match_score DESC
		LIMIT $5
	`

	rows, err := r.pool.Query(ctx, query, categoryID, lng, lat, radiusMeters, limit)
	if err != nil {
		return nil, fmt.Errorf("query matching providers: %w", err)
	}
	defer rows.Close()

	var providers []domain.MatchedProvider
	for rows.Next() {
		var p domain.MatchedProvider
		if err := rows.Scan(
			&p.ProviderID,
			&p.DisplayName,
			&p.TrustScore,
			&p.TrustTier,
			&p.DistanceKm,
			&p.WinRate,
			&p.AvgResponseMin,
			&p.MatchScore,
		); err != nil {
			return nil, fmt.Errorf("scan matching provider: %w", err)
		}
		providers = append(providers, p)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate matching providers: %w", err)
	}

	return providers, nil
}

// GetJobLocation retrieves the latitude and longitude of a job's service location.
func (r *PostgresRepository) GetJobLocation(ctx context.Context, jobID string) (float64, float64, error) {
	var lat, lng float64
	err := r.pool.QueryRow(ctx, `
		SELECT ST_Y(service_location) AS lat, ST_X(service_location) AS lng
		FROM jobs
		WHERE id = $1 AND deleted_at IS NULL`, jobID).Scan(&lat, &lng)
	if err != nil {
		return 0, 0, fmt.Errorf("get job location: %w", err)
	}
	return lat, lng, nil
}
