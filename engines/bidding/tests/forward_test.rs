//! Integration tests for the forward-auction engine (goods marketplace).
//!
//! Pure-validation tests run anywhere. Database-backed tests require
//! `DATABASE_URL` to point at a Postgres instance with migrations applied
//! (`make migrate-up`). When `DATABASE_URL` is unset, DB-backed tests are
//! skipped via early return — same convention as the Go-side integration
//! tests.

use bidding::forward::{
    MAX_SNIPE_EXTENSIONS, place_forward_bid, should_extend_for_snipe, validate_forward_bid,
};
use bidding::models::BidError;
use chrono::{Duration, Utc};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use std::env;
use std::sync::Arc;
use tokio::task::JoinSet;
use uuid::Uuid;

// ──────────────────────────────────────────────────────────────────────
// Pure validation tests — run unconditionally.
// ──────────────────────────────────────────────────────────────────────

#[test]
fn lower_bid_is_rejected_pure() {
    let err = validate_forward_bid(1500, 1000, Some(2000)).unwrap_err();
    assert!(matches!(err, BidError::BelowMinimum));
}

#[test]
fn equal_bid_is_rejected_pure() {
    let err = validate_forward_bid(2000, 1000, Some(2000)).unwrap_err();
    assert!(
        matches!(err, BidError::BelowMinimum),
        "forward auction must reject equal bids — strict greater-than semantics"
    );
}

#[test]
fn higher_bid_wins_pure() {
    assert!(validate_forward_bid(2001, 1000, Some(2000)).is_ok());
}

#[test]
fn first_bid_must_meet_starting_price_pure() {
    assert!(validate_forward_bid(900, 1000, None).is_err());
    assert!(validate_forward_bid(1000, 1000, None).is_ok());
    assert!(validate_forward_bid(1500, 1000, None).is_ok());
}

#[test]
fn snipe_extension_fires_inside_60s_window() {
    let now = Utc::now();
    assert!(should_extend_for_snipe(now + Duration::seconds(30), now, 0));
    assert!(should_extend_for_snipe(now + Duration::seconds(59), now, 0));
    assert!(should_extend_for_snipe(now + Duration::seconds(60), now, 0));
    assert!(!should_extend_for_snipe(
        now + Duration::seconds(61),
        now,
        0
    ));
}

#[test]
fn snipe_extension_capped_at_max() {
    let now = Utc::now();
    let ends_at = now + Duration::seconds(30);
    assert!(should_extend_for_snipe(
        ends_at,
        now,
        MAX_SNIPE_EXTENSIONS - 1
    ));
    assert!(!should_extend_for_snipe(ends_at, now, MAX_SNIPE_EXTENSIONS));
    assert!(!should_extend_for_snipe(
        ends_at,
        now,
        MAX_SNIPE_EXTENSIONS + 1
    ));
}

// ──────────────────────────────────────────────────────────────────────
// Database-backed concurrency test.
// ──────────────────────────────────────────────────────────────────────

async fn pool_or_skip() -> Option<PgPool> {
    let url = env::var("DATABASE_URL").ok()?;
    PgPoolOptions::new()
        .max_connections(20)
        .connect(&url)
        .await
        .ok()
}

async fn pick_seller_buyers(pool: &PgPool, n: usize) -> Vec<Uuid> {
    let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM users ORDER BY created_at LIMIT $1")
        .bind(n as i64)
        .fetch_all(pool)
        .await
        .expect("query users");
    rows.into_iter().map(|r| r.0).collect()
}

async fn pick_category(pool: &PgPool) -> Uuid {
    let (id,): (Uuid,) = sqlx::query_as("SELECT id FROM service_categories LIMIT 1")
        .fetch_one(pool)
        .await
        .expect("category");
    id
}

async fn create_active_listing(pool: &PgPool, seller_id: Uuid, category_id: Uuid) -> Uuid {
    let (id,): (Uuid,) = sqlx::query_as(
        "INSERT INTO listings (seller_id, title, category_id, location, starting_price_cents,
                               auction_duration_hours, auction_ends_at, original_auction_ends_at, status)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326),
                 1000, 24, now() + interval '24 hours', now() + interval '24 hours', 'active')
         RETURNING id",
    )
    .bind(seller_id)
    .bind(format!("forward race {}", Uuid::now_v7()))
    .bind(category_id)
    .fetch_one(pool)
    .await
    .expect("insert listing");
    id
}

