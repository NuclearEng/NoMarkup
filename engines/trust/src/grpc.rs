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
    pub mod trust {
        pub mod v1 {
            tonic::include_proto!("nomarkup.trust.v1");
        }
    }
}

// Re-export for convenience.
pub use nomarkup::trust::v1 as trust_proto;
pub use nomarkup::trust::v1::trust_service_server::{TrustService, TrustServiceServer};

use std::sync::Arc;

use tonic::{Request, Response, Status};
use tracing::{info, warn};
use uuid::Uuid;

use crate::engine::TrustScorer;
use crate::models::{
    all_tier_requirements, FeedbackDetails, FraudDetails, RiskDetails, TrustError,
    TrustScoreHistoryRow, TrustScoreRow, TrustTier, VolumeDetails,
};

/// gRPC service implementation wrapping the trust scoring engine.
pub struct TrustServiceImpl {
    engine: Arc<TrustScorer>,
}

impl TrustServiceImpl {
    #[must_use]
    pub fn new(engine: Arc<TrustScorer>) -> Self {
        Self { engine }
    }
}

#[tonic::async_trait]
impl TrustService for TrustServiceImpl {
    async fn compute_trust_score(
        &self,
        request: Request<trust_proto::ComputeTrustScoreRequest>,
    ) -> Result<Response<trust_proto::ComputeTrustScoreResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        match self.engine.compute_score(user_id, &req.trigger_reason).await {
            Ok((row, tier_changed, previous_tier)) => {
                info!(
                    user_id = %user_id,
                    score = row.composite_score,
                    tier = %row.tier,
                    tier_changed = tier_changed,
                    trigger = %req.trigger_reason,
                    "grpc compute_trust_score completed"
                );
                Ok(Response::new(trust_proto::ComputeTrustScoreResponse {
                    score: Some(score_row_to_proto(&row)),
                    tier_changed,
                    previous_tier: tier_str_to_proto_i32(&previous_tier),
                }))
            }
            Err(e) => {
                warn!(user_id = %user_id, error = %e, "grpc compute_trust_score failed");
                Err(trust_error_to_status(e))
            }
        }
    }

    async fn batch_compute_trust_scores(
        &self,
        request: Request<trust_proto::BatchComputeTrustScoresRequest>,
    ) -> Result<Response<trust_proto::BatchComputeTrustScoresResponse>, Status> {
        let req = request.into_inner();

        let user_ids: Vec<Uuid> = req
            .user_ids
            .iter()
            .map(|s| parse_uuid(s, "user_id"))
            .collect::<Result<Vec<_>, _>>()?;

        let (computed, tier_changes) = self
            .engine
            .batch_compute(&user_ids)
            .await
            .map_err(trust_error_to_status)?;

        Ok(Response::new(
            trust_proto::BatchComputeTrustScoresResponse {
                computed,
                tier_changes,
            },
        ))
    }

    async fn get_trust_score(
        &self,
        request: Request<trust_proto::GetTrustScoreRequest>,
    ) -> Result<Response<trust_proto::GetTrustScoreResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        let row = self
            .engine
            .get_score(user_id)
            .await
            .map_err(trust_error_to_status)?;

        Ok(Response::new(trust_proto::GetTrustScoreResponse {
            score: Some(score_row_to_proto(&row)),
        }))
    }

    #[allow(clippy::cast_possible_truncation)]
    async fn get_trust_score_history(
        &self,
        request: Request<trust_proto::GetTrustScoreHistoryRequest>,
    ) -> Result<Response<trust_proto::GetTrustScoreHistoryResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        let (page, page_size) = if let Some(ref pag) = req.pagination {
            (pag.page, pag.page_size)
        } else {
            (1, 20)
        };

        let (rows, total) = self
            .engine
            .get_history(user_id, page, page_size)
            .await
            .map_err(trust_error_to_status)?;

        // Build snapshots with previous_overall computed from adjacent rows.
        // Rows are in descending order, so each row's "previous" is the next row.
        let snapshots: Vec<trust_proto::TrustScoreSnapshot> = rows
            .iter()
            .enumerate()
            .map(|(i, row)| {
                let previous_overall = rows
                    .get(i + 1)
                    .map_or(0.0, |prev| prev.overall_score / 100.0);
                let previous_tier = rows
                    .get(i + 1)
                    .map_or(
                        nomarkup::common::v1::TrustTier::Unspecified as i32,
                        |_prev| nomarkup::common::v1::TrustTier::Unspecified as i32,
                    );
                history_row_to_proto(row, previous_overall, previous_tier)
            })
            .collect();

        let total_pages = if page_size > 0 {
            ((total + i64::from(page_size) - 1) / i64::from(page_size)) as i32
        } else {
            0
        };

        Ok(Response::new(trust_proto::GetTrustScoreHistoryResponse {
            snapshots,
            pagination: Some(nomarkup::common::v1::PaginationResponse {
                total_count: total as i32,
                page,
                page_size,
                total_pages,
                has_next: page < total_pages,
            }),
        }))
    }

    async fn get_tier_requirements(
        &self,
        _request: Request<trust_proto::GetTierRequirementsRequest>,
    ) -> Result<Response<trust_proto::GetTierRequirementsResponse>, Status> {
        let requirements = all_tier_requirements();

        let tiers: Vec<trust_proto::TierRequirement> = requirements
            .iter()
            .map(|r| trust_proto::TierRequirement {
                tier: tier_to_proto_i32(&r.tier),
                min_overall_score: r.min_overall_score,
                min_completed_jobs: r.min_completed_jobs,
                min_reviews: r.min_reviews,
                min_rating: r.min_rating,
                requires_verification: r.requires_verification,
                description: r.description.clone(),
            })
            .collect();

        Ok(Response::new(trust_proto::GetTierRequirementsResponse {
            tiers,
        }))
    }

    async fn record_feedback_signal(
        &self,
        request: Request<trust_proto::RecordFeedbackSignalRequest>,
    ) -> Result<Response<trust_proto::RecordFeedbackSignalResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        self.engine
            .record_feedback_signal(user_id, &req.source, req.value, &req.reference_id)
            .await
            .map_err(trust_error_to_status)?;

        Ok(Response::new(trust_proto::RecordFeedbackSignalResponse {}))
    }

    async fn record_volume_signal(
        &self,
        request: Request<trust_proto::RecordVolumeSignalRequest>,
    ) -> Result<Response<trust_proto::RecordVolumeSignalResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        self.engine
            .record_volume_signal(user_id, &req.signal_type, &req.reference_id)
            .await
            .map_err(trust_error_to_status)?;

        Ok(Response::new(trust_proto::RecordVolumeSignalResponse {}))
    }

    async fn record_risk_signal(
        &self,
        request: Request<trust_proto::RecordRiskSignalRequest>,
    ) -> Result<Response<trust_proto::RecordRiskSignalResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        self.engine
            .record_risk_signal(user_id, &req.signal_type, req.severity, &req.reference_id)
            .await
            .map_err(trust_error_to_status)?;

        Ok(Response::new(trust_proto::RecordRiskSignalResponse {}))
    }

    async fn admin_override_trust_score(
        &self,
        request: Request<trust_proto::AdminOverrideTrustScoreRequest>,
    ) -> Result<Response<trust_proto::AdminOverrideTrustScoreResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        // Validate admin_id is provided and is a valid UUID.
        if req.admin_id.is_empty() {
            return Err(Status::invalid_argument("admin_id is required"));
        }
        let admin_id = parse_uuid(&req.admin_id, "admin_id")?;
        if admin_id.is_nil() {
            return Err(Status::invalid_argument("admin_id must not be nil"));
        }

        // Map proto tier to an overall score (0-100 scale).
        let new_overall = match req.new_tier {
            t if t == nomarkup::common::v1::TrustTier::TopRated as i32 => 90.0,
            t if t == nomarkup::common::v1::TrustTier::Trusted as i32 => 75.0,
            t if t == nomarkup::common::v1::TrustTier::Rising as i32 => 55.0,
            t if t == nomarkup::common::v1::TrustTier::New as i32 => 30.0,
            t if t == nomarkup::common::v1::TrustTier::UnderReview as i32 => 10.0,
            _ => return Err(Status::invalid_argument("invalid tier value")),
        };

        let reason = if req.reason.is_empty() {
            "admin_override".to_string()
        } else {
            req.reason
        };

        // The engine method enforces admin-only access via the role parameter.
        let row = self
            .engine
            .admin_override_score(user_id, "admin", new_overall, &reason)
            .await
            .map_err(trust_error_to_status)?;

        Ok(Response::new(trust_proto::AdminOverrideTrustScoreResponse {
            score: Some(score_row_to_proto(&row)),
        }))
    }

    async fn admin_get_trust_breakdown(
        &self,
        request: Request<trust_proto::AdminGetTrustBreakdownRequest>,
    ) -> Result<Response<trust_proto::AdminGetTrustBreakdownResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        let row = self
            .engine
            .get_score(user_id)
            .await
            .map_err(trust_error_to_status)?;

        let score = score_row_to_proto(&row);

        // Parse the JSONB detail columns into breakdown protos.
        let feedback = row
            .feedback_details
            .as_ref()
            .and_then(|v| serde_json::from_value::<FeedbackDetails>(v.clone()).ok())
            .unwrap_or_default();

        let volume = row
            .volume_details
            .as_ref()
            .and_then(|v| serde_json::from_value::<VolumeDetails>(v.clone()).ok())
            .unwrap_or_default();

        let risk = row
            .risk_details
            .as_ref()
            .and_then(|v| serde_json::from_value::<RiskDetails>(v.clone()).ok())
            .unwrap_or_default();

        let fraud = row
            .fraud_details
            .as_ref()
            .and_then(|v| serde_json::from_value::<FraudDetails>(v.clone()).ok())
            .unwrap_or_default();

        #[allow(clippy::cast_possible_truncation)]
        Ok(Response::new(trust_proto::AdminGetTrustBreakdownResponse {
            score: Some(score),
            feedback: Some(trust_proto::FeedbackBreakdown {
                average_rating: feedback.average_rating,
                total_reviews: feedback.total_reviews,
                five_star_count: feedback.five_star_count,
                one_star_count: feedback.one_star_count,
                rating_trend: feedback.rating_trend,
                disputes_lost: feedback.disputes_lost,
            }),
            volume: Some(trust_proto::VolumeBreakdown {
                total_jobs_completed: volume.total_jobs_completed,
                jobs_last_90_days: volume.jobs_last_90_days,
                repeat_customers: volume.repeat_customers,
                on_time_rate: volume.on_time_rate,
                total_gmv_cents: volume.total_gmv_cents as i32,
            }),
            risk: Some(trust_proto::RiskBreakdown {
                cancellations: risk.cancellations,
                disputes_filed: risk.disputes_filed,
                late_deliveries: risk.late_deliveries,
                no_shows: risk.no_shows,
                cancellation_rate: risk.cancellation_rate,
                dispute_rate: risk.dispute_rate,
            }),
            fraud: Some(trust_proto::FraudBreakdown {
                fraud_signals_detected: fraud.fraud_signals_detected,
                fraud_probability: fraud.fraud_probability,
                has_active_flags: fraud.has_active_flags,
                last_review_outcome: fraud.last_review_outcome,
            }),
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

/// Convert a `TrustScoreRow` (DB: 0-100 as f64) to a proto `TrustScore` (0.0-1.0).
fn score_row_to_proto(row: &TrustScoreRow) -> trust_proto::TrustScore {
    // Convert 0-100 DB values to 0.0-1.0 proto values.
    let overall = row.overall_score / 100.0;
    let feedback = row.feedback_score / 100.0;
    let volume = row.volume_score / 100.0;
    let risk = row.risk_score / 100.0;
    let fraud = row.fraud_score / 100.0;

    // Count data points from the details JSON fields.
    let data_points = count_data_points(row);

    trust_proto::TrustScore {
        user_id: row.user_id.to_string(),
        overall_score: overall,
        tier: tier_str_to_proto_i32(&row.tier),
        feedback_score: feedback,
        volume_score: volume,
        risk_score: risk,
        fraud_score: fraud,
        data_points,
        computed_at: Some(datetime_to_proto(row.last_computed_at)),
    }
}

/// Convert a `TrustScoreHistoryRow` (DB: 0-100 as f64) to a proto `TrustScoreSnapshot`.
///
/// `previous_overall` and `previous_tier` are computed from adjacent history rows
/// by the caller.
fn history_row_to_proto(
    row: &TrustScoreHistoryRow,
    previous_overall: f64,
    previous_tier: i32,
) -> trust_proto::TrustScoreSnapshot {
    let overall = row.overall_score / 100.0;
    let feedback = row.feedback_score / 100.0;
    let volume = row.volume_score / 100.0;
    let risk = row.risk_score / 100.0;
    let fraud = row.fraud_score / 100.0;

    trust_proto::TrustScoreSnapshot {
        score: Some(trust_proto::TrustScore {
            user_id: row.user_id.to_string(),
            overall_score: overall,
            tier: nomarkup::common::v1::TrustTier::Unspecified as i32,
            feedback_score: feedback,
            volume_score: volume,
            risk_score: risk,
            fraud_score: fraud,
            data_points: 0,
            computed_at: Some(datetime_to_proto(row.created_at)),
        }),
        change_reason: row.trigger_event.clone(),
        previous_overall,
        previous_tier,
        recorded_at: Some(datetime_to_proto(row.created_at)),
    }
}

/// Count total data points from the details JSON.
#[allow(clippy::cast_possible_truncation)]
fn count_data_points(row: &TrustScoreRow) -> i32 {
    let mut count = 0i32;

    if let Some(ref details) = row.feedback_details {
        if let Ok(fd) = serde_json::from_value::<FeedbackDetails>(details.clone()) {
            count += fd.total_reviews;
        }
    }
    if let Some(ref details) = row.volume_details {
        if let Ok(vd) = serde_json::from_value::<VolumeDetails>(details.clone()) {
            count += vd.total_jobs_completed;
        }
    }
    if let Some(ref details) = row.risk_details {
        if let Ok(rd) = serde_json::from_value::<RiskDetails>(details.clone()) {
            count += rd.cancellations + rd.disputes_filed + rd.late_deliveries + rd.no_shows;
        }
    }
    if let Some(ref details) = row.fraud_details {
        if let Ok(fd) = serde_json::from_value::<FraudDetails>(details.clone()) {
            count += fd.fraud_signals_detected;
        }
    }

    count
}

/// Convert a tier string from the database to a proto enum i32.
fn tier_str_to_proto_i32(s: &str) -> i32 {
    match s {
        "under_review" => nomarkup::common::v1::TrustTier::UnderReview as i32,
        "new" => nomarkup::common::v1::TrustTier::New as i32,
        "rising" => nomarkup::common::v1::TrustTier::Rising as i32,
        "trusted" => nomarkup::common::v1::TrustTier::Trusted as i32,
        "top_rated" => nomarkup::common::v1::TrustTier::TopRated as i32,
        _ => nomarkup::common::v1::TrustTier::Unspecified as i32,
    }
}

/// Convert a `TrustTier` enum to a proto enum i32.
fn tier_to_proto_i32(tier: &TrustTier) -> i32 {
    tier_str_to_proto_i32(tier.as_db_str())
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_possible_wrap)]
fn datetime_to_proto(dt: chrono::DateTime<chrono::Utc>) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: dt.timestamp(),
        nanos: dt.timestamp_subsec_nanos() as i32,
    }
}

fn trust_error_to_status(err: TrustError) -> Status {
    match err {
        TrustError::UserNotFound(_) | TrustError::ScoreNotFound(_) => {
            Status::not_found(err.to_string())
        }
        TrustError::InvalidUserId(_) | TrustError::InvalidSignal(_) => {
            Status::invalid_argument(err.to_string())
        }
        TrustError::PermissionDenied(_) => Status::permission_denied(err.to_string()),
        TrustError::DatabaseError(e) => {
            tracing::error!(error = %e, "database error in trust service");
            Status::internal("internal database error")
        }
    }
}
