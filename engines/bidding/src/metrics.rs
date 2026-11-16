//! Prometheus metrics for the bidding engine.
//!
//! Exposes `bid_processing_duration_seconds` (histogram, per CLAUDE.md §11)
//! and `bids_awarded_total` (counter) on a separate HTTP listener so scrape
//! traffic never competes with the gRPC bid-processing hot path.
//!
//! The metrics server is non-critical: if `BIDDING_METRICS_PORT` is unset
//! the server is skipped silently and engine startup continues.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::LazyLock;

use http_body_util::Full;
use hyper::body::{Bytes, Incoming};
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use prometheus::{Encoder, Histogram, HistogramOpts, IntCounter, Registry, TextEncoder};
use tokio::net::TcpListener;

/// Buckets matched to the bidding hot-path SLO budget (CLAUDE.md §8 — p99 < 1ms).
/// Lower bound (100µs) catches well-tuned cases; upper bound (50ms) catches
/// pathologically slow database round-trips.
const BID_BUCKETS: &[f64] = &[0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05];

/// Process-wide metrics registry. We do not use the prometheus default
/// registry so other crates linking us cannot accidentally collide.
pub static REGISTRY: LazyLock<Registry> = LazyLock::new(Registry::new);

pub static BID_PROCESSING_DURATION: LazyLock<Histogram> = LazyLock::new(|| {
    let h = Histogram::with_opts(
        HistogramOpts::new(
            "bid_processing_duration_seconds",
            "End-to-end latency of bid placement and award through the bidding engine.",
        )
        .buckets(BID_BUCKETS.to_vec()),
    )
    .expect("histogram opts are valid");
    REGISTRY
        .register(Box::new(h.clone()))
        .expect("histogram registration succeeds");
    h
});

pub static BIDS_AWARDED_TOTAL: LazyLock<IntCounter> = LazyLock::new(|| {
    let c = IntCounter::new(
        "bids_awarded_total",
        "Total number of bids awarded to providers (terminal auction outcome).",
    )
    .expect("counter opts are valid");
    REGISTRY
        .register(Box::new(c.clone()))
        .expect("counter registration succeeds");
    c
});

/// Force lazy initialization so the metrics show up in `/metrics` output
/// even before any traffic is observed.
pub fn init() {
    LazyLock::force(&BID_PROCESSING_DURATION);
    LazyLock::force(&BIDS_AWARDED_TOTAL);
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

/// Run the metrics HTTP server. Loops accepting connections; each connection
/// is served on its own task. Returns only on listener failure.
///
/// # Errors
///
/// Returns `std::io::Error` if the TCP listener cannot bind.
pub async fn serve_metrics(addr: SocketAddr) -> std::io::Result<()> {
    init();
    let listener = TcpListener::bind(addr).await?;
    tracing::info!(addr = %addr, "bidding metrics server listening");

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
        // Histogram should accept observations across the bucket range.
        BID_PROCESSING_DURATION.observe(0.0002);
        BID_PROCESSING_DURATION.observe(0.001);
        BID_PROCESSING_DURATION.observe(0.05);

        BIDS_AWARDED_TOTAL.inc();

        let families = REGISTRY.gather();
        let names: Vec<&str> = families
            .iter()
            .map(prometheus::proto::MetricFamily::name)
            .collect();
        assert!(names.contains(&"bid_processing_duration_seconds"));
        assert!(names.contains(&"bids_awarded_total"));
    }

    #[test]
    fn buckets_cover_slo_budget() {
        // SLO: p99 < 1ms. We need at least one bucket boundary at or below 1ms
        // and meaningful resolution below that.
        assert!(
            BID_BUCKETS
                .iter()
                .any(|&b| (b - 0.001).abs() < f64::EPSILON)
        );
        assert!(BID_BUCKETS.iter().any(|&b| b < 0.001));
    }
}
