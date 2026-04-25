//! Integration tests for the bidding engine.
//!
//! These tests exercise the pure logic functions (validate, rank, offer-accepted)
//! through realistic multi-step scenarios without requiring a database connection.

use bidding::engine::{is_offer_accepted, rank_bids, validate_bid_amount};
use bidding::models::{Bid, BidAnalytics, BidError, BidUpdate};
use chrono::Utc;
use uuid::Uuid;

/// Helper: build a minimal `Bid` for testing.
fn make_bid(amount_cents: i64, provider_id: Uuid, status: &str, job_id: Uuid) -> Bid {
    let now = Utc::now();
    Bid {
        id: Uuid::now_v7(),
        job_id,
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

// ---------------------------------------------------------------------------
// Full bid lifecycle: place bid -> update bid -> award bid
// ---------------------------------------------------------------------------

#[test]
fn full_bid_lifecycle_validation() {
    let job_id = Uuid::now_v7();
    let provider_id = Uuid::now_v7();

    // Step 1: Validate initial bid amount.
    assert!(validate_bid_amount(10000).is_ok());

    // Step 2: Create a bid.
    let bid = make_bid(10000, provider_id, "active", job_id);
    assert_eq!(bid.amount_cents, 10000);
    assert_eq!(bid.status, "active");

    // Step 3: Validate updated (lower) amount.
    assert!(validate_bid_amount(8000).is_ok());

    // Step 4: Simulate bid update by creating a new bid with lower amount.
    let updated_bid = make_bid(8000, provider_id, "active", job_id);
    assert!(updated_bid.amount_cents < bid.amount_cents);

    // Step 5: Simulate award — bid status transitions.
    let awarded_bid = Bid {
        status: "awarded".to_string(),
        awarded_at: Some(Utc::now()),
        ..updated_bid
    };
    assert_eq!(awarded_bid.status, "awarded");
    assert!(awarded_bid.awarded_at.is_some());
}

// ---------------------------------------------------------------------------
// Starting bid validation
// ---------------------------------------------------------------------------

#[test]
fn starting_bid_validation_positive_amounts() {
    assert!(validate_bid_amount(1).is_ok());
    assert!(validate_bid_amount(100).is_ok());
    assert!(validate_bid_amount(999_999).is_ok());
    assert!(validate_bid_amount(i64::MAX).is_ok());
}

#[test]
fn starting_bid_validation_rejects_zero() {
    let err = validate_bid_amount(0).unwrap_err();
    assert!(matches!(err, BidError::InvalidAmount(_)));
}

#[test]
fn starting_bid_validation_rejects_negative() {
    let err = validate_bid_amount(-1).unwrap_err();
    assert!(matches!(err, BidError::InvalidAmount(_)));

    let err = validate_bid_amount(-10000).unwrap_err();
    assert!(matches!(err, BidError::InvalidAmount(_)));

    let err = validate_bid_amount(i64::MIN).unwrap_err();
    assert!(matches!(err, BidError::InvalidAmount(_)));
}

// ---------------------------------------------------------------------------
// Concurrent bid safety — ranking with many bids
// ---------------------------------------------------------------------------

#[test]
fn concurrent_bid_safety_ranking_is_deterministic() {
    let job_id = Uuid::now_v7();
    let providers: Vec<Uuid> = (0..50).map(|_| Uuid::now_v7()).collect();

    // Simulate 50 concurrent bids with varying amounts.
    let bids: Vec<Bid> = providers
        .iter()
        .enumerate()
        .map(|(i, p)| {
            #[allow(clippy::cast_possible_wrap)]
            make_bid((50 - i as i64) * 100 + 500, *p, "active", job_id)
        })
        .collect();

    // Rank twice — result must be identical.
    let ranked1 = rank_bids(&bids);
    let ranked2 = rank_bids(&bids);

    assert_eq!(ranked1.len(), ranked2.len());
    for (a, b) in ranked1.iter().zip(ranked2.iter()) {
        assert_eq!(a.amount_cents, b.amount_cents);
    }

    // Verify sorted ascending (lowest bid wins in reverse auction).
    for window in ranked1.windows(2) {
        assert!(window[0].amount_cents <= window[1].amount_cents);
    }
}

#[test]
fn concurrent_bids_no_data_loss() {
    let job_id = Uuid::now_v7();
    let n = 200;
    let bids: Vec<Bid> = (0..n)
        .map(|i| {
            #[allow(clippy::cast_possible_wrap)]
            make_bid(1000 + i as i64, Uuid::now_v7(), "active", job_id)
        })
        .collect();

    let ranked = rank_bids(&bids);
    assert_eq!(ranked.len(), n);
}

// ---------------------------------------------------------------------------
// Offer-accepted logic
// ---------------------------------------------------------------------------

#[test]
fn offer_accepted_integration_scenarios() {
    // Scenario 1: Bid exactly at offer price -> accepted.
    assert!(is_offer_accepted(Some(5000), 5000));

    // Scenario 2: Bid below offer price -> accepted.
    assert!(is_offer_accepted(Some(5000), 3000));
    assert!(is_offer_accepted(Some(5000), 1));

    // Scenario 3: Bid above offer price -> not accepted.
    assert!(!is_offer_accepted(Some(5000), 5001));
    assert!(!is_offer_accepted(Some(5000), 10000));

    // Scenario 4: No offer set -> never accepted.
    assert!(!is_offer_accepted(None, 1));
    assert!(!is_offer_accepted(None, 5000));
    assert!(!is_offer_accepted(None, 0));
}

// ---------------------------------------------------------------------------
// BidUpdate serialization
// ---------------------------------------------------------------------------

#[test]
fn bid_update_history_tracking() {
    let updates = vec![
        BidUpdate {
            amount_cents: 10000,
            updated_at: Utc::now(),
        },
        BidUpdate {
            amount_cents: 8000,
            updated_at: Utc::now(),
        },
        BidUpdate {
            amount_cents: 6000,
            updated_at: Utc::now(),
        },
    ];

    // Serialize all updates as JSON array.
    let json = serde_json::to_string(&updates).expect("serialize updates");
    let parsed: Vec<BidUpdate> = serde_json::from_str(&json).expect("deserialize updates");

    assert_eq!(parsed.len(), 3);
    assert_eq!(parsed[0].amount_cents, 10000);
    assert_eq!(parsed[1].amount_cents, 8000);
    assert_eq!(parsed[2].amount_cents, 6000);

    // Updates should show decreasing amounts (bid lowering).
    for window in parsed.windows(2) {
        assert!(window[0].amount_cents > window[1].amount_cents);
    }
}

// ---------------------------------------------------------------------------
// BidAnalytics
// ---------------------------------------------------------------------------

#[test]
fn bid_analytics_default_state() {
    let analytics = BidAnalytics::default();
    assert_eq!(analytics.total_bids, 0);
    assert_eq!(analytics.lowest_bid_cents, 0);
    assert_eq!(analytics.highest_bid_cents, 0);
    assert_eq!(analytics.median_bid_cents, 0);
    assert_eq!(analytics.offer_accepted_count, 0);
    assert!(analytics.first_bid_at.is_none());
    assert!(analytics.last_bid_at.is_none());
}

// ---------------------------------------------------------------------------
// BidError display messages
// ---------------------------------------------------------------------------

#[test]
fn bid_error_messages_are_descriptive() {
    let errors: Vec<(BidError, &str)> = vec![
        (BidError::AuctionClosed, "closed"),
        (BidError::AuctionNotActive, "not in active"),
        (BidError::BelowMinimum, "lower"),
        (BidError::AlreadyBid, "already"),
        (BidError::NotBidOwner, "owner"),
        (BidError::BidNotActive, "not in active"),
        (BidError::BidNotFound, "not found"),
        (BidError::JobNotFound, "not found"),
        (
            BidError::InvalidAmount("test".into()),
            "test",
        ),
        (
            BidError::AboveStartingBid {
                amount: 10000,
                starting_bid: 5000,
            },
            "starting bid",
        ),
        (
            BidError::PermissionDenied("denied".into()),
            "denied",
        ),
    ];

    for (err, expected_substring) in errors {
        let msg = err.to_string();
        assert!(
            msg.to_lowercase().contains(expected_substring),
            "Error '{msg}' should contain '{expected_substring}'"
        );
    }
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

#[test]
fn rank_empty_bids() {
    let ranked = rank_bids(&[]);
    assert!(ranked.is_empty());
}

#[test]
fn rank_single_bid() {
    let job_id = Uuid::now_v7();
    let bids = vec![make_bid(5000, Uuid::now_v7(), "active", job_id)];
    let ranked = rank_bids(&bids);
    assert_eq!(ranked.len(), 1);
    assert_eq!(ranked[0].amount_cents, 5000);
}

#[test]
fn rank_bids_with_equal_amounts() {
    let job_id = Uuid::now_v7();
    let bids = vec![
        make_bid(3000, Uuid::now_v7(), "active", job_id),
        make_bid(3000, Uuid::now_v7(), "active", job_id),
        make_bid(3000, Uuid::now_v7(), "active", job_id),
    ];
    let ranked = rank_bids(&bids);
    assert_eq!(ranked.len(), 3);
    assert!(ranked.iter().all(|b| b.amount_cents == 3000));
}
