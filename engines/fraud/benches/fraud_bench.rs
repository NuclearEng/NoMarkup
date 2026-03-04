use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};

use std::collections::HashMap;

use chrono::{Duration, Utc};
use uuid::Uuid;

use nomarkup_fraud_engine::behavioral::{
    compute_composite_risk, score_bid_patterns, score_fingerprint, score_ip_geolocation,
    BidRecord, FingerprintAttributes, IpSessionRecord, RiskThresholds, SessionInfo,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a realistic-looking browser fingerprint.
fn make_normal_fingerprint() -> FingerprintAttributes {
    FingerprintAttributes {
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".into(),
        canvas_hash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6".into(),
        webgl_renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)".into(),
        plugin_count: 3,
        font_count: 150,
        screen_resolution: (2560, 1440),
        timezone_offset: -480,
        do_not_track: false,
        hardware_concurrency: 10,
        device_memory_gb: 16,
        attribute_count: 250,
    }
}

/// Build a suspicious (bot-like) fingerprint.
fn make_suspicious_fingerprint() -> FingerprintAttributes {
    FingerprintAttributes {
        user_agent: "Mozilla/5.0 HeadlessChrome/90.0".into(),
        canvas_hash: "0000000000000000".into(),
        webgl_renderer: "SwiftShader".into(),
        plugin_count: 0,
        font_count: 0,
        screen_resolution: (800, 600),
        timezone_offset: 0,
        do_not_track: true,
        hardware_concurrency: 1,
        device_memory_gb: 0,
        attribute_count: 12,
    }
}

/// Build N bid records spread across multiple jobs.
fn make_bid_records(n: usize, jobs: usize) -> Vec<BidRecord> {
    let provider_id = Uuid::now_v7();
    let job_ids: Vec<Uuid> = (0..jobs).map(|_| Uuid::now_v7()).collect();
    let now = Utc::now();

    (0..n)
        .map(|i| BidRecord {
            provider_id,
            job_id: job_ids[i % jobs],
            amount_cents: 10000 + (i as i64 * 100),
            placed_at: now - Duration::seconds((n - i) as i64 * 5),
            withdrawn: i % 5 == 0, // 20% withdrawal rate.
            ip_address: format!("192.168.1.{}", i % 256),
            device_fingerprint: format!("fp-{}", i % 3),
        })
        .collect()
}

/// Build customer ID mapping and session data for shill detection.
fn make_customer_context(
    bids: &[BidRecord],
) -> (
    HashMap<Uuid, Uuid>,
    HashMap<Uuid, Vec<SessionInfo>>,
) {
    let mut customer_ids: HashMap<Uuid, Uuid> = HashMap::new();
    let mut customer_sessions: HashMap<Uuid, Vec<SessionInfo>> = HashMap::new();

    for bid in bids {
        let customer_id = *customer_ids
            .entry(bid.job_id)
            .or_insert_with(Uuid::now_v7);

        customer_sessions.entry(customer_id).or_insert_with(|| {
            vec![SessionInfo {
                ip_address: "10.0.0.1".into(),
                device_fingerprint: "customer-fp".into(),
            }]
        });
    }

    (customer_ids, customer_sessions)
}

