/// Generated protobuf types and gRPC service definitions.
///
/// Module hierarchy mirrors proto package paths so relative imports resolve correctly.

#[allow(clippy::all, clippy::pedantic, dead_code)]
pub mod nomarkup {
    pub mod common {
        pub mod v1 {
            tonic::include_proto!("nomarkup.common.v1");
        }
    }
    pub mod user {
        pub mod v1 {
            tonic::include_proto!("nomarkup.user.v1");
        }
    }
    pub mod bid {
        pub mod v1 {
            tonic::include_proto!("nomarkup.bid.v1");
        }
    }
}

// Re-export for convenience.
pub use nomarkup::bid::v1 as bid_proto;
pub use nomarkup::bid::v1::bid_service_server::{BidService, BidServiceServer};

use std::sync::Arc;

use chrono::TimeZone;
use tonic::{Request, Response, Status};
use uuid::Uuid;

use crate::engine::BiddingEngine;
use crate::models::{Bid, BidError};

/// gRPC service implementation wrapping the bidding engine.
pub struct BidServiceImpl {
    engine: Arc<BiddingEngine>,
}

impl BidServiceImpl {
    #[must_use]
    pub fn new(engine: Arc<BiddingEngine>) -> Self {
        Self { engine }
    }
}

#[tonic::async_trait]
impl BidService for BidServiceImpl {
    async fn place_bid(
        &self,
        request: Request<bid_proto::PlaceBidRequest>,
    ) -> Result<Response<bid_proto::PlaceBidResponse>, Status> {
        let req = request.into_inner();

        let job_id = parse_uuid(&req.job_id, "job_id")?;
        let provider_id = parse_uuid(&req.provider_id, "provider_id")?;

        if req.amount_cents <= 0 {
            return Err(Status::invalid_argument("amount_cents must be positive"));
        }

        let bid = self
            .engine
            .place_bid(job_id, provider_id, req.amount_cents)
            .await
            .map_err(bid_error_to_status)?;

        Ok(Response::new(bid_proto::PlaceBidResponse {
            bid: Some(bid_to_proto(&bid)),
        }))
    }

    async fn update_bid(
        &self,
        request: Request<bid_proto::UpdateBidRequest>,
    ) -> Result<Response<bid_proto::UpdateBidResponse>, Status> {
        let req = request.into_inner();

        let bid_id = parse_uuid(&req.bid_id, "bid_id")?;
        let provider_id = parse_uuid(&req.provider_id, "provider_id")?;

        if req.new_amount_cents <= 0 {
            return Err(Status::invalid_argument(
                "new_amount_cents must be positive",
            ));
        }

        let bid = self
            .engine
            .update_bid(bid_id, provider_id, req.new_amount_cents)
            .await
            .map_err(bid_error_to_status)?;

        Ok(Response::new(bid_proto::UpdateBidResponse {
            bid: Some(bid_to_proto(&bid)),
        }))
    }

    async fn withdraw_bid(
        &self,
        request: Request<bid_proto::WithdrawBidRequest>,
    ) -> Result<Response<bid_proto::WithdrawBidResponse>, Status> {
        let req = request.into_inner();

        let bid_id = parse_uuid(&req.bid_id, "bid_id")?;
        let provider_id = parse_uuid(&req.provider_id, "provider_id")?;

        let bid = self
            .engine
            .withdraw_bid(bid_id, provider_id)
            .await
            .map_err(bid_error_to_status)?;

        Ok(Response::new(bid_proto::WithdrawBidResponse {
            bid: Some(bid_to_proto(&bid)),
        }))
    }

    async fn accept_offer_price(
        &self,
        request: Request<bid_proto::AcceptOfferPriceRequest>,
    ) -> Result<Response<bid_proto::AcceptOfferPriceResponse>, Status> {
        let req = request.into_inner();

        let job_id = parse_uuid(&req.job_id, "job_id")?;
        let provider_id = parse_uuid(&req.provider_id, "provider_id")?;

        let bid = self
            .engine
            .accept_offer_price(job_id, provider_id)
            .await
            .map_err(bid_error_to_status)?;

        Ok(Response::new(bid_proto::AcceptOfferPriceResponse {
            bid: Some(bid_to_proto(&bid)),
        }))
    }

    async fn award_bid(
        &self,
        request: Request<bid_proto::AwardBidRequest>,
    ) -> Result<Response<bid_proto::AwardBidResponse>, Status> {
        let req = request.into_inner();

        let job_id = parse_uuid(&req.job_id, "job_id")?;
        let bid_id = parse_uuid(&req.bid_id, "bid_id")?;
        let customer_id = parse_uuid(&req.customer_id, "customer_id")?;

        let bid = self
            .engine
            .award_bid(job_id, bid_id, customer_id)
            .await
            .map_err(bid_error_to_status)?;

        Ok(Response::new(bid_proto::AwardBidResponse {
            awarded_bid: Some(bid_to_proto(&bid)),
            contract_id: String::new(), // contract service will generate this
        }))
    }

