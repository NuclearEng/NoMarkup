//! Forward-auction engine for the goods marketplace.
//!
//! The existing `engine.rs` implements a *reverse* auction (lowest bid wins)
//! for service jobs. The goods marketplace runs the inverse: the highest
//! bidder at close wins. The mechanics share infrastructure (atomic bid_count
//! deltas, snipe extension, FOR UPDATE serialisation) but the comparison
//! direction inverts.
//!
//! This module is intentionally compact: most invariants are enforced at the
//! database level (CHECK constraint on amount_cents, the AFTER-INSERT
//! trigger that maintains listings.current_bid_cents and bid_count). The
//! Rust layer provides:
//!   - A pure validation function `validate_forward_bid` that compares an
//!     amount to the current high bid and starting price.
//!   - A snipe-extension check `should_extend_for_snipe` that mirrors the
//!     service's behaviour.
//!   - A `place_forward_bid` async path that takes a sqlx pool and runs the
//!     full FOR-UPDATE-locked INSERT for callers that want to bypass the Go
//!     gateway. (The primary write path remains the Go service to avoid two
//!     services racing each other.)
//!
//! These helpers are designed so the Go service and the Rust engine produce
//! IDENTICAL accept/reject decisions for the same inputs — a critical
//! property when running both behind a feature flag during cut-over.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::BidError;

/// Snipe window in seconds — bids inside this window of close trigger an
/// extension. Mirrors the Go service constant in
/// `services/job/internal/repository/listing_repo.go`.
pub const SNIPE_WINDOW_SECS: i64 = 60;

/// Snipe extension — the auction is pushed forward by this many minutes when
/// a bid lands inside the snipe window.
pub const SNIPE_EXTENSION_MINUTES: i64 = 5;

/// Maximum number of snipe extensions per listing. Prevents pathological
/// last-second-bid loops from extending an auction indefinitely.
pub const MAX_SNIPE_EXTENSIONS: i32 = 5;

/// Validate that a forward-auction bid amount is acceptable.
///
/// Forward auctions accept only strictly-higher bids than the current high.
/// For the *first* bid (when `current_bid` is `None`), the amount must be
/// `>= starting_price`.
///
/// # Errors
///
/// - `BidError::InvalidAmount` if `amount_cents <= 0`.
/// - `BidError::BelowMinimum` if `amount_cents < starting_price` (no bids yet).
/// - `BidError::BelowMinimum` if `amount_cents <= current_bid`.
pub fn validate_forward_bid(
    amount_cents: i64,
    starting_price_cents: i64,
    current_bid_cents: Option<i64>,
) -> Result<(), BidError> {
    if amount_cents <= 0 {
        return Err(BidError::InvalidAmount(
            "amount must be greater than zero".into(),
        ));
    }
    match current_bid_cents {
        None => {
            if amount_cents < starting_price_cents {
                return Err(BidError::BelowMinimum);
            }
        }
        Some(high) => {
            if amount_cents <= high {
                return Err(BidError::BelowMinimum);
            }
        }
    }
    Ok(())
}

/// Decide whether a bid landing at `now` should trigger a snipe extension.
///
/// Returns `true` when:
///   - the auction has not yet ended,
///   - we are within `SNIPE_WINDOW_SECS` of the close, AND
///   - we have not already extended `MAX_SNIPE_EXTENSIONS` times.
#[must_use]
pub fn should_extend_for_snipe(
    auction_ends_at: DateTime<Utc>,
    now: DateTime<Utc>,
    current_extension_count: i32,
) -> bool {
    if now >= auction_ends_at {
        return false;
    }
    if current_extension_count >= MAX_SNIPE_EXTENSIONS {
        return false;
    }
    let secs_remaining = (auction_ends_at - now).num_seconds();
    secs_remaining > 0 && secs_remaining <= SNIPE_WINDOW_SECS
}

