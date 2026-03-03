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
    pub mod fraud {
        pub mod v1 {
            tonic::include_proto!("nomarkup.fraud.v1");
        }
    }
}

// Re-export for convenience.
pub use nomarkup::fraud::v1 as fraud_proto;
pub use nomarkup::fraud::v1::fraud_service_server::{FraudService, FraudServiceServer};

use std::sync::Arc;

use tonic::{Request, Response, Status};
use uuid::Uuid;

use crate::engine::FraudDetector;
use crate::models::{
    FraudError, FraudSignalRow, RiskLevel, SignalType, UserRiskProfileData, UserSessionRow,
};

/// gRPC service implementation wrapping the fraud detection engine.
pub struct FraudServiceImpl {
    engine: Arc<FraudDetector>,
}

impl FraudServiceImpl {
    #[must_use]
    pub fn new(engine: Arc<FraudDetector>) -> Self {
        Self { engine }
    }
}

#[tonic::async_trait]
impl FraudService for FraudServiceImpl {
    // -----------------------------------------------------------------------
    // Real-time checks
    // -----------------------------------------------------------------------

    async fn check_transaction(
        &self,
        request: Request<fraud_proto::CheckTransactionRequest>,
    ) -> Result<Response<fraud_proto::CheckTransactionResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        let result = self
            .engine
            .check_transaction(
                user_id,
                &req.payment_id,
                req.amount_cents,
                &req.ip_address,
                &req.device_fingerprint,
            )
            .await
            .map_err(fraud_error_to_status)?;