    async fn get_bid(
        &self,
        request: Request<bid_proto::GetBidRequest>,
    ) -> Result<Response<bid_proto::GetBidResponse>, Status> {
        let req = request.into_inner();

        let bid_id = parse_uuid(&req.bid_id, "bid_id")?;

        let bid = self
            .engine
            .get_bid(bid_id)
            .await
            .map_err(bid_error_to_status)?;

        Ok(Response::new(bid_proto::GetBidResponse {
            bid: Some(bid_to_proto(&bid)),
        }))
    }

    async fn list_bids_for_job(
        &self,
        request: Request<bid_proto::ListBidsForJobRequest>,
    ) -> Result<Response<bid_proto::ListBidsForJobResponse>, Status> {
        let req = request.into_inner();

        let job_id = parse_uuid(&req.job_id, "job_id")?;
        let customer_id = parse_uuid(&req.customer_id, "customer_id")?;

        let bids = self
            .engine
            .list_bids_for_job(job_id, customer_id)
            .await
            .map_err(bid_error_to_status)?;

        // Return as BidWithProvider (provider details would be enriched by a
        // separate service; for now we return bid data with empty provider fields).
        let proto_bids: Vec<bid_proto::BidWithProvider> = bids
            .iter()
            .map(|b| bid_proto::BidWithProvider {
                bid: Some(bid_to_proto(b)),
                provider_display_name: String::new(),
                provider_business_name: String::new(),
                provider_avatar_url: String::new(),
                trust_score: None,
                review_summary: None,
                badges: vec![],
                jobs_completed: 0,
            })
            .collect();

        Ok(Response::new(bid_proto::ListBidsForJobResponse {
            bids: proto_bids,
        }))
    }

    #[allow(clippy::cast_possible_truncation)]
    async fn list_bids_for_provider(
        &self,
        request: Request<bid_proto::ListBidsForProviderRequest>,
    ) -> Result<Response<bid_proto::ListBidsForProviderResponse>, Status> {
        let req = request.into_inner();

        let provider_id = parse_uuid(&req.provider_id, "provider_id")?;

        let status_filter = if req.status_filter.is_some() {
            let status_val = req.status_filter();
            match status_val {
                bid_proto::BidStatus::Unspecified => None,
                bid_proto::BidStatus::Active => Some("active".to_string()),
                bid_proto::BidStatus::Awarded => Some("awarded".to_string()),
                bid_proto::BidStatus::NotSelected => Some("not_selected".to_string()),
                bid_proto::BidStatus::Withdrawn => Some("withdrawn".to_string()),
                bid_proto::BidStatus::Expired => Some("expired".to_string()),
            }
        } else {
            None
        };

        let (page, page_size) = if let Some(ref pag) = req.pagination {
            (pag.page, pag.page_size)
        } else {
            (1, 20)
        };

        let (bids, total) = self
            .engine
            .list_bids_for_provider(provider_id, status_filter, page, page_size)
            .await
            .map_err(bid_error_to_status)?;

        let proto_bids: Vec<bid_proto::Bid> = bids.iter().map(bid_to_proto).collect();

        let total_pages = if page_size > 0 {
            ((total + i64::from(page_size) - 1) / i64::from(page_size)) as i32
        } else {
            0
        };

        Ok(Response::new(bid_proto::ListBidsForProviderResponse {
            bids: proto_bids,
            pagination: Some(nomarkup::common::v1::PaginationResponse {
                total_count: total as i32,
                page,
                page_size,
                total_pages,
                has_next: page < total_pages,
            }),
        }))
    }

    async fn get_bid_count(
        &self,
        request: Request<bid_proto::GetBidCountRequest>,
    ) -> Result<Response<bid_proto::GetBidCountResponse>, Status> {
        let req = request.into_inner();

        let job_id = parse_uuid(&req.job_id, "job_id")?;

        let count = self
            .engine
            .get_bid_count(job_id)
            .await
            .map_err(bid_error_to_status)?;

        Ok(Response::new(bid_proto::GetBidCountResponse { count }))
    }

    async fn expire_auction(
        &self,
        request: Request<bid_proto::ExpireAuctionRequest>,
    ) -> Result<Response<bid_proto::ExpireAuctionResponse>, Status> {
        let req = request.into_inner();

        let job_id = parse_uuid(&req.job_id, "job_id")?;

        let bids_expired = self
            .engine
            .expire_auction(job_id)
            .await
            .map_err(bid_error_to_status)?;

        Ok(Response::new(bid_proto::ExpireAuctionResponse {
            bids_expired,
        }))
    }

