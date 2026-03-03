use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Trust tier classification matching the database CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrustTier {
    UnderReview,
    New,
    Rising,
    Trusted,
    TopRated,
}

impl TrustTier {
    /// Parse from the database text representation.
    #[must_use]
    pub fn from_db_str(s: &str) -> Self {
        match s {
            "under_review" => Self::UnderReview,
            "new" => Self::New,
            "rising" => Self::Rising,
            "trusted" => Self::Trusted,
            "top_rated" => Self::TopRated,
            _ => Self::New,
        }
    }

    /// Convert to the database text representation.
    #[must_use]
    pub fn as_db_str(&self) -> &'static str {
        match self {
            Self::UnderReview => "under_review",
            Self::New => "new",
            Self::Rising => "rising",
            Self::Trusted => "trusted",
            Self::TopRated => "top_rated",
        }
    }
}

/// Computed trust score row from the `trust_scores` table.
/// DB stores scores as 0-100; proto uses 0.0-1.0.
/// NUMERIC columns are cast to `float8` in queries so they map to Rust `f64`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TrustScoreRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub overall_score: f64,
    pub tier: String,
    pub feedback_score: f64,
    pub volume_score: f64,
    pub risk_score: f64,
    pub fraud_score: f64,
    pub feedback_details: Option<serde_json::Value>,
    pub volume_details: Option<serde_json::Value>,
    pub risk_details: Option<serde_json::Value>,
    pub fraud_details: Option<serde_json::Value>,
    pub last_computed_at: DateTime<Utc>,
    pub computation_version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// History row from the `trust_score_history` table.
/// NUMERIC columns are cast to `float8` in queries so they map to Rust `f64`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TrustScoreHistoryRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub overall_score: f64,
    pub feedback_score: f64,
    pub volume_score: f64,
    pub risk_score: f64,
    pub fraud_score: f64,
    pub trigger_event: String,
    pub trigger_entity_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// Dimensional breakdown used during computation. All scores are 0.0-1.0.
#[derive(Debug, Clone, Default)]
pub struct DimensionScores {
    pub feedback: f64,
    pub volume: f64,
    pub risk: f64,
    pub fraud: f64,
}

impl DimensionScores {
    /// Compute weighted overall score.
    /// Feedback: 35%, Volume: 20%, Risk: 25%, Fraud: 20%.
    #[must_use]
    pub fn overall(&self) -> f64 {
        self.feedback * 0.35 + self.volume * 0.20 + self.risk * 0.25 + self.fraud * 0.20
    }
}

/// Feedback dimension sub-scores for detailed breakdown.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FeedbackDetails {
    pub average_rating: f64,
    pub total_reviews: i32,
    pub five_star_count: i32,
    pub one_star_count: i32,
    pub rating_trend: f64,
    pub disputes_lost: i32,
}

/// Volume dimension sub-scores for detailed breakdown.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VolumeDetails {
    pub total_jobs_completed: i32,
    pub jobs_last_90_days: i32,
    pub repeat_customers: i32,
    pub on_time_rate: f64,
    pub total_gmv_cents: i64,
}

/// Risk dimension sub-scores for detailed breakdown.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RiskDetails {
    pub cancellations: i32,
    pub disputes_filed: i32,
    pub late_deliveries: i32,
    pub no_shows: i32,
    pub cancellation_rate: f64,
    pub dispute_rate: f64,
}

/// Fraud dimension sub-scores for detailed breakdown.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FraudDetails {
    pub fraud_signals_detected: i32,
    pub fraud_probability: f64,
    pub has_active_flags: bool,
    pub last_review_outcome: String,
}

/// Tier requirement definition (returned by `GetTierRequirements`).
#[derive(Debug, Clone)]
pub struct TierRequirement {
    pub tier: TrustTier,
    pub min_overall_score: f64,
    pub min_completed_jobs: i32,
    pub min_reviews: i32,
    pub min_rating: f64,
    pub requires_verification: bool,
    pub description: String,
}

/// Return all tier requirements.
#[must_use]
pub fn all_tier_requirements() -> Vec<TierRequirement> {
    vec![
        TierRequirement {
            tier: TrustTier::UnderReview,
            min_overall_score: 0.0,
            min_completed_jobs: 0,
            min_reviews: 0,
            min_rating: 0.0,
            requires_verification: false,
            description: "Account is under review due to flags or violations".into(),
        },
        TierRequirement {
            tier: TrustTier::New,
            min_overall_score: 0.0,
            min_completed_jobs: 0,
            min_reviews: 0,
            min_rating: 0.0,
            requires_verification: false,
            description: "New accounts or those with score below 50".into(),
        },
        TierRequirement {
            tier: TrustTier::Rising,
            min_overall_score: 0.50,
            min_completed_jobs: 3,
            min_reviews: 2,
            min_rating: 0.0,
            requires_verification: false,
            description: "Building reputation with consistent positive activity".into(),
        },
        TierRequirement {
            tier: TrustTier::Trusted,
            min_overall_score: 0.70,
            min_completed_jobs: 10,
            min_reviews: 5,
            min_rating: 4.0,
            requires_verification: true,
            description: "Established track record with verified identity".into(),
        },
        TierRequirement {
            tier: TrustTier::TopRated,
            min_overall_score: 0.85,
            min_completed_jobs: 25,
            min_reviews: 15,
            min_rating: 4.5,
            requires_verification: true,
            description: "Elite status with exceptional performance across all dimensions".into(),
        },
    ]
}

