//! gRPC surface for the pricing engine. Thin: converts the proto request into
//! the model types, runs the pure estimator, and maps the result back.

use tonic::{Request, Response, Status};

use crate::model::{self, Side};
use crate::proto::pricing_service_server::PricingService;
use crate::proto::{
    ComputeFairPriceRequest, ComputeFairPriceResponse, MarketSide, Transaction as ProtoTxn,
};

#[derive(Debug, Default)]
pub struct PricingServer;

fn side_from_proto(v: i32) -> Side {
    match MarketSide::try_from(v).unwrap_or(MarketSide::Unspecified) {
        MarketSide::Service => Side::Service,
        MarketSide::Good => Side::Good,
        MarketSide::Unspecified => Side::Unspecified,
    }
}

impl From<&ProtoTxn> for model::Txn {
    fn from(t: &ProtoTxn) -> Self {
        Self {
            category_id: t.category_id.clone(),
            parent_category_id: t.parent_category_id.clone(),
            market_id: t.market_id.clone(),
            zip: t.zip.clone(),
            cleared_price_cents: t.cleared_price_cents,
            settled_at: t.settled_at,
            trust_tier: t.trust_tier,
            instant_match: t.instant_match,
            condition: t.condition,
            side: side_from_proto(t.side),
        }
    }
}

#[tonic::async_trait]
impl PricingService for PricingServer {
    async fn compute_fair_price(
        &self,
        request: Request<ComputeFairPriceRequest>,
    ) -> Result<Response<ComputeFairPriceResponse>, Status> {
        let req = request.into_inner();
        let q = req
            .query
            .ok_or_else(|| Status::invalid_argument("query is required"))?;

        let query = model::Query {
            category_id: q.category_id,
            parent_category_id: q.parent_category_id,
            zip: q.zip,
            market_id: q.market_id,
            as_of: q.as_of,
            side: side_from_proto(q.side),
            want_instant: q.want_instant,
            want_condition: q.want_condition,
            want_trust_tier_min: q.want_trust_tier_min,
        };
        let txns: Vec<model::Txn> = req.transactions.iter().map(model::Txn::from).collect();

        let fp = model::fair_price(&txns, &query);

        Ok(Response::new(ComputeFairPriceResponse {
            has_data: fp.has_data,
            price_cents: fp.price_cents,
            p25_cents: fp.p25_cents,
            p75_cents: fp.p75_cents,
            ci_lo_cents: fp.ci_lo_cents,
            ci_hi_cents: fp.ci_hi_cents,
            n_eff: fp.n_eff,
            confidence: fp.confidence,
            confidence_label: fp.confidence_label.to_string(),
            level_used: fp.level_used,
            model_version: fp.model_version.to_string(),
        }))
    }
}
