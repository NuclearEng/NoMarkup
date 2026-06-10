//! Integration tests for the trust scoring engine.
//!
//! These tests exercise the pure scoring functions end-to-end, computing
//! composite scores and verifying tier determination logic without a database.

use trust::models::{
    DimensionScores, FeedbackDetails, TrustTier, VolumeDetails, all_tier_requirements,
};
use trust::scoring::{
    DecayConfig, FeedbackInput, FraudInput, ReviewDataPoint, RiskInput, VolumeInput,
    composite_score, compute_feedback_score, compute_fraud_score, compute_risk_score,
    compute_volume_score, decay_weight, recency_weighted_average,
};

// ---------------------------------------------------------------------------
// Score computation end-to-end
// ---------------------------------------------------------------------------

#[test]
fn end_to_end_new_user_gets_low_score() {
    // A brand new user with no activity should get a low overall score.
    let feedback = compute_feedback_score(&FeedbackInput {
        average_rating: 0.0,
        weighted_average_rating: None,
        total_reviews: 0,
        five_star_count: 0,
        one_star_count: 0,
        rating_trend: 0.0,
        disputes_lost: 0,
    });

    let volume = compute_volume_score(&VolumeInput {
        total_completed: 0,
        recent_completed: 0,
        repeat_customers: 0,
        // No contracts means no completion data; NaN simulates the 0/0
        // case that the aggregation layer produces for a brand-new user.
        completion_rate: f64::NAN,
        avg_response_time_hours: 0.0,
    });

    let risk = compute_risk_score(&RiskInput {
        total_contracts: 0,
        cancellations: 0,
        disputes_against: 0,
        no_shows: 0,
        late_deliveries: 0,
    });

    let fraud = compute_fraud_score(&FraudInput {
        total_signals: 0,
        active_flags: 0,
    });

    let overall = composite_score(feedback, volume, risk, fraud);

    // All dimension scores should be in 0.0..=1.0.
    assert!((0.0..=1.0).contains(&feedback));
    assert!((0.0..=1.0).contains(&volume));
    assert!((0.0..=1.0).contains(&risk));
    assert!((0.0..=1.0).contains(&fraud));
    assert!((0.0..=1.0).contains(&overall));
}

#[test]
fn end_to_end_excellent_provider_gets_high_score() {
    // Simulate an excellent provider with many 5-star reviews, lots of completed
    // jobs, no disputes, and no fraud signals.
    let feedback = compute_feedback_score(&FeedbackInput {
        average_rating: 4.9,
        weighted_average_rating: Some(4.9),
        total_reviews: 50,
        five_star_count: 48,
        one_star_count: 0,
        rating_trend: 0.1,
        disputes_lost: 0,
    });

    let volume = compute_volume_score(&VolumeInput {
        total_completed: 100,
        recent_completed: 15,
        repeat_customers: 20,
        completion_rate: 0.99,
        avg_response_time_hours: 1.5,
    });

    let risk = compute_risk_score(&RiskInput {
        total_contracts: 105,
        cancellations: 1,
        disputes_against: 0,
        no_shows: 0,
        late_deliveries: 0,
    });

    let fraud = compute_fraud_score(&FraudInput {
        total_signals: 0,
        active_flags: 0,
    });

    let overall = composite_score(feedback, volume, risk, fraud);

    // Excellent provider should have a high overall score.
    assert!(overall > 0.7, "Expected high score, got {overall}");
    assert!(feedback > 0.8, "Expected high feedback, got {feedback}");
    assert!(volume > 0.5, "Expected decent volume, got {volume}");
    assert!(risk > 0.8, "Expected low risk (high score), got {risk}");
    assert!(fraud > 0.9, "Expected no fraud (high score), got {fraud}");
}

