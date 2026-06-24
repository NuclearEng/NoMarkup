//! `NoMarkup` Pricing Engine — the Fair Price Index.
//!
//! [`model`] is a pure function; [`grpc`] exposes it over tonic.

// Numeric model: i64 cents <-> f64 conversions are intentional and bounded
// (prices validated at ingress, clamped well inside f64's 2^53 integer range).
// `suboptimal_flops` is allowed because mul_add/exp2 rewrites change IEEE-754
// rounding, which would silently shift the frozen, golden-tested estimator
// outputs — determinism is versioned via `MODEL_VERSION`, not refactors.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::suboptimal_flops
)]

pub mod grpc;
pub mod model;

/// Generated gRPC types (`nomarkup.pricing.v1`).
#[allow(clippy::all, clippy::pedantic, clippy::nursery)] // prost/tonic-generated code
pub mod proto {
    tonic::include_proto!("nomarkup.pricing.v1");
}

pub use model::{FairPrice, MODEL_VERSION, Query, Side, Txn, fair_price};

// ML / ONNX hook (P1-2 gap closure).
// When the optional `ort` feature is enabled (off by default per CLAUDE.md policy),
// engines can load a price model exported from ml/pricing/train.py and call
// inference. The deterministic fair_price remains the always-on fallback.
// See gap-closure-plan.md and ml/README.md.
#[cfg(feature = "ort")]
pub mod ml_stub {
    // TODO: use ort::Session, load from env MODEL_PATH or baked bytes,
    // run predict on featurized Query + context, blend or replace heuristic.
    pub fn load_and_predict(_bytes: &[u8], _features: &[f32]) -> Option<f64> { None }
}
