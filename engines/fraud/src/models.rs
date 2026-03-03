use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------------

/// Risk level classification. Proto has 4 non-zero levels; DB has 3 severity
/// values. CRITICAL maps to "high" in the DB.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

impl RiskLevel {
    #[must_use]
    pub fn from_score(score: f64) -> Self {
        if score > 0.8 {
            Self::Critical
        } else if score > 0.6 {
            Self::High
        } else if score > 0.3 {
            Self::Medium
        } else {
            Self::Low
        }
    }

    /// Map to DB severity string (3 values: low, medium, high).
    #[must_use]
    pub fn as_db_severity(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High | Self::Critical => "high",
        }
    }

    /// Parse from DB severity string.
    #[must_use]
    pub fn from_db_severity(s: &str) -> Self {
        match s {
            "low" => Self::Low,
            "medium" => Self::Medium,
            "high" => Self::High,
            _ => Self::Low,
        }
    }

    /// Convert to proto i32.
    #[must_use]
    pub fn to_proto_i32(self) -> i32 {
        match self {
            Self::Low => 1,
            Self::Medium => 2,
            Self::High => 3,
            Self::Critical => 4,
        }
    }
}

/// Fraud decision after evaluating risk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FraudDecision {
    Allow,
    AllowWithReview,
    Challenge,
    Block,
}

impl FraudDecision {
    #[must_use]
    pub fn from_risk_level(level: RiskLevel) -> Self {
        match level {
            RiskLevel::Low => Self::Allow,
            RiskLevel::Medium => Self::AllowWithReview,
            RiskLevel::High => Self::Challenge,
            RiskLevel::Critical => Self::Block,
        }
    }

    /// Convert to proto i32.
    #[must_use]
    pub fn to_proto_i32(self) -> i32 {
        match self {
            Self::Allow => 1,
            Self::AllowWithReview => 2,
            Self::Challenge => 3,
            Self::Block => 4,
        }
    }
}

/// Proto signal type enum values mapped to closest DB `signal_type` values.
/// Proto enum: VELOCITY=1, GEO_MISMATCH=2, DEVICE_FINGERPRINT=3, SHILL_BID=4,
///   ACCOUNT_TAKEOVER=5, PAYMENT_FRAUD=6, FAKE_REVIEW=7, MULTI_ACCOUNT=8, BOT_BEHAVIOR=9
/// DB: 'review_manipulation', 'account_fraud', 'bid_manipulation',
///     'transaction_fraud', 'bad_actor_behavior'
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignalType {
    Velocity,
    GeoMismatch,
    DeviceFingerprint,
    ShillBid,
    AccountTakeover,
    PaymentFraud,
    FakeReview,
    MultiAccount,
    BotBehavior,
}

impl SignalType {
    /// Parse from proto enum i32.
    #[must_use]
    pub fn from_proto_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Velocity),
            2 => Some(Self::GeoMismatch),
            3 => Some(Self::DeviceFingerprint),
            4 => Some(Self::ShillBid),
            5 => Some(Self::AccountTakeover),
            6 => Some(Self::PaymentFraud),
            7 => Some(Self::FakeReview),
            8 => Some(Self::MultiAccount),
            9 => Some(Self::BotBehavior),
            _ => None,
        }
    }

    /// Convert to proto enum i32.
    #[must_use]
    pub fn to_proto_i32(self) -> i32 {
        match self {
            Self::Velocity => 1,
            Self::GeoMismatch => 2,
            Self::DeviceFingerprint => 3,
            Self::ShillBid => 4,
            Self::AccountTakeover => 5,
            Self::PaymentFraud => 6,
            Self::FakeReview => 7,
            Self::MultiAccount => 8,
            Self::BotBehavior => 9,
        }
    }

    /// Map to closest DB `signal_type` value.
    #[must_use]
    pub fn as_db_str(&self) -> &'static str {
        match self {
            Self::Velocity => "bad_actor_behavior",
            Self::GeoMismatch => "account_fraud",
            Self::DeviceFingerprint => "account_fraud",
            Self::ShillBid => "bid_manipulation",
            Self::AccountTakeover => "account_fraud",
            Self::PaymentFraud => "transaction_fraud",
            Self::FakeReview => "review_manipulation",
            Self::MultiAccount => "account_fraud",
            Self::BotBehavior => "bad_actor_behavior",
        }
    }

    /// Parse from DB `signal_type` and `signal_subtype` to closest proto type.
    #[must_use]
    pub fn from_db_str(signal_type: &str, signal_subtype: &str) -> Self {
        match signal_type {
            "review_manipulation" => Self::FakeReview,
            "bid_manipulation" => Self::ShillBid,
            "transaction_fraud" => Self::PaymentFraud,
            "account_fraud" => match signal_subtype {
                "geo_mismatch" => Self::GeoMismatch,
                "device_fingerprint" => Self::DeviceFingerprint,
                "account_takeover" => Self::AccountTakeover,
                "multi_account" => Self::MultiAccount,
                _ => Self::AccountTakeover,
            },
            "bad_actor_behavior" => match signal_subtype {
                "velocity" | "rapid_actions" => Self::Velocity,
                "bot_behavior" | "bot" => Self::BotBehavior,
                _ => Self::Velocity,
            },
            _ => Self::Velocity,
        }
    }

    /// Human-readable name used as DB `signal_subtype`.
    #[must_use]
    pub fn as_subtype_str(&self) -> &'static str {
        match self {
            Self::Velocity => "velocity",
            Self::GeoMismatch => "geo_mismatch",
            Self::DeviceFingerprint => "device_fingerprint",
            Self::ShillBid => "shill_bid",
            Self::AccountTakeover => "account_takeover",
            Self::PaymentFraud => "payment_fraud",
            Self::FakeReview => "fake_review",
            Self::MultiAccount => "multi_account",
            Self::BotBehavior => "bot_behavior",
        }
    }
}

