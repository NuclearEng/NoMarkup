//! Prometheus metrics for the pricing engine.
//!
//! Exposes `pricing_request_duration_seconds` and `pricing_requests_total` on a
//! separate HTTP listener so scrape traffic never competes with the gRPC hot
//! path. Skipped when `PRICING_METRICS_PORT` is unset.

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

const BUCKETS: &[f64] = &[0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1];

pub static REGISTRY: LazyLock<Registry> = LazyLock::new(Registry::new);

pub static REQUEST_DURATION: LazyLock<Histogram> = LazyLock::new(|| {
    let h = Histogram::with_opts(
        HistogramOpts::new(
            "pricing_request_duration_seconds",
            "End-to-end latency of ComputeFairPrice through the pricing engine.",
        )
        .buckets(BUCKETS.to_vec()),
    )
    .expect("histogram opts are valid");
    REGISTRY
        .register(Box::new(h.clone()))
        .expect("histogram registration succeeds");
    h
});

pub static REQUESTS_TOTAL: LazyLock<IntCounter> = LazyLock::new(|| {
    let c = IntCounter::new(
        "pricing_requests_total",
        "Total number of fair-price computations served.",
    )
    .expect("counter opts are valid");
    REGISTRY
        .register(Box::new(c.clone()))
        .expect("counter registration succeeds");
    c
});

pub fn init() {
    LazyLock::force(&REQUEST_DURATION);
    LazyLock::force(&REQUESTS_TOTAL);
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

pub async fn serve_metrics(addr: SocketAddr) -> std::io::Result<()> {
    init();
    let listener = TcpListener::bind(addr).await?;
    tracing::info!(addr = %addr, "pricing metrics server listening");

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
        REQUEST_DURATION.observe(0.001);
        REQUESTS_TOTAL.inc();
        let families = REGISTRY.gather();
        let names: Vec<&str> = families
            .iter()
            .map(prometheus::proto::MetricFamily::name)
            .collect();
        assert!(names.contains(&"pricing_request_duration_seconds"));
        assert!(names.contains(&"pricing_requests_total"));
    }
}
