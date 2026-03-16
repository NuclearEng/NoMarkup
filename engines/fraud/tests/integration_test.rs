//! Integration tests for the fraud detection engine.
//!
//! These tests exercise the pure behavioral scoring functions and model types
//! without requiring a database connection.

use fraud::models::{
    CheckResult, CountRow, FraudDecision, FraudError, FraudSignalRow, RiskLevel, SignalType,
};
use chrono::Utc;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Signal recording and retrieval (model-level)
// ---------------------------------------------------------------------------

#[test]
fn signal_type_proto_roundtrip_all_variants() {
    let variants = [
        (1, SignalType::Velocity),
        (2, SignalType::GeoMismatch),
        (3, SignalType::DeviceFingerprint),
        (4, SignalType::ShillBid),
        (5, SignalType::AccountTakeover),
        (6, SignalType::PaymentFraud),
        (7, SignalType::FakeReview),
        (8, SignalType::MultiAccount),
        (9, SignalType::BotBehavior),
    ];

    for (proto_val, expected_type) in &variants {
        let parsed = SignalType::from_proto_i32(*proto_val);
        assert_eq!(parsed, Some(*expected_type), "Proto {proto_val} should parse");

        let back = expected_type.to_proto_i32();
        assert_eq!(back, *proto_val, "Round-trip failed for {expected_type:?}");
    }
}

#[test]
fn signal_type_from_proto_invalid_returns_none() {
    assert!(SignalType::from_proto_i32(0).is_none());
    assert!(SignalType::from_proto_i32(10).is_none());
    assert!(SignalType::from_proto_i32(-1).is_none());
    assert!(SignalType::from_proto_i32(100).is_none());
}

#[test]
fn signal_type_db_roundtrip() {
    let types = [
        SignalType::Velocity,
        SignalType::GeoMismatch,
        SignalType::DeviceFingerprint,
        SignalType::ShillBid,
        SignalType::AccountTakeover,
        SignalType::PaymentFraud,
        SignalType::FakeReview,
        SignalType::MultiAccount,
        SignalType::BotBehavior,
    ];

    for signal_type in &types {
        let db_type = signal_type.as_db_str();
        let subtype = signal_type.as_subtype_str();
        let parsed = SignalType::from_db_str(db_type, subtype);

        // The round-trip might not be exact (db types are broader), but
        // it should always produce a valid SignalType.
        assert_eq!(parsed.to_proto_i32() > 0, true, "Invalid proto for {signal_type:?}");
    }
}

#[test]
fn signal_type_db_str_mapping() {
    assert_eq!(SignalType::Velocity.as_db_str(), "bad_actor_behavior");
    assert_eq!(SignalType::GeoMismatch.as_db_str(), "account_fraud");
    assert_eq!(SignalType::ShillBid.as_db_str(), "bid_manipulation");
    assert_eq!(SignalType::PaymentFraud.as_db_str(), "transaction_fraud");
    assert_eq!(SignalType::FakeReview.as_db_str(), "review_manipulation");
    assert_eq!(SignalType::BotBehavior.as_db_str(), "bad_actor_behavior");
}

// ---------------------------------------------------------------------------
// Risk level scoring
// ---------------------------------------------------------------------------

#[test]
fn risk_level_from_score_ranges() {
    assert_eq!(RiskLevel::from_score(0.0), RiskLevel::Low);
    assert_eq!(RiskLevel::from_score(0.2), RiskLevel::Low);
    assert_eq!(RiskLevel::from_score(0.3), RiskLevel::Low);
    assert_eq!(RiskLevel::from_score(0.31), RiskLevel::Medium);
    assert_eq!(RiskLevel::from_score(0.5), RiskLevel::Medium);
    assert_eq!(RiskLevel::from_score(0.6), RiskLevel::Medium);
    assert_eq!(RiskLevel::from_score(0.61), RiskLevel::High);
    assert_eq!(RiskLevel::from_score(0.8), RiskLevel::High);
    assert_eq!(RiskLevel::from_score(0.81), RiskLevel::Critical);
    assert_eq!(RiskLevel::from_score(1.0), RiskLevel::Critical);
}

#[test]
fn risk_level_db_severity_mapping() {
    assert_eq!(RiskLevel::Low.as_db_severity(), "low");
    assert_eq!(RiskLevel::Medium.as_db_severity(), "medium");
    assert_eq!(RiskLevel::High.as_db_severity(), "high");
    assert_eq!(RiskLevel::Critical.as_db_severity(), "high"); // Critical maps to "high" in DB.
}

#[test]
fn risk_level_from_db_severity() {
    assert_eq!(RiskLevel::from_db_severity("low"), RiskLevel::Low);
    assert_eq!(RiskLevel::from_db_severity("medium"), RiskLevel::Medium);
    assert_eq!(RiskLevel::from_db_severity("high"), RiskLevel::High);
    assert_eq!(RiskLevel::from_db_severity("unknown"), RiskLevel::Low);
}

