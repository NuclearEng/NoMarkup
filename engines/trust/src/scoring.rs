/// Pure scoring computations. No I/O, no database access.
///
/// All functions in this module operate on plain data and return deterministic
/// results. This makes them trivial to unit-test and property-test.
///
/// Score range: all dimension scores are 0.0..=1.0.
/// Overall score: weighted combination also 0.0..=1.0.
/// DB storage multiplies by 100 to get 0-100 integer range.

/// Configuration for the time-decay weighting of reviews.
#[derive(Debug, Clone, Copy)]
pub struct DecayConfig {
    /// Half-life in days: after this many days, a review's weight drops to 50%.
    pub half_life_days: f64,
    /// Minimum weight a review can have (prevents very old reviews from being
    /// completely ignored).
    pub min_weight: f64,
}

impl Default for DecayConfig {
    fn default() -> Self {
        Self {
            half_life_days: 180.0,
            min_weight: 0.05,
        }
    }
}

/// A single review data point used for time-decay weighted averaging.
#[derive(Debug, Clone, Copy)]
pub struct ReviewDataPoint {
    /// Rating on a 1-5 scale.
    pub rating: f64,
    /// Age of the review in days (0.0 = just posted).
    pub age_days: f64,
}

/// Compute exponential decay weight for a review given its age.
///
/// Formula: weight = max(min_weight, 2^(-age / half_life))
///
/// This gives:
/// - age = 0: weight = 1.0
/// - age = half_life: weight = 0.5
/// - age = 2 * half_life: weight = 0.25
/// - etc.
///
/// Returns a value in `[min_weight, 1.0]`.
#[must_use]
pub fn decay_weight(age_days: f64, config: &DecayConfig) -> f64 {
    if age_days <= 0.0 {
        return 1.0;
    }
    if !age_days.is_finite() || !config.half_life_days.is_finite() || config.half_life_days <= 0.0
    {
        return config.min_weight;
    }

    let exponent = -age_days / config.half_life_days;
    // 2^exponent = e^(exponent * ln(2))
    let weight = (exponent * core::f64::consts::LN_2).exp();
    weight.max(config.min_weight).min(1.0)
}

/// Compute the recency-weighted average rating from a set of reviews.
///
/// Each review's rating is weighted by its exponential decay factor.
/// The result is the weighted mean on a 1-5 scale.
///
/// Returns `None` if there are no reviews (caller should use a default).
#[must_use]
pub fn recency_weighted_average(reviews: &[ReviewDataPoint], config: &DecayConfig) -> Option<f64> {
    if reviews.is_empty() {
        return None;
    }

    let mut weighted_sum = 0.0_f64;
    let mut weight_total = 0.0_f64;

    for review in reviews {
        let w = decay_weight(review.age_days, config);
        weighted_sum += review.rating * w;
        weight_total += w;
    }

    if weight_total <= 0.0 {
        return None;
    }

    Some(weighted_sum / weight_total)
}

// ---------------------------------------------------------------------------
// Feedback dimension scoring
// ---------------------------------------------------------------------------

/// Inputs for the feedback dimension score computation.
#[derive(Debug, Clone, Default)]
pub struct FeedbackInput {
    /// Average rating (1-5 scale). 0.0 means no reviews.
    pub average_rating: f64,
    /// Recency-weighted average rating (1-5 scale). `None` means no reviews.
    pub weighted_average_rating: Option<f64>,
    /// Total number of reviews.
    pub total_reviews: i32,
    /// Number of 5-star reviews.
    pub five_star_count: i32,
    /// Number of 1-star reviews.
    pub one_star_count: i32,
    /// Difference between recent average and overall average (positive = improving).
    pub rating_trend: f64,
    /// Number of disputes resolved against this user.
    pub disputes_lost: i32,
}

/// Compute the feedback dimension score from input data.
///
/// Returns a score in 0.0..=1.0.
///
/// Scoring logic:
/// - Base: recency-weighted rating normalized from 1-5 to 0-1.
/// - Confidence boost: more reviews increase confidence toward the actual rating
///   (fewer reviews regress toward 0.5).
/// - Trend bonus/penalty: improving trend gets a small bonus, declining gets a penalty.
/// - Dispute penalty: each dispute lost costs 5%, capped at 30%.
///
/// With no reviews, returns 0.5 (neutral prior).
#[must_use]
pub fn compute_feedback_score(input: &FeedbackInput) -> f64 {
    if input.total_reviews == 0 {
        return 0.5;
    }

    // Use the recency-weighted rating if available, otherwise fall back to simple average.
    let effective_rating = input
        .weighted_average_rating
        .unwrap_or(input.average_rating);

    // Normalize 1-5 rating to 0-1.
    let normalized = ((effective_rating - 1.0) / 4.0).clamp(0.0, 1.0);

    // Bayesian confidence: blend toward 0.5 (neutral) when reviews are few.
    // After ~10 reviews, confidence is ~0.91. After 20, ~0.95.
    let confidence = bayesian_confidence(input.total_reviews);
    let base_score = 0.5 * (1.0 - confidence) + normalized * confidence;

    // Rating trend bonus/penalty (capped at +/- 0.05).
    let trend_adjustment = (input.rating_trend * 0.025).clamp(-0.05, 0.05);

    // Dispute penalty: 5% per dispute lost, capped at 30%.
    let dispute_penalty = (f64::from(input.disputes_lost) * 0.05).min(0.3);

    // Rating distribution penalty: high proportion of 1-star reviews is a red flag.
    let one_star_ratio = if input.total_reviews > 0 {
        f64::from(input.one_star_count) / f64::from(input.total_reviews)
    } else {
        0.0
    };
    // If more than 20% of reviews are 1-star, penalize.
    let distribution_penalty = if one_star_ratio > 0.2 {
        ((one_star_ratio - 0.2) * 0.5).min(0.15)
    } else {
        0.0
    };

    (base_score + trend_adjustment - dispute_penalty - distribution_penalty).clamp(0.0, 1.0)
}

