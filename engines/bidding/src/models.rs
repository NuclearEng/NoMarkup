use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// A bid in a sealed reverse auction.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[allow(clippy::struct_field_names)]
pub struct Bid {
    pub id: Uuid,
    pub job_id: Uuid,
    pub provider_id: Uuid,
    pub amount_cents: i64,
    pub is_offer_accepted: bool,
    pub status: String,
    pub original_amount_cents: i64,
    pub bid_updates: serde_json::Value,
    pub awarded_at: Option<DateTime<Utc>>,
    pub withdrawn_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A single update entry in the `bid_updates` JSONB array.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidUpdate {
    pub amount_cents: i64,
    pub updated_at: DateTime<Utc>,
}

/// Aggregate analytics for bids on a job.
#[derive(Debug, Clone, Default)]
pub struct BidAnalytics {
    pub total_bids: i32,
    pub lowest_bid_cents: i64,
    pub highest_bid_cents: i64,
    pub median_bid_cents: i64,
    pub offer_accepted_count: i32,
    pub first_bid_at: Option<DateTime<Utc>>,
    pub last_bid_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct AuctionBidEvent {
    pub id: Uuid,
    pub job_id: Uuid,
    pub amount_cents: i64,
    pub event_type: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveAuctionState {
    pub job_id: Uuid,
    pub lowest_bid_cents: i64,
    pub bid_count: i32,
    pub auction_ends_at: Option<DateTime<Utc>>,
    pub snipe_extension_count: i32,
    pub max_snipe_extensions: i32,
    pub recent_events: Vec<AuctionBidEvent>,
}

/// Errors that can occur during bidding operations.
#[derive(Debug, thiserror::Error)]
pub enum BidError {
    #[error("auction is closed or not active")]
    AuctionClosed,

    #[error("auction is not in active status")]
    AuctionNotActive,

    #[error("bid amount must be lower than current amount")]
    BelowMinimum,

    #[error("provider already has an active bid on this job")]
    AlreadyBid,

    #[error("only the bid owner can perform this action")]
    NotBidOwner,

    #[error("bid is not in active status")]
    BidNotActive,

    #[error("bid not found")]
    BidNotFound,

    #[error("job not found")]
    JobNotFound,

    #[error("invalid amount: {0}")]
    InvalidAmount(String),

    #[error("bid amount {amount} exceeds starting bid of {starting_bid}")]
    AboveStartingBid { amount: i64, starting_bid: i64 },

    #[error("permission denied: {0}")]
    PermissionDenied(String),

    // Reserved variant of the versioned BidError contract: it is exhaustively
    // handled in the gRPC status mapper but the current anti-snipe path stops
    // extending silently (SQL guard `snipe_extension_count < 3`) rather than
    // erroring, so it is not yet constructed. Kept for forward compatibility.
    #[allow(dead_code)]
    #[error("snipe extension limit reached for job {job_id}")]
    SnipeExtensionLimitReached { job_id: String },

    #[error("feature not enabled: {0}")]
    FeatureNotEnabled(String),

    #[error("database error: {0}")]
    DatabaseError(#[from] sqlx::Error),
}
