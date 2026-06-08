//! Verifies the gRPC panic boundary (CLAUDE.md §9: "panics are bugs — catch at
//! the service boundary").
//!
//! `handle_panic` lives in the binary crate (`src/main.rs`), so it cannot be
//! imported here. It is small and intentionally duplicated per engine (there is
//! no shared crate), so this test keeps a byte-identical copy and asserts:
//!
//!   1. (unit) `handle_panic` builds a trailers-only gRPC error frame — HTTP 200,
//!      `content-type: application/grpc`, `grpc-status: 13` (Internal) — NOT a
//!      bare HTTP 500 that a gRPC client would read as a transport error.
//!
//!   2. (end-to-end) a tower service that panics inside `call`, wrapped in
//!      `CatchPanicLayer::custom(handle_panic)`, yields a *response* carrying
//!      `grpc-status: 13` instead of propagating the panic / resetting the
//!      stream. This is the exact layer wiring used in every engine's
//!      `Server::builder().layer(CatchPanicLayer::custom(handle_panic))`.

use std::convert::Infallible;
use std::task::{Context, Poll};

use http::{Request, Response};
use tower::{Layer, Service};
use tower_http::catch_panic::CatchPanicLayer;

/// Byte-identical copy of the per-engine `handle_panic` in `src/main.rs`.
fn handle_panic(
    err: Box<dyn std::any::Any + Send + 'static>,
) -> http::Response<tonic::body::BoxBody> {
    let details = if let Some(s) = err.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = err.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic payload".to_string()
    };

    tracing::error!(panic = %details, "gRPC handler panicked; returning Internal");

    http::Response::builder()
        .status(http::StatusCode::OK)
        .header(http::header::CONTENT_TYPE, "application/grpc")
        .header("grpc-status", "13")
        .header("grpc-message", "internal error")
        .body(tonic::body::empty_body())
        .expect("static gRPC panic response is always well-formed")
}

/// (1) Unit: the response built by `handle_panic` is a gRPC Internal frame.
#[test]
fn handle_panic_returns_grpc_internal_frame() {
    let payload: Box<dyn std::any::Any + Send + 'static> = Box::new("boom in a handler");
    let resp = handle_panic(payload);

    // gRPC errors ride on HTTP 200 — the failure lives in grpc-status, not the
    // HTTP status line. An HTTP 500 here would be read as a transport error.
    assert_eq!(resp.status(), http::StatusCode::OK, "must be HTTP 200");

    let headers = resp.headers();
    assert_eq!(
        headers
            .get(http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/grpc"),
        "content-type must mark this as a gRPC frame",
    );
    assert_eq!(
        headers.get("grpc-status").and_then(|v| v.to_str().ok()),
        Some("13"),
        "grpc-status must be 13 (Internal)",
    );
    assert_eq!(
        headers.get("grpc-message").and_then(|v| v.to_str().ok()),
        Some("internal error"),
    );
}

/// A tower service whose `call` always panics — stands in for a gRPC handler
/// that hits an `unwrap`/`expect`/indexing panic in production.
#[derive(Clone)]
struct PanickingService;

impl Service<Request<tonic::body::BoxBody>> for PanickingService {
    type Response = Response<tonic::body::BoxBody>;
    type Error = Infallible;
    type Future =
        std::future::Ready<Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, _req: Request<tonic::body::BoxBody>) -> Self::Future {
        panic!("handler exploded: simulated unwrap() on None");
    }
}

/// (2) End-to-end: the real `CatchPanicLayer::custom(handle_panic)` stack turns
/// a panicking inner service into a clean gRPC Internal response. This is the
/// exact wiring used in every engine's `main.rs`.
#[tokio::test]
async fn catch_panic_layer_converts_handler_panic_to_grpc_internal() {
    let mut svc =
        CatchPanicLayer::custom(handle_panic).layer(PanickingService);

    let req = Request::builder()
        .method(http::Method::POST)
        .uri("/nomarkup.bid.v1.BidService/PlaceBid")
        .header(http::header::CONTENT_TYPE, "application/grpc")
        .body(tonic::body::empty_body())
        .expect("request builds");

    // Honor the Service contract (poll_ready before call) without pulling in
    // tower's `util`/`ServiceExt` feature: both services here are always ready.
    std::future::poll_fn(|cx| svc.poll_ready(cx))
        .await
        .expect("service ready");

    // The panic happens inside `call`; the layer catches it and resolves to a
    // response rather than unwinding into the test (or resetting the stream).
    let resp = svc
        .call(req)
        .await
        .expect("CatchPanicLayer must yield a response, not propagate the panic");

    assert_eq!(resp.status(), http::StatusCode::OK, "HTTP 200 gRPC frame");
    assert_eq!(
        resp.headers()
            .get("grpc-status")
            .and_then(|v| v.to_str().ok()),
        Some("13"),
        "panic must surface as gRPC Internal (13), not a transport error",
    );
    assert_eq!(
        resp.headers()
            .get(http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/grpc"),
    );
}