/// Bayesian confidence factor based on number of reviews.
/// Returns 0.0 (no confidence) to 1.0 (full confidence).
///
/// Uses a sigmoid-like function: confidence = n / (n + k) where k is a
/// constant controlling how quickly confidence grows. k = 5 means:
/// - 1 review: 0.17
/// - 5 reviews: 0.50
/// - 10 reviews: 0.67
/// - 20 reviews: 0.80
/// - 50 reviews: 0.91
#[must_use]
fn bayesian_confidence(n: i32) -> f64 {
    let n_f = f64::from(n.max(0));
    const K: f64 = 5.0;
    n_f / (n_f + K)
}

// ---------------------------------------------------------------------------
// Volume dimension scoring
// ---------------------------------------------------------------------------

/// Inputs for the volume dimension score computation.
#[derive(Debug, Clone, Default)]
pub struct VolumeInput {
    /// Total lifetime completed jobs.
    pub total_completed: i64,
    /// Completed jobs in the last 90 days.
    pub recent_completed: i64,
    /// Number of distinct repeat counterparties (>1 completed contract).
    pub repeat_customers: i64,
    /// Fraction of contracts that were completed (vs completed + cancelled).
    /// 1.0 means all were completed. NaN/0.0 if no contracts.
    pub completion_rate: f64,
    /// Average response time in hours (lower is better). 0.0 if unknown.
    pub avg_response_time_hours: f64,
}

/// Compute the volume dimension score from input data.
///
/// Returns a score in 0.0..=1.0.
///
/// Components:
/// - Jobs completed (40%): logarithmic scale, saturates at ~50 jobs.
/// - Recent activity (20%): linear up to 10 recent jobs.
/// - Repeat customers (15%): linear up to 5 repeat customers.
/// - Completion rate (15%): direct mapping.
/// - Response time (10%): inverse mapping, 1h = 1.0, 24h+ = 0.0.
#[must_use]
pub fn compute_volume_score(input: &VolumeInput) -> f64 {
    // Jobs completed: logarithmic scale to reward early growth more.
    // ln(1 + n) / ln(1 + target), capped at 1.0. Target = 50.
    let jobs_component = if input.total_completed <= 0 {
        0.0
    } else {
        let n = input.total_completed as f64;
        (n.ln_1p() / 50.0_f64.ln_1p()).min(1.0)
    };

    // Recent activity: linear to 10.
    let recency_component = if input.recent_completed <= 0 {
        0.0
    } else {
        (input.recent_completed as f64 / 10.0).min(1.0)
    };

    // Repeat customers: linear to 5.
    let repeat_component = if input.repeat_customers <= 0 {
        0.0
    } else {
        (input.repeat_customers as f64 / 5.0).min(1.0)
    };

    // Completion rate: direct mapping (already 0-1).
    let completion_component = if input.completion_rate.is_finite() {
        input.completion_rate.clamp(0.0, 1.0)
    } else {
        1.0 // No data means no failures
    };

    // Response time: inverse linear. 0h = 1.0, 24h+ = 0.0.
    let response_component = if input.avg_response_time_hours <= 0.0
        || !input.avg_response_time_hours.is_finite()
    {
        0.5 // Unknown: neutral
    } else {
        (1.0 - input.avg_response_time_hours / 24.0).clamp(0.0, 1.0)
    };

    let score = jobs_component * 0.40
        + recency_component * 0.20
        + repeat_component * 0.15
        + completion_component * 0.15
        + response_component * 0.10;

    score.clamp(0.0, 1.0)
}

// ---------------------------------------------------------------------------
// Risk dimension scoring (inverted: low risk = high score)
// ---------------------------------------------------------------------------

/// Inputs for the risk dimension score computation.
#[derive(Debug, Clone, Default)]
pub struct RiskInput {
    /// Total contracts (denominator for rates).
    pub total_contracts: i64,
    /// Number of cancellations initiated by this user.
    pub cancellations: i64,
    /// Number of disputes filed against this user.
    pub disputes_against: i64,
    /// Number of no-show incidents.
    pub no_shows: i64,
    /// Number of late delivery / abandonment incidents.
    pub late_deliveries: i64,
}

