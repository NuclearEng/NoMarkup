//! `NoMarkup` Underwriting Engine — deterministic working-capital underwriting.
//!
//! The model ([`model`]) is a pure function; [`grpc`] exposes it over tonic.

// Numeric scorecard: i64 cents <-> f64 conversions are intentional and bounded
// (earnings sized against a $25k absolute cap, far inside f64's 2^53 integer
// range; f64 -> i32/i64 casts happen only after .round() + clamp).
// `suboptimal_flops` is allowed because mul_add rewrites change IEEE-754
// rounding, which would silently shift frozen model outputs AND the
// tamper-evidence `decision_hash` — determinism is versioned via
// `MODEL_VERSION`, not refactors.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::suboptimal_flops
)]

pub mod grpc;
pub mod model;

/// Generated gRPC types (`nomarkup.underwriting.v1`).
#[allow(clippy::all, clippy::pedantic, clippy::nursery)] // prost/tonic-generated code
pub mod proto {
    tonic::include_proto!("nomarkup.underwriting.v1");
}

pub use model::{Decision, Features, MODEL_VERSION, Reason, UnderwritingTier, underwrite};
