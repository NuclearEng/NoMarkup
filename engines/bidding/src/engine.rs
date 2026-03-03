/// Core auction engine for sealed-bid reverse auctions.
///
/// Handles bid placement, validation, auction expiry, and award logic.
/// Target: < 1ms p99 latency for bid processing.
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{Bid, BidAnalytics, BidError, BidUpdate};

pub struct BiddingEngine {
    pool: PgPool,
}

impl BiddingEngine {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Place a new bid on a job. Validates the auction is active and the provider
    /// has not already bid.
    ///
    /// # Errors
    ///
    /// Returns `BidError` if the auction is not active, the provider already bid,
    /// or the amount is invalid.
    pub async fn place_bid(
        &self,
        job_id: Uuid,
        provider_id: Uuid,
        amount_cents: i64,
    ) -> Result<Bid, BidError> {
        if amount_cents <= 0 {
            return Err(BidError::InvalidAmount(
                "amount must be greater than zero".into(),
            ));
        }

        // Validate auction is active and not expired.
        let job = sqlx::query_as::<_, JobRow>(
            "SELECT id, status, offer_accepted_cents, auction_ends_at, customer_id \
             FROM jobs WHERE id = $1",
        )
        .bind(job_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(BidError::JobNotFound)?;

        if job.status != "active" {
            return Err(BidError::AuctionNotActive);
        }

        if let Some(ends_at) = job.auction_ends_at {
            if ends_at <= Utc::now() {
                return Err(BidError::AuctionClosed);
            }
        }

        // Check if bid amount meets the offer-accepted threshold for auto-accept.
        let is_offer_accepted = job
            .offer_accepted_cents
            .is_some_and(|offer| amount_cents <= offer);

        // Insert bid.
        let bid = sqlx::query_as::<_, Bid>(
            "INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, is_offer_accepted) \
             VALUES ($1, $2, $3, $3, $4) \
             RETURNING *",
        )
        .bind(job_id)
        .bind(provider_id)
        .bind(amount_cents)
        .bind(is_offer_accepted)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            if is_unique_violation(&e) {
                BidError::AlreadyBid
            } else {
                BidError::DatabaseError(e)
            }
        })?;

        // Increment job bid count.
        sqlx::query("UPDATE jobs SET bid_count = bid_count + 1 WHERE id = $1")
            .bind(job_id)
            .execute(&self.pool)
            .await?;

        tracing::info!(
            bid_id = %bid.id,
            job_id = %job_id,
            provider_id = %provider_id,
            amount_cents,
            is_offer_accepted,
            "bid placed"
        );