/// Compute the risk dimension score from input data.
///
/// Returns a score in 0.0..=1.0 where 1.0 means NO risk (inverted).
///
/// Penalty model:
/// - Cancellation rate penalty: rate * 2.0, capped at 0.5.
/// - Dispute rate penalty: rate * 3.0, capped at 0.5.
/// - No-show penalty: 15% per incident, capped at 0.4.
/// - Late delivery penalty: 8% per incident, capped at 0.3.
///
/// Total penalty is capped at 1.0 (score cannot go below 0).
///
/// With no contracts, returns 1.0 (no risk data = clean).
#[must_use]
pub fn compute_risk_score(input: &RiskInput) -> f64 {
    if input.total_contracts <= 0 {
        return 1.0; // No history means no risk signals
    }

    let total = input.total_contracts as f64;

    let cancellation_rate = input.cancellations as f64 / total;
    let dispute_rate = input.disputes_against as f64 / total;

    let cancel_penalty = (cancellation_rate * 2.0).min(0.5);
    let dispute_penalty = (dispute_rate * 3.0).min(0.5);
    let noshow_penalty = (input.no_shows as f64 * 0.15).min(0.4);
    let late_penalty = (input.late_deliveries as f64 * 0.08).min(0.3);

    (1.0 - cancel_penalty - dispute_penalty - noshow_penalty - late_penalty).clamp(0.0, 1.0)
}

// ---------------------------------------------------------------------------
// Fraud dimension scoring (inverted: low fraud = high score)
// ---------------------------------------------------------------------------

/// Inputs for the fraud dimension score computation.
#[derive(Debug, Clone, Default)]
pub struct FraudInput {
    /// Total fraud signals detected for this user.
    pub total_signals: i64,
    /// Number of currently active (unresolved) fraud flags.
    pub active_flags: i64,
}

/// Compute the fraud dimension score from input data.
///
/// Returns a score in 0.0..=1.0 where 1.0 means NO fraud signals (clean).
///
/// Penalty model:
/// - Each signal: 10% penalty, capped at 0.5.
/// - Active (unresolved) flags: 30% penalty.
///
/// With no signals, returns 1.0 (clean).
#[must_use]
pub fn compute_fraud_score(input: &FraudInput) -> f64 {
    let signal_penalty = (input.total_signals as f64 * 0.1).min(0.5);
    let active_flag_penalty = if input.active_flags > 0 { 0.3 } else { 0.0 };

    (1.0 - signal_penalty - active_flag_penalty).clamp(0.0, 1.0)
}

// ---------------------------------------------------------------------------
// Composite score and tier determination
// ---------------------------------------------------------------------------

/// Dimension weights for the composite score.
pub const WEIGHT_FEEDBACK: f64 = 0.35;
pub const WEIGHT_VOLUME: f64 = 0.20;
pub const WEIGHT_RISK: f64 = 0.25;
pub const WEIGHT_FRAUD: f64 = 0.20;

/// Compute the weighted composite score from four dimension scores.
///
/// All inputs should be in 0.0..=1.0. The output is also 0.0..=1.0.
/// If inputs are outside range, the output is clamped.
#[must_use]
pub fn composite_score(feedback: f64, volume: f64, risk: f64, fraud: f64) -> f64 {
    let raw =
        feedback * WEIGHT_FEEDBACK + volume * WEIGHT_VOLUME + risk * WEIGHT_RISK + fraud * WEIGHT_FRAUD;
    raw.clamp(0.0, 1.0)
}

/// Trust tier based on the 0-100 overall score.
///
/// Thresholds:
/// - LOW:    0-25
/// - MEDIUM: 26-50
/// - HIGH:   51-75
/// - ELITE:  76-100
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScoreTier {
    Low,
    Medium,
    High,
    Elite,
}

impl ScoreTier {
    /// Determine the tier from a 0-100 score.
    #[must_use]
    pub fn from_score_100(score: f64) -> Self {
        if score > 75.0 {
            Self::Elite
        } else if score > 50.0 {
            Self::High
        } else if score > 25.0 {
            Self::Medium
        } else {
            Self::Low
        }
    }

