use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};

use chrono::Utc;
use uuid::Uuid;

use nomarkup_bidding_engine::engine::{is_offer_accepted, rank_bids, validate_bid_amount};
use nomarkup_bidding_engine::models::{Bid, BidUpdate};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a minimal `Bid` for benchmarking.
fn make_bid(amount_cents: i64, provider_id: Uuid, status: &str) -> Bid {
    let now = Utc::now();
    Bid {
        id: Uuid::now_v7(),
        job_id: Uuid::now_v7(),
        provider_id,
        amount_cents,
        is_offer_accepted: false,
        status: status.to_string(),
        original_amount_cents: amount_cents,
        bid_updates: serde_json::json!([]),
        awarded_at: None,
        withdrawn_at: None,
        created_at: now,
        updated_at: now,
    }
}

/// Generate a vector of N bids with random amounts.
fn make_bids(n: usize) -> Vec<Bid> {
    let provider = Uuid::now_v7();
    (0..n)
        .map(|i| {
            // Reverse order so sorting actually has work to do.
            let amount = ((n - i) as i64) * 100 + (i as i64 % 37);
            make_bid(amount, provider, "active")
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

fn bench_validate_bid_amount(c: &mut Criterion) {
    let mut group = c.benchmark_group("validate_bid_amount");

    group.bench_function("valid_amount", |b| {
        b.iter(|| validate_bid_amount(black_box(15000)));
    });

    group.bench_function("zero_amount", |b| {
        b.iter(|| validate_bid_amount(black_box(0)));
    });

    group.bench_function("negative_amount", |b| {
        b.iter(|| validate_bid_amount(black_box(-500)));
    });

    group.finish();
}

fn bench_rank_bids(c: &mut Criterion) {
    let mut group = c.benchmark_group("rank_bids");

    // Benchmark with different sizes to see scaling behavior.
    for size in [10, 50, 100, 500, 1000] {
        let bids = make_bids(size);
        group.bench_with_input(
            BenchmarkId::from_parameter(size),
            &bids,
            |b, bids| {
                b.iter(|| rank_bids(black_box(bids)));
            },
        );
    }

    group.finish();
}

fn bench_is_offer_accepted(c: &mut Criterion) {
    let mut group = c.benchmark_group("is_offer_accepted");

    group.bench_function("with_offer_below", |b| {
        b.iter(|| is_offer_accepted(black_box(Some(5000)), black_box(3000)));
    });

    group.bench_function("with_offer_at_threshold", |b| {
        b.iter(|| is_offer_accepted(black_box(Some(5000)), black_box(5000)));
    });

    group.bench_function("with_offer_above", |b| {
        b.iter(|| is_offer_accepted(black_box(Some(5000)), black_box(7000)));
    });

    group.bench_function("no_offer", |b| {
        b.iter(|| is_offer_accepted(black_box(None), black_box(5000)));
    });

    group.finish();
}

fn bench_bid_update_serialization(c: &mut Criterion) {
    let mut group = c.benchmark_group("bid_update_serde");

    let update = BidUpdate {
        amount_cents: 4200,
        updated_at: Utc::now(),
    };

    group.bench_function("serialize", |b| {
        b.iter(|| serde_json::to_value(black_box(&update)).unwrap());
    });

    let json_str = serde_json::to_string(&update).unwrap();
    group.bench_function("deserialize", |b| {
        b.iter(|| serde_json::from_str::<BidUpdate>(black_box(&json_str)).unwrap());
    });

    group.finish();
}

fn bench_bid_model_clone(c: &mut Criterion) {
    let mut group = c.benchmark_group("bid_clone");

    let bid = make_bid(15000, Uuid::now_v7(), "active");

    group.bench_function("single_bid", |b| {
        b.iter(|| black_box(&bid).clone());
    });

    let bids = make_bids(100);
    group.bench_function("100_bids", |b| {
        b.iter(|| black_box(&bids).clone());
    });

    group.finish();
}

fn bench_concurrent_bid_ranking(c: &mut Criterion) {
    let mut group = c.benchmark_group("concurrent_bid_ranking");
    group.sample_size(50);

    // Simulate the hot path: receive N bids, rank them all at once.
    for size in [100, 500, 1000] {
        let bids = make_bids(size);
        group.bench_with_input(
            BenchmarkId::new("rank_and_find_winner", size),
            &bids,
            |b, bids| {
                b.iter(|| {
                    let ranked = rank_bids(black_box(bids));
                    // Access winner (lowest bid) to prevent dead-code elimination.
                    black_box(ranked.first().map(|b| b.amount_cents))
                });
            },
        );
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Criterion harness
// ---------------------------------------------------------------------------

criterion_group!(
    benches,
    bench_validate_bid_amount,
    bench_rank_bids,
    bench_is_offer_accepted,
    bench_bid_update_serialization,
    bench_bid_model_clone,
    bench_concurrent_bid_ranking,
);
criterion_main!(benches);