// ---------------------------------------------------------------------------
// Database row types
// ---------------------------------------------------------------------------

/// Row from the `fraud_signals` table.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FraudSignalRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub signal_type: String,
    pub signal_subtype: String,
    pub severity: String,
    pub confidence: f64,
    pub description: String,
    pub evidence_json: Option<serde_json::Value>,
    pub related_entity_id: Option<Uuid>,
    pub related_entity_type: Option<String>,
    pub status: String,
    pub auto_actioned: bool,
    pub auto_action: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Row from the `user_sessions` table.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserSessionRow {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub ip_address: String,
    pub user_agent: Option<String>,
    pub device_fingerprint: Option<String>,
    pub geo_lat: Option<f64>,
    pub geo_lng: Option<f64>,
    pub geo_city: Option<String>,
    pub geo_country: Option<String>,
    pub session_start: DateTime<Utc>,
    pub session_end: Option<DateTime<Utc>>,
    pub page_views: i32,
    pub created_at: DateTime<Utc>,
}

/// Result of a real-time fraud check.
#[derive(Debug, Clone)]
pub struct CheckResult {
    pub decision: FraudDecision,
    pub risk_level: RiskLevel,
    pub risk_score: f64,
    pub reasons: Vec<String>,
    pub shill_bid_detected: bool,
}

impl CheckResult {
    #[must_use]
    pub fn from_score(score: f64) -> Self {
        let risk_level = RiskLevel::from_score(score);
        let decision = FraudDecision::from_risk_level(risk_level);
        Self {
            decision,
            risk_level,
            risk_score: score,
            reasons: Vec::new(),
            shill_bid_detected: false,
        }
    }
}

/// Aggregated user risk profile.
#[derive(Debug, Clone)]
pub struct UserRiskProfileData {
    pub user_id: Uuid,
    pub risk_score: f64,
    pub risk_level: RiskLevel,
    pub total_signals: i32,
    pub active_alerts: i32,
    pub recent_signal_types: Vec<SignalType>,
    pub is_restricted: bool,
    pub last_signal_at: Option<DateTime<Utc>>,
    pub last_reviewed_at: Option<DateTime<Utc>>,
}

/// Data recorded when persisting a fraud signal.
#[derive(Debug, Clone)]
pub struct RecordedSignal {
    pub row: FraudSignalRow,
    pub alert_created: bool,
}

// ---------------------------------------------------------------------------
// sqlx helper row types
// ---------------------------------------------------------------------------

#[derive(FromRow)]
pub struct CountRow {
    pub count: i64,
}

#[derive(FromRow)]
#[allow(dead_code)]
pub struct ConfidenceRow {
    pub avg_confidence: f64,
}

#[derive(FromRow)]
pub struct TimestampRow {
    pub ts: Option<DateTime<Utc>>,
}

#[derive(FromRow)]
pub struct SignalTypeRow {
    pub signal_type: String,
    pub signal_subtype: String,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum FraudError {
    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("user not found: {0}")]
    #[allow(dead_code)]
    UserNotFound(String),

    #[error("signal not found: {0}")]
    #[allow(dead_code)]
    SignalNotFound(String),

    #[error("database error: {0}")]
    DatabaseError(#[from] sqlx::Error),
}