/// Errors that can occur during trust scoring operations.
#[derive(Debug, thiserror::Error)]
pub enum TrustError {
    #[error("user not found: {0}")]
    UserNotFound(String),

    #[error("trust score not found for user: {0}")]
    ScoreNotFound(String),

    #[error("invalid user id: {0}")]
    InvalidUserId(String),

    #[error("invalid signal value: {0}")]
    InvalidSignal(String),

    #[error("permission denied: {0}")]
    PermissionDenied(String),

    #[error("database error: {0}")]
    DatabaseError(#[from] sqlx::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------------
    // TrustTier parsing and round-trip
    // ------------------------------------------------------------------

    #[test]
    fn tier_from_db_str_known_values() {
        assert_eq!(TrustTier::from_db_str("under_review"), TrustTier::UnderReview);
        assert_eq!(TrustTier::from_db_str("new"), TrustTier::New);
        assert_eq!(TrustTier::from_db_str("rising"), TrustTier::Rising);
        assert_eq!(TrustTier::from_db_str("trusted"), TrustTier::Trusted);
        assert_eq!(TrustTier::from_db_str("top_rated"), TrustTier::TopRated);
    }

    #[test]
    fn tier_from_db_str_unknown_defaults_to_new() {
        assert_eq!(TrustTier::from_db_str("garbage"), TrustTier::New);
        assert_eq!(TrustTier::from_db_str(""), TrustTier::New);
    }

    #[test]
    fn tier_roundtrip_all_variants() {
        for tier in [
            TrustTier::UnderReview,
            TrustTier::New,
            TrustTier::Rising,
            TrustTier::Trusted,
            TrustTier::TopRated,
        ] {
            let db_str = tier.as_db_str();
            let parsed = TrustTier::from_db_str(db_str);
            assert_eq!(parsed, tier, "round-trip failed for {db_str}");
        }
    }

    // ------------------------------------------------------------------
    // DimensionScores::overall()
    // ------------------------------------------------------------------

    #[test]
    fn dimension_scores_overall_all_ones() {
        let scores = DimensionScores {
            feedback: 1.0,
            volume: 1.0,
            risk: 1.0,
            fraud: 1.0,
        };
        // 0.35 + 0.20 + 0.25 + 0.20 = 1.0
        let overall = scores.overall();
        assert!((overall - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn dimension_scores_overall_all_zeros() {
        let scores = DimensionScores::default();
        assert!((scores.overall()).abs() < f64::EPSILON);
    }

    #[test]
    fn dimension_scores_overall_weights_correct() {
        // Only feedback = 1.0, rest 0.0 => 0.35
        let scores = DimensionScores {
            feedback: 1.0,
            volume: 0.0,
            risk: 0.0,
            fraud: 0.0,
        };
        assert!((scores.overall() - 0.35).abs() < f64::EPSILON);

        // Only volume = 1.0 => 0.20
        let scores = DimensionScores {
            feedback: 0.0,
            volume: 1.0,
            risk: 0.0,
            fraud: 0.0,
        };
        assert!((scores.overall() - 0.20).abs() < f64::EPSILON);

        // Only risk = 1.0 => 0.25
        let scores = DimensionScores {
            feedback: 0.0,
            volume: 0.0,
            risk: 1.0,
            fraud: 0.0,
        };
        assert!((scores.overall() - 0.25).abs() < f64::EPSILON);

        // Only fraud = 1.0 => 0.20
        let scores = DimensionScores {
            feedback: 0.0,
            volume: 0.0,
            risk: 0.0,
            fraud: 1.0,
        };
        assert!((scores.overall() - 0.20).abs() < f64::EPSILON);
    }

    #[test]
    fn dimension_scores_weights_sum_to_one() {
        // Weights: 0.35 + 0.20 + 0.25 + 0.20 = 1.00
        let sum = 0.35_f64 + 0.20 + 0.25 + 0.20;
        assert!((sum - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn dimension_scores_partial_values() {
        let scores = DimensionScores {
            feedback: 0.8,
            volume: 0.5,
            risk: 0.9,
            fraud: 0.7,
        };
        let expected = 0.8 * 0.35 + 0.5 * 0.20 + 0.9 * 0.25 + 0.7 * 0.20;
        assert!((scores.overall() - expected).abs() < f64::EPSILON);
    }

    // ------------------------------------------------------------------
    // all_tier_requirements
    // ------------------------------------------------------------------

    #[test]
    fn tier_requirements_has_all_tiers() {
        let reqs = all_tier_requirements();
        assert_eq!(reqs.len(), 5);

        let tiers: Vec<TrustTier> = reqs.iter().map(|r| r.tier).collect();
        assert!(tiers.contains(&TrustTier::UnderReview));
        assert!(tiers.contains(&TrustTier::New));
        assert!(tiers.contains(&TrustTier::Rising));
        assert!(tiers.contains(&TrustTier::Trusted));
        assert!(tiers.contains(&TrustTier::TopRated));
    }

    #[test]
    fn tier_requirements_thresholds_ascending() {
        let reqs = all_tier_requirements();
        // Filter to the ordered tiers (New, Rising, Trusted, TopRated).
        let ordered = [TrustTier::New, TrustTier::Rising, TrustTier::Trusted, TrustTier::TopRated];
        let ordered_reqs: Vec<&TierRequirement> = ordered
            .iter()
            .filter_map(|t| reqs.iter().find(|r| r.tier == *t))
            .collect();

        for window in ordered_reqs.windows(2) {
            assert!(
                window[0].min_overall_score <= window[1].min_overall_score,
                "tier thresholds must be ascending"
            );
            assert!(
                window[0].min_completed_jobs <= window[1].min_completed_jobs,
                "job requirements must be ascending"
            );
        }
    }

    #[test]
    fn tier_requirements_top_rated_strictest() {
        let reqs = all_tier_requirements();
        let top = reqs.iter().find(|r| r.tier == TrustTier::TopRated).unwrap();
        assert!(top.min_overall_score >= 0.85);
        assert!(top.min_completed_jobs >= 25);
        assert!(top.min_reviews >= 15);
        assert!(top.min_rating >= 4.5);
        assert!(top.requires_verification);
    }

    // ------------------------------------------------------------------
    // Edge cases: no reviews, perfect reviews, zero jobs
    // ------------------------------------------------------------------

    #[test]
    fn feedback_details_default_is_zeroed() {
        let f = FeedbackDetails::default();
        assert_eq!(f.total_reviews, 0);
        assert!((f.average_rating).abs() < f64::EPSILON);
    }

    #[test]
    fn volume_details_default_is_zeroed() {
        let v = VolumeDetails::default();
        assert_eq!(v.total_jobs_completed, 0);
        assert_eq!(v.total_gmv_cents, 0);
    }

    #[test]
    fn risk_details_default_is_zeroed() {
        let r = RiskDetails::default();
        assert_eq!(r.cancellations, 0);
        assert_eq!(r.disputes_filed, 0);
    }

    #[test]
    fn fraud_details_default_is_zeroed() {
        let f = FraudDetails::default();
        assert_eq!(f.fraud_signals_detected, 0);
        assert!(!f.has_active_flags);
    }

    // ------------------------------------------------------------------
    // TrustError display messages
    // ------------------------------------------------------------------

    #[test]
    fn trust_error_display() {
        let err = TrustError::UserNotFound("abc".into());
        assert_eq!(err.to_string(), "user not found: abc");

        let err = TrustError::InvalidSignal("bad".into());
        assert_eq!(err.to_string(), "invalid signal value: bad");
    }

    // ------------------------------------------------------------------
    // FeedbackDetails / VolumeDetails serialization round-trip
    // ------------------------------------------------------------------

    #[test]
    fn feedback_details_serde_roundtrip() {
        let details = FeedbackDetails {
            average_rating: 4.7,
            total_reviews: 42,
            five_star_count: 30,
            one_star_count: 1,
            rating_trend: 0.1,
            disputes_lost: 0,
        };
        let json = serde_json::to_string(&details).expect("serialize");
        let parsed: FeedbackDetails = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.total_reviews, 42);
        assert!((parsed.average_rating - 4.7).abs() < f64::EPSILON);
    }

    // ------------------------------------------------------------------
    // proptest: DimensionScores::overall() always in 0..=1 for inputs in 0..=1
    // ------------------------------------------------------------------

    mod proptests {
        use super::*;
        use proptest::prelude::*;

        proptest! {
            #[test]
            fn overall_score_in_0_to_1(
                feedback in 0.0..=1.0_f64,
                volume in 0.0..=1.0_f64,
                risk in 0.0..=1.0_f64,
                fraud in 0.0..=1.0_f64,
            ) {
                let scores = DimensionScores { feedback, volume, risk, fraud };
                let overall = scores.overall();
                prop_assert!(overall >= 0.0, "overall score must be >= 0.0, got {overall}");
                prop_assert!(overall <= 1.0, "overall score must be <= 1.0, got {overall}");
            }

            #[test]
            fn overall_never_panics(
                feedback in proptest::num::f64::ANY,
                volume in proptest::num::f64::ANY,
                risk in proptest::num::f64::ANY,
                fraud in proptest::num::f64::ANY,
            ) {
                let scores = DimensionScores { feedback, volume, risk, fraud };
                let _ = scores.overall();
            }

            #[test]
            fn tier_roundtrip_prop(s in "(under_review|new|rising|trusted|top_rated)") {
                let tier = TrustTier::from_db_str(&s);
                let db_str = tier.as_db_str();
                let roundtripped = TrustTier::from_db_str(db_str);
                prop_assert_eq!(tier, roundtripped);
            }
        }
    }
}
