/// Composite trust score computation engine.
///
/// 4 dimensions weighted:
/// - Feedback: 35% (ratings, review sentiment, dispute outcomes)
/// - Volume: 20% (jobs completed, repeat customers, on-time rate)
/// - Risk: 25% (cancellations, disputes, late deliveries -- inverted)
/// - Fraud: 20% (fraud signals, account flags -- inverted)
///
/// The mathematical scoring logic lives in `crate::scoring` (pure functions,
/// no I/O). This module is responsible for fetching data from PostgreSQL and
/// feeding it into those functions.
///
/// Target: < 5ms p99 latency for score computation.
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{
    all_tier_requirements, DimensionScores, FeedbackDetails, FraudDetails, RiskDetails,
    TrustError, TrustScoreHistoryRow, TrustScoreRow, TrustTier, VolumeDetails,
};
use crate::scoring::{
    self, DecayConfig, FeedbackInput, FraudInput, ReviewDataPoint, RiskInput, VolumeInput,
};

/// SQL query to select all columns from trust_scores with NUMERIC casts to float8.
const TRUST_SCORE_SELECT_ALL: &str = "\
    SELECT id, user_id, role, \
      overall_score::float8 as overall_score, tier, \
      feedback_score::float8 as feedback_score, \
      volume_score::float8 as volume_score, \
      risk_score::float8 as risk_score, \
      fraud_score::float8 as fraud_score, \
      feedback_details, volume_details, risk_details, fraud_details, \
      last_computed_at, computation_version, created_at, updated_at \
    FROM trust_scores WHERE user_id = $1";

pub struct TrustScorer {
    pool: PgPool,
    decay_config: DecayConfig,
}

