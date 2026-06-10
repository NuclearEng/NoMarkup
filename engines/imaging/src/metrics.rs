//! Prometheus metrics for the imaging engine.
//!
//! Exposes `image_processing_duration_seconds` (histogram, per CLAUDE.md §11)
//! and `images_processed_total` (counter).

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

/// Buckets matched to the imaging SLO budget (CLAUDE.md §8 — p99 < 200ms).
const IMAGE_BUCKETS: &[f64] = &[0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0];

pub static REGISTRY: LazyLock<Registry> = LazyLock::new(Registry::new);

pub static IMAGE_PROCESSING_DURATION: LazyLock<Histogram> = LazyLock::new(|| {
    let h = Histogram::with_opts(
        HistogramOpts::new(
            "image_processing_duration_seconds",
            "End-to-end latency of single-image processing (download + resize + encode + upload).",
        )
        .buckets(IMAGE_BUCKETS.to_vec()),
    )
    .expect("histogram opts are valid");
    REGISTRY
        .register(Box::new(h.clone()))
        .expect("histogram registration succeeds");
    h
});

pub static IMAGES_PROCESSED_TOTAL: LazyLock<IntCounter> = LazyLock::new(|| {
    let c = IntCounter::new(
        "images_processed_total",
        "Total number of images successfully processed by the imaging pipeline.",
    )
    .expect("counter opts are valid");
    REGISTRY
        .register(Box::new(c.clone()))
        .expect("counter registration succeeds");
    c
});

pub fn init() {
    LazyLock::force(&IMAGE_PROCESSING_DURATION);
    LazyLock::force(&IMAGES_PROCESSED_TOTAL);
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
    tracing::info!(addr = %addr, "imaging metrics server listening");

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
        IMAGE_PROCESSING_DURATION.observe(0.1);
        IMAGE_PROCESSING_DURATION.observe(0.2);
        IMAGES_PROCESSED_TOTAL.inc();

        let families = REGISTRY.gather();
        let names: Vec<&str> = families
            .iter()
            .map(prometheus::proto::MetricFamily::get_name)
            .collect();
        assert!(names.contains(&"image_processing_duration_seconds"));
        assert!(names.contains(&"images_processed_total"));
    }

    #[test]
    fn buckets_cover_slo_budget() {
        // SLO: p99 < 200ms. The 200ms bucket boundary must exist.
        assert!(
            IMAGE_BUCKETS
                .iter()
                .any(|&b| (b - 0.2).abs() < f64::EPSILON)
        );
    }
}