/// Build IP session records for N users.
fn make_ip_sessions(n: usize) -> Vec<IpSessionRecord> {
    (0..n)
        .map(|i| IpSessionRecord {
            user_id: Uuid::now_v7(),
            ip_address: format!("192.168.1.{}", i % 256),
            geo_lat: Some(37.7749 + (i as f64 * 0.01)),
            geo_lng: Some(-122.4194 + (i as f64 * 0.01)),
            geo_country: Some("US".into()),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Benchmarks: Fingerprint scoring
// ---------------------------------------------------------------------------

fn bench_score_fingerprint(c: &mut Criterion) {
    let mut group = c.benchmark_group("score_fingerprint");

    let normal_fp = make_normal_fingerprint();
    group.bench_function("normal_browser", |b| {
        b.iter(|| score_fingerprint(black_box(&normal_fp)));
    });

    let suspicious_fp = make_suspicious_fingerprint();
    group.bench_function("suspicious_browser", |b| {
        b.iter(|| score_fingerprint(black_box(&suspicious_fp)));
    });

    // Minimal fingerprint (empty fields).
    let minimal_fp = FingerprintAttributes {
        user_agent: String::new(),
        canvas_hash: String::new(),
        webgl_renderer: String::new(),
        plugin_count: 0,
        font_count: 0,
        screen_resolution: (0, 0),
        timezone_offset: 0,
        do_not_track: false,
        hardware_concurrency: 0,
        device_memory_gb: 0,
        attribute_count: 0,
    };
    group.bench_function("minimal_fingerprint", |b| {
        b.iter(|| score_fingerprint(black_box(&minimal_fp)));
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: Bid pattern analysis
// ---------------------------------------------------------------------------

fn bench_score_bid_patterns(c: &mut Criterion) {
    let mut group = c.benchmark_group("score_bid_patterns");
    group.sample_size(50);

    for (bid_count, job_count) in [(10, 3), (50, 10), (100, 20), (500, 50)] {
        let bids = make_bid_records(bid_count, job_count);
        let (customer_ids, customer_sessions) = make_customer_context(&bids);

        group.bench_with_input(
            BenchmarkId::new("bids_x_jobs", format!("{bid_count}x{job_count}")),
            &(bids, customer_ids, customer_sessions),
            |b, (bids, cids, csess)| {
                b.iter(|| {
                    score_bid_patterns(
                        black_box(bids),
                        black_box(cids),
                        black_box(csess),
                    )
                });
            },
        );
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: IP geolocation analysis
// ---------------------------------------------------------------------------

fn bench_score_ip_geolocation(c: &mut Criterion) {
    let mut group = c.benchmark_group("score_ip_geolocation");
    group.sample_size(50);

    let target_user_id = Uuid::now_v7();
    let target_ip = "192.168.1.42";

    for session_count in [10, 50, 100, 500] {
        let mut sessions = make_ip_sessions(session_count);
        // Add a session for the target user.
        sessions.push(IpSessionRecord {
            user_id: target_user_id,
            ip_address: target_ip.into(),
            geo_lat: Some(37.7749),
            geo_lng: Some(-122.4194),
            geo_country: Some("US".into()),
        });

        group.bench_with_input(
            BenchmarkId::from_parameter(session_count),
            &sessions,
            |b, sessions| {
                b.iter(|| {
                    score_ip_geolocation(
                        black_box(target_user_id),
                        black_box(target_ip),
                        black_box(sessions),
                        black_box(Some("US")),
                    )
                });
            },
        );
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: Composite risk scoring
// ---------------------------------------------------------------------------

fn bench_compute_composite_risk(c: &mut Criterion) {
    let mut group = c.benchmark_group("compute_composite_risk");

    let thresholds = RiskThresholds::default();

    group.bench_function("clean_user", |b| {
        b.iter(|| {
            compute_composite_risk(
                black_box(0.05),
                black_box(0.0),
                black_box(0.02),
                black_box(0.0),
                black_box(&thresholds),
            )
        });
    });

    group.bench_function("moderate_risk", |b| {
        b.iter(|| {
            compute_composite_risk(
                black_box(0.35),
                black_box(0.20),
                black_box(0.15),
                black_box(0.10),
                black_box(&thresholds),
            )
        });
    });

    group.bench_function("high_risk", |b| {
        b.iter(|| {
            compute_composite_risk(
                black_box(0.85),
                black_box(0.70),
                black_box(0.60),
                black_box(0.50),
                black_box(&thresholds),
            )
        });
    });

    group.bench_function("all_max", |b| {
        b.iter(|| {
            compute_composite_risk(
                black_box(1.0),
                black_box(1.0),
                black_box(1.0),
                black_box(1.0),
                black_box(&thresholds),
            )
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmarks: Full pipeline (fingerprint + bids + IP + composite)
// ---------------------------------------------------------------------------

fn bench_full_fraud_pipeline(c: &mut Criterion) {
    let mut group = c.benchmark_group("full_fraud_pipeline");
    group.sample_size(30);
    group.measurement_time(std::time::Duration::from_secs(10));

    // Prepare all the data up front.
    let fp = make_normal_fingerprint();
    let bids = make_bid_records(100, 20);
    let (customer_ids, customer_sessions) = make_customer_context(&bids);
    let target_user_id = Uuid::now_v7();
    let target_ip = "192.168.1.42";
    let ip_sessions = make_ip_sessions(100);
    let thresholds = RiskThresholds::default();

    group.bench_function("full_pipeline", |b| {
        b.iter(|| {
            // Step 1: Fingerprint scoring.
            let fp_score = score_fingerprint(black_box(&fp));

            // Step 2: Bid pattern analysis.
            let bid_result = score_bid_patterns(
                black_box(&bids),
                black_box(&customer_ids),
                black_box(&customer_sessions),
            );

            // Step 3: IP geolocation analysis.
            let ip_result = score_ip_geolocation(
                black_box(target_user_id),
                black_box(target_ip),
                black_box(&ip_sessions),
                black_box(Some("US")),
            );

            // Step 4: Composite risk score.
            let result = compute_composite_risk(
                black_box(fp_score),
                black_box(bid_result.score),
                black_box(ip_result.score),
                black_box(0.1), // Simulated historical score.
                black_box(&thresholds),
            );

            black_box(result.action)
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Criterion harness
// ---------------------------------------------------------------------------

criterion_group!(
    benches,
    bench_score_fingerprint,
    bench_score_bid_patterns,
    bench_score_ip_geolocation,
    bench_compute_composite_risk,
    bench_full_fraud_pipeline,
);
criterion_main!(benches);