        Ok(Response::new(fraud_proto::CheckTransactionResponse {
            decision: result.decision.to_proto_i32(),
            risk_level: result.risk_level.to_proto_i32(),
            risk_score: result.risk_score,
            reasons: result.reasons,
        }))
    }

    async fn check_registration(
        &self,
        request: Request<fraud_proto::CheckRegistrationRequest>,
    ) -> Result<Response<fraud_proto::CheckRegistrationResponse>, Status> {
        let req = request.into_inner();

        let result = self
            .engine
            .check_registration(
                &req.email,
                &req.ip_address,
                &req.device_fingerprint,
                &req.phone,
            )
            .await
            .map_err(fraud_error_to_status)?;

        Ok(Response::new(fraud_proto::CheckRegistrationResponse {
            decision: result.decision.to_proto_i32(),
            risk_level: result.risk_level.to_proto_i32(),
            reasons: result.reasons,
        }))
    }

    async fn check_bid(
        &self,
        request: Request<fraud_proto::CheckBidRequest>,
    ) -> Result<Response<fraud_proto::CheckBidResponse>, Status> {
        let req = request.into_inner();
        let provider_id = parse_uuid(&req.provider_id, "provider_id")?;
        let job_id = parse_uuid(&req.job_id, "job_id")?;
        let customer_id = parse_uuid(&req.customer_id, "customer_id")?;

        let result = self
            .engine
            .check_bid(
                provider_id,
                job_id,
                customer_id,
                req.amount_cents,
                &req.ip_address,
                &req.device_fingerprint,
            )
            .await
            .map_err(fraud_error_to_status)?;

        Ok(Response::new(fraud_proto::CheckBidResponse {
            decision: result.decision.to_proto_i32(),
            risk_level: result.risk_level.to_proto_i32(),
            shill_bid_detected: result.shill_bid_detected,
            reasons: result.reasons,
        }))
    }

    // -----------------------------------------------------------------------
    // Signal recording
    // -----------------------------------------------------------------------

    async fn record_signal(
        &self,
        request: Request<fraud_proto::RecordSignalRequest>,
    ) -> Result<Response<fraud_proto::RecordSignalResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;
        let signal_type = SignalType::from_proto_i32(req.signal_type).ok_or_else(|| {
            Status::invalid_argument(format!("invalid signal_type: {}", req.signal_type))
        })?;

        let recorded = self
            .engine
            .record_signal(
                user_id,
                signal_type,
                req.confidence,
                &req.details,
                &req.ip_address,
                &req.device_fingerprint,
                &req.reference_type,
                &req.reference_id,
            )
            .await
            .map_err(fraud_error_to_status)?;

        Ok(Response::new(fraud_proto::RecordSignalResponse {
            signal: Some(signal_row_to_proto(&recorded.row)),
            alert_created: recorded.alert_created,
        }))
    }

    async fn batch_record_signals(
        &self,
        request: Request<fraud_proto::BatchRecordSignalsRequest>,
    ) -> Result<Response<fraud_proto::BatchRecordSignalsResponse>, Status> {
        let req = request.into_inner();

        let mut signals = Vec::with_capacity(req.signals.len());
        for s in &req.signals {
            let user_id = parse_uuid(&s.user_id, "user_id")?;
            let signal_type =
                SignalType::from_proto_i32(s.signal_type).ok_or_else(|| {
                    Status::invalid_argument(format!(
                        "invalid signal_type: {}",
                        s.signal_type
                    ))
                })?;

            signals.push((
                user_id,
                signal_type,
                s.confidence,
                s.details.clone(),
                s.ip_address.clone(),
                s.device_fingerprint.clone(),
                s.reference_type.clone(),
                s.reference_id.clone(),
            ));
        }

        let (recorded, alerts_created) = self
            .engine
            .batch_record_signals(signals)
            .await
            .map_err(fraud_error_to_status)?;

        Ok(Response::new(fraud_proto::BatchRecordSignalsResponse {
            recorded,
            alerts_created,
        }))
    }

    // -----------------------------------------------------------------------
    // Session tracking
    // -----------------------------------------------------------------------

    async fn record_session(
        &self,
        request: Request<fraud_proto::RecordSessionRequest>,
    ) -> Result<Response<fraud_proto::RecordSessionResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        let (geo_lat, geo_lng) = if let Some(ref loc) = req.location {
            (Some(loc.latitude), Some(loc.longitude))
        } else {
            (None, None)
        };

        let (anomaly_detected, anomaly_reasons) = self
            .engine
            .record_session(
                user_id,
                &req.ip_address,
                &req.user_agent,
                &req.device_fingerprint,
                geo_lat,
                geo_lng,
                None, // geo_city not in proto RecordSessionRequest
                None, // geo_country not in proto RecordSessionRequest
            )
            .await
            .map_err(fraud_error_to_status)?;

        Ok(Response::new(fraud_proto::RecordSessionResponse {
            anomaly_detected,
            anomaly_reasons,
        }))
    }

    #[allow(clippy::cast_possible_truncation)]
    async fn get_session_history(
        &self,
        request: Request<fraud_proto::GetSessionHistoryRequest>,
    ) -> Result<Response<fraud_proto::GetSessionHistoryResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        let (page, page_size) = if let Some(ref pag) = req.pagination {
            (pag.page, pag.page_size)
        } else {
            (1, 20)
        };

        let (rows, total) = self
            .engine
            .get_session_history(user_id, page, page_size)
            .await
            .map_err(fraud_error_to_status)?;

        let sessions: Vec<fraud_proto::SessionRecord> =
            rows.iter().map(session_row_to_proto).collect();

        let total_pages = if page_size > 0 {
            ((total + i64::from(page_size) - 1) / i64::from(page_size)) as i32
        } else {
            0
        };

        Ok(Response::new(fraud_proto::GetSessionHistoryResponse {
            sessions,
            pagination: Some(nomarkup::common::v1::PaginationResponse {
                total_count: total as i32,
                page,
                page_size,
                total_pages,
                has_next: page < total_pages,
            }),
        }))
    }

    // -----------------------------------------------------------------------
    // User risk profile
    // -----------------------------------------------------------------------

    async fn get_user_risk_profile(
        &self,
        request: Request<fraud_proto::GetUserRiskProfileRequest>,
    ) -> Result<Response<fraud_proto::GetUserRiskProfileResponse>, Status> {
        let req = request.into_inner();
        let user_id = parse_uuid(&req.user_id, "user_id")?;

        let profile = self
            .engine
            .get_user_risk_profile(user_id)
            .await
            .map_err(fraud_error_to_status)?;

        Ok(Response::new(fraud_proto::GetUserRiskProfileResponse {
            profile: Some(risk_profile_to_proto(&profile)),
        }))
    }

    // -----------------------------------------------------------------------
    // Admin RPCs (unimplemented for now)
    // -----------------------------------------------------------------------

    async fn admin_list_fraud_alerts(
        &self,
        _request: Request<fraud_proto::AdminListFraudAlertsRequest>,
    ) -> Result<Response<fraud_proto::AdminListFraudAlertsResponse>, Status> {
        Err(Status::unimplemented(
            "admin_list_fraud_alerts is not yet implemented",
        ))
    }

    async fn admin_review_fraud_alert(
        &self,
        _request: Request<fraud_proto::AdminReviewFraudAlertRequest>,
    ) -> Result<Response<fraud_proto::AdminReviewFraudAlertResponse>, Status> {
        Err(Status::unimplemented(
            "admin_review_fraud_alert is not yet implemented",
        ))
    }

    async fn admin_get_fraud_dashboard(
        &self,
        _request: Request<fraud_proto::AdminGetFraudDashboardRequest>,
    ) -> Result<Response<fraud_proto::AdminGetFraudDashboardResponse>, Status> {
        Err(Status::unimplemented(
            "admin_get_fraud_dashboard is not yet implemented",
        ))
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

/// Convert a `FraudSignalRow` to a proto `FraudSignal`.
fn signal_row_to_proto(row: &FraudSignalRow) -> fraud_proto::FraudSignal {
    let signal_type = SignalType::from_db_str(&row.signal_type, &row.signal_subtype);
    let risk_level = RiskLevel::from_db_severity(&row.severity);

    // Extract ip_address and device_fingerprint from evidence_json.
    let (ip_address, device_fingerprint) = row
        .evidence_json
        .as_ref()
        .map(|ev| {
            (
                ev.get("ip_address")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                ev.get("device_fingerprint")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            )
        })
        .unwrap_or_default();

    let (reference_type, reference_id) = row
        .evidence_json
        .as_ref()
        .map(|ev| {
            (
                ev.get("reference_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                ev.get("reference_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            )
        })
        .unwrap_or_default();

    fraud_proto::FraudSignal {
        id: row.id.to_string(),
        user_id: row.user_id.to_string(),
        signal_type: signal_type.to_proto_i32(),
        confidence: row.confidence,
        risk_level: risk_level.to_proto_i32(),
        details: row.description.clone(),
        ip_address,
        device_fingerprint,
        reference_type,
        reference_id,
        detected_at: Some(datetime_to_proto(row.created_at)),
    }
}

/// Convert a `UserSessionRow` to a proto `SessionRecord`.
fn session_row_to_proto(row: &UserSessionRow) -> fraud_proto::SessionRecord {
    let location = match (row.geo_lat, row.geo_lng) {
        (Some(lat), Some(lng)) => Some(nomarkup::common::v1::Location {
            latitude: lat,
            longitude: lng,
        }),
        _ => None,
    };

    fraud_proto::SessionRecord {
        id: row.id.to_string(),
        user_id: row.user_id.map_or_else(String::new, |u| u.to_string()),
        ip_address: row.ip_address.clone(),
        user_agent: row.user_agent.clone().unwrap_or_default(),
        device_fingerprint: row.device_fingerprint.clone().unwrap_or_default(),
        location,
        action: String::new(),
        created_at: Some(datetime_to_proto(row.created_at)),
    }
}

/// Convert a `UserRiskProfileData` to a proto `UserRiskProfile`.
fn risk_profile_to_proto(profile: &UserRiskProfileData) -> fraud_proto::UserRiskProfile {
    fraud_proto::UserRiskProfile {
        user_id: profile.user_id.to_string(),
        risk_score: profile.risk_score,
        risk_level: profile.risk_level.to_proto_i32(),
        total_signals: profile.total_signals,
        active_alerts: profile.active_alerts,
        recent_signal_types: profile
            .recent_signal_types
            .iter()
            .map(|st| st.to_proto_i32())
            .collect(),
        is_restricted: profile.is_restricted,
        last_signal_at: profile.last_signal_at.map(datetime_to_proto),
        last_reviewed_at: profile.last_reviewed_at.map(datetime_to_proto),
    }
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap
)]
fn datetime_to_proto(dt: chrono::DateTime<chrono::Utc>) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: dt.timestamp(),
        nanos: dt.timestamp_subsec_nanos() as i32,
    }
}

fn fraud_error_to_status(err: FraudError) -> Status {
    match err {
        FraudError::InvalidArgument(_) => Status::invalid_argument(err.to_string()),
        FraudError::UserNotFound(_) | FraudError::SignalNotFound(_) => {
            Status::not_found(err.to_string())
        }
        FraudError::DatabaseError(e) => {
            tracing::error!(error = %e, "database error in fraud service");
            Status::internal("internal database error")
        }
    }
}