        Ok(bid)
    }

    /// Update an existing bid to a lower amount. Only the bid owner can update,
    /// and the new amount must be strictly less than the current amount.
    ///
    /// # Errors
    ///
    /// Returns `BidError` if the bid is not found, not owned by the caller,
    /// not active, or the new amount is not lower.
    pub async fn update_bid(
        &self,
        bid_id: Uuid,
        provider_id: Uuid,
        new_amount: i64,
    ) -> Result<Bid, BidError> {
        if new_amount <= 0 {
            return Err(BidError::InvalidAmount(
                "amount must be greater than zero".into(),
            ));
        }

        let existing = self.get_bid(bid_id).await?;

        if existing.provider_id != provider_id {
            return Err(BidError::NotBidOwner);
        }
        if existing.status != "active" {
            return Err(BidError::BidNotActive);
        }
        if new_amount >= existing.amount_cents {
            return Err(BidError::BelowMinimum);
        }

        // Build the update entry for the JSONB array.
        let update_entry = BidUpdate {
            amount_cents: existing.amount_cents,
            updated_at: Utc::now(),
        };
        let update_json = serde_json::to_value(&update_entry)
            .map_err(|e| BidError::InvalidAmount(e.to_string()))?;

        let bid = sqlx::query_as::<_, Bid>(
            "UPDATE bids \
             SET amount_cents = $1, \
                 bid_updates = bid_updates || $2::jsonb, \
                 updated_at = now() \
             WHERE id = $3 \
             RETURNING *",
        )
        .bind(new_amount)
        .bind(update_json)
        .bind(bid_id)
        .fetch_one(&self.pool)
        .await?;

        tracing::info!(
            bid_id = %bid_id,
            old_amount = existing.amount_cents,
            new_amount,
            "bid updated"
        );

        Ok(bid)
    }

    /// Withdraw an active bid. Decrements the job's bid count.
    ///
    /// # Errors
    ///
    /// Returns `BidError` if the bid is not found, not owned, or not active.
    pub async fn withdraw_bid(
        &self,
        bid_id: Uuid,
        provider_id: Uuid,
    ) -> Result<Bid, BidError> {
        let existing = self.get_bid(bid_id).await?;

        if existing.provider_id != provider_id {
            return Err(BidError::NotBidOwner);
        }
        if existing.status != "active" {
            return Err(BidError::BidNotActive);
        }

        let bid = sqlx::query_as::<_, Bid>(
            "UPDATE bids \
             SET status = 'withdrawn', withdrawn_at = now(), updated_at = now() \
             WHERE id = $1 \
             RETURNING *",
        )
        .bind(bid_id)
        .fetch_one(&self.pool)
        .await?;

        // Decrement job bid count.
        sqlx::query("UPDATE jobs SET bid_count = GREATEST(bid_count - 1, 0) WHERE id = $1")
            .bind(existing.job_id)
            .execute(&self.pool)
            .await?;

        tracing::info!(bid_id = %bid_id, "bid withdrawn");

        Ok(bid)
    }

    /// Accept the job's offer price by placing a bid at that exact amount.
    ///
    /// # Errors
    ///
    /// Returns `BidError` if the job has no offer price set, or placement fails.
    pub async fn accept_offer_price(
        &self,
        job_id: Uuid,
        provider_id: Uuid,
    ) -> Result<Bid, BidError> {
        let job = sqlx::query_as::<_, JobRow>(
            "SELECT id, status, offer_accepted_cents, auction_ends_at, customer_id \
             FROM jobs WHERE id = $1",
        )
        .bind(job_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(BidError::JobNotFound)?;

        let offer_cents = job
            .offer_accepted_cents
            .ok_or_else(|| BidError::InvalidAmount("job has no offer accepted price".into()))?;

        if job.status != "active" {
            return Err(BidError::AuctionNotActive);
        }

        if let Some(ends_at) = job.auction_ends_at {
            if ends_at <= Utc::now() {
                return Err(BidError::AuctionClosed);
            }
        }

        // Insert bid at the offer price with is_offer_accepted = true.
        let bid = sqlx::query_as::<_, Bid>(
            "INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, is_offer_accepted) \
             VALUES ($1, $2, $3, $3, true) \
             RETURNING *",
        )
        .bind(job_id)
        .bind(provider_id)
        .bind(offer_cents)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            if is_unique_violation(&e) {
                BidError::AlreadyBid
            } else {
                BidError::DatabaseError(e)
            }
        })?;

        sqlx::query("UPDATE jobs SET bid_count = bid_count + 1 WHERE id = $1")
            .bind(job_id)
            .execute(&self.pool)
            .await?;

        tracing::info!(
            bid_id = %bid.id,
            job_id = %job_id,
            provider_id = %provider_id,
            offer_cents,
            "offer price accepted"
        );

        Ok(bid)
    }

    /// Award a bid to a provider. Validates the customer owns the job,
    /// marks the winning bid as awarded, all other active bids as `not_selected`,
    /// and updates the job status. Uses a database transaction.
    ///
    /// # Errors
    ///
    /// Returns `BidError` if validation fails or the transaction cannot complete.
    pub async fn award_bid(
        &self,
        job_id: Uuid,
        bid_id: Uuid,
        customer_id: Uuid,
    ) -> Result<Bid, BidError> {
        let mut tx = self.pool.begin().await?;

        // Validate customer owns the job.
        let job = sqlx::query_as::<_, JobRow>(
            "SELECT id, status, offer_accepted_cents, auction_ends_at, customer_id \
             FROM jobs WHERE id = $1",
        )
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(BidError::JobNotFound)?;

        if job.customer_id != customer_id {
            return Err(BidError::PermissionDenied(
                "only the job owner can award a bid".into(),
            ));
        }

        // Validate bid exists, is active, and belongs to this job.
        let bid = sqlx::query_as::<_, Bid>("SELECT * FROM bids WHERE id = $1")
            .bind(bid_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(BidError::BidNotFound)?;

        if bid.job_id != job_id {
            return Err(BidError::BidNotFound);
        }
        if bid.status != "active" {
            return Err(BidError::BidNotActive);
        }

        // Mark winning bid as awarded.
        let awarded = sqlx::query_as::<_, Bid>(
            "UPDATE bids \
             SET status = 'awarded', awarded_at = now(), updated_at = now() \
             WHERE id = $1 \
             RETURNING *",
        )
        .bind(bid_id)
        .fetch_one(&mut *tx)
        .await?;

        // Mark all other active bids as not_selected.
        sqlx::query(
            "UPDATE bids SET status = 'not_selected', updated_at = now() \
             WHERE job_id = $1 AND id != $2 AND status = 'active'",
        )
        .bind(job_id)
        .bind(bid_id)
        .execute(&mut *tx)
        .await?;

        // Update job status to awarded.
        sqlx::query(
            "UPDATE jobs SET status = 'awarded', \
             awarded_provider_id = $1, awarded_bid_id = $2, awarded_at = now() \
             WHERE id = $3",
        )
        .bind(bid.provider_id)
        .bind(bid_id)
        .bind(job_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        tracing::info!(
            bid_id = %bid_id,
            job_id = %job_id,
            provider_id = %bid.provider_id,
            "bid awarded"
        );

        Ok(awarded)
    }

    /// List all bids for a job. Validates the requesting user owns the job (sealed bid).
    ///
    /// # Errors
    ///
    /// Returns `BidError` if the job is not found or the user doesn't own it.
    pub async fn list_bids_for_job(
        &self,
        job_id: Uuid,
        customer_id: Uuid,
    ) -> Result<Vec<Bid>, BidError> {
        // Validate customer owns the job.
        let job = sqlx::query_as::<_, JobRow>(
            "SELECT id, status, offer_accepted_cents, auction_ends_at, customer_id \
             FROM jobs WHERE id = $1",
        )
        .bind(job_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(BidError::JobNotFound)?;

        if job.customer_id != customer_id {
            return Err(BidError::PermissionDenied(
                "only the job owner can view bids".into(),
            ));
        }

        let bids = sqlx::query_as::<_, Bid>(
            "SELECT * FROM bids WHERE job_id = $1 ORDER BY amount_cents ASC",
        )
        .bind(job_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(bids)
    }

    /// List bids for a provider with optional status filter and pagination.
    ///
    /// # Errors
    ///
    /// Returns `BidError` on database errors.
    #[allow(clippy::cast_sign_loss)]
    pub async fn list_bids_for_provider(
        &self,
        provider_id: Uuid,
        status_filter: Option<String>,
        page: i32,
        page_size: i32,
    ) -> Result<(Vec<Bid>, i64), BidError> {
        let offset = i64::from((page - 1).max(0)) * i64::from(page_size.max(1));
        let limit = i64::from(page_size.clamp(1, 100));

        let (bids, total) = if let Some(ref status) = status_filter {
            let bids = sqlx::query_as::<_, Bid>(
                "SELECT * FROM bids \
                 WHERE provider_id = $1 AND status = $2 \
                 ORDER BY created_at DESC \
                 LIMIT $3 OFFSET $4",
            )
            .bind(provider_id)
            .bind(status)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

            let count: CountRow = sqlx::query_as(
                "SELECT COUNT(*) as count FROM bids WHERE provider_id = $1 AND status = $2",
            )
            .bind(provider_id)
            .bind(status)
            .fetch_one(&self.pool)
            .await?;

            (bids, count.count)
        } else {
            let bids = sqlx::query_as::<_, Bid>(
                "SELECT * FROM bids \
                 WHERE provider_id = $1 \
                 ORDER BY created_at DESC \
                 LIMIT $2 OFFSET $3",
            )
            .bind(provider_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

            let count: CountRow =
                sqlx::query_as("SELECT COUNT(*) as count FROM bids WHERE provider_id = $1")
                    .bind(provider_id)
                    .fetch_one(&self.pool)
                    .await?;

            (bids, count.count)
        };

        Ok((bids, total))
    }

    /// Get a single bid by ID.
    ///
    /// # Errors
    ///
    /// Returns `BidError::BidNotFound` if not found.
    pub async fn get_bid(&self, bid_id: Uuid) -> Result<Bid, BidError> {
        sqlx::query_as::<_, Bid>("SELECT * FROM bids WHERE id = $1")
            .bind(bid_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(BidError::BidNotFound)
    }

    /// Get the count of active bids for a job.
    ///
    /// # Errors
    ///
    /// Returns `BidError` on database errors.
    #[allow(clippy::cast_possible_truncation)]
    pub async fn get_bid_count(&self, job_id: Uuid) -> Result<i32, BidError> {
        let row: CountRow = sqlx::query_as(
            "SELECT COUNT(*) as count FROM bids WHERE job_id = $1 AND status = 'active'",
        )
        .bind(job_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(row.count as i32)
    }

    /// Expire all active bids for a job and update job status.
    ///
    /// # Errors
    ///
    /// Returns `BidError` on database errors.
    #[allow(clippy::cast_possible_truncation)]
    pub async fn expire_auction(&self, job_id: Uuid) -> Result<i32, BidError> {
        let result = sqlx::query(
            "UPDATE bids SET status = 'expired', updated_at = now() \
             WHERE job_id = $1 AND status = 'active'",
        )
        .bind(job_id)
        .execute(&self.pool)
        .await?;

        let expired_count = result.rows_affected() as i32;

        // Update job status based on whether there were bids.
        let new_status = if expired_count > 0 {
            "closed"
        } else {
            "closed_zero_bids"
        };
        sqlx::query("UPDATE jobs SET status = $1 WHERE id = $2")
            .bind(new_status)
            .bind(job_id)
            .execute(&self.pool)
            .await?;

        tracing::info!(job_id = %job_id, expired_count, "auction expired");

        Ok(expired_count)
    }

    /// Check for auctions that have passed their deadline or are closing soon.
    ///
    /// # Errors
    ///
    /// Returns `BidError` on database errors.
    pub async fn check_auction_deadlines(
        &self,
        before: DateTime<Utc>,
    ) -> Result<(Vec<Uuid>, Vec<Uuid>), BidError> {
        // Find jobs whose auction has expired.
        let expired: Vec<UuidRow> = sqlx::query_as(
            "SELECT id FROM jobs \
             WHERE status = 'active' AND auction_ends_at IS NOT NULL AND auction_ends_at <= $1",
        )
        .bind(before)
        .fetch_all(&self.pool)
        .await?;

        // Find jobs closing within 2 hours.
        let two_hours = before + chrono::Duration::hours(2);
        let closing_soon: Vec<UuidRow> = sqlx::query_as(
            "SELECT id FROM jobs \
             WHERE status = 'active' \
               AND auction_ends_at IS NOT NULL \
               AND auction_ends_at > $1 \
               AND auction_ends_at <= $2",
        )
        .bind(before)
        .bind(two_hours)
        .fetch_all(&self.pool)
        .await?;

        let expired_ids: Vec<Uuid> = expired.into_iter().map(|r| r.id).collect();
        let closing_ids: Vec<Uuid> = closing_soon.into_iter().map(|r| r.id).collect();

        Ok((expired_ids, closing_ids))
    }

    /// Get aggregate bid analytics for a job.
    ///
    /// # Errors
    ///
    /// Returns `BidError` on database errors.
    #[allow(clippy::cast_possible_truncation)]
    pub async fn get_bid_analytics(&self, job_id: Uuid) -> Result<BidAnalytics, BidError> {
        let stats: AnalyticsRow = sqlx::query_as(
            "SELECT \
               COUNT(*)::bigint as total_bids, \
               COALESCE(MIN(amount_cents), 0) as lowest_bid_cents, \
               COALESCE(MAX(amount_cents), 0) as highest_bid_cents, \
               COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount_cents), 0)::bigint as median_bid_cents, \
               COUNT(*) FILTER (WHERE is_offer_accepted)::bigint as offer_accepted_count, \
               MIN(created_at) as first_bid_at, \
               MAX(created_at) as last_bid_at \
             FROM bids WHERE job_id = $1",
        )
        .bind(job_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(BidAnalytics {
            total_bids: stats.total_bids as i32,
            lowest_bid_cents: stats.lowest_bid_cents,
            highest_bid_cents: stats.highest_bid_cents,
            median_bid_cents: stats.median_bid_cents,
            offer_accepted_count: stats.offer_accepted_count as i32,
            first_bid_at: stats.first_bid_at,
            last_bid_at: stats.last_bid_at,
        })
    }
}

// ---------------------------------------------------------------------------
// Helper row types for sqlx queries
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct JobRow {
    #[allow(dead_code)]
    id: Uuid,
    status: String,
    offer_accepted_cents: Option<i64>,
    auction_ends_at: Option<DateTime<Utc>>,
    customer_id: Uuid,
}

#[derive(sqlx::FromRow)]
struct CountRow {
    count: i64,
}

#[derive(sqlx::FromRow)]
struct UuidRow {
    id: Uuid,
}

#[derive(sqlx::FromRow)]
struct AnalyticsRow {
    total_bids: i64,
    lowest_bid_cents: i64,
    highest_bid_cents: i64,
    median_bid_cents: i64,
    offer_accepted_count: i64,
    first_bid_at: Option<DateTime<Utc>>,
    last_bid_at: Option<DateTime<Utc>>,
}

/// Check if a sqlx error is a unique constraint violation (`PostgreSQL` error code 23505).
fn is_unique_violation(err: &sqlx::Error) -> bool {
    if let sqlx::Error::Database(db_err) = err {
        return db_err.code().as_deref() == Some("23505");
    }
    false
}