    /// Determine the tier from a 0.0-1.0 score.
    #[must_use]
    pub fn from_score(score: f64) -> Self {
        Self::from_score_100(score * 100.0)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ---------------------------------------------------------------
    // Decay weight tests
    // ---------------------------------------------------------------

    #[test]
    fn decay_weight_at_zero_age_is_one() {
        let config = DecayConfig::default();
        let w = decay_weight(0.0, &config);
        assert!((w - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn decay_weight_at_half_life_is_half() {
        let config = DecayConfig {
            half_life_days: 180.0,
            min_weight: 0.0,
        };
        let w = decay_weight(180.0, &config);
        assert!(
            (w - 0.5).abs() < 1e-10,
            "expected ~0.5 at half-life, got {w}"
        );
    }

    #[test]
    fn decay_weight_at_double_half_life_is_quarter() {
        let config = DecayConfig {
            half_life_days: 180.0,
            min_weight: 0.0,
        };
        let w = decay_weight(360.0, &config);
        assert!(
            (w - 0.25).abs() < 1e-10,
            "expected ~0.25 at 2x half-life, got {w}"
        );
    }

    #[test]
    fn decay_weight_never_below_min_weight() {
        let config = DecayConfig {
            half_life_days: 30.0,
            min_weight: 0.05,
        };
        // Very old review: 10000 days.
        let w = decay_weight(10000.0, &config);
        assert!(
            w >= config.min_weight,
            "weight {w} should be >= min_weight {}",
            config.min_weight
        );
    }

    #[test]
    fn decay_weight_negative_age_returns_one() {
        let config = DecayConfig::default();
        let w = decay_weight(-10.0, &config);
        assert!((w - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn decay_weight_infinite_age_returns_min() {
        let config = DecayConfig {
            half_life_days: 180.0,
            min_weight: 0.05,
        };
        let w = decay_weight(f64::INFINITY, &config);
        assert!(
            (w - config.min_weight).abs() < f64::EPSILON,
            "infinite age should return min_weight, got {w}"
        );
    }

    #[test]
    fn decay_weight_zero_half_life_returns_min() {
        let config = DecayConfig {
            half_life_days: 0.0,
            min_weight: 0.05,
        };
        let w = decay_weight(10.0, &config);
        assert!(
            (w - config.min_weight).abs() < f64::EPSILON,
            "zero half-life should return min_weight, got {w}"
        );
    }

    // ---------------------------------------------------------------
    // Recency-weighted average tests
    // ---------------------------------------------------------------

    #[test]
    fn weighted_avg_empty_returns_none() {
        let config = DecayConfig::default();
        assert!(recency_weighted_average(&[], &config).is_none());
    }

    #[test]
    fn weighted_avg_single_recent_review() {
        let config = DecayConfig::default();
        let reviews = [ReviewDataPoint {
            rating: 4.0,
            age_days: 0.0,
        }];
        let avg = recency_weighted_average(&reviews, &config).unwrap();
        assert!((avg - 4.0).abs() < f64::EPSILON);
    }

    #[test]
    fn weighted_avg_recent_reviews_weighted_more() {
        let config = DecayConfig {
            half_life_days: 30.0,
            min_weight: 0.0,
        };
        // One old 1-star review (300 days) and one new 5-star review (0 days).
        // The old review's weight should be tiny: 2^(-300/30) = 2^(-10) ~ 0.001.
        let reviews = [
            ReviewDataPoint {
                rating: 1.0,
                age_days: 300.0,
            },
            ReviewDataPoint {
                rating: 5.0,
                age_days: 0.0,
            },
        ];
        let avg = recency_weighted_average(&reviews, &config).unwrap();
        // Should be very close to 5.0 since the old review has negligible weight.
        assert!(
            avg > 4.5,
            "expected avg close to 5.0, got {avg}"
        );
    }

    #[test]
    fn weighted_avg_equal_age_equals_simple_average() {
        let config = DecayConfig::default();
        let reviews = [
            ReviewDataPoint {
                rating: 3.0,
                age_days: 10.0,
            },
            ReviewDataPoint {
                rating: 5.0,
                age_days: 10.0,
            },
        ];
        let avg = recency_weighted_average(&reviews, &config).unwrap();
        assert!(
            (avg - 4.0).abs() < 1e-10,
            "equal-age reviews should give simple average, got {avg}"
        );
    }

    // ---------------------------------------------------------------
    // Feedback score tests
    // ---------------------------------------------------------------

    #[test]
    fn feedback_no_reviews_returns_neutral() {
        let input = FeedbackInput::default();
        let score = compute_feedback_score(&input);
        assert!(
            (score - 0.5).abs() < f64::EPSILON,
            "no reviews should give 0.5, got {score}"
        );
    }

    #[test]
    fn feedback_perfect_reviews() {
        let input = FeedbackInput {
            average_rating: 5.0,
            weighted_average_rating: Some(5.0),
            total_reviews: 50,
            five_star_count: 50,
            one_star_count: 0,
            rating_trend: 0.0,
            disputes_lost: 0,
        };
        let score = compute_feedback_score(&input);
        // With 50 reviews: confidence = 50/55 = 0.909. Base = 0.5*(1-0.909) + 1.0*0.909 = 0.955.
        assert!(
            score > 0.9,
            "perfect reviews should give high score, got {score}"
        );
    }

    #[test]
    fn feedback_terrible_reviews() {
        let input = FeedbackInput {
            average_rating: 1.0,
            weighted_average_rating: Some(1.0),
            total_reviews: 50,
            five_star_count: 0,
            one_star_count: 50,
            rating_trend: 0.0,
            disputes_lost: 0,
        };
        let score = compute_feedback_score(&input);
        // 100% one-star, all ratings = 1.0.
        // normalized = 0.0, confidence = 0.909
        // base = 0.5 * 0.091 + 0.0 * 0.909 = 0.0455
        // one_star_ratio = 1.0, penalty = (0.8 * 0.5).min(0.15) = 0.15
        assert!(
            score < 0.1,
            "terrible reviews should give low score, got {score}"
        );
    }

    #[test]
    fn feedback_disputes_reduce_score() {
        let base = FeedbackInput {
            average_rating: 4.5,
            weighted_average_rating: Some(4.5),
            total_reviews: 20,
            five_star_count: 15,
            one_star_count: 0,
            rating_trend: 0.0,
            disputes_lost: 0,
        };
        let with_disputes = FeedbackInput {
            disputes_lost: 3,
            ..base.clone()
        };
        let score_base = compute_feedback_score(&base);
        let score_disputes = compute_feedback_score(&with_disputes);
        assert!(
            score_disputes < score_base,
            "disputes should reduce score: base={score_base}, with_disputes={score_disputes}"
        );
    }

    #[test]
    fn feedback_few_reviews_regress_toward_neutral() {
        let few = FeedbackInput {
            average_rating: 5.0,
            weighted_average_rating: Some(5.0),
            total_reviews: 1,
            five_star_count: 1,
            one_star_count: 0,
            rating_trend: 0.0,
            disputes_lost: 0,
        };
        let many = FeedbackInput {
            average_rating: 5.0,
            weighted_average_rating: Some(5.0),
            total_reviews: 50,
            five_star_count: 50,
            one_star_count: 0,
            rating_trend: 0.0,
            disputes_lost: 0,
        };
        let score_few = compute_feedback_score(&few);
        let score_many = compute_feedback_score(&many);
        assert!(
            score_many > score_few,
            "more reviews should increase confidence: few={score_few}, many={score_many}"
        );
    }

    #[test]
    fn feedback_positive_trend_helps() {
        let base = FeedbackInput {
            average_rating: 3.5,
            weighted_average_rating: Some(3.5),
            total_reviews: 20,
            five_star_count: 5,
            one_star_count: 2,
            rating_trend: 0.0,
            disputes_lost: 0,
        };
        let improving = FeedbackInput {
            rating_trend: 1.0,
            ..base.clone()
        };
        assert!(
            compute_feedback_score(&improving) > compute_feedback_score(&base),
            "positive trend should help"
        );
    }

    // ---------------------------------------------------------------
    // Volume score tests
    // ---------------------------------------------------------------

    #[test]
    fn volume_no_history() {
        let input = VolumeInput::default();
        let score = compute_volume_score(&input);
        // Only the completion rate (1.0 for no data) and response time (0.5 neutral)
        // contribute. completion: 0.15 * 1.0 = 0.15, response: 0.10 * 0.5 = 0.05.
        assert!(
            score < 0.3,
            "zero history should give low volume score, got {score}"
        );
    }

    #[test]
    fn volume_experienced_provider() {
        let input = VolumeInput {
            total_completed: 60,
            recent_completed: 8,
            repeat_customers: 4,
            completion_rate: 0.95,
            avg_response_time_hours: 2.0,
        };
        let score = compute_volume_score(&input);
        assert!(
            score > 0.7,
            "experienced provider should have high volume score, got {score}"
        );
    }

    #[test]
    fn volume_logarithmic_scaling() {
        // Going from 0 to 10 jobs should increase score more than going from 40 to 50.
        let score_10 = compute_volume_score(&VolumeInput {
            total_completed: 10,
            ..VolumeInput::default()
        });
        let score_40 = compute_volume_score(&VolumeInput {
            total_completed: 40,
            ..VolumeInput::default()
        });
        let score_50 = compute_volume_score(&VolumeInput {
            total_completed: 50,
            ..VolumeInput::default()
        });
        let jump_0_to_10 = score_10;
        let jump_40_to_50 = score_50 - score_40;
        assert!(
            jump_0_to_10 > jump_40_to_50,
            "logarithmic scaling: 0->10 jump ({jump_0_to_10}) should be > 40->50 jump ({jump_40_to_50})"
        );
    }

    #[test]
    fn volume_response_time_scoring() {
        let fast = VolumeInput {
            total_completed: 10,
            avg_response_time_hours: 1.0,
            completion_rate: 1.0,
            ..VolumeInput::default()
        };
        let slow = VolumeInput {
            avg_response_time_hours: 20.0,
            ..fast.clone()
        };
        assert!(
            compute_volume_score(&fast) > compute_volume_score(&slow),
            "faster response should give higher score"
        );
    }

    // ---------------------------------------------------------------
    // Risk score tests
    // ---------------------------------------------------------------

    #[test]
    fn risk_no_contracts_is_clean() {
        let input = RiskInput::default();
        let score = compute_risk_score(&input);
        assert!(
            (score - 1.0).abs() < f64::EPSILON,
            "no contracts should be 1.0, got {score}"
        );
    }

    #[test]
    fn risk_clean_history() {
        let input = RiskInput {
            total_contracts: 20,
            cancellations: 0,
            disputes_against: 0,
            no_shows: 0,
            late_deliveries: 0,
        };
        let score = compute_risk_score(&input);
        assert!(
            (score - 1.0).abs() < f64::EPSILON,
            "clean history should be 1.0, got {score}"
        );
    }

    #[test]
    fn risk_some_cancellations() {
        let input = RiskInput {
            total_contracts: 20,
            cancellations: 5,
            disputes_against: 0,
            no_shows: 0,
            late_deliveries: 0,
        };
        let score = compute_risk_score(&input);
        // cancel_rate = 5/20 = 0.25, penalty = 0.25 * 2.0 = 0.5. Score = 1.0 - 0.5 = 0.5.
        assert!(
            (score - 0.5).abs() < 1e-10,
            "expected 0.5 for 25% cancellation rate, got {score}"
        );
    }

    #[test]
    fn risk_heavy_violations() {
        let input = RiskInput {
            total_contracts: 10,
            cancellations: 5,
            disputes_against: 5,
            no_shows: 3,
            late_deliveries: 3,
        };
        let score = compute_risk_score(&input);
        assert!(
            (score - 0.0).abs() < f64::EPSILON,
            "heavy violations should clamp to 0.0, got {score}"
        );
    }

    #[test]
    fn risk_no_shows_penalized_more_than_late() {
        let base = RiskInput {
            total_contracts: 50,
            cancellations: 0,
            disputes_against: 0,
            no_shows: 0,
            late_deliveries: 0,
        };
        let with_noshow = RiskInput {
            no_shows: 1,
            ..base
        };
        let with_late = RiskInput {
            late_deliveries: 1,
            ..base
        };
        let penalty_noshow = 1.0 - compute_risk_score(&with_noshow);
        let penalty_late = 1.0 - compute_risk_score(&with_late);
        assert!(
            penalty_noshow > penalty_late,
            "no-show should be penalized more than late delivery: noshow={penalty_noshow}, late={penalty_late}"
        );
    }

    // ---------------------------------------------------------------
    // Fraud score tests
    // ---------------------------------------------------------------

    #[test]
    fn fraud_clean_is_one() {
        let input = FraudInput::default();
        let score = compute_fraud_score(&input);
        assert!(
            (score - 1.0).abs() < f64::EPSILON,
            "no fraud signals should give 1.0, got {score}"
        );
    }

    #[test]
    fn fraud_active_flags_severe_penalty() {
        let input = FraudInput {
            total_signals: 1,
            active_flags: 1,
        };
        let score = compute_fraud_score(&input);
        // signal penalty = 0.1, active flag penalty = 0.3. Score = 0.6.
        assert!(
            (score - 0.6).abs() < 1e-10,
            "one active flag should give 0.6, got {score}"
        );
    }

    #[test]
    fn fraud_many_signals_caps_penalty() {
        let input = FraudInput {
            total_signals: 100,
            active_flags: 0,
        };
        let score = compute_fraud_score(&input);
        // signal penalty capped at 0.5. Score = 0.5.
        assert!(
            (score - 0.5).abs() < 1e-10,
            "many signals should cap at 0.5, got {score}"
        );
    }

    // ---------------------------------------------------------------
    // Composite score tests
    // ---------------------------------------------------------------

    #[test]
    fn composite_all_ones() {
        let score = composite_score(1.0, 1.0, 1.0, 1.0);
        assert!(
            (score - 1.0).abs() < f64::EPSILON,
            "all 1.0 should give 1.0, got {score}"
        );
    }

    #[test]
    fn composite_all_zeros() {
        let score = composite_score(0.0, 0.0, 0.0, 0.0);
        assert!(
            (score).abs() < f64::EPSILON,
            "all 0.0 should give 0.0, got {score}"
        );
    }

    #[test]
    fn composite_weights_are_correct() {
        // Feedback only.
        let f = composite_score(1.0, 0.0, 0.0, 0.0);
        assert!((f - WEIGHT_FEEDBACK).abs() < f64::EPSILON);
        // Volume only.
        let v = composite_score(0.0, 1.0, 0.0, 0.0);
        assert!((v - WEIGHT_VOLUME).abs() < f64::EPSILON);
        // Risk only.
        let r = composite_score(0.0, 0.0, 1.0, 0.0);
        assert!((r - WEIGHT_RISK).abs() < f64::EPSILON);
        // Fraud only.
        let d = composite_score(0.0, 0.0, 0.0, 1.0);
        assert!((d - WEIGHT_FRAUD).abs() < f64::EPSILON);
    }

    #[test]
    fn composite_weights_sum_to_one() {
        let sum = WEIGHT_FEEDBACK + WEIGHT_VOLUME + WEIGHT_RISK + WEIGHT_FRAUD;
        assert!((sum - 1.0).abs() < f64::EPSILON);
    }

    // ---------------------------------------------------------------
    // ScoreTier tests
    // ---------------------------------------------------------------

    #[test]
    fn score_tier_boundaries() {
        assert_eq!(ScoreTier::from_score_100(0.0), ScoreTier::Low);
        assert_eq!(ScoreTier::from_score_100(25.0), ScoreTier::Low);
        assert_eq!(ScoreTier::from_score_100(25.1), ScoreTier::Medium);
        assert_eq!(ScoreTier::from_score_100(50.0), ScoreTier::Medium);
        assert_eq!(ScoreTier::from_score_100(50.1), ScoreTier::High);
        assert_eq!(ScoreTier::from_score_100(75.0), ScoreTier::High);
        assert_eq!(ScoreTier::from_score_100(75.1), ScoreTier::Elite);
        assert_eq!(ScoreTier::from_score_100(100.0), ScoreTier::Elite);
    }

    #[test]
    fn score_tier_from_normalized() {
        assert_eq!(ScoreTier::from_score(0.0), ScoreTier::Low);
        assert_eq!(ScoreTier::from_score(0.25), ScoreTier::Low);
        assert_eq!(ScoreTier::from_score(0.5), ScoreTier::Medium);
        assert_eq!(ScoreTier::from_score(0.75), ScoreTier::High);
        assert_eq!(ScoreTier::from_score(1.0), ScoreTier::Elite);
    }

    // ---------------------------------------------------------------
    // Bayesian confidence tests
    // ---------------------------------------------------------------

    #[test]
    fn bayesian_confidence_values() {
        assert!((bayesian_confidence(0) - 0.0).abs() < f64::EPSILON);
        assert!((bayesian_confidence(5) - 0.5).abs() < f64::EPSILON);
        let c20 = bayesian_confidence(20);
        assert!(
            (c20 - 0.8).abs() < f64::EPSILON,
            "expected 0.8, got {c20}"
        );
    }

    #[test]
    fn bayesian_confidence_negative_is_zero() {
        assert!((bayesian_confidence(-5) - 0.0).abs() < f64::EPSILON);
    }

    // ---------------------------------------------------------------
    // Integration-style: end-to-end scenario tests
    // ---------------------------------------------------------------

    #[test]
    fn scenario_new_user_gets_neutral_score() {
        let feedback = compute_feedback_score(&FeedbackInput::default());
        let volume = compute_volume_score(&VolumeInput::default());
        let risk = compute_risk_score(&RiskInput::default());
        let fraud = compute_fraud_score(&FraudInput::default());
        let overall = composite_score(feedback, volume, risk, fraud);

        // New user: feedback=0.5, volume~0.2, risk=1.0, fraud=1.0.
        // Weighted: 0.5*0.35 + 0.2*0.20 + 1.0*0.25 + 1.0*0.20 = 0.175+0.04+0.25+0.20 = 0.665
        assert!(
            overall > 0.3 && overall < 0.8,
            "new user should have a middling score, got {overall}"
        );
        assert_eq!(ScoreTier::from_score(overall), ScoreTier::High);
    }

    #[test]
    fn scenario_excellent_provider() {
        let feedback = compute_feedback_score(&FeedbackInput {
            average_rating: 4.9,
            weighted_average_rating: Some(4.9),
            total_reviews: 100,
            five_star_count: 95,
            one_star_count: 0,
            rating_trend: 0.1,
            disputes_lost: 0,
        });
        let volume = compute_volume_score(&VolumeInput {
            total_completed: 80,
            recent_completed: 10,
            repeat_customers: 8,
            completion_rate: 0.99,
            avg_response_time_hours: 1.5,
        });
        let risk = compute_risk_score(&RiskInput {
            total_contracts: 85,
            cancellations: 1,
            disputes_against: 0,
            no_shows: 0,
            late_deliveries: 0,
        });
        let fraud = compute_fraud_score(&FraudInput::default());

        let overall = composite_score(feedback, volume, risk, fraud);
        assert!(
            overall > 0.85,
            "excellent provider should score > 0.85, got {overall}"
        );
        assert_eq!(ScoreTier::from_score(overall), ScoreTier::Elite);
    }

    #[test]
    fn scenario_problematic_user() {
        let feedback = compute_feedback_score(&FeedbackInput {
            average_rating: 2.0,
            weighted_average_rating: Some(1.5),
            total_reviews: 15,
            five_star_count: 0,
            one_star_count: 10,
            rating_trend: -0.5,
            disputes_lost: 3,
        });
        let volume = compute_volume_score(&VolumeInput {
            total_completed: 5,
            recent_completed: 0,
            repeat_customers: 0,
            completion_rate: 0.3,
            avg_response_time_hours: 18.0,
        });
        let risk = compute_risk_score(&RiskInput {
            total_contracts: 15,
            cancellations: 8,
            disputes_against: 5,
            no_shows: 2,
            late_deliveries: 3,
        });
        let fraud = compute_fraud_score(&FraudInput {
            total_signals: 3,
            active_flags: 1,
        });

        let overall = composite_score(feedback, volume, risk, fraud);
        assert!(
            overall < 0.25,
            "problematic user should score < 0.25, got {overall}"
        );
        assert_eq!(ScoreTier::from_score(overall), ScoreTier::Low);
    }

    // ---------------------------------------------------------------
    // proptest: property-based tests
    // ---------------------------------------------------------------

    mod proptests {
        use super::*;

        proptest! {
            #[test]
            fn decay_weight_always_in_range(
                age_days in 0.0..10000.0_f64,
                half_life in 1.0..1000.0_f64,
                min_weight in 0.0..0.5_f64,
            ) {
                let config = DecayConfig { half_life_days: half_life, min_weight };
                let w = decay_weight(age_days, &config);
                prop_assert!(w >= min_weight, "weight {w} < min_weight {min_weight}");
                prop_assert!(w <= 1.0, "weight {w} > 1.0");
            }

            #[test]
            fn decay_weight_monotonically_decreasing(
                a1 in 0.0..5000.0_f64,
                delta in 0.01..5000.0_f64,
            ) {
                let config = DecayConfig { half_life_days: 180.0, min_weight: 0.0 };
                let a2 = a1 + delta;
                let w1 = decay_weight(a1, &config);
                let w2 = decay_weight(a2, &config);
                prop_assert!(w1 >= w2, "decay not monotonic: w({a1})={w1} < w({a2})={w2}");
            }

            #[test]
            fn weighted_average_in_rating_range(
                ratings in proptest::collection::vec(1.0..=5.0_f64, 1..50),
                ages in proptest::collection::vec(0.0..1000.0_f64, 1..50),
            ) {
                let len = ratings.len().min(ages.len());
                let reviews: Vec<ReviewDataPoint> = ratings.into_iter()
                    .zip(ages.into_iter())
                    .take(len)
                    .map(|(rating, age_days)| ReviewDataPoint { rating, age_days })
                    .collect();

                let config = DecayConfig::default();
                if let Some(avg) = recency_weighted_average(&reviews, &config) {
                    prop_assert!(avg >= 1.0, "weighted avg {avg} < 1.0");
                    prop_assert!(avg <= 5.0, "weighted avg {avg} > 5.0");
                }
            }

            #[test]
            fn feedback_score_in_0_to_1(
                avg_rating in 1.0..=5.0_f64,
                total_reviews in 0..200_i32,
                five_star in 0..100_i32,
                one_star in 0..100_i32,
                trend in -2.0..2.0_f64,
                disputes in 0..10_i32,
            ) {
                let input = FeedbackInput {
                    average_rating: avg_rating,
                    weighted_average_rating: Some(avg_rating),
                    total_reviews,
                    five_star_count: five_star,
                    one_star_count: one_star,
                    rating_trend: trend,
                    disputes_lost: disputes,
                };
                let score = compute_feedback_score(&input);
                prop_assert!(score >= 0.0, "feedback score {score} < 0");
                prop_assert!(score <= 1.0, "feedback score {score} > 1");
            }

            #[test]
            fn volume_score_in_0_to_1(
                total in 0..1000_i64,
                recent in 0..100_i64,
                repeat in 0..50_i64,
                completion in 0.0..=1.0_f64,
                response_hrs in 0.0..100.0_f64,
            ) {
                let input = VolumeInput {
                    total_completed: total,
                    recent_completed: recent,
                    repeat_customers: repeat,
                    completion_rate: completion,
                    avg_response_time_hours: response_hrs,
                };
                let score = compute_volume_score(&input);
                prop_assert!(score >= 0.0, "volume score {score} < 0");
                prop_assert!(score <= 1.0, "volume score {score} > 1");
            }

            #[test]
            fn risk_score_in_0_to_1(
                total in 0..200_i64,
                cancellations in 0..100_i64,
                disputes in 0..100_i64,
                no_shows in 0..50_i64,
                late in 0..50_i64,
            ) {
                let input = RiskInput {
                    total_contracts: total,
                    cancellations,
                    disputes_against: disputes,
                    no_shows,
                    late_deliveries: late,
                };
                let score = compute_risk_score(&input);
                prop_assert!(score >= 0.0, "risk score {score} < 0");
                prop_assert!(score <= 1.0, "risk score {score} > 1");
            }

            #[test]
            fn fraud_score_in_0_to_1(
                signals in 0..100_i64,
                flags in 0..20_i64,
            ) {
                let input = FraudInput {
                    total_signals: signals,
                    active_flags: flags,
                };
                let score = compute_fraud_score(&input);
                prop_assert!(score >= 0.0, "fraud score {score} < 0");
                prop_assert!(score <= 1.0, "fraud score {score} > 1");
            }

            #[test]
            fn composite_in_0_to_1(
                feedback in 0.0..=1.0_f64,
                volume in 0.0..=1.0_f64,
                risk in 0.0..=1.0_f64,
                fraud in 0.0..=1.0_f64,
            ) {
                let score = composite_score(feedback, volume, risk, fraud);
                prop_assert!(score >= 0.0, "composite {score} < 0");
                prop_assert!(score <= 1.0, "composite {score} > 1");
            }

            #[test]
            fn composite_monotonic_in_all_dimensions(
                base in 0.0..0.9_f64,
                delta in 0.01..0.1_f64,
            ) {
                let b = base;
                let d = (b + delta).min(1.0);

                // Increasing any single dimension should not decrease overall score.
                let s_base = composite_score(b, b, b, b);

                let s_f = composite_score(d, b, b, b);
                prop_assert!(s_f >= s_base, "increasing feedback decreased score");

                let s_v = composite_score(b, d, b, b);
                prop_assert!(s_v >= s_base, "increasing volume decreased score");

                let s_r = composite_score(b, b, d, b);
                prop_assert!(s_r >= s_base, "increasing risk decreased score");

                let s_d = composite_score(b, b, b, d);
                prop_assert!(s_d >= s_base, "increasing fraud decreased score");
            }

            #[test]
            fn score_tier_always_valid(score in 0.0..=100.0_f64) {
                let tier = ScoreTier::from_score_100(score);
                match tier {
                    ScoreTier::Low => prop_assert!(score <= 25.0),
                    ScoreTier::Medium => prop_assert!(score > 25.0 && score <= 50.0),
                    ScoreTier::High => prop_assert!(score > 50.0 && score <= 75.0),
                    ScoreTier::Elite => prop_assert!(score > 75.0),
                }
            }
        }
    }
}
