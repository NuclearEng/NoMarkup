use serde::{Deserialize, Serialize};

/// Risk level classification for fraud signals.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

/// Decision after fraud evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FraudDecision {
    Allow,
    AllowWithReview,
    Challenge,
    Block,
}

/// A detected fraud signal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FraudSignal {
    pub user_id: String,
    pub signal_type: String,
    pub confidence: f64,
    pub risk_level: RiskLevel,
}
