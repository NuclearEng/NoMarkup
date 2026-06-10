//! Spec worked examples as regression fixtures.

use pricing::model::{Query, Side, Txn, fair_price};

const AS_OF: i64 = 1_750_000_000;

fn t(price: i64, age_days: i64, zip: &str, tier: u32) -> Txn {
    Txn {
        category_id: "cleaning".into(),
        parent_category_id: "home".into(),
        market_id: "austin".into(),
        zip: zip.into(),
        cleared_price_cents: price,
        settled_at: AS_OF - age_days * 86_400,
        trust_tier: tier,
        instant_match: false,
        condition: 4,
        side: Side::Service,
    }
}

fn q(zip: &str) -> Query {
    Query {
        category_id: "cleaning".into(),
        parent_category_id: "home".into(),
        zip: zip.into(),
        market_id: "austin".into(),
        as_of: AS_OF,
        side: Side::Service,
        want_instant: None,
        want_condition: None,
        want_trust_tier_min: None,
    }
}

// Ex 1 — dense / stable zip cell → tight estimate, level 0, decent confidence.
#[test]
fn dense_stable_cell() {
    let mut txns = Vec::new();
    for i in 0..60 {
        // prices clustered ~$110–$160 in the target ZIP, recent, trusted.
        txns.push(t(
            11_000 + (i % 50) * 100,
            i % 90,
            "78701",
            2 + (i % 3) as u32,
        ));
    }
    let fp = fair_price(&txns, &q("78701"));
    assert!(fp.has_data);
    assert_eq!(fp.level_used, 0, "should use the local zip cell");
    assert!(
        (11_000..=16_000).contains(&fp.price_cents),
        "price {} outside expected cluster",
        fp.price_cents
    );
    assert!(fp.p25_cents <= fp.price_cents && fp.price_cents <= fp.p75_cents);
    assert!(fp.n_eff > 20.0, "n_eff {} too low for 60 txns", fp.n_eff);
}

// Ex 2 — sparse local cell → shrinks toward the metro parent, LOW confidence.
#[test]
fn sparse_cell_shrinks_to_parent() {
    let mut txns = Vec::new();
    // 200 metro txns (other ZIPs) clustered ~$150.
    for i in 0..200 {
        txns.push(t(14_000 + (i % 20) * 100, i % 120, "78704", 3));
    }
    // 2 wildly-disagreeing txns in the target ZIP.
    txns.push(t(9_000, 5, "78701", 3));
    txns.push(t(25_000, 5, "78701", 3));

    let fp = fair_price(&txns, &q("78701"));
    assert!(fp.has_data);
    assert_eq!(
        fp.level_used, 0,
        "local cell exists (2 txns) so level 0 is used"
    );
    // With n_eff≈2, B≈0.2 → estimate leans hard on the ~$150 metro parent.
    assert!(
        (13_000..=17_000).contains(&fp.price_cents),
        "sparse estimate {} should sit near the metro parent (~$150)",
        fp.price_cents
    );
    assert!(
        fp.confidence < 0.33,
        "thin cell should be LOW confidence, got {}",
        fp.confidence
    );
    assert_eq!(fp.confidence_label, "low");
}

// Geo fallback — empty local ZIP cell uses the metro (level 1).
#[test]
fn empty_local_falls_back_to_metro() {
    let mut txns = Vec::new();
    for i in 0..50 {
        txns.push(t(14_000 + (i % 20) * 100, i % 100, "78704", 3));
    }
    // Query a ZIP with no local txns.
    let fp = fair_price(&txns, &q("99999"));
    assert!(fp.has_data, "should fall back to the metro cell");
    assert_eq!(
        fp.level_used, 1,
        "level 1 (market × category) supplies the estimate"
    );
    assert!((13_000..=17_000).contains(&fp.price_cents));
}

// Ex 5 — trending: recency decay pulls the estimate toward recent prices.
#[test]
fn trend_tracks_recent_prices() {
    let mut txns = Vec::new();
    // Old cheap prices (~$60, ~1y ago) and recent expensive (~$120, last month).
    for i in 0..20 {
        txns.push(t(6_000 + (i % 5) * 100, 330 + i % 20, "78701", 3)); // old, cheap
    }
    for i in 0..20 {
        txns.push(t(12_000 + (i % 5) * 100, 5 + i % 20, "78701", 3)); // recent, pricey
    }
    let fp = fair_price(&txns, &q("78701"));
    assert!(fp.has_data);
    // Half-life decay weights the recent $120 cohort far more than the year-old
    // $60 cohort → estimate pulled well above the naive midpoint (~$90).
    assert!(
        fp.price_cents > 10_000,
        "recency decay should pull toward recent prices, got {}",
        fp.price_cents
    );
}

// Determinism incl. label.
#[test]
fn deterministic() {
    let txns: Vec<Txn> = (0..40)
        .map(|i| t(15_000 + (i % 10) * 200, i % 80, "78701", 3))
        .collect();
    let a = fair_price(&txns, &q("78701"));
    let b = fair_price(&txns, &q("78701"));
    assert_eq!(a, b);
    assert_eq!(a.model_version, "fpi-v1.0.0");
}
