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
