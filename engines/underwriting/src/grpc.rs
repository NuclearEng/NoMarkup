//! gRPC surface for the underwriting engine. Thin: converts the proto request
//! into [`model::Features`], runs the pure deterministic model, and maps the
//! [`model::Decision`] back. No DB, no state.

use tonic::{Request, Response, Status};

use crate::model::{self, UnderwritingTier};
use crate::proto::underwriting_service_server::UnderwritingService;
use crate::proto::{
    DecisionReason, ProviderFeatures, UnderwriteRequest, UnderwriteResponse,
    UnderwritingTier as ProtoTier,
};

#[derive(Debug, Default)]
pub struct UnderwritingServer;

impl From<&ProviderFeatures> for model::Features {
    fn from(p: &ProviderFeatures) -> Self {
        Self {
            provider_id: p.provider_id.clone(),
            trust_overall: p.trust_overall,
            trust_feedback: p.trust_feedback,
            trust_fraud: p.trust_fraud,
            trust_tier: p.trust_tier.clone(),
            trailing_30d_earnings_cents: p.trailing_30d_earnings_cents,
            trailing_90d_earnings_cents: p.trailing_90d_earnings_cents,
            trailing_365d_earnings_cents: p.trailing_365d_earnings_cents,
            completed_jobs_90d: p.completed_jobs_90d,
            active_months: p.active_months,
            on_time_repayment_rate: p.on_time_repayment_rate,
            prior_advances_count: p.prior_advances_count,
            dispute_rate_90d: p.dispute_rate_90d,
            account_tenure_days: p.account_tenure_days,
            outstanding_advance_cents: p.outstanding_advance_cents,
            as_of_unix: p.as_of_unix,
        }
    }
}

fn tier_to_proto(t: UnderwritingTier) -> ProtoTier {
    match t {
        UnderwritingTier::Ineligible => ProtoTier::Ineligible,
        UnderwritingTier::Starter => ProtoTier::Starter,
        UnderwritingTier::Standard => ProtoTier::Standard,
        UnderwritingTier::Premium => ProtoTier::Premium,
        UnderwritingTier::Elite => ProtoTier::Elite,
    }
}

#[tonic::async_trait]
impl UnderwritingService for UnderwritingServer {
    // A credit decision: the attributes recorded are exactly the ones needed
    // to reconstruct *why* a provider was approved or declined, without
    // re-running the model. `decision_hash` ties the span back to the audit
    // record. The model itself stays an uninstrumented pure function.
    #[tracing::instrument(
        skip_all,
        fields(
            provider_id = tracing::field::Empty,
            approved = tracing::field::Empty,
            tier = tracing::field::Empty,
            risk_score = tracing::field::Empty,
            binding_gate = tracing::field::Empty,
            decision_hash = tracing::field::Empty,
        )
    )]
    async fn underwrite(
        &self,
        request: Request<UnderwriteRequest>,
    ) -> Result<Response<UnderwriteResponse>, Status> {
        let req = request.into_inner();
        let features = req
            .features
            .as_ref()
            .ok_or_else(|| Status::invalid_argument("features are required"))?;
        if features.provider_id.is_empty() {
            return Err(Status::invalid_argument("provider_id is required"));
        }

        let d = model::underwrite(&model::Features::from(features));

        let span = tracing::Span::current();
        span.record("provider_id", d.provider_id.as_str());
        span.record("approved", d.approved);
        span.record("tier", tracing::field::debug(d.tier));
        span.record("risk_score", d.risk_score);
        span.record("binding_gate", d.binding_gate.as_str());
        span.record("decision_hash", d.decision_hash.as_str());

        let resp = UnderwriteResponse {
            provider_id: d.provider_id,
            approved: d.approved,
            tier: tier_to_proto(d.tier) as i32,
            max_credit_cents: d.max_credit_cents,
            available_credit_cents: d.available_credit_cents,
            fee_bps: d.fee_bps,
            factor_rate: d.factor_rate,
            holdback_pct: d.holdback_pct,
            risk_score: d.risk_score,
            binding_gate: d.binding_gate,
            binding_cap: d.binding_cap,
            reasons: d
                .reasons
                .into_iter()
                .map(|r| DecisionReason {
                    code: r.code.to_string(),
                    label: r.label.to_string(),
                    contribution: r.contribution,
                })
                .collect(),
            decision_hash: d.decision_hash,
            model_version: d.model_version.to_string(),
        };
        Ok(Response::new(resp))
    }
}
