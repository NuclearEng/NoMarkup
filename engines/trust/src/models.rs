use serde::{Deserialize, Serialize};

/// Trust tier classification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TrustTier {
    UnderReview,
    New,
    Rising,
    Trusted,
    TopRated,
}

/// Computed trust score with dimensional breakdown.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustScore {
    pub user_id: String,
    pub overall: f64,
    pub tier: TrustTier,
    pub feedback_score: f64,
    pub volume_score: f64,
    pub risk_score: f64,
    pub fraud_score: f64,
    pub data_points: i32,
}
