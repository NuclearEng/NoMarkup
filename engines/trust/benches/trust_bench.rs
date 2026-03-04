use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};

use nomarkup_trust_engine::models::DimensionScores;
use nomarkup_trust_engine::scoring::{
    composite_score, compute_feedback_score, compute_fraud_score, compute_risk_score,
    compute_volume_score, decay_weight, recency_weighted_average, DecayConfig, FeedbackInput,
    FraudInput, ReviewDataPoint, RiskInput, ScoreTier, VolumeInput,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Generate N review data points with varying ages.
fn make_reviews(n: usize) -> Vec<ReviewDataPoint> {
    (0..n)
        .map(|i| ReviewDataPoint {
            rating: 1.0 + (i % 5) as f64, // Ratings 1-5 cycling.
            age_days: i as f64 * 7.0,      // One review per week.
        })
        .collect()
}

/// Build a FeedbackInput for a provider with `n` reviews.
fn make_feedback_input(n: i32) -> FeedbackInput {
    let avg = if n > 0 { 4.2 } else { 0.0 };
    FeedbackInput {
        average_rating: avg,
        weighted_average_rating: if n > 0 { Some(4.3) } else { None },
        total_reviews: n,
        five_star_count: (n as f64 * 0.6) as i32,
        one_star_count: (n as f64 * 0.05) as i32,
        rating_trend: 0.1,
        disputes_lost: (n as f64 * 0.02) as i32,
    }
}

/// Build a VolumeInput representing different activity levels.
fn make_volume_input(completed: i64) -> VolumeInput {
    VolumeInput {
        total_completed: completed,
        recent_completed: (completed as f64 * 0.3) as i64,
        repeat_customers: (completed as f64 * 0.15) as i64,
        completion_rate: 0.92,
        avg_response_time_hours: 2.5,
    }
}

/// Build a RiskInput representing different risk levels.
fn make_risk_input(contracts: i64, cancellations: i64, disputes: i64) -> RiskInput {
    RiskInput {
        total_contracts: contracts,
        cancellations,
        disputes_against: disputes,
        no_shows: disputes / 3,
        late_deliveries: disputes / 2,
    }
}

// ---------------------------------------------------------------------------
// Benchmarks: Decay weight
// ---------------------------------------------------------------------------

fn bench_decay_weight(c: &mut Criterion) {
    let mut group = c.benchmark_group("decay_weight");
    let config = DecayConfig::default();

    group.bench_function("recent_review", |b| {
        b.iter(|| decay_weight(black_box(1.0), black_box(&config)));
    });

    group.bench_function("half_life_review", |b| {
        b.iter(|| decay_weight(black_box(180.0), black_box(&config)));
    });

    group.bench_function("very_old_review", |b| {
        b.iter(|| decay_weight(black_box(1000.0), black_box(&config)));
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: Recency-weighted average
// ---------------------------------------------------------------------------

fn bench_recency_weighted_average(c: &mut Criterion) {
    let mut group = c.benchmark_group("recency_weighted_average");
    let config = DecayConfig::default();

    for review_count in [5, 20, 50, 100, 500] {
        let reviews = make_reviews(review_count);
        group.bench_with_input(
            BenchmarkId::from_parameter(review_count),
            &reviews,
            |b, reviews| {
                b.iter(|| recency_weighted_average(black_box(reviews), black_box(&config)));
            },
        );
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: Feedback score
// ---------------------------------------------------------------------------

fn bench_compute_feedback_score(c: &mut Criterion) {
    let mut group = c.benchmark_group("compute_feedback_score");

    group.bench_function("no_reviews", |b| {
        let input = make_feedback_input(0);
        b.iter(|| compute_feedback_score(black_box(&input)));
    });

    group.bench_function("few_reviews", |b| {
        let input = make_feedback_input(5);
        b.iter(|| compute_feedback_score(black_box(&input)));
    });

    group.bench_function("moderate_reviews", |b| {
        let input = make_feedback_input(50);
        b.iter(|| compute_feedback_score(black_box(&input)));
    });

    group.bench_function("many_reviews", |b| {
        let input = make_feedback_input(500);
        b.iter(|| compute_feedback_score(black_box(&input)));
    });

    // Edge case: high dispute ratio.
    group.bench_function("high_disputes", |b| {
        let input = FeedbackInput {
            average_rating: 3.0,
            weighted_average_rating: Some(2.8),
            total_reviews: 20,
            five_star_count: 4,
            one_star_count: 8, // 40% one-star — triggers distribution penalty.
            rating_trend: -0.5,
            disputes_lost: 5,
        };
        b.iter(|| compute_feedback_score(black_box(&input)));
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: Volume score
// ---------------------------------------------------------------------------

fn bench_compute_volume_score(c: &mut Criterion) {
    let mut group = c.benchmark_group("compute_volume_score");

    for completed in [0, 5, 25, 50, 100] {
        let input = make_volume_input(completed);
        group.bench_with_input(
            BenchmarkId::from_parameter(completed),
            &input,
            |b, input| {
                b.iter(|| compute_volume_score(black_box(input)));
            },
        );
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: Risk score
// ---------------------------------------------------------------------------

fn bench_compute_risk_score(c: &mut Criterion) {
    let mut group = c.benchmark_group("compute_risk_score");

    group.bench_function("clean_user", |b| {
        let input = make_risk_input(50, 0, 0);
        b.iter(|| compute_risk_score(black_box(&input)));
    });

    group.bench_function("moderate_risk", |b| {
        let input = make_risk_input(50, 3, 2);
        b.iter(|| compute_risk_score(black_box(&input)));
    });

    group.bench_function("high_risk", |b| {
        let input = make_risk_input(20, 8, 5);
        b.iter(|| compute_risk_score(black_box(&input)));
    });

    group.bench_function("no_history", |b| {
        let input = make_risk_input(0, 0, 0);
        b.iter(|| compute_risk_score(black_box(&input)));
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: Fraud score
// ---------------------------------------------------------------------------

fn bench_compute_fraud_score(c: &mut Criterion) {
    let mut group = c.benchmark_group("compute_fraud_score");

    group.bench_function("clean", |b| {
        let input = FraudInput {
            total_signals: 0,
            active_flags: 0,
        };
        b.iter(|| compute_fraud_score(black_box(&input)));
    });

    group.bench_function("some_signals", |b| {
        let input = FraudInput {
            total_signals: 3,
            active_flags: 0,
        };
        b.iter(|| compute_fraud_score(black_box(&input)));
    });

    group.bench_function("active_flags", |b| {
        let input = FraudInput {
            total_signals: 5,
            active_flags: 2,
        };
        b.iter(|| compute_fraud_score(black_box(&input)));
    });

    group.bench_function("max_signals", |b| {
        let input = FraudInput {
            total_signals: 10,
            active_flags: 5,
        };
        b.iter(|| compute_fraud_score(black_box(&input)));
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: Composite score
// ---------------------------------------------------------------------------

fn bench_composite_score(c: &mut Criterion) {
    let mut group = c.benchmark_group("composite_score");

    group.bench_function("all_perfect", |b| {
        b.iter(|| {
            composite_score(
                black_box(1.0),
                black_box(1.0),
                black_box(1.0),
                black_box(1.0),
            )
        });
    });

    group.bench_function("all_zero", |b| {
        b.iter(|| {
            composite_score(
                black_box(0.0),
                black_box(0.0),
                black_box(0.0),
                black_box(0.0),
            )
        });
    });

    group.bench_function("typical_good_provider", |b| {
        b.iter(|| {
            composite_score(
                black_box(0.85),
                black_box(0.70),
                black_box(0.95),
                black_box(1.0),
            )
        });
    });

    group.bench_function("mixed_scores", |b| {
        b.iter(|| {
            composite_score(
                black_box(0.6),
                black_box(0.3),
                black_box(0.8),
                black_box(0.5),
            )
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: DimensionScores::overall()
// ---------------------------------------------------------------------------

fn bench_dimension_scores_overall(c: &mut Criterion) {
    let mut group = c.benchmark_group("dimension_scores_overall");

    let scores = DimensionScores {
        feedback: 0.85,
        volume: 0.70,
        risk: 0.95,
        fraud: 1.0,
    };

    group.bench_function("compute", |b| {
        b.iter(|| black_box(&scores).overall());
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: ScoreTier determination
// ---------------------------------------------------------------------------

fn bench_score_tier(c: &mut Criterion) {
    let mut group = c.benchmark_group("score_tier");

    group.bench_function("from_score", |b| {
        b.iter(|| ScoreTier::from_score(black_box(0.72)));
    });

    group.bench_function("from_score_100", |b| {
        b.iter(|| ScoreTier::from_score_100(black_box(72.0)));
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: Full pipeline (all dimensions -> composite -> tier)
// ---------------------------------------------------------------------------

fn bench_full_scoring_pipeline(c: &mut Criterion) {
    let mut group = c.benchmark_group("full_scoring_pipeline");
    group.measurement_time(std::time::Duration::from_secs(10));

    // Build all inputs.
    let feedback_input = make_feedback_input(50);
    let volume_input = make_volume_input(30);
    let risk_input = make_risk_input(50, 2, 1);
    let fraud_input = FraudInput {
        total_signals: 1,
        active_flags: 0,
    };

    group.bench_function("complete_computation", |b| {
        b.iter(|| {
            // Compute each dimension.
            let fb = compute_feedback_score(black_box(&feedback_input));
            let vol = compute_volume_score(black_box(&volume_input));
            let risk = compute_risk_score(black_box(&risk_input));
            let fraud = compute_fraud_score(black_box(&fraud_input));

            // Compute composite.
            let overall = composite_score(
                black_box(fb),
                black_box(vol),
                black_box(risk),
                black_box(fraud),
            );

            // Determine tier.
            let tier = ScoreTier::from_score(black_box(overall));

            black_box(tier)
        });
    });

    // Also benchmark with recency-weighted review averaging included.
    let reviews = make_reviews(100);
    let config = DecayConfig::default();

    group.bench_function("with_review_averaging", |b| {
        b.iter(|| {
            // Step 1: Compute weighted average from reviews.
            let weighted_avg = recency_weighted_average(black_box(&reviews), black_box(&config));

            // Step 2: Build feedback input with weighted average.
            let fb_input = FeedbackInput {
                average_rating: 4.2,
                weighted_average_rating: weighted_avg,
                total_reviews: reviews.len() as i32,
                five_star_count: 60,
                one_star_count: 5,
                rating_trend: 0.1,
                disputes_lost: 1,
            };

            // Step 3: Compute all dimensions.
            let fb = compute_feedback_score(black_box(&fb_input));
            let vol = compute_volume_score(black_box(&volume_input));
            let risk = compute_risk_score(black_box(&risk_input));
            let fraud = compute_fraud_score(black_box(&fraud_input));

            // Step 4: Composite + tier.
            let overall = composite_score(
                black_box(fb),
                black_box(vol),
                black_box(risk),
                black_box(fraud),
            );

            black_box(ScoreTier::from_score(overall))
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Criterion harness
// ---------------------------------------------------------------------------

criterion_group!(
    benches,
    bench_decay_weight,
    bench_recency_weighted_average,
    bench_compute_feedback_score,
    bench_compute_volume_score,
    bench_compute_risk_score,
    bench_compute_fraud_score,
    bench_composite_score,
    bench_dimension_scores_overall,
    bench_score_tier,
    bench_full_scoring_pipeline,
);
criterion_main!(benches);