#[test]
fn risk_level_proto_values() {
    assert_eq!(RiskLevel::Low.to_proto_i32(), 1);
    assert_eq!(RiskLevel::Medium.to_proto_i32(), 2);
    assert_eq!(RiskLevel::High.to_proto_i32(), 3);
    assert_eq!(RiskLevel::Critical.to_proto_i32(), 4);
}

// ---------------------------------------------------------------------------
// Fraud decision
// ---------------------------------------------------------------------------

#[test]
fn fraud_decision_from_risk_level() {
    assert_eq!(FraudDecision::from_risk_level(RiskLevel::Low), FraudDecision::Allow);
    assert_eq!(FraudDecision::from_risk_level(RiskLevel::Medium), FraudDecision::AllowWithReview);
    assert_eq!(FraudDecision::from_risk_level(RiskLevel::High), FraudDecision::Challenge);
    assert_eq!(FraudDecision::from_risk_level(RiskLevel::Critical), FraudDecision::Block);
}

#[test]
fn fraud_decision_proto_values() {
    assert_eq!(FraudDecision::Allow.to_proto_i32(), 1);
    assert_eq!(FraudDecision::AllowWithReview.to_proto_i32(), 2);
    assert_eq!(FraudDecision::Challenge.to_proto_i32(), 3);
    assert_eq!(FraudDecision::Block.to_proto_i32(), 4);
}

// ---------------------------------------------------------------------------
// CheckResult
// ---------------------------------------------------------------------------

#[test]
fn check_result_from_score_low() {
    let result = CheckResult::from_score(0.1);
    assert_eq!(result.risk_level, RiskLevel::Low);
    assert_eq!(result.decision, FraudDecision::Allow);
    assert!((result.risk_score - 0.1).abs() < f64::EPSILON);
    assert!(result.reasons.is_empty());
    assert!(!result.shill_bid_detected);
}

#[test]
fn check_result_from_score_critical() {
    let result = CheckResult::from_score(0.95);
    assert_eq!(result.risk_level, RiskLevel::Critical);
    assert_eq!(result.decision, FraudDecision::Block);
}

#[test]
fn check_result_full_range() {
    // Verify scoring at boundaries.
    for score in [0.0, 0.3, 0.31, 0.6, 0.61, 0.8, 0.81, 1.0] {
        let result = CheckResult::from_score(score);
        assert!((result.risk_score - score).abs() < f64::EPSILON);
        // Decision should be consistent with risk level.
        assert_eq!(
            result.decision,
            FraudDecision::from_risk_level(result.risk_level)
        );
    }
}

// ---------------------------------------------------------------------------
// Admin alert listing (model-level)
// ---------------------------------------------------------------------------

#[test]
fn fraud_signal_row_construction() {
    let signal = FraudSignalRow {
        id: Uuid::now_v7(),
        user_id: Uuid::now_v7(),
        signal_type: "account_fraud".into(),
        signal_subtype: "multi_account".into(),
        severity: "high".into(),
        confidence: 0.85,
        description: "Multiple accounts from same IP".into(),
        evidence_json: Some(serde_json::json!({"ip": "192.168.1.1"})),
        related_entity_id: None,
        related_entity_type: None,
        status: "pending".into(),
        auto_actioned: false,
        auto_action: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    assert_eq!(signal.signal_type, "account_fraud");
    assert_eq!(signal.severity, "high");
    assert!((signal.confidence - 0.85).abs() < f64::EPSILON);
    assert!(signal.evidence_json.is_some());
}

#[test]
fn fraud_signal_serde_roundtrip() {
    let signal = FraudSignalRow {
        id: Uuid::now_v7(),
        user_id: Uuid::now_v7(),
        signal_type: "bid_manipulation".into(),
        signal_subtype: "shill_bid".into(),
        severity: "medium".into(),
        confidence: 0.72,
        description: "Suspicious bidding pattern".into(),
        evidence_json: None,
        related_entity_id: Some(Uuid::now_v7()),
        related_entity_type: Some("bid".into()),
        status: "pending".into(),
        auto_actioned: true,
        auto_action: Some("flag_for_review".into()),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    let json = serde_json::to_string(&signal).expect("serialize");
    let parsed: FraudSignalRow = serde_json::from_str(&json).expect("deserialize");

    assert_eq!(parsed.signal_type, "bid_manipulation");
    assert_eq!(parsed.signal_subtype, "shill_bid");
    assert!(parsed.auto_actioned);
}

// ---------------------------------------------------------------------------
// FraudError display
// ---------------------------------------------------------------------------

#[test]
fn fraud_error_display_messages() {
    let err = FraudError::InvalidArgument("bad input".into());
    assert!(err.to_string().contains("bad input"));

    let err = FraudError::UserNotFound("user-123".into());
    assert!(err.to_string().contains("user-123"));

    let err = FraudError::SignalNotFound("sig-456".into());
    assert!(err.to_string().contains("sig-456"));
}