    async fn check_auction_deadlines(
        &self,
        request: Request<bid_proto::CheckAuctionDeadlinesRequest>,
    ) -> Result<Response<bid_proto::CheckAuctionDeadlinesResponse>, Status> {
        let req = request.into_inner();

        let before = req
            .before
            .map(|ts| {
                chrono::Utc
                    .timestamp_opt(ts.seconds, ts.nanos.try_into().unwrap_or(0))
                    .single()
                    .ok_or_else(|| Status::invalid_argument("invalid timestamp"))
            })
            .transpose()?
            .unwrap_or_else(chrono::Utc::now);

        let (expired_ids, closing_soon_ids) = self
            .engine
            .check_auction_deadlines(before)
            .await
            .map_err(bid_error_to_status)?;

        Ok(Response::new(
            bid_proto::CheckAuctionDeadlinesResponse {
                expired_job_ids: expired_ids.iter().map(ToString::to_string).collect(),
                closing_soon_job_ids: closing_soon_ids
                    .iter()
                    .map(ToString::to_string)
                    .collect(),
            },
        ))
    }

    async fn get_bid_analytics(
        &self,
        request: Request<bid_proto::GetBidAnalyticsRequest>,
    ) -> Result<Response<bid_proto::GetBidAnalyticsResponse>, Status> {
        let req = request.into_inner();

        let job_id = parse_uuid(&req.job_id, "job_id")?;

        let analytics = self
            .engine
            .get_bid_analytics(job_id)
            .await
            .map_err(bid_error_to_status)?;

        Ok(Response::new(bid_proto::GetBidAnalyticsResponse {
            total_bids: analytics.total_bids,
            lowest_bid_cents: analytics.lowest_bid_cents,
            highest_bid_cents: analytics.highest_bid_cents,
            median_bid_cents: analytics.median_bid_cents,
            offer_accepted_count: analytics.offer_accepted_count,
            first_bid_at: analytics.first_bid_at.map(datetime_to_proto),
            last_bid_at: analytics.last_bid_at.map(datetime_to_proto),
        }))
    }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

#[allow(clippy::result_large_err)]
fn parse_uuid(s: &str, field: &str) -> Result<Uuid, Status> {
    s.parse::<Uuid>()
        .map_err(|_| Status::invalid_argument(format!("invalid {field}: {s}")))
}

fn bid_to_proto(bid: &Bid) -> bid_proto::Bid {
    // Parse bid_updates JSONB into proto BidUpdate list.
    let bid_history: Vec<bid_proto::BidUpdate> = serde_json::from_value::<
        Vec<crate::models::BidUpdate>,
    >(bid.bid_updates.clone())
    .unwrap_or_default()
    .into_iter()
    .map(|u| bid_proto::BidUpdate {
        amount_cents: u.amount_cents,
        updated_at: Some(datetime_to_proto(u.updated_at)),
    })
    .collect();

    bid_proto::Bid {
        id: bid.id.to_string(),
        job_id: bid.job_id.to_string(),
        provider_id: bid.provider_id.to_string(),
        amount_cents: bid.amount_cents,
        is_offer_accepted: bid.is_offer_accepted,
        status: status_str_to_proto(&bid.status),
        original_amount_cents: bid.original_amount_cents,
        bid_history,
        created_at: Some(datetime_to_proto(bid.created_at)),
        updated_at: Some(datetime_to_proto(bid.updated_at)),
        awarded_at: bid.awarded_at.map(datetime_to_proto),
        withdrawn_at: bid.withdrawn_at.map(datetime_to_proto),
    }
}

fn status_str_to_proto(s: &str) -> i32 {
    match s {
        "active" => bid_proto::BidStatus::Active as i32,
        "awarded" => bid_proto::BidStatus::Awarded as i32,
        "not_selected" => bid_proto::BidStatus::NotSelected as i32,
        "withdrawn" => bid_proto::BidStatus::Withdrawn as i32,
        "expired" => bid_proto::BidStatus::Expired as i32,
        _ => bid_proto::BidStatus::Unspecified as i32,
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_possible_wrap)]
fn datetime_to_proto(dt: chrono::DateTime<chrono::Utc>) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: dt.timestamp(),
        nanos: dt.timestamp_subsec_nanos() as i32,
    }
}

fn bid_error_to_status(err: BidError) -> Status {
    match err {
        BidError::AuctionClosed | BidError::AuctionNotActive => {
            Status::failed_precondition(err.to_string())
        }
        BidError::BelowMinimum | BidError::InvalidAmount(_) => {
            Status::invalid_argument(err.to_string())
        }
        BidError::AlreadyBid => Status::already_exists(err.to_string()),
        BidError::NotBidOwner | BidError::PermissionDenied(_) => {
            Status::permission_denied(err.to_string())
        }
        BidError::BidNotActive => Status::failed_precondition(err.to_string()),
        BidError::BidNotFound | BidError::JobNotFound => Status::not_found(err.to_string()),
        BidError::DatabaseError(e) => {
            tracing::error!(error = %e, "database error in bid service");
            Status::internal("internal database error")
        }
    }
}
