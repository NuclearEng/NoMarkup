//! Property-based invariants — the guardrails that must hold for EVERY input.
//! These are the security + fairness contract: no input (even adversarial /
//! out-of-range) can produce an out-of-bounds, non-monotonic, or non-
//! deterministic decision.

use proptest::prelude::*;
use underwriting::model::{Features, underwrite};

const CAP_ABS: i64 = 2_500_000;
const MIN_OFFER: i64 = 25_000;

const TIERS: [&str; 5] = ["new", "rising", "trusted", "top_rated", "under_review"];

prop_compose! {
    fn arb_features()(
        trust_overall in 0.0f64..=1.0,
        trust_feedback in 0.0f64..=1.0,
        trust_fraud in 0.0f64..=1.0,
        tier_idx in 0usize..5,
        t30 in 0i64..5_000_000,
        t90 in 0i64..15_000_000,
        t365 in 0i64..60_000_000,
        jobs90 in 0i32..500,
        active in 0i32..30,
        on_time in 0.0f64..=1.0,
        prior in 0i32..50,
        dispute in 0.0f64..=1.0,
        tenure in 0i32..2000,
        outstanding in 0i64..3_000_000,
    ) -> Features {
        Features {
            provider_id: "p".to_string(),
            trust_overall, trust_feedback, trust_fraud,
            trust_tier: TIERS[tier_idx].to_string(),
            trailing_30d_earnings_cents: t30,
            trailing_90d_earnings_cents: t90,
            trailing_365d_earnings_cents: t365,
            completed_jobs_90d: jobs90,
            active_months: active,
            on_time_repayment_rate: on_time,
            prior_advances_count: prior,
            dispute_rate_90d: dispute,
            account_tenure_days: tenure,
            outstanding_advance_cents: outstanding,
            as_of_unix: 1_750_000_000,
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 4000, ..ProptestConfig::default() })]

    #[test]
    fn invariants_hold(f in arb_features()) {
        let d = underwrite(&f);

        // 1. Bounded limit.
        prop_assert!(d.max_credit_cents >= 0 && d.max_credit_cents <= CAP_ABS);

        // 2. Revenue cap (≤ 35% of trailing-year).
        let cap_rev = (f.trailing_365d_earnings_cents.max(0)).saturating_mul(35) / 100;
        prop_assert!(d.max_credit_cents <= cap_rev);

        // 3. Available = max(limit - outstanding, 0), and ≥ 0.
        let expected_avail = (d.max_credit_cents - f.outstanding_advance_cents.max(0)).max(0);
        prop_assert_eq!(d.available_credit_cents, expected_avail);
        prop_assert!(d.available_credit_cents >= 0);

        // 4. PD bounded & finite.
        prop_assert!(d.risk_score.is_finite() && (0.0..=1.0).contains(&d.risk_score));

        // 5. Fee in band when approved; zeroed when not.
        if d.approved {
            prop_assert!((600..=1800).contains(&d.fee_bps));
            prop_assert!(d.factor_rate.is_finite() && d.factor_rate >= 1.06 && d.factor_rate <= 1.18);
            prop_assert!((8..=20).contains(&d.holdback_pct));
        } else {
            prop_assert_eq!(d.fee_bps, 0);
            prop_assert_eq!(d.max_credit_cents, 0);
        }

        // 8. Tier floor.
        if matches!(f.trust_tier.as_str(), "new" | "under_review") {
            prop_assert_eq!(d.max_credit_cents, 0);
        }
        // 9. Fraud gate.
        if f.trust_fraud < 0.5 {
            prop_assert_eq!(d.max_credit_cents, 0);
        }
        // 10. PD ceiling.
        if d.risk_score > 0.35 {
            prop_assert_eq!(d.max_credit_cents, 0);
        }
        // 11. Activity floor.
        if f.trailing_365d_earnings_cents.max(0) < 50_000 {
            prop_assert_eq!(d.max_credit_cents, 0);
        }
        // 7b. Dispute gate.
        if f.dispute_rate_90d > 0.10 {
            prop_assert_eq!(d.max_credit_cents, 0);
        }

        // 12. Min-offer floor: a positive limit is at least $250.
        if d.max_credit_cents > 0 {
            prop_assert!(d.max_credit_cents >= MIN_OFFER);
        }

        // 13. No negative money.
        prop_assert!(d.available_credit_cents >= 0);
        prop_assert!(d.holdback_pct >= 0 && d.fee_bps >= 0);

        // 14. Determinism (incl. hash).
        let d2 = underwrite(&f);
        prop_assert_eq!(&d, &d2);
        prop_assert_eq!(d.decision_hash.len(), 64);
    }

    // 6 / 16. Monotonic: more trust never raises risk and never lowers the limit.
    #[test]
    fn monotonic_in_trust(f in arb_features(), bump in 0.001f64..=0.5) {
        let mut g = f.clone();
        g.trust_overall = (f.trust_overall + bump).min(1.0);
        let a = underwrite(&f);
        let b = underwrite(&g);
        prop_assert!(b.risk_score <= a.risk_score + 1e-9, "pd rose with trust: {} -> {}", a.risk_score, b.risk_score);
        prop_assert!(b.max_credit_cents >= a.max_credit_cents, "limit fell with trust: {} -> {}", a.max_credit_cents, b.max_credit_cents);
    }

    // 7. Monotonic: more disputes never lowers risk; past 10% → zero limit.
    #[test]
    fn monotonic_in_dispute(f in arb_features(), bump in 0.001f64..=0.5) {
        let mut g = f.clone();
        g.dispute_rate_90d = (f.dispute_rate_90d + bump).min(1.0);
        let a = underwrite(&f);
        let b = underwrite(&g);
        prop_assert!(b.risk_score >= a.risk_score - 1e-9, "pd fell with disputes");
        if g.dispute_rate_90d > 0.10 {
            prop_assert_eq!(b.max_credit_cents, 0);
        }
    }

    // 15. Fee is non-decreasing in risk (compare two approved decisions where
    //     only repayment differs — worse repayment → higher pd → higher fee).
    #[test]
    fn fee_non_decreasing_in_risk(f in arb_features()) {
        let mut better = f.clone();
        better.on_time_repayment_rate = 1.0;
        better.prior_advances_count = f.prior_advances_count.max(5);
        let mut worse = f.clone();
        worse.on_time_repayment_rate = 0.0;
        worse.prior_advances_count = worse.prior_advances_count.max(5);
        let a = underwrite(&better);
        let b = underwrite(&worse);
        // worse repayment never produces a lower PD.
        prop_assert!(b.risk_score >= a.risk_score - 1e-9);
        if a.approved && b.approved {
            prop_assert!(b.fee_bps >= a.fee_bps, "fee fell as risk rose: {} -> {}", a.fee_bps, b.fee_bps);
        }
    }
}
