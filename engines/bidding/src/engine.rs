/// Core auction engine for sealed-bid reverse auctions.
///
/// Handles bid placement, validation, auction expiry, and award logic.
/// Target: < 1ms p99 latency for bid processing.
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{AuctionBidEvent, Bid, BidAnalytics, BidError, BidUpdate, LiveAuctionState};

pub struct BiddingEngine {
    pool: PgPool,
    redis: Option<redis::aio::MultiplexedConnection>,
}

impl BiddingEngine {
    #[must_use]
    pub const fn new(pool: PgPool, redis: Option<redis::aio::MultiplexedConnection>) -> Self {
        Self { pool, redis }
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
        let _timer = crate::metrics::BID_PROCESSING_DURATION.start_timer();
        if amount_cents <= 0 {
            return Err(BidError::InvalidAmount(
                "amount must be greater than zero".into(),
            ));
        }

        // Open the transaction up front and lock the job row with FOR UPDATE so
        // the read -> snipe-extension-count check -> snipe-extension UPDATE below
        // is serialized against concurrent bids on the same job. Without the lock,
        // two bids in the final snipe window can both pass the
        // `snipe_extension_count < 3` check (TOCTOU) and both extend the deadline,
        // or interleave so an extension is computed against a stale deadline.
        // Mirrors the locked read in `award_bid`.
        let mut tx = self.pool.begin().await?;

        // Validate auction is active and not expired.
        let job = sqlx::query_as::<_, JobRow>(
            "SELECT id, status, offer_accepted_cents, starting_bid_cents, auction_ends_at, customer_id, auction_type, snipe_extension_count \
             FROM jobs WHERE id = $1 FOR UPDATE",
        )
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(BidError::JobNotFound)?;

        // A customer must not bid on their own job. Self-bidding lets the owner
        // pollute their own sealed-bid pool, inflate bid_count, trigger their own
        // offer-accepted threshold, and award themselves. Symmetric with the
        // forward path's seller-can't-bid guard (forward.rs).
        if job.customer_id == provider_id {
            return Err(BidError::PermissionDenied(
                "you cannot bid on your own job".into(),
            ));
        }

        if job.status != "active" {
            return Err(BidError::AuctionNotActive);
        }

        if let Some(ends_at) = job.auction_ends_at
            && ends_at <= Utc::now()
        {
            return Err(BidError::AuctionClosed);
        }

        // Validate bid does not exceed the starting bid (maximum price cap).
        if let Some(starting_bid) = job.starting_bid_cents
            && amount_cents > starting_bid
        {
            return Err(BidError::AboveStartingBid {
                amount: amount_cents,
                starting_bid,
            });
        }

        // Check if bid amount meets the offer-accepted threshold for auto-accept.
        let is_offer_accepted = job
            .offer_accepted_cents
            .is_some_and(|offer| amount_cents <= offer);

        // Insert bid and let the database trigger maintain bid_count.
        //
        // NOTE: jobs.bid_count is maintained by the AFTER-INSERT trigger
        // bids_update_bid_count installed by migration 029 and switched
        // to atomic delta updates (`bid_count = bid_count + 1`) by
        // migration 030. We MUST NOT also do an explicit increment from
        // app code — under concurrency, an explicit `+1` racing the
        // trigger's atomic delta produces over-counts, and a recomputing
        // trigger (the v029 form) racing in-flight inserts produces
        // under-counts. Tier 1 audit caught both modes via
        // services/job/internal/service/bid_race_test.go.
        //
        // The job row is already locked FOR UPDATE on the transaction `tx`
        // opened at the top of this function; reuse it here.
        let bid = sqlx::query_as::<_, Bid>(
            "INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, is_offer_accepted) \
             VALUES ($1, $2, $3, $3, $4) \
             RETURNING *",
        )
        .bind(job_id)
        .bind(provider_id)
        .bind(amount_cents)
        .bind(is_offer_accepted)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            if is_unique_violation(&e) {
                BidError::AlreadyBid
            } else {
                BidError::DatabaseError(e)
            }
        })?;

        // Live auction: record event and check anti-snipe
        if job.auction_type == "live" {
            sqlx::query(
                "INSERT INTO auction_bid_events (job_id, amount_cents, event_type) VALUES ($1, $2, 'bid_placed')"
            )
            .bind(job_id)
            .bind(amount_cents)
            .execute(&mut *tx)
            .await
            .map_err(BidError::DatabaseError)?;

            // Anti-snipe: if within final 5 minutes and extensions < 3, extend by 5 min
            let snipe_window = sqlx::query_scalar::<_, bool>(
                "SELECT auction_ends_at IS NOT NULL AND auction_ends_at - INTERVAL '5 minutes' <= now() AND snipe_extension_count < 3 FROM jobs WHERE id = $1"
            )
            .bind(job_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(BidError::DatabaseError)?;

            if snipe_window {
                sqlx::query(
                    "UPDATE jobs SET auction_ends_at = auction_ends_at + INTERVAL '5 minutes', snipe_extension_count = snipe_extension_count + 1, updated_at = now() WHERE id = $1"
                )
                .bind(job_id)
                .execute(&mut *tx)
                .await
                .map_err(BidError::DatabaseError)?;
            }
        }

        tx.commit().await?;

        // Publish to Redis for live streaming (fire-and-forget)
        if job.auction_type == "live"
            && let Some(ref mut redis_conn) = self.redis.clone()
        {
            let event = serde_json::json!({
                "type": "bid_placed",
                "job_id": job_id.to_string(),
                "amount_cents": amount_cents,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            });
            let topic = format!("auction:{job_id}");
            let _ = redis::cmd("PUBLISH")
                .arg(&topic)
                .arg(event.to_string())
                .query_async::<()>(redis_conn)
                .await;
        }

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

        // Live auction: record event and check anti-snipe
        let auction_type: String = sqlx::query_scalar(
            "SELECT auction_type FROM jobs WHERE id = (SELECT job_id FROM bids WHERE id = $1)",
        )
        .bind(bid_id)
        .fetch_one(&self.pool)
        .await
        .map_err(BidError::DatabaseError)?;

        if auction_type == "live" {
            sqlx::query(
                "INSERT INTO auction_bid_events (job_id, amount_cents, event_type) VALUES ($1, $2, 'bid_updated')"
            )
            .bind(bid.job_id)
            .bind(new_amount)
            .execute(&self.pool)
            .await
            .map_err(BidError::DatabaseError)?;

            // Anti-snipe check
            let snipe_window: bool = sqlx::query_scalar(
                "SELECT auction_ends_at IS NOT NULL AND auction_ends_at - INTERVAL '5 minutes' <= now() AND snipe_extension_count < 3 FROM jobs WHERE id = $1"
            )
            .bind(bid.job_id)
            .fetch_one(&self.pool)
            .await
            .map_err(BidError::DatabaseError)?;

            if snipe_window {
                sqlx::query(
                    "UPDATE jobs SET auction_ends_at = auction_ends_at + INTERVAL '5 minutes', snipe_extension_count = snipe_extension_count + 1, updated_at = now() WHERE id = $1"
                )
                .bind(bid.job_id)
                .execute(&self.pool)
                .await
                .map_err(BidError::DatabaseError)?;
            }

            // Publish to Redis
            if let Some(ref mut redis_conn) = self.redis.clone() {
                let event = serde_json::json!({
                    "type": "bid_updated",
                    "job_id": bid.job_id.to_string(),
                    "amount_cents": new_amount,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                });
                let topic = format!("auction:{}", bid.job_id);
                let _ = redis::cmd("PUBLISH")
                    .arg(&topic)
                    .arg(event.to_string())
                    .query_async::<()>(redis_conn)
                    .await;
            }
        }

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
    pub async fn withdraw_bid(&self, bid_id: Uuid, provider_id: Uuid) -> Result<Bid, BidError> {
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

        // Live auction: record withdrawal event
        let auction_type: String = sqlx::query_scalar(
            "SELECT auction_type FROM jobs WHERE id = (SELECT job_id FROM bids WHERE id = $1)",
        )
        .bind(bid_id)
        .fetch_one(&self.pool)
        .await
        .map_err(BidError::DatabaseError)?;

        if auction_type == "live" {
            sqlx::query(
                "INSERT INTO auction_bid_events (job_id, amount_cents, event_type) VALUES ($1, $2, 'bid_withdrawn')"
            )
            .bind(bid.job_id)
            .bind(bid.amount_cents)
            .execute(&self.pool)
            .await
            .map_err(BidError::DatabaseError)?;

            if let Some(ref mut redis_conn) = self.redis.clone() {
                let event = serde_json::json!({
                    "type": "bid_withdrawn",
                    "job_id": bid.job_id.to_string(),
                    "amount_cents": bid.amount_cents,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                });
                let topic = format!("auction:{}", bid.job_id);
                let _ = redis::cmd("PUBLISH")
                    .arg(&topic)
                    .arg(event.to_string())
                    .query_async::<()>(redis_conn)
                    .await;
            }
        }

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
        // Instant-match accept is an EXCLUSIVE claim: the first provider to
        // accept an offer wins the job, and every subsequent accept must fail.
        // The only DB-level guard previously was UNIQUE(job_id, provider_id),
        // which stops the SAME provider double-accepting but lets two DIFFERENT
        // providers both INSERT an offer-accepted bid — a double-award race
        // (two concurrent accepts → two `is_offer_accepted` bids on one job).
        //
        // Fix: run the whole accept inside a transaction that locks the job row
        // FOR UPDATE (mirroring `place_bid` / `award_bid`), then reject if the
        // job has already been claimed — either it has left `active` status
        // (already awarded/matched) or an offer-accepted bid already exists.
        // Under the row lock the two concurrent accepts are serialized: the
        // first transitions the job to `awarded` and commits; the second
        // re-reads the now-`awarded` status (or sees the existing offer bid)
        // and returns a clean error → 4xx, never a second accepted bid.
        let mut tx = self.pool.begin().await?;

        let job = sqlx::query_as::<_, JobRow>(
            "SELECT id, status, offer_accepted_cents, starting_bid_cents, auction_ends_at, customer_id, auction_type, snipe_extension_count \
             FROM jobs WHERE id = $1 FOR UPDATE",
        )
        .bind(job_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(BidError::JobNotFound)?;

        // A customer must not accept the offer on their own job (self-dealing).
        if job.customer_id == provider_id {
            return Err(BidError::PermissionDenied(
                "you cannot bid on your own job".into(),
            ));
        }

        let offer_cents = job
            .offer_accepted_cents
            .ok_or_else(|| BidError::InvalidAmount("job has no offer accepted price".into()))?;

        // The job must still be open. A non-`active` status means it has already
        // been awarded/matched by a competing accept (or otherwise closed) — the
        // second accept loses here. AuctionNotActive → failed_precondition → 422.
        if job.status != "active" {
            return Err(BidError::AuctionNotActive);
        }

        if let Some(ends_at) = job.auction_ends_at
            && ends_at <= Utc::now()
        {
            return Err(BidError::AuctionClosed);
        }

        // Backstop guard, still under the FOR UPDATE lock: if any offer-accepted
        // bid already exists for this job, the offer has been claimed. This
        // catches the race even if the job-status transition below is ever
        // bypassed, and rejects with AlreadyBid → already_exists → 409 Conflict.
        let already_accepted: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM bids WHERE job_id = $1 AND is_offer_accepted = true AND status IN ('active', 'awarded'))",
        )
        .bind(job_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(BidError::DatabaseError)?;

        if already_accepted {
            return Err(BidError::AlreadyBid);
        }

        // Insert bid at the offer price with is_offer_accepted = true.
        // UNIQUE(job_id, provider_id) still guards the same-provider retry case.
        let bid = sqlx::query_as::<_, Bid>(
            "INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, is_offer_accepted, status) \
             VALUES ($1, $2, $3, $3, true, 'awarded') \
             RETURNING *",
        )
        .bind(job_id)
        .bind(provider_id)
        .bind(offer_cents)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            if is_unique_violation(&e) {
                BidError::AlreadyBid
            } else {
                BidError::DatabaseError(e)
            }
        })?;

        // Atomically claim the job for this provider. Transitioning the job out
        // of `active` is what makes a concurrent second accept fail its
        // `status != "active"` check above once this tx commits.
        sqlx::query(
            "UPDATE jobs SET status = 'awarded', \
             awarded_provider_id = $1, awarded_bid_id = $2, awarded_at = now(), \
             bid_count = bid_count + 1, updated_at = now() \
             WHERE id = $3",
        )
        .bind(provider_id)
        .bind(bid.id)
        .bind(job_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        crate::metrics::BIDS_AWARDED_TOTAL.inc();

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
        let _timer = crate::metrics::BID_PROCESSING_DURATION.start_timer();
        let mut tx = self.pool.begin().await?;

        // Validate customer owns the job. Lock the row to prevent concurrent awards.
        let job = sqlx::query_as::<_, JobRow>(
            "SELECT id, status, offer_accepted_cents, starting_bid_cents, auction_ends_at, customer_id, auction_type, snipe_extension_count \
             FROM jobs WHERE id = $1 FOR UPDATE",
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
        let bid = sqlx::query_as::<_, Bid>("SELECT * FROM bids WHERE id = $1 FOR UPDATE")
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

        crate::metrics::BIDS_AWARDED_TOTAL.inc();

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
    /// The `sort_field` parameter controls ordering. Supported values:
    /// - `"price"` or empty: order by `amount_cents ASC` (default, lowest bid first)
    /// - `"created_at"`: order by `created_at DESC` (newest first)
    ///
    /// The `sort_direction` parameter: `"asc"` or `"desc"` (default depends on field).
    ///
    /// # Errors
    ///
    /// Returns `BidError` if the job is not found or the user doesn't own it.
    pub async fn list_bids_for_job(
        &self,
        job_id: Uuid,
        customer_id: Uuid,
        sort_field: &str,
        sort_direction: &str,
    ) -> Result<Vec<Bid>, BidError> {
        // Validate customer owns the job.
        let job = sqlx::query_as::<_, JobRow>(
            "SELECT id, status, offer_accepted_cents, starting_bid_cents, auction_ends_at, customer_id, auction_type, snipe_extension_count \
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

        // Determine ORDER BY clause from sort parameters. Only allow
        // whitelisted column names to prevent SQL injection.
        let column = match sort_field {
            "created_at" => "created_at",
            // "price" or any unrecognized field defaults to amount_cents
            _ => "amount_cents",
        };
        let direction = match sort_direction {
            "desc" => "DESC",
            "asc" => "ASC",
            _ => {
                // Default direction: ASC for price, DESC for created_at.
                if column == "amount_cents" {
                    "ASC"
                } else {
                    "DESC"
                }
            }
        };

        let query = format!("SELECT * FROM bids WHERE job_id = $1 ORDER BY {column} {direction}");

        let bids = sqlx::query_as::<_, Bid>(&query)
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

    /// Get a single bid by ID, enforcing that the requester is allowed to view it.
    ///
    /// In a sealed reverse auction the full details of a bid (amount, provider,
    /// status) must only be visible to:
    /// - the **bid owner** (the provider who placed it),
    /// - the **job's customer** (the owner of the auction), or
    /// - an **admin** (`is_admin == true`).
    ///
    /// Any other authenticated user — e.g. a competing provider — must be denied,
    /// otherwise rivals could read each other's sealed bids by GUID (IDOR).
    ///
    /// # Errors
    ///
    /// - `BidError::BidNotFound` if the bid does not exist.
    /// - `BidError::JobNotFound` if the bid's job is missing (data integrity issue).
    /// - `BidError::PermissionDenied` if the requester is not the bid owner, the job
    ///   customer, or an admin.
    pub async fn get_bid_authorized(
        &self,
        bid_id: Uuid,
        requesting_user_id: Uuid,
        is_admin: bool,
    ) -> Result<Bid, BidError> {
        let bid = self.get_bid(bid_id).await?;

        // Admins may view any bid (e.g. dispute resolution, support).
        if is_admin {
            return Ok(bid);
        }

        // The bid owner (provider who placed it) may always view it.
        if bid.provider_id == requesting_user_id {
            return Ok(bid);
        }

        // The customer who owns the auction may view bids on their job.
        let job = sqlx::query_as::<_, JobRow>(
            "SELECT id, status, offer_accepted_cents, starting_bid_cents, auction_ends_at, customer_id, auction_type, snipe_extension_count \
             FROM jobs WHERE id = $1",
        )
        .bind(bid.job_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(BidError::JobNotFound)?;

        if job.customer_id == requesting_user_id {
            return Ok(bid);
        }

        Err(BidError::PermissionDenied(
            "not authorized to view this bid".into(),
        ))
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

    pub async fn get_live_auction_state(&self, job_id: Uuid) -> Result<LiveAuctionState, BidError> {
        let row = sqlx::query_as::<_, (i32, Option<DateTime<Utc>>, i32, String)>(
            "SELECT bid_count, auction_ends_at, snipe_extension_count, auction_type FROM jobs WHERE id = $1 AND status = 'active'"
        )
        .bind(job_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(BidError::DatabaseError)?
        .ok_or(BidError::JobNotFound)?;

        if row.3 != "live" {
            return Err(BidError::FeatureNotEnabled(
                "live auctions not enabled for this job".into(),
            ));
        }

        let lowest: Option<i64> = sqlx::query_scalar(
            "SELECT MIN(amount_cents) FROM bids WHERE job_id = $1 AND status = 'active'",
        )
        .bind(job_id)
        .fetch_one(&self.pool)
        .await
        .map_err(BidError::DatabaseError)?;

        let recent_events = sqlx::query_as::<_, AuctionBidEvent>(
            "SELECT id, job_id, amount_cents, event_type, created_at FROM auction_bid_events WHERE job_id = $1 ORDER BY created_at DESC LIMIT 50"
        )
        .bind(job_id)
        .fetch_all(&self.pool)
        .await
        .map_err(BidError::DatabaseError)?;

        Ok(LiveAuctionState {
            job_id,
            lowest_bid_cents: lowest.unwrap_or(0),
            bid_count: row.0,
            auction_ends_at: row.1,
            snipe_extension_count: row.2,
            max_snipe_extensions: 3,
            recent_events,
        })
    }

    pub async fn get_auction_events(&self, job_id: Uuid) -> Result<Vec<AuctionBidEvent>, BidError> {
        let events = sqlx::query_as::<_, AuctionBidEvent>(
            "SELECT id, job_id, amount_cents, event_type, created_at FROM auction_bid_events WHERE job_id = $1 ORDER BY created_at ASC"
        )
        .bind(job_id)
        .fetch_all(&self.pool)
        .await
        .map_err(BidError::DatabaseError)?;

        Ok(events)
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
    starting_bid_cents: Option<i64>,
    auction_ends_at: Option<DateTime<Utc>>,
    customer_id: Uuid,
    auction_type: String,
    // Selected by the JobRow query for row-shape parity, but the snipe-extension
    // logic re-reads the live count in its own atomic UPDATE (TOCTOU-safe), so it
    // is never read off this struct. Same situation as `id` above.
    #[allow(dead_code)]
    snipe_extension_count: i32,
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

/// Validate that a bid amount is positive.
///
/// Returns `Ok(())` when `amount_cents > 0`, or `BidError::InvalidAmount` otherwise.
/// This is the same check used inside `place_bid` and `update_bid`, extracted for
/// testability and benchmarking.
// Part of the lib's public, unit/integration/bench-tested surface; the gRPC
// binary inlines the equivalent check, so it is unused in the `bin` target only.
#[allow(dead_code)]
#[must_use]
pub fn validate_bid_amount(amount_cents: i64) -> Result<(), BidError> {
    if amount_cents <= 0 {
        return Err(BidError::InvalidAmount(
            "amount must be greater than zero".into(),
        ));
    }
    Ok(())
}

/// Rank bids by amount ascending (lowest bid wins in a reverse auction).
///
/// Returns a new `Vec<Bid>` sorted from lowest to highest `amount_cents`.
// Lib/test/bench surface; the gRPC binary ranks via SQL `ORDER BY`, so this is
// unused in the `bin` target only.
#[allow(dead_code)]
#[must_use]
pub fn rank_bids(bids: &[Bid]) -> Vec<Bid> {
    let mut sorted = bids.to_vec();
    sorted.sort_by_key(|b| b.amount_cents);
    sorted
}

/// Determine whether a bid qualifies as an "offer accepted" bid.
///
/// Returns `true` when the offer threshold is set and `amount_cents` is at or below it.
// Lib/test/bench surface; the gRPC binary derives this inline in `place_bid`, so
// this standalone helper is unused in the `bin` target only.
#[allow(dead_code)]
#[must_use]
pub fn is_offer_accepted(offer_accepted_cents: Option<i64>, amount_cents: i64) -> bool {
    offer_accepted_cents.is_some_and(|offer| amount_cents <= offer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    /// Helper: build a minimal `Bid` for testing.
    fn make_bid(amount_cents: i64, provider_id: Uuid, status: &str) -> Bid {
        let now = Utc::now();
        Bid {
            id: Uuid::now_v7(),
            job_id: Uuid::now_v7(),
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

    // ------------------------------------------------------------------
    // validate_bid_amount
    // ------------------------------------------------------------------

    #[test]
    fn validate_bid_amount_positive_is_ok() {
        assert!(validate_bid_amount(1).is_ok());
        assert!(validate_bid_amount(100_000).is_ok());
    }

    #[test]
    fn validate_bid_amount_zero_is_err() {
        let err = validate_bid_amount(0).unwrap_err();
        assert!(matches!(err, BidError::InvalidAmount(_)));
    }

    #[test]
    fn validate_bid_amount_negative_is_err() {
        let err = validate_bid_amount(-500).unwrap_err();
        assert!(matches!(err, BidError::InvalidAmount(_)));
    }

    // ------------------------------------------------------------------
    // rank_bids — reverse auction: lowest bid wins
    // ------------------------------------------------------------------

    #[test]
    fn rank_bids_returns_lowest_first() {
        let p = Uuid::now_v7();
        let bids = vec![
            make_bid(5000, p, "active"),
            make_bid(1000, p, "active"),
            make_bid(3000, p, "active"),
        ];

        let ranked = rank_bids(&bids);
        assert_eq!(ranked[0].amount_cents, 1000);
        assert_eq!(ranked[1].amount_cents, 3000);
        assert_eq!(ranked[2].amount_cents, 5000);
    }

    #[test]
    fn rank_bids_equal_amounts_stable() {
        let p = Uuid::now_v7();
        let bids = vec![make_bid(2000, p, "active"), make_bid(2000, p, "active")];

        let ranked = rank_bids(&bids);
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].amount_cents, 2000);
        assert_eq!(ranked[1].amount_cents, 2000);
    }

    #[test]
    fn rank_bids_single_bid() {
        let p = Uuid::now_v7();
        let bids = vec![make_bid(4200, p, "active")];
        let ranked = rank_bids(&bids);
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].amount_cents, 4200);
    }

    #[test]
    fn rank_bids_empty() {
        let ranked = rank_bids(&[]);
        assert!(ranked.is_empty());
    }

    // ------------------------------------------------------------------
    // is_offer_accepted
    // ------------------------------------------------------------------

    #[test]
    fn offer_accepted_at_threshold() {
        assert!(is_offer_accepted(Some(5000), 5000));
    }

    #[test]
    fn offer_accepted_below_threshold() {
        assert!(is_offer_accepted(Some(5000), 3000));
    }

    #[test]
    fn offer_not_accepted_above_threshold() {
        assert!(!is_offer_accepted(Some(5000), 6000));
    }

    #[test]
    fn offer_not_accepted_when_none() {
        assert!(!is_offer_accepted(None, 5000));
    }

    // ------------------------------------------------------------------
    // BidError Display messages
    // ------------------------------------------------------------------

    #[test]
    fn bid_error_display_messages() {
        assert_eq!(
            BidError::AuctionClosed.to_string(),
            "auction is closed or not active"
        );
        assert_eq!(BidError::BidNotFound.to_string(), "bid not found");
        assert_eq!(
            BidError::AlreadyBid.to_string(),
            "provider already has an active bid on this job"
        );
    }

    // ------------------------------------------------------------------
    // is_unique_violation helper
    // ------------------------------------------------------------------

    #[test]
    fn is_unique_violation_returns_false_for_non_db_error() {
        let err = sqlx::Error::RowNotFound;
        assert!(!is_unique_violation(&err));
    }

    // ------------------------------------------------------------------
    // BidUpdate serialization round-trip
    // ------------------------------------------------------------------

    #[test]
    fn bid_update_serialization_roundtrip() {
        let update = BidUpdate {
            amount_cents: 4200,
            updated_at: Utc::now(),
        };
        let json = serde_json::to_string(&update).expect("serialize");
        let parsed: BidUpdate = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.amount_cents, 4200);
    }

    // ------------------------------------------------------------------
    // BidAnalytics default
    // ------------------------------------------------------------------

    #[test]
    fn bid_analytics_default_is_zeroed() {
        let a = BidAnalytics::default();
        assert_eq!(a.total_bids, 0);
        assert_eq!(a.lowest_bid_cents, 0);
        assert_eq!(a.highest_bid_cents, 0);
        assert_eq!(a.median_bid_cents, 0);
        assert_eq!(a.offer_accepted_count, 0);
        assert!(a.first_bid_at.is_none());
        assert!(a.last_bid_at.is_none());
    }

    // ------------------------------------------------------------------
    // Concurrent bid safety: rank_bids is deterministic
    // ------------------------------------------------------------------

    #[test]
    fn concurrent_bids_do_not_lose_data() {
        let providers: Vec<Uuid> = (0..100).map(|_| Uuid::now_v7()).collect();
        let bids: Vec<Bid> = providers
            .iter()
            .enumerate()
            .map(|(i, p)| {
                #[allow(clippy::cast_possible_wrap)]
                make_bid((100 - i as i64) * 100, *p, "active")
            })
            .collect();

        let ranked = rank_bids(&bids);
        assert_eq!(ranked.len(), 100);
        // Verify sorted ascending.
        for window in ranked.windows(2) {
            assert!(window[0].amount_cents <= window[1].amount_cents);
        }
    }

    // ------------------------------------------------------------------
    // proptest: arbitrary bid amounts never panic, output is deterministic
    // ------------------------------------------------------------------

    mod proptests {
        use super::*;
        use proptest::prelude::*;

        proptest! {
            #[test]
            fn validate_bid_amount_never_panics(amount in proptest::num::i64::ANY) {
                let _ = validate_bid_amount(amount);
            }

            #[test]
            fn validate_positive_always_ok(amount in 1..=i64::MAX) {
                prop_assert!(validate_bid_amount(amount).is_ok());
            }

            #[test]
            fn validate_nonpositive_always_err(amount in i64::MIN..=0i64) {
                prop_assert!(validate_bid_amount(amount).is_err());
            }

            #[test]
            fn rank_bids_output_is_sorted(amounts in proptest::collection::vec(1..=100_000_000i64, 0..50)) {
                let p = Uuid::now_v7();
                let bids: Vec<Bid> = amounts.iter().map(|&a| make_bid(a, p, "active")).collect();
                let ranked = rank_bids(&bids);
                prop_assert_eq!(ranked.len(), bids.len());
                for window in ranked.windows(2) {
                    prop_assert!(window[0].amount_cents <= window[1].amount_cents);
                }
            }

            #[test]
            fn is_offer_accepted_deterministic(offer in proptest::option::of(1..=100_000_000i64), amount in 1..=100_000_000i64) {
                let r1 = is_offer_accepted(offer, amount);
                let r2 = is_offer_accepted(offer, amount);
                prop_assert_eq!(r1, r2);
            }
        }
    }
}
