//! Property-based invariants — the guardrails that must hold for EVERY input.

use pricing::model::{fair_price, Query, Side, Txn};
use proptest::prelude::*;

const AS_OF: i64 = 1_750_000_000;

fn query_zip(zip: &str) -> Query {
    Query {
        category_id: "cat".to_string(),
        parent_category_id: "par".to_string(),
        zip: zip.to_string(),
        market_id: "mkt".to_string(),
        as_of: AS_OF,
        side: Side::Service,
        want_instant: None,
        want_condition: None,
        want_trust_tier_min: None,
    }
}

prop_compose! {
    fn arb_txn()(
        price in 100i64..10_000_000,
        age_days in 0i64..500,
        tier in 0u32..5,
        zipsel in 0u32..3, // 0,1 → target zip "A"; 2 → "B" (parent-only)
    ) -> Txn {
        Txn {
            category_id: "cat".to_string(),
            parent_category_id: "par".to_string(),
            market_id: "mkt".to_string(),
            zip: (if zipsel < 2 { "A" } else { "B" }).to_string(),
            cleared_price_cents: price,
            settled_at: AS_OF - age_days * 86_400,
            trust_tier: tier,
            instant_match: false,
            condition: 4,
            side: Side::Service,
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 3000, ..ProptestConfig::default() })]

    #[test]
    fn invariants_hold(txns in prop::collection::vec(arb_txn(), 0..200)) {
        let q = query_zip("A");
        let fp = fair_price(&txns, &q);

        // 6. Empty input never panics; flagged has_data=false when nothing usable.
        if txns.is_empty() {
            prop_assert!(!fp.has_data);
        }

        if fp.has_data {
            // All txns match (cat/market), all in window → they're the candidate set.
            let min = txns.iter().map(|t| t.cleared_price_cents).min().unwrap();
            let max = txns.iter().map(|t| t.cleared_price_cents).max().unwrap();

            // 1. Bounded point estimate.
            prop_assert!(fp.price_cents >= min && fp.price_cents <= max,
                "price {} not in [{},{}]", fp.price_cents, min, max);
            // 2. Ordering.
            prop_assert!(fp.p25_cents <= fp.price_cents && fp.price_cents <= fp.p75_cents);
            prop_assert!(fp.ci_lo_cents <= fp.price_cents && fp.price_cents <= fp.ci_hi_cents);
            // 4. Positive, finite, well-formed.
            prop_assert!(fp.price_cents > 0 && fp.p25_cents > 0 && fp.p75_cents > 0);
            prop_assert!(fp.ci_lo_cents > 0 && fp.ci_hi_cents > 0);
            prop_assert!(fp.confidence.is_finite() && (0.0..=1.0).contains(&fp.confidence));
            prop_assert!(fp.n_eff.is_finite() && fp.n_eff >= 0.0);
            prop_assert!(fp.level_used < 6);
            // 5. Determinism.
            prop_assert_eq!(&fp, &fair_price(&txns, &q));
        }
    }

    // 3. Monotone confidence in sample size: adding identical (same price/age)
    //    transactions never decreases confidence.
    #[test]
    fn confidence_monotone_in_n(
        price in 1000i64..1_000_000,
        n in 1usize..40,
        extra in 1usize..40,
    ) {
        let mk = |count: usize| -> Vec<Txn> {
            (0..count).map(|_| Txn {
                category_id: "cat".into(), parent_category_id: "par".into(),
                market_id: "mkt".into(), zip: "A".into(),
                cleared_price_cents: price, settled_at: AS_OF - 10 * 86_400,
                trust_tier: 3, instant_match: false, condition: 4, side: Side::Service,
            }).collect()
        };
        let q = query_zip("A");
        let a = fair_price(&mk(n), &q);
        let b = fair_price(&mk(n + extra), &q);
        prop_assert!(b.confidence >= a.confidence - 1e-9,
            "confidence fell as n rose: {} -> {}", a.confidence, b.confidence);
    }
}

// 6. Empty input → NoData, no panic.
#[test]
fn empty_is_no_data() {
    let fp = fair_price(&[], &query_zip("A"));
    assert!(!fp.has_data);
    assert_eq!(fp.price_cents, 0);
}

// 7 + 8. Outlier robustness + trust non-amplification: a wash trade at an
// absurd price, especially at low trust, barely moves the estimate.
#[test]
fn outliers_and_low_trust_do_not_move_estimate() {
    let mk_clean = || -> Vec<Txn> {
        (0..30)
            .map(|i| Txn {
                category_id: "cat".into(),
                parent_category_id: "par".into(),
                market_id: "mkt".into(),
                zip: "A".into(),
                cleared_price_cents: 20_000 + (i % 10) * 500,
                settled_at: AS_OF - 20 * 86_400,
                trust_tier: 3,
                instant_match: false,
                condition: 4,
                side: Side::Service,
            })
            .collect()
    };
    let clean = fair_price(&mk_clean(), &query_zip("A"));

    // Add 3 low-trust wash trades at $5,000 (500_000 cents).
    let mut attacked = mk_clean();
    for _ in 0..3 {
        attacked.push(Txn {
            category_id: "cat".into(),
            parent_category_id: "par".into(),
            market_id: "mkt".into(),
            zip: "A".into(),
            cleared_price_cents: 500_000,
            settled_at: AS_OF - 1 * 86_400,
            trust_tier: 0,
            instant_match: false,
            condition: 4,
            side: Side::Service,
        });
    }
    let attacked_fp = fair_price(&attacked, &query_zip("A"));

    // The estimate must stay within the clean band — the attack is neutralized.
    assert!(
        attacked_fp.price_cents >= clean.p25_cents && attacked_fp.price_cents <= clean.p75_cents,
        "wash trades moved the estimate out of the clean band: {} vs [{},{}]",
        attacked_fp.price_cents,
        clean.p25_cents,
        clean.p75_cents
    );
}