impl TrustScorer {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            decay_config: DecayConfig::default(),
        }
    }

    // -----------------------------------------------------------------------
    // Score retrieval
    // -----------------------------------------------------------------------

    /// Get the current trust score for a user.
    ///
    /// # Errors
    ///
    /// Returns `TrustError::ScoreNotFound` if no score record exists.
    pub async fn get_score(&self, user_id: Uuid) -> Result<TrustScoreRow, TrustError> {
        sqlx::query_as::<_, TrustScoreRow>(TRUST_SCORE_SELECT_ALL)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| TrustError::ScoreNotFound(user_id.to_string()))
    }

    /// Get trust score history for a user with pagination.
    ///
    /// # Errors
    ///
    /// Returns `TrustError` on database errors.
    #[allow(clippy::cast_sign_loss)]
    pub async fn get_history(
        &self,
        user_id: Uuid,
        page: i32,
        page_size: i32,
    ) -> Result<(Vec<TrustScoreHistoryRow>, i64), TrustError> {
        let offset = i64::from((page - 1).max(0)) * i64::from(page_size.max(1));
        let limit = i64::from(page_size.clamp(1, 100));

        let rows = sqlx::query_as::<_, TrustScoreHistoryRow>(
            "SELECT id, user_id, role, \
               overall_score::float8 as overall_score, \
               feedback_score::float8 as feedback_score, \
               volume_score::float8 as volume_score, \
               risk_score::float8 as risk_score, \
               fraud_score::float8 as fraud_score, \
               trigger_event, trigger_entity_id, created_at \
             FROM trust_score_history \
             WHERE user_id = $1 \
             ORDER BY created_at DESC \
             LIMIT $2 OFFSET $3",
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        let count: CountRow =
            sqlx::query_as("SELECT COUNT(*) as count FROM trust_score_history WHERE user_id = $1")
                .bind(user_id)
                .fetch_one(&self.pool)
                .await?;

        Ok((rows, count.count))
    }

    // -----------------------------------------------------------------------
    // Score computation
    // -----------------------------------------------------------------------

    /// Compute (or recompute) the trust score for a user.
    /// This reads from reviews, contracts, disputes, and fraud_signals tables,
    /// calculates all four dimension scores, determines the tier, and upserts
    /// the result into `trust_scores`. Also inserts a history row.
    ///
    /// Returns the updated score row plus whether the tier changed and the
    /// previous tier string.
    ///
    /// # Errors
    ///
    /// Returns `TrustError` on database or validation errors.
    pub async fn compute_score(
        &self,
        user_id: Uuid,
        trigger_reason: &str,
    ) -> Result<(TrustScoreRow, bool, String), TrustError> {
        // Look up user role from the existing trust record, or determine from
        // users table if this is the first computation.
        let existing = sqlx::query_as::<_, TrustScoreRow>(TRUST_SCORE_SELECT_ALL)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;

        let role = if let Some(ref row) = existing {
            row.role.clone()
        } else {
            // Determine role from users table: use the first role or default to "customer".
            let user_row: Option<RolesRow> =
                sqlx::query_as("SELECT roles FROM users WHERE id = $1")
                    .bind(user_id)
                    .fetch_optional(&self.pool)
                    .await?;

            let user_row = user_row
                .ok_or_else(|| TrustError::UserNotFound(user_id.to_string()))?;

            if user_row.roles.contains(&"provider".to_string()) {
                "provider".to_string()
            } else {
                "customer".to_string()
            }
        };

        let previous_tier = existing
            .as_ref()
            .map_or("new".to_string(), |r| r.tier.clone());

        // Compute each dimension using pure scoring functions.
        let feedback = self.compute_feedback(user_id).await?;
        let volume = self.compute_volume(user_id).await?;
        let risk = self.compute_risk(user_id).await?;
        let fraud = self.compute_fraud(user_id).await?;

        let dimensions = DimensionScores {
            feedback: feedback.0,
            volume: volume.0,
            risk: risk.0,
            fraud: fraud.0,
        };

        let overall = scoring::composite_score(
            dimensions.feedback,
            dimensions.volume,
            dimensions.risk,
            dimensions.fraud,
        );

        // Determine tier from overall score and volume/feedback data.
        let new_tier = self
            .determine_tier(overall, &volume.1, &feedback.1, user_id)
            .await;

        let feedback_json = serde_json::to_value(&feedback.1).ok();
        let volume_json = serde_json::to_value(&volume.1).ok();
        let risk_json = serde_json::to_value(&risk.1).ok();
        let fraud_json = serde_json::to_value(&fraud.1).ok();

        // DB stores 0-100 range.
        let overall_db = overall * 100.0;
        let feedback_db = dimensions.feedback * 100.0;
        let volume_db = dimensions.volume * 100.0;
        let risk_db = dimensions.risk * 100.0;
        let fraud_db = dimensions.fraud * 100.0;

        // Upsert trust_scores.
        let row = sqlx::query_as::<_, TrustScoreRow>(
            "INSERT INTO trust_scores \
                (user_id, role, overall_score, tier, feedback_score, volume_score, \
                 risk_score, fraud_score, feedback_details, volume_details, \
                 risk_details, fraud_details, last_computed_at, computation_version) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), 1) \
             ON CONFLICT (user_id) DO UPDATE SET \
                overall_score = EXCLUDED.overall_score, \
                tier = EXCLUDED.tier, \
                feedback_score = EXCLUDED.feedback_score, \
                volume_score = EXCLUDED.volume_score, \
                risk_score = EXCLUDED.risk_score, \
                fraud_score = EXCLUDED.fraud_score, \
                feedback_details = EXCLUDED.feedback_details, \
                volume_details = EXCLUDED.volume_details, \
                risk_details = EXCLUDED.risk_details, \
                fraud_details = EXCLUDED.fraud_details, \
                last_computed_at = now(), \
                computation_version = trust_scores.computation_version + 1, \
                updated_at = now() \
             RETURNING id, user_id, role, \
               overall_score::float8 as overall_score, tier, \
               feedback_score::float8 as feedback_score, \
               volume_score::float8 as volume_score, \
               risk_score::float8 as risk_score, \
               fraud_score::float8 as fraud_score, \
               feedback_details, volume_details, risk_details, fraud_details, \
               last_computed_at, computation_version, created_at, updated_at",
        )
        .bind(user_id)
        .bind(&role)
        .bind(overall_db)
        .bind(new_tier.as_db_str())
        .bind(feedback_db)
        .bind(volume_db)
        .bind(risk_db)
        .bind(fraud_db)
        .bind(&feedback_json)
        .bind(&volume_json)
        .bind(&risk_json)
        .bind(&fraud_json)
        .fetch_one(&self.pool)
        .await?;

        // Insert history row.
        sqlx::query(
            "INSERT INTO trust_score_history \
                (user_id, role, overall_score, feedback_score, volume_score, \
                 risk_score, fraud_score, trigger_event) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(user_id)
        .bind(&role)
        .bind(overall_db)
        .bind(feedback_db)
        .bind(volume_db)
        .bind(risk_db)
        .bind(fraud_db)
        .bind(trigger_reason)
        .execute(&self.pool)
        .await?;

        let tier_changed = new_tier.as_db_str() != previous_tier;

        tracing::info!(
            user_id = %user_id,
            overall = overall,
            tier = new_tier.as_db_str(),
            tier_changed,
            trigger = trigger_reason,
            "trust score computed"
        );

        Ok((row, tier_changed, previous_tier))
    }

    /// Batch compute trust scores for multiple users.
    ///
    /// # Errors
    ///
    /// Returns `TrustError` on database errors.
    #[allow(clippy::cast_possible_truncation)]
    pub async fn batch_compute(
        &self,
        user_ids: &[Uuid],
    ) -> Result<(i32, i32), TrustError> {
        let mut computed = 0i32;
        let mut tier_changes = 0i32;

        for user_id in user_ids {
            match self.compute_score(*user_id, "scheduled").await {
                Ok((_row, changed, _prev)) => {
                    computed += 1;
                    if changed {
                        tier_changes += 1;
                    }
                }
                Err(e) => {
                    tracing::warn!(user_id = %user_id, error = %e, "failed to compute trust score");
                }
            }
        }

        Ok((computed, tier_changes))
    }

    // -----------------------------------------------------------------------
    // Signal recording
    // -----------------------------------------------------------------------

    /// Record a feedback signal and trigger recomputation.
    ///
    /// # Errors
    ///
    /// Returns `TrustError` on database errors.
    pub async fn record_feedback_signal(
        &self,
        user_id: Uuid,
        source: &str,
        value: f64,
        reference_id: &str,
    ) -> Result<(), TrustError> {
        if !(0.0..=1.0).contains(&value) {
            return Err(TrustError::InvalidSignal(
                "feedback value must be between 0.0 and 1.0".into(),
            ));
        }

        tracing::info!(
            user_id = %user_id,
            source,
            value,
            reference_id,
            "feedback signal recorded"
        );

        // Trigger recomputation with this signal as reason.
        self.compute_score(user_id, &format!("feedback:{source}"))
            .await?;

        Ok(())
    }

    /// Record a volume signal and trigger recomputation.
    ///
    /// # Errors
    ///
    /// Returns `TrustError` on database errors.
    pub async fn record_volume_signal(
        &self,
        user_id: Uuid,
        signal_type: &str,
        reference_id: &str,
    ) -> Result<(), TrustError> {
        tracing::info!(
            user_id = %user_id,
            signal_type,
            reference_id,
            "volume signal recorded"
        );

        self.compute_score(user_id, &format!("volume:{signal_type}"))
            .await?;

        Ok(())
    }

    /// Record a risk signal and trigger recomputation.
    ///
    /// # Errors
    ///
    /// Returns `TrustError` on database errors.
    pub async fn record_risk_signal(
        &self,
        user_id: Uuid,
        signal_type: &str,
        severity: f64,
        reference_id: &str,
    ) -> Result<(), TrustError> {
        if !(0.0..=1.0).contains(&severity) {
            return Err(TrustError::InvalidSignal(
                "severity must be between 0.0 and 1.0".into(),
            ));
        }

        tracing::info!(
            user_id = %user_id,
            signal_type,
            severity,
            reference_id,
            "risk signal recorded"
        );

        self.compute_score(user_id, &format!("risk:{signal_type}"))
            .await?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Dimension computation (DB fetch -> pure scoring function)
    // -----------------------------------------------------------------------

    /// Compute the feedback dimension score (0.0-1.0).
    ///
    /// Queries the reviews table for the user's reviews, computes recency-weighted
    /// average rating, rating trend, and dispute impact, then delegates to the
    /// pure scoring function.
    async fn compute_feedback(
        &self,
        user_id: Uuid,
    ) -> Result<(f64, FeedbackDetails), TrustError> {
        // Get review statistics for this user (where they are the reviewee).
        let stats: ReviewStatsRow = sqlx::query_as(
            "SELECT \
               COALESCE(AVG(overall_rating)::float8, 0) as avg_rating, \
               COUNT(*)::bigint as total_reviews, \
               COUNT(*) FILTER (WHERE overall_rating = 5)::bigint as five_star, \
               COUNT(*) FILTER (WHERE overall_rating = 1)::bigint as one_star \
             FROM reviews \
             WHERE reviewee_id = $1 AND status = 'published'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Fetch individual review ratings + ages for recency-weighted averaging.
        let review_rows: Vec<ReviewRatingRow> = sqlx::query_as(
            "SELECT overall_rating::float8 as rating, \
               EXTRACT(EPOCH FROM (now() - created_at))::float8 / 86400.0 as age_days \
             FROM reviews \
             WHERE reviewee_id = $1 AND status = 'published' \
             ORDER BY created_at DESC \
             LIMIT 500",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        // Build review data points for time-decay weighted averaging.
        let review_data_points: Vec<ReviewDataPoint> = review_rows
            .iter()
            .map(|r| ReviewDataPoint {
                rating: r.rating,
                age_days: r.age_days.max(0.0),
            })
            .collect();

        let weighted_avg =
            scoring::recency_weighted_average(&review_data_points, &self.decay_config);

        // Get recent reviews (last 90 days) for trend calculation.
        let recent_stats: AvgRow = sqlx::query_as(
            "SELECT COALESCE(AVG(overall_rating)::float8, 0) as avg_val \
             FROM reviews \
             WHERE reviewee_id = $1 AND status = 'published' \
               AND created_at >= now() - interval '90 days'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Count disputes lost (resolved against this user).
        let disputes_lost: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count \
             FROM disputes d \
             JOIN contracts c ON c.id = d.contract_id \
             WHERE (c.provider_id = $1 OR c.customer_id = $1) \
               AND d.opened_by != $1 \
               AND d.status = 'resolved' \
               AND d.resolution_type IN ('full_refund', 'partial_refund', 'contract_terminated')",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        let details = FeedbackDetails {
            average_rating: stats.avg_rating,
            total_reviews: i32_from_i64(stats.total_reviews),
            five_star_count: i32_from_i64(stats.five_star),
            one_star_count: i32_from_i64(stats.one_star),
            rating_trend: recent_stats.avg_val - stats.avg_rating,
            disputes_lost: i32_from_i64(disputes_lost.count),
        };

        // Delegate to pure scoring function.
        let score = scoring::compute_feedback_score(&FeedbackInput {
            average_rating: stats.avg_rating,
            weighted_average_rating: weighted_avg,
            total_reviews: i32_from_i64(stats.total_reviews),
            five_star_count: i32_from_i64(stats.five_star),
            one_star_count: i32_from_i64(stats.one_star),
            rating_trend: recent_stats.avg_val - stats.avg_rating,
            disputes_lost: i32_from_i64(disputes_lost.count),
        });

        Ok((score, details))
    }

    /// Compute the volume dimension score (0.0-1.0).
    ///
    /// Queries contracts for completed count, recent activity, repeat customers,
    /// completion rate, and response time, then delegates to the pure scoring function.
    #[allow(clippy::cast_possible_truncation)]
    async fn compute_volume(
        &self,
        user_id: Uuid,
    ) -> Result<(f64, VolumeDetails), TrustError> {
        // Total completed contracts.
        let completed: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM contracts \
             WHERE (provider_id = $1 OR customer_id = $1) AND status = 'completed'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Completed in last 90 days.
        let recent: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM contracts \
             WHERE (provider_id = $1 OR customer_id = $1) \
               AND status = 'completed' \
               AND completed_at >= now() - interval '90 days'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Repeat customers: distinct counterparties with >1 completed contract.
        let repeat: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM ( \
               SELECT CASE WHEN provider_id = $1 THEN customer_id ELSE provider_id END as other_id \
               FROM contracts \
               WHERE (provider_id = $1 OR customer_id = $1) AND status = 'completed' \
               GROUP BY other_id \
               HAVING COUNT(*) > 1 \
             ) sub",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Completion rate: completed / (completed + cancelled).
        let total_terminal: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM contracts \
             WHERE (provider_id = $1 OR customer_id = $1) \
               AND status IN ('completed', 'cancelled')",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        let completion_rate = if total_terminal.count > 0 {
            completed.count as f64 / total_terminal.count as f64
        } else {
            1.0
        };

        // Average response time in hours (from first message to first reply in chats
        // related to contracts). Fall back to 0 if no data.
        let response_time: AvgRow = sqlx::query_as(
            "SELECT COALESCE(AVG(response_time_hours)::float8, 0) as avg_val \
             FROM ( \
               SELECT EXTRACT(EPOCH FROM (c.started_at - c.created_at))::float8 / 3600.0 \
                 as response_time_hours \
               FROM contracts c \
               WHERE c.provider_id = $1 AND c.started_at IS NOT NULL \
             ) sub",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Total GMV.
        let gmv: GmvRow = sqlx::query_as(
            "SELECT COALESCE(SUM(amount_cents), 0)::bigint as total_cents FROM contracts \
             WHERE (provider_id = $1 OR customer_id = $1) AND status = 'completed'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        let details = VolumeDetails {
            total_jobs_completed: i32_from_i64(completed.count),
            jobs_last_90_days: i32_from_i64(recent.count),
            repeat_customers: i32_from_i64(repeat.count),
            on_time_rate: completion_rate,
            total_gmv_cents: gmv.total_cents,
        };

        // Delegate to pure scoring function.
        let score = scoring::compute_volume_score(&VolumeInput {
            total_completed: completed.count,
            recent_completed: recent.count,
            repeat_customers: repeat.count,
            completion_rate,
            avg_response_time_hours: response_time.avg_val,
        });

        Ok((score, details))
    }

    /// Compute the risk dimension score (0.0-1.0).
    /// INVERTED: lower risk = higher score.
    ///
    /// Queries cancellations, disputes, late deliveries, no-shows, then delegates
    /// to the pure scoring function.
    #[allow(clippy::cast_possible_truncation)]
    async fn compute_risk(
        &self,
        user_id: Uuid,
    ) -> Result<(f64, RiskDetails), TrustError> {
        // Cancellations initiated by this user.
        let cancellations: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM contracts \
             WHERE cancelled_by = $1 AND status = 'cancelled'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Total contracts for rate calculation.
        let total: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM contracts \
             WHERE provider_id = $1 OR customer_id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Disputes filed against this user.
        let disputes: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM disputes d \
             JOIN contracts c ON c.id = d.contract_id \
             WHERE (c.provider_id = $1 OR c.customer_id = $1) \
               AND d.opened_by != $1",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // No-shows: disputes with type 'no_show' involving this user.
        let no_shows: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM disputes d \
             JOIN contracts c ON c.id = d.contract_id \
             WHERE (c.provider_id = $1 OR c.customer_id = $1) \
               AND d.opened_by != $1 \
               AND d.dispute_type = 'no_show'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Late deliveries: disputes with type 'incomplete_work' or 'abandonment'.
        let late: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM disputes d \
             JOIN contracts c ON c.id = d.contract_id \
             WHERE (c.provider_id = $1 OR c.customer_id = $1) \
               AND d.opened_by != $1 \
               AND d.dispute_type IN ('incomplete_work', 'abandonment')",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        let cancellation_rate = if total.count > 0 {
            cancellations.count as f64 / total.count as f64
        } else {
            0.0
        };

        let dispute_rate = if total.count > 0 {
            disputes.count as f64 / total.count as f64
        } else {
            0.0
        };

        let details = RiskDetails {
            cancellations: i32_from_i64(cancellations.count),
            disputes_filed: i32_from_i64(disputes.count),
            late_deliveries: i32_from_i64(late.count),
            no_shows: i32_from_i64(no_shows.count),
            cancellation_rate,
            dispute_rate,
        };

        // Delegate to pure scoring function.
        let score = scoring::compute_risk_score(&RiskInput {
            total_contracts: total.count,
            cancellations: cancellations.count,
            disputes_against: disputes.count,
            no_shows: no_shows.count,
            late_deliveries: late.count,
        });

        Ok((score, details))
    }

    /// Compute the fraud dimension score (0.0-1.0).
    /// INVERTED: lower fraud = higher score.
    ///
    /// Queries fraud_signals table, then delegates to the pure scoring function.
    #[allow(clippy::cast_possible_truncation)]
    async fn compute_fraud(
        &self,
        user_id: Uuid,
    ) -> Result<(f64, FraudDetails), TrustError> {
        // Count fraud signals for this user.
        let signals: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM fraud_signals \
             WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Check for unresolved (pending/confirmed) fraud flags.
        let active_flags: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM fraud_signals \
             WHERE user_id = $1 AND status IN ('pending', 'confirmed')",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        // Get the most recent action taken.
        let last_outcome: Option<OutcomeRow> = sqlx::query_as(
            "SELECT COALESCE(action_taken, 'cleared') as outcome FROM fraud_signals \
             WHERE user_id = $1 AND status IN ('actioned', 'dismissed') \
             ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        let has_active_flags = active_flags.count > 0;
        let fraud_probability = if signals.count == 0 {
            0.0
        } else {
            // Simple heuristic: more signals = higher probability, capped at 1.0.
            (signals.count as f64 * 0.15).min(1.0)
        };

        let details = FraudDetails {
            fraud_signals_detected: i32_from_i64(signals.count),
            fraud_probability,
            has_active_flags,
            last_review_outcome: last_outcome
                .map_or_else(|| "cleared".to_string(), |r| r.outcome),
        };

        // Delegate to pure scoring function.
        let score = scoring::compute_fraud_score(&FraudInput {
            total_signals: signals.count,
            active_flags: active_flags.count,
        });

        Ok((score, details))
    }

    // -----------------------------------------------------------------------
    // Tier determination
    // -----------------------------------------------------------------------

    /// Determine the trust tier from the overall score and volume/feedback data.
    async fn determine_tier(
        &self,
        overall: f64,
        volume: &VolumeDetails,
        feedback: &FeedbackDetails,
        user_id: Uuid,
    ) -> TrustTier {
        // Check for unresolved fraud flags -> under_review.
        let active_flags: CountRow = sqlx::query_as(
            "SELECT COUNT(*)::bigint as count FROM fraud_signals \
             WHERE user_id = $1 AND status IN ('pending', 'confirmed')",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .unwrap_or(None)
        .unwrap_or(CountRow { count: 0 });

        if active_flags.count > 0 {
            return TrustTier::UnderReview;
        }

        let requirements = all_tier_requirements();

        // Check tiers from highest to lowest.
        // Top Rated: 85+, 25+ jobs, 15+ reviews, 4.5+ rating, verification.
        if let Some(req) = requirements.iter().find(|r| r.tier == TrustTier::TopRated) {
            if overall >= req.min_overall_score
                && volume.total_jobs_completed >= req.min_completed_jobs
                && feedback.total_reviews >= req.min_reviews
                && feedback.average_rating >= req.min_rating
            {
                return TrustTier::TopRated;
            }
        }

        // Trusted: 70+, 10+ jobs, 5+ reviews, 4.0+ rating, verification.
        if let Some(req) = requirements.iter().find(|r| r.tier == TrustTier::Trusted) {
            if overall >= req.min_overall_score
                && volume.total_jobs_completed >= req.min_completed_jobs
                && feedback.total_reviews >= req.min_reviews
                && feedback.average_rating >= req.min_rating
            {
                return TrustTier::Trusted;
            }
        }

        // Rising: 50+, 3+ jobs, 2+ reviews.
        if let Some(req) = requirements.iter().find(|r| r.tier == TrustTier::Rising) {
            if overall >= req.min_overall_score
                && volume.total_jobs_completed >= req.min_completed_jobs
                && feedback.total_reviews >= req.min_reviews
            {
                return TrustTier::Rising;
            }
        }

        TrustTier::New
    }
}

// ---------------------------------------------------------------------------
// Helper row types for sqlx queries
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct CountRow {
    count: i64,
}

#[derive(sqlx::FromRow)]
struct RolesRow {
    roles: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct ReviewStatsRow {
    avg_rating: f64,
    total_reviews: i64,
    five_star: i64,
    one_star: i64,
}

/// Individual review row with rating and age for time-decay weighting.
#[derive(sqlx::FromRow)]
struct ReviewRatingRow {
    rating: f64,
    age_days: f64,
}

#[derive(sqlx::FromRow)]
struct AvgRow {
    avg_val: f64,
}

#[derive(sqlx::FromRow)]
struct GmvRow {
    total_cents: i64,
}

#[derive(sqlx::FromRow)]
struct OutcomeRow {
    outcome: String,
}

/// Safely truncate i64 to i32 for proto field sizes.
#[allow(clippy::cast_possible_truncation)]
fn i32_from_i64(v: i64) -> i32 {
    v.min(i64::from(i32::MAX)) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn i32_from_i64_small_value() {
        assert_eq!(i32_from_i64(42), 42);
    }

    #[test]
    fn i32_from_i64_zero() {
        assert_eq!(i32_from_i64(0), 0);
    }

    #[test]
    fn i32_from_i64_at_max() {
        assert_eq!(i32_from_i64(i64::from(i32::MAX)), i32::MAX);
    }

    #[test]
    fn i32_from_i64_above_max_clamps() {
        assert_eq!(i32_from_i64(i64::from(i32::MAX) + 1), i32::MAX);
        assert_eq!(i32_from_i64(i64::MAX), i32::MAX);
    }

    #[test]
    fn i32_from_i64_negative() {
        assert_eq!(i32_from_i64(-1), -1);
        assert_eq!(i32_from_i64(-100), -100);
    }
}
