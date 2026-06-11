//! Criterion benchmark — a fair-price estimate over a realistic candidate set
//! must be sub-millisecond (one O(n log n) sort dominates).

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use pricing::model::{Query, Side, Txn, fair_price};

fn txn(price: i64, age_days: i64, zip: &str, tier: u32) -> Txn {
    Txn {
        category_id: "cat-cleaning".to_string(),
        parent_category_id: "cat-home".to_string(),
        market_id: "mkt-austin".to_string(),
        zip: zip.to_string(),
        cleared_price_cents: price,
        settled_at: 1_750_000_000 - age_days * 86_400,
        trust_tier: tier,
        instant_match: false,
        condition: 4,
        side: Side::Service,
    }
}

fn corpus() -> Vec<Txn> {
    // ~300 txns across the metro, ~60 in the target ZIP.
    let mut v = Vec::with_capacity(300);
    for i in 0u32..300 {
        let zip = if i % 5 == 0 { "78701" } else { "78704" };
        let price = 11_000 + i64::from(i % 50) * 120;
        v.push(txn(price, i64::from(i % 200), zip, 2 + (i % 3)));
    }
    v
}

fn query() -> Query {
    Query {
        category_id: "cat-cleaning".to_string(),
        parent_category_id: "cat-home".to_string(),
        zip: "78701".to_string(),
        market_id: "mkt-austin".to_string(),
        as_of: 1_750_000_000,
        side: Side::Service,
        want_instant: None,
        want_condition: None,
        want_trust_tier_min: None,
    }
}

fn bench_fair_price(c: &mut Criterion) {
    let txns = corpus();
    let q = query();
    c.bench_function("fair_price_300txn", |b| {
        b.iter(|| fair_price(black_box(&txns), black_box(&q)));
    });
}

criterion_group!(benches, bench_fair_price);
criterion_main!(benches);
