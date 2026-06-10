//! Prometheus metrics for the fraud engine.
//!
//! Exposes `fraud_scoring_duration_seconds` (histogram, per CLAUDE.md §11)
//! and `fraud_alerts_created_total` (counter) on a separate HTTP listener.

use std::convert::Infallible;
use std::net::SocketAddr;

use http_body_util::Full;
use hyper::body::{Bytes, Incoming};
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use once_cell::sync::Lazy;
use prometheus::{Encoder, Histogram, HistogramOpts, IntCounter, Registry, TextEncoder};
use tokio::net::TcpListener;

/// Buckets matched to the fraud-scoring SLO budget (CLAUDE.md §8 — p99 < 50ms).
const FRAUD_BUCKETS: &[f64] = &[0.005, 0.01, 0.05, 0.1, 0.5, 1.0];

pub static REGISTRY: Lazy<Registry> = Lazy::new(Registry::new);

pub static FRAUD_SCORING_DURATION: Lazy<Histogram> = Lazy::new(|| {
    let h = Histogram::with_opts(
        HistogramOpts::new(
            "fraud_scoring_duration_seconds",
            "End-to-end latency of fraud scoring entry points (transaction/registration/bid checks).",
        )
        .buckets(FRAUD_BUCKETS.to_vec()),
    )
    .expect("histogram opts are valid");
    REGISTRY
        .register(Box::new(h.clone()))
        .expect("histogram registration succeeds");
    h
});

pub static FRAUD_ALERTS_CREATED_TOTAL: Lazy<IntCounter> = Lazy::new(|| {
    let c = IntCounter::new(
        "fraud_alerts_created_total",
        "Total number of fraud alerts created (signal recorded with alert threshold reached).",
    )
    .expect("counter opts are valid");
    REGISTRY
        .register(Box::new(c.clone()))
        .expect("counter registration succeeds");
    c
});

pub fn init() {
    Lazy::force(&FRAUD_SCORING_DURATION);
    Lazy::force(&FRAUD_ALERTS_CREATED_TOTAL);
}

async fn handle_request(req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    if req.method() != Method::GET {
        return Ok(Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .body(Full::from(Bytes::from_static(b"method not allowed")))
            .expect("response builder"));
    }

    match req.uri().path() {
        "/metrics" => {
            let encoder = TextEncoder::new();
            let metric_families = REGISTRY.gather();
            let mut buf = Vec::with_capacity(4096);
            if let Err(e) = encoder.encode(&metric_families, &mut buf) {
                tracing::warn!(error = %e, "failed to encode metrics");
                return Ok(Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Full::from(Bytes::from_static(b"encode error")))
                    .expect("response builder"));
            }
            Ok(Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", encoder.format_type())
                .body(Full::from(Bytes::from(buf)))
                .expect("response builder"))
        }
        "/healthz" => Ok(Response::builder()
            .status(StatusCode::OK)
            .body(Full::from(Bytes::from_static(b"ok")))
            .expect("response builder")),
        _ => Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Full::from(Bytes::from_static(b"not found")))
            .expect("response builder")),
    }
}

/// Run the metrics HTTP server.
///
/// # Errors
///
/// Returns `std::io::Error` if the TCP listener cannot bind.
pub async fn serve_metrics(addr: SocketAddr) -> std::io::Result<()> {
    init();
    let listener = TcpListener::bind(addr).await?;
    tracing::info!(addr = %addr, "fraud metrics server listening");

    loop {
        let (stream, _peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                tracing::warn!(error = %e, "metrics accept failed");
                continue;
            }
        };

        let io = TokioIo::new(stream);
        tokio::spawn(async move {
            if let Err(e) = auto::Builder::new(TokioExecutor::new())
                .serve_connection(io, service_fn(handle_request))
                .await
            {
                tracing::debug!(error = %e, "metrics connection ended");
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metrics_register_without_panic() {
        init();
        FRAUD_SCORING_DURATION.observe(0.01);
        FRAUD_SCORING_DURATION.observe(0.05);
        FRAUD_ALERTS_CREATED_TOTAL.inc();

        let families = REGISTRY.gather();
        let names: Vec<&str> = families
            .iter()
            .map(prometheus::proto::MetricFamily::get_name)
            .collect();
        assert!(names.contains(&"fraud_scoring_duration_seconds"));
        assert!(names.contains(&"fraud_alerts_created_total"));
    }

    #[test]
    fn buckets_cover_slo_budget() {
        // SLO: p99 < 50ms. The 50ms bucket boundary must exist.
        assert!(
            FRAUD_BUCKETS
                .iter()
                .any(|&b| (b - 0.05).abs() < f64::EPSILON)
        );
    }
}
