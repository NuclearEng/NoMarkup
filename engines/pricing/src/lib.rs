//! NoMarkup Pricing Engine — the Fair Price Index.
//!
//! [`model`] is a pure function; [`grpc`] exposes it over tonic.

#![forbid(unsafe_code)]

pub mod grpc;
pub mod model;

/// Generated gRPC types (`nomarkup.pricing.v1`).
pub mod proto {
    tonic::include_proto!("nomarkup.pricing.v1");
}

pub use model::{FairPrice, MODEL_VERSION, Query, Side, Txn, fair_price};