/// Place a forward-auction bid against a listings row.
///
/// This is the Rust counterpart to
/// `services/job/internal/repository/listing_repo.go::PlaceListingBid`.
/// Both implementations MUST produce identical accept/reject decisions for
/// the same inputs.
///
/// The function:
///   1. Opens a transaction.
///   2. Locks the listing row with `SELECT … FOR UPDATE`.
///   3. Validates active status, deadline, and forward-direction amount.
///   4. Marks the previous active bid as `'outbid'`.
///   5. Inserts the new bid.
///   6. Extends the deadline if we're inside the snipe window.
///   7. Commits.
///
/// The trigger `listing_bids_update_counters` (migration 034) maintains
/// `listings.current_bid_cents`, `current_bidder_id`, and `bid_count`
/// transactionally — we do NOT update those fields in app code.
///
/// # Errors
///
/// Returns `BidError` when the listing is missing/closed, the amount fails
/// the forward-direction check, or the database call fails.
// The goods-side twin of `BiddingEngine::place_bid`, and equally latency
// critical — same span shape so one dashboard covers both auction directions.
#[tracing::instrument(
    skip_all,
    fields(listing_id = %listing_id, bidder_id = %bidder_id, amount_cents),
    err
)]
pub async fn place_forward_bid(
    pool: &PgPool,
    listing_id: Uuid,
    bidder_id: Uuid,
    amount_cents: i64,
) -> Result<ForwardBidResult, BidError> {
    if amount_cents <= 0 {
        return Err(BidError::InvalidAmount(
            "amount must be greater than zero".into(),
        ));
    }

    let mut tx = pool.begin().await?;

    let row = sqlx::query_as::<_, ListingLockRow>(
        "SELECT seller_id, status, starting_price_cents, current_bid_cents, \
                auction_ends_at, snipe_extension_count \
         FROM listings WHERE id = $1 FOR UPDATE",
    )
    .bind(listing_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(BidError::JobNotFound)?;

    if row.status != "active" {
        return Err(BidError::AuctionNotActive);
    }
    let now = Utc::now();
    if row.auction_ends_at <= now {
        return Err(BidError::AuctionClosed);
    }
    if row.seller_id == bidder_id {
        return Err(BidError::PermissionDenied(
            "seller cannot bid on own listing".into(),
        ));
    }
    validate_forward_bid(
        amount_cents,
        row.starting_price_cents,
        row.current_bid_cents,
    )?;

    // Outbid the prior high bid.
    sqlx::query(
        "UPDATE listing_bids SET status = 'outbid' WHERE listing_id = $1 AND status = 'active'",
    )
    .bind(listing_id)
    .execute(&mut *tx)
    .await?;

    // Insert the new bid.
    let bid_id: Uuid = sqlx::query_scalar(
        "INSERT INTO listing_bids (listing_id, bidder_id, amount_cents, status) \
         VALUES ($1, $2, $3, 'active') RETURNING id",
    )
    .bind(listing_id)
    .bind(bidder_id)
    .bind(amount_cents)
    .fetch_one(&mut *tx)
    .await?;

    // Snipe extension.
    let mut new_ends_at = row.auction_ends_at;
    let mut new_extension_count = row.snipe_extension_count;
    let extended = should_extend_for_snipe(row.auction_ends_at, now, row.snipe_extension_count);
    if extended {
        let updated = sqlx::query_as::<_, ExtendedRow>(
            "UPDATE listings \
                SET auction_ends_at = auction_ends_at + INTERVAL '5 minutes', \
                    snipe_extension_count = snipe_extension_count + 1 \
              WHERE id = $1 \
            RETURNING auction_ends_at, snipe_extension_count",
        )
        .bind(listing_id)
        .fetch_one(&mut *tx)
        .await?;
        new_ends_at = updated.auction_ends_at;
        new_extension_count = updated.snipe_extension_count;
    }

    tx.commit().await?;

    Ok(ForwardBidResult {
        bid_id,
        listing_id,
        bidder_id,
        amount_cents,
        snipe_extension_triggered: extended,
        new_auction_ends_at: new_ends_at,
        snipe_extension_count: new_extension_count,
    })
}

#[derive(Debug, Clone)]
pub struct ForwardBidResult {
    pub bid_id: Uuid,
    pub listing_id: Uuid,
    pub bidder_id: Uuid,
    pub amount_cents: i64,
    pub snipe_extension_triggered: bool,
    pub new_auction_ends_at: DateTime<Utc>,
    pub snipe_extension_count: i32,
}

#[derive(sqlx::FromRow)]
struct ListingLockRow {
    seller_id: Uuid,
    status: String,
    starting_price_cents: i64,
    current_bid_cents: Option<i64>,
    auction_ends_at: DateTime<Utc>,
    snipe_extension_count: i32,
}

#[derive(sqlx::FromRow)]
struct ExtendedRow {
    auction_ends_at: DateTime<Utc>,
    snipe_extension_count: i32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use proptest::prelude::*;

    // ── validate_forward_bid ─────────────────────────────────────────────

    #[test]
    fn first_bid_below_starting_is_rejected() {
        let err = validate_forward_bid(900, 1000, None).unwrap_err();
        assert!(matches!(err, BidError::BelowMinimum));
    }

    #[test]
    fn first_bid_at_starting_is_accepted() {
        assert!(validate_forward_bid(1000, 1000, None).is_ok());
    }

    #[test]
    fn first_bid_above_starting_is_accepted() {
        assert!(validate_forward_bid(1500, 1000, None).is_ok());
    }

    #[test]
    fn lower_than_current_high_is_rejected() {
        let err = validate_forward_bid(1500, 1000, Some(2000)).unwrap_err();
        assert!(matches!(err, BidError::BelowMinimum));
    }

    #[test]
    fn equal_to_current_high_is_rejected() {
        let err = validate_forward_bid(2000, 1000, Some(2000)).unwrap_err();
        assert!(
            matches!(err, BidError::BelowMinimum),
            "forward auction must reject equal bids — only strictly-higher bids win"
        );
    }

    #[test]
    fn higher_than_current_high_is_accepted() {
        assert!(validate_forward_bid(2001, 1000, Some(2000)).is_ok());
    }

    #[test]
    fn zero_amount_is_rejected() {
        let err = validate_forward_bid(0, 1000, None).unwrap_err();
        assert!(matches!(err, BidError::InvalidAmount(_)));
    }

    #[test]
    fn negative_amount_is_rejected() {
        let err = validate_forward_bid(-100, 1000, None).unwrap_err();
        assert!(matches!(err, BidError::InvalidAmount(_)));
    }

    // ── should_extend_for_snipe ─────────────────────────────────────────

    #[test]
    fn snipe_extension_fires_in_last_60s() {
        let now = Utc::now();
        let ends_at = now + Duration::seconds(30);
        assert!(should_extend_for_snipe(ends_at, now, 0));
    }

    #[test]
    fn snipe_extension_fires_at_exactly_60s() {
        let now = Utc::now();
        let ends_at = now + Duration::seconds(60);
        assert!(should_extend_for_snipe(ends_at, now, 0));
    }

    #[test]
    fn snipe_extension_does_not_fire_outside_window() {
        let now = Utc::now();
        let ends_at = now + Duration::seconds(120);
        assert!(!should_extend_for_snipe(ends_at, now, 0));
    }

    #[test]
    fn snipe_extension_does_not_fire_after_close() {
        let now = Utc::now();
        let ends_at = now - Duration::seconds(1);
        assert!(!should_extend_for_snipe(ends_at, now, 0));
    }

    #[test]
    fn snipe_extension_blocked_at_max_count() {
        let now = Utc::now();
        let ends_at = now + Duration::seconds(30);
        assert!(!should_extend_for_snipe(ends_at, now, MAX_SNIPE_EXTENSIONS));
    }

    // ── proptest: arbitrary inputs never panic ──────────────────────────

    proptest! {
        #[test]
        fn validate_forward_bid_never_panics(
            amount in proptest::num::i64::ANY,
            starting in 0..=1_000_000_000i64,
            current in proptest::option::of(0..=1_000_000_000i64),
        ) {
            let _ = validate_forward_bid(amount, starting, current);
        }

        // Property: any amount strictly greater than current high (when set,
        // > 0) and at least starting price (when no high) must be accepted
        // (assuming amount > 0).
        #[test]
        fn higher_bid_always_accepted(
            high in 1..=1_000_000_000i64,
            delta in 1..=10_000_000i64,
            starting in 0..=1_000_000_000i64,
        ) {
            let amount = high.saturating_add(delta);
            // amount > high by construction; starting is irrelevant when high.is_some().
            prop_assert!(validate_forward_bid(amount, starting, Some(high)).is_ok());
        }

        // Property: any amount <= current high must be rejected.
        #[test]
        fn lower_or_equal_bid_always_rejected(
            high in 1..=1_000_000_000i64,
            amount in 1..=1_000_000_000i64,
            starting in 0..=1_000_000_000i64,
        ) {
            if amount <= high {
                prop_assert!(validate_forward_bid(amount, starting, Some(high)).is_err());
            }
        }

        // Property: snipe extension is monotonically false once
        // current_extension_count >= MAX_SNIPE_EXTENSIONS.
        #[test]
        fn snipe_capped_at_max(
            secs_remaining in 1i64..=30,
            count in MAX_SNIPE_EXTENSIONS..=20i32,
        ) {
            let now = Utc::now();
            let ends_at = now + Duration::seconds(secs_remaining);
            prop_assert!(!should_extend_for_snipe(ends_at, now, count));
        }
    }
}
