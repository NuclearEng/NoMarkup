//! The model-spec worked examples as regression fixtures. Gate/cap outcomes are
//! deterministic and asserted exactly; the mid-tier offer is asserted in a band
//! (its exact cents depend on the derived velocity ratio).

use underwriting::model::{Features, UnderwritingTier, underwrite};

fn base() -> Features {
    Features {
        provider_id: "p".to_string(),
        trust_overall: 0.5,
        trust_feedback: 0.5,
        trust_fraud: 1.0,
        trust_tier: "trusted".to_string(),
        trailing_30d_earnings_cents: 0,
        trailing_90d_earnings_cents: 0,
        trailing_365d_earnings_cents: 0,
        completed_jobs_90d: 0,
        active_months: 0,
        on_time_repayment_rate: 0.5,
        prior_advances_count: 0,
        dispute_rate_90d: 0.0,
        account_tenure_days: 0,
        outstanding_advance_cents: 0,
        as_of_unix: 1_750_000_000,
    }
}

// Example A — new / thin-file → DECLINED on the tier gate.
#[test]
fn example_a_new_thin_file_declined() {
    let f = Features {
        trust_tier: "new".to_string(),
        trust_overall: 0.40,
        trust_fraud: 0.90,
        account_tenure_days: 20,
        active_months: 1,
        trailing_30d_earnings_cents: 30_000,
        trailing_90d_earnings_cents: 70_000,
        trailing_365d_earnings_cents: 70_000,
        ..base()
    };
    let d = underwrite(&f);
    assert!(!d.approved);
    assert_eq!(d.max_credit_cents, 0);
    assert_eq!(d.available_credit_cents, 0);
    assert_eq!(d.tier, UnderwritingTier::Ineligible);
    assert!(
        d.binding_gate.starts_with("TIER"),
        "gate was {}",
        d.binding_gate
    );
    assert_eq!(d.fee_bps, 0);
}

// Example B — rising / mid → APPROVED, small offer in the low-thousands.
#[test]
fn example_b_rising_mid_limited_offer() {
    let f = Features {
        trust_tier: "rising".to_string(),
        trust_overall: 0.70,
        trust_feedback: 0.72,
        trust_fraud: 0.95,
        on_time_repayment_rate: 0.90,
        prior_advances_count: 2,
        dispute_rate_90d: 0.02,
        account_tenure_days: 240,
        active_months: 8,
        trailing_30d_earnings_cents: 200_000,
        trailing_90d_earnings_cents: 540_000,
        trailing_365d_earnings_cents: 2_000_000,
        ..base()
    };
    let d = underwrite(&f);
    assert!(d.approved, "should be approved: {d:?}");
    // ~ $1,500–$2,500 (risk-adjusted earnings multiple, not a cap).
    assert!(
        (150_000..=250_000).contains(&d.max_credit_cents),
        "limit {} out of expected band",
        d.max_credit_cents
    );
    assert_eq!(d.binding_cap, "risk_multiple");
    assert_eq!(d.available_credit_cents, d.max_credit_cents); // no outstanding
    assert!((600..=1800).contains(&d.fee_bps));
    assert!(d.risk_score < 0.15 && d.risk_score > 0.0);
    assert!((8..=20).contains(&d.holdback_pct));
}

// Example C — top-rated / high-velocity → APPROVED at the absolute cap.
#[test]
fn example_c_top_rated_hits_absolute_cap() {
    let f = Features {
        trust_tier: "top_rated".to_string(),
        trust_overall: 0.96,
        trust_feedback: 0.95,
        trust_fraud: 1.0,
        on_time_repayment_rate: 1.0,
        prior_advances_count: 6,
        dispute_rate_90d: 0.0,
        account_tenure_days: 900,
        active_months: 24,
        trailing_30d_earnings_cents: 2_200_000,
        trailing_90d_earnings_cents: 6_000_000,
        trailing_365d_earnings_cents: 24_000_000,
        ..base()
    };
    let d = underwrite(&f);
    assert!(d.approved);
    assert_eq!(d.max_credit_cents, 2_500_000); // $25k absolute cap binds
    assert_eq!(d.binding_cap, "absolute_max");
    assert_eq!(d.tier, UnderwritingTier::Elite);
    // Pristine provider → near the fee floor.
    assert!(
        d.fee_bps <= 800,
        "fee {} should be near the floor",
        d.fee_bps
    );
    assert!(d.risk_score < 0.05);
}

// Example D — risky / disputed → DECLINED on the dispute gate.
#[test]
fn example_d_disputed_declined() {
    let f = Features {
        trust_tier: "trusted".to_string(),
        trust_overall: 0.65,
        trust_fraud: 0.80,
        on_time_repayment_rate: 0.60,
        prior_advances_count: 3,
        dispute_rate_90d: 0.14,
        account_tenure_days: 400,
        active_months: 10,
        trailing_365d_earnings_cents: 3_000_000,
        ..base()
    };
    let d = underwrite(&f);
    assert!(!d.approved);
    assert_eq!(d.max_credit_cents, 0);
    assert!(
        d.binding_gate.starts_with("DISPUTE"),
        "gate was {}",
        d.binding_gate
    );
}

// Outstanding reduces available credit but not the limit.
#[test]
fn outstanding_reduces_available_not_limit() {
    let f = Features {
        trust_tier: "top_rated".to_string(),
        trust_overall: 0.96,
        trust_fraud: 1.0,
        on_time_repayment_rate: 1.0,
        prior_advances_count: 6,
        account_tenure_days: 900,
        active_months: 24,
        trailing_30d_earnings_cents: 2_200_000,
        trailing_90d_earnings_cents: 6_000_000,
        trailing_365d_earnings_cents: 24_000_000,
        outstanding_advance_cents: 1_000_000,
        ..base()
    };
    let d = underwrite(&f);
    assert_eq!(d.max_credit_cents, 2_500_000);
    assert_eq!(d.available_credit_cents, 1_500_000); // 2.5m - 1.0m
}

// Determinism: same input → byte-identical output incl. the tamper hash.
#[test]
fn deterministic_including_hash() {
    let f = base();
    let a = underwrite(&f);
    let b = underwrite(&f);
    assert_eq!(a, b);
    assert!(!a.decision_hash.is_empty());
    assert_eq!(a.decision_hash.len(), 64); // sha-256 hex
}

// Tamper-evidence: changing any feature changes the hash.
#[test]
fn hash_changes_on_input_change() {
    let f = base();
    let mut g = f.clone();
    g.trust_overall = 0.99;
    assert_ne!(underwrite(&f).decision_hash, underwrite(&g).decision_hash);
}
