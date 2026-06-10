//! NoMarkup Underwriting Engine — deterministic working-capital underwriting.
//!
//! The model ([`model`]) is a pure function; [`grpc`] exposes it over tonic.

#![forbid(unsafe_code)]

pub mod grpc;
pub mod model;

/// Generated gRPC types (`nomarkup.underwriting.v1`).
pub mod proto {
    tonic::include_proto!("nomarkup.underwriting.v1");
}

pub use model::{Decision, Features, MODEL_VERSION, Reason, UnderwritingTier, underwrite};