#[tokio::test]
async fn concurrent_forward_bids_serialize_correctly() {
    let Some(pool) = pool_or_skip().await else {
        eprintln!("DATABASE_URL unset — skipping forward concurrency test");
        return;
    };

    let users = pick_seller_buyers(&pool, 11).await;
    assert!(users.len() >= 11, "need >= 11 seed users");
    let seller = users[0];
    let bidders = users[1..].to_vec();
    let category = pick_category(&pool).await;

    let pool_arc = Arc::new(pool.clone());

    for iter in 0..3 {
        let listing = create_active_listing(&pool, seller, category).await;
        let mut set = JoinSet::new();
        // Each bidder bids a unique amount in [2000, 2009]. The serialised
        // FOR UPDATE will accept whichever lands first; subsequent bids must
        // strictly exceed the current high to land.
        for (i, bidder) in bidders.iter().enumerate() {
            let pool = pool_arc.clone();
            let bidder = *bidder;
            let amount = 2000 + i as i64;
            set.spawn(async move { place_forward_bid(&*pool, listing, bidder, amount).await });
        }

        let mut accepted = 0i64;
        let mut rejected = 0i64;
        while let Some(res) = set.join_next().await {
            match res.expect("task") {
                Ok(_) => accepted += 1,
                Err(_) => rejected += 1,
            }
        }
        assert_eq!(accepted + rejected, bidders.len() as i64);

        // Verify DB invariants.
        let (db_count, db_max): (i64, Option<i64>) = sqlx::query_as(
            "SELECT count(*), max(amount_cents) FROM listing_bids WHERE listing_id = $1",
        )
        .bind(listing)
        .fetch_one(&pool)
        .await
        .expect("count");
        let (listing_bid_count, listing_current): (i32, Option<i64>) =
            sqlx::query_as("SELECT bid_count, current_bid_cents FROM listings WHERE id = $1")
                .bind(listing)
                .fetch_one(&pool)
                .await
                .expect("listing");

        assert_eq!(
            db_count, accepted as i64,
            "iter {iter}: accepted={accepted} but listing_bids row count={db_count}"
        );
        assert_eq!(
            listing_bid_count as i64, db_count,
            "iter {iter}: listings.bid_count={listing_bid_count} != count(*)={db_count}"
        );
        assert_eq!(
            listing_current, db_max,
            "iter {iter}: listings.current_bid_cents != max(listing_bids.amount_cents)"
        );

        // Cleanup.
        sqlx::query("DELETE FROM listings WHERE id = $1")
            .bind(listing)
            .execute(&pool)
            .await
            .expect("cleanup");
    }
}

// ──────────────────────────────────────────────────────────────────────
// Snipe extension fires from real DB write path.
// ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn snipe_extension_fires_inside_60s_via_db() {
    let Some(pool) = pool_or_skip().await else {
        eprintln!("DATABASE_URL unset — skipping snipe DB test");
        return;
    };

    let users = pick_seller_buyers(&pool, 2).await;
    let seller = users[0];
    let bidder = users[1];
    let category = pick_category(&pool).await;

    // Create a listing whose auction ends in 30 seconds.
    let (listing,): (Uuid,) = sqlx::query_as(
        "INSERT INTO listings (seller_id, title, category_id, location, starting_price_cents,
                               auction_duration_hours, auction_ends_at, original_auction_ends_at, status)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326),
                 1000, 24, now() + interval '30 seconds', now() + interval '30 seconds', 'active')
         RETURNING id",
    )
    .bind(seller)
    .bind(format!("snipe {}", Uuid::now_v7()))
    .bind(category)
    .fetch_one(&pool)
    .await
    .expect("insert listing");

    let res = place_forward_bid(&pool, listing, bidder, 1500)
        .await
        .expect("bid");

    assert!(
        res.snipe_extension_triggered,
        "bid placed within 60s of close must extend"
    );
    assert_eq!(res.snipe_extension_count, 1);

    sqlx::query("DELETE FROM listings WHERE id = $1")
        .bind(listing)
        .execute(&pool)
        .await
        .expect("cleanup");
}