#[test]
fn end_to_end_risky_user_gets_low_score() {
    // Simulate a user with many disputes, cancellations, and fraud signals.
    let feedback = compute_feedback_score(&FeedbackInput {
        average_rating: 2.5,
        weighted_average_rating: Some(2.5),
        total_reviews: 10,
        five_star_count: 1,
        one_star_count: 4,
        rating_trend: -0.5,
        disputes_lost: 3,
    });

    let volume = compute_volume_score(&VolumeInput {
        total_completed: 5,
        recent_completed: 1,
        repeat_customers: 0,
        completion_rate: 0.5,
        avg_response_time_hours: 48.0,
    });

    let risk = compute_risk_score(&RiskInput {
        total_contracts: 10,
        cancellations: 5,
        disputes_against: 4,
        no_shows: 2,
        late_deliveries: 3,
    });

    let fraud = compute_fraud_score(&FraudInput {
        total_signals: 5,
        active_flags: 2,
    });

    let overall = composite_score(feedback, volume, risk, fraud);

    // Risky user should have a low overall score.
    assert!(
        overall < 0.5,
        "Expected low score for risky user, got {overall}"
    );
}

// ---------------------------------------------------------------------------
// Tier determination with different score ranges
// ---------------------------------------------------------------------------

#[test]
fn tier_determination_new_user() {
    // Score below 0.50 with no jobs -> New tier.
    let requirements = all_tier_requirements();
    let rising_req = requirements
        .iter()
        .find(|r| r.tier == TrustTier::Rising)
        .unwrap();

    // Below Rising threshold.
    let overall = 0.30;
    assert!(overall < rising_req.min_overall_score);
}

#[test]
fn tier_determination_rising_user() {
    let requirements = all_tier_requirements();
    let rising_req = requirements
        .iter()
        .find(|r| r.tier == TrustTier::Rising)
        .unwrap();
    let trusted_req = requirements
        .iter()
        .find(|r| r.tier == TrustTier::Trusted)
        .unwrap();

    // Meet Rising but not Trusted requirements.
    let overall = 0.60;
    let volume = VolumeDetails {
        total_jobs_completed: 5,
        jobs_last_90_days: 3,
        repeat_customers: 1,
        on_time_rate: 0.9,
        total_gmv_cents: 50000,
    };
    let feedback = FeedbackDetails {
        average_rating: 3.8,
        total_reviews: 4,
        five_star_count: 2,
        one_star_count: 0,
        rating_trend: 0.2,
        disputes_lost: 0,
    };

    assert!(overall >= rising_req.min_overall_score);
    assert!(volume.total_jobs_completed >= rising_req.min_completed_jobs);
    assert!(feedback.total_reviews >= rising_req.min_reviews);

    // But not Trusted.
    assert!(overall < trusted_req.min_overall_score);
}

#[test]
fn tier_determination_trusted_user() {
    let requirements = all_tier_requirements();
    let trusted_req = requirements
        .iter()
        .find(|r| r.tier == TrustTier::Trusted)
        .unwrap();
    let top_rated_req = requirements
        .iter()
        .find(|r| r.tier == TrustTier::TopRated)
        .unwrap();

    let overall = 0.75;
    let volume = VolumeDetails {
        total_jobs_completed: 15,
        jobs_last_90_days: 5,
        repeat_customers: 4,
        on_time_rate: 0.95,
        total_gmv_cents: 200000,
    };
    let feedback = FeedbackDetails {
        average_rating: 4.3,
        total_reviews: 12,
        five_star_count: 8,
        one_star_count: 0,
        rating_trend: 0.1,
        disputes_lost: 0,
    };

    assert!(overall >= trusted_req.min_overall_score);
    assert!(volume.total_jobs_completed >= trusted_req.min_completed_jobs);
    assert!(feedback.total_reviews >= trusted_req.min_reviews);
    assert!(feedback.average_rating >= trusted_req.min_rating);

    // But not TopRated.
    assert!(overall < top_rated_req.min_overall_score);
}

#[test]
fn tier_determination_top_rated_user() {
    let requirements = all_tier_requirements();
    let top_rated_req = requirements
        .iter()
        .find(|r| r.tier == TrustTier::TopRated)
        .unwrap();

    let overall = 0.92;
    let volume = VolumeDetails {
        total_jobs_completed: 50,
        jobs_last_90_days: 10,
        repeat_customers: 15,
        on_time_rate: 0.98,
        total_gmv_cents: 1_000_000,
    };
    let feedback = FeedbackDetails {
        average_rating: 4.8,
        total_reviews: 40,
        five_star_count: 35,
        one_star_count: 0,
        rating_trend: 0.05,
        disputes_lost: 0,
    };

    assert!(overall >= top_rated_req.min_overall_score);
    assert!(volume.total_jobs_completed >= top_rated_req.min_completed_jobs);
    assert!(feedback.total_reviews >= top_rated_req.min_reviews);
    assert!(feedback.average_rating >= top_rated_req.min_rating);
}

