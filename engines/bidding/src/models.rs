use serde::{Deserialize, Serialize};

/// Bid status in the auction lifecycle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BidStatus {
    Active,
    Awarded,
    NotSelected,
    Withdrawn,
    Expired,
}

/// A bid in a sealed reverse auction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bid {
    pub id: String,
    pub job_id: String,
    pub provider_id: String,
    pub amount_cents: i64,
    pub status: BidStatus,
}
