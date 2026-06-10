//! Criterion benchmark — the underwriting decision must be sub-millisecond
//! (the §8 numerical hot-path budget). It is a pure CPU function, so this is the
//! whole cost of a decision (the surrounding gRPC + feature-gather is I/O).

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use underwriting::model::{Features, underwrite};

fn elite_features() -> Features {
    Features {
        provider_id: "00000000-0000-0000-0000-000000000003".to_string(),
        trust_overall: 0.96,
        trust_feedback: 0.95,
        trust_fraud: 1.0,
        trust_tier: "top_rated".to_string(),
        trailing_30d_earnings_cents: 2_200_000,
        trailing_90d_earnings_cents: 6_000_000,
        trailing_365d_earnings_cents: 24_000_000,
        completed_jobs_90d: 40,
        active_months: 24,
        on_time_repayment_rate: 1.0,
        prior_advances_count: 6,
        dispute_rate_90d: 0.0,
        account_tenure_days: 900,
        outstanding_advance_cents: 0,
        as_of_unix: 1_750_000_000,
    }
}

fn bench_underwrite(c: &mut Criterion) {
    let f = elite_features();
    c.bench_function("underwrite_decision", |b| {
        b.iter(|| underwrite(black_box(&f)));
    });
}

criterion_group!(benches, bench_underwrite);
criterion_main!(benches);