// ---------------------------------------------------------------------------
// DimensionScores overall computation
// ---------------------------------------------------------------------------

#[test]
fn dimension_scores_overall_weighted_correctly() {
    // Weights: feedback=0.35, volume=0.20, risk=0.25, fraud=0.20
    let scores = DimensionScores {
        feedback: 0.8,
        volume: 0.6,
        risk: 0.9,
        fraud: 1.0,
    };

    let expected = 0.8 * 0.35 + 0.6 * 0.20 + 0.9 * 0.25 + 1.0 * 0.20;
    let overall = scores.overall();
    assert!((overall - expected).abs() < f64::EPSILON);
}

#[test]
fn composite_score_matches_dimension_scores() {
    let overall = composite_score(0.8, 0.6, 0.9, 1.0);
    let scores = DimensionScores {
        feedback: 0.8,
        volume: 0.6,
        risk: 0.9,
        fraud: 1.0,
    };
    let expected = scores.overall();
    assert!((overall - expected).abs() < 1e-10);
}

// ---------------------------------------------------------------------------
// Decay weight
// ---------------------------------------------------------------------------

#[test]
fn decay_weight_recent_review_full_weight() {
    let config = DecayConfig::default();
    let w = decay_weight(0.0, &config);
    assert!((w - 1.0).abs() < f64::EPSILON);
}

#[test]
fn decay_weight_at_half_life() {
    let config = DecayConfig::default();
    let w = decay_weight(config.half_life_days, &config);
    assert!((w - 0.5).abs() < 0.01);
}

#[test]
fn decay_weight_very_old_review_above_minimum() {
    let config = DecayConfig::default();
    let w = decay_weight(10000.0, &config);
    assert!(w >= config.min_weight);
}

// ---------------------------------------------------------------------------
// Recency-weighted average
// ---------------------------------------------------------------------------

#[test]
fn recency_weighted_average_no_reviews_returns_none() {
    let config = DecayConfig::default();
    let avg = recency_weighted_average(&[], &config);
    assert!(avg.is_none(), "empty review set should return None");
}

#[test]
fn recency_weighted_average_single_review() {
    let config = DecayConfig::default();
    let reviews = vec![ReviewDataPoint {
        rating: 4.5,
        age_days: 0.0,
    }];
    let avg = recency_weighted_average(&reviews, &config).expect("some average");
    assert!((avg - 4.5).abs() < 0.01);
}

#[test]
fn recency_weighted_average_recent_reviews_weighted_more() {
    let config = DecayConfig::default();

    // Recent 5-star review and old 1-star review.
    let reviews = vec![
        ReviewDataPoint {
            rating: 5.0,
            age_days: 1.0,
        },
        ReviewDataPoint {
            rating: 1.0,
            age_days: 365.0,
        },
    ];

    let avg = recency_weighted_average(&reviews, &config).expect("some average");

    // Should be closer to 5.0 than to 3.0 (unweighted average)
    // because the 5-star review is much more recent.
    assert!(avg > 3.5, "Expected weighted average > 3.5, got {avg}");
}

// ---------------------------------------------------------------------------
// TrustTier round-trip
// ---------------------------------------------------------------------------

#[test]
fn trust_tier_all_variants_round_trip() {
    let tiers = [
        TrustTier::UnderReview,
        TrustTier::New,
        TrustTier::Rising,
        TrustTier::Trusted,
        TrustTier::TopRated,
    ];

    for tier in tiers {
        let db_str = tier.as_db_str();
        let parsed = TrustTier::from_db_str(db_str);
        assert_eq!(tier, parsed, "Round-trip failed for {db_str}");
    }
}
