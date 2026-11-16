//! A tower layer that turns every incoming gRPC request into a server span
//! parented to the caller's trace.
//!
//! # Why a transport layer rather than per-handler instrumentation
//!
//! The engines expose ~50 RPCs across six binaries. Annotating each handler
//! would guarantee the next RPC someone adds is untraced, and would still not
//! cover the panic path. Wrapping the tonic stack once per binary covers every
//! present and future method, and — because it sits *outside*
//! `CatchPanicLayer` — a panicked handler still produces a span carrying
//! `grpc-status: 13` rather than vanishing.
//!
//! What a transport layer cannot see is the decoded request message, so
//! per-request diagnostics (batch size, image dimensions, candidate count) are
//! recorded on the engine-level child spans instead, where the types are known.
//!
//! # Cost
//!
//! One span per RPC, never per item. When the `info` level is filtered out the
//! span is disabled and the whole path — including the `traceparent` parse,
//! which is the expensive half — is skipped. See `benches/span_overhead.rs`.

use std::pin::Pin;
use std::task::{Context, Poll, ready};

use opentelemetry::global;
use pin_project_lite::pin_project;
use tower::{Layer, Service};
use tracing::instrument::{Instrument, Instrumented};
use tracing::{Span, field};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::propagation::HeaderExtractor;

/// gRPC status code for "no error", per the gRPC wire spec.
const GRPC_STATUS_OK: i64 = 0;

/// Layers [`GrpcTrace`] onto a tonic server stack.
///
/// Apply it *before* `CatchPanicLayer` so it ends up outermost:
///
/// ```ignore
/// Server::builder()
///     .layer(GrpcTraceLayer)
///     .layer(CatchPanicLayer::custom(handle_panic))
/// ```
#[derive(Clone, Copy, Debug, Default)]
pub struct GrpcTraceLayer;

impl<S> Layer<S> for GrpcTraceLayer {
    type Service = GrpcTrace<S>;

    fn layer(&self, inner: S) -> Self::Service {
        GrpcTrace { inner }
    }
}

/// The service produced by [`GrpcTraceLayer`].
#[derive(Clone, Copy, Debug)]
pub struct GrpcTrace<S> {
    inner: S,
}

impl<S, ReqBody, ResBody> Service<http::Request<ReqBody>> for GrpcTrace<S>
where
    S: Service<http::Request<ReqBody>, Response = http::Response<ResBody>>,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = ResponseFuture<S::Future>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: http::Request<ReqBody>) -> Self::Future {
        let span = server_span(req.uri().path(), req.headers());

        ResponseFuture {
            inner: self.inner.call(req).instrument(span),
        }
    }
}

/// Build the server span for one RPC and join it to the caller's trace.
///
/// The tracing macro requires a `'static` span name, so the collector-visible
/// name is set through the well-known `otel.name` field, which
/// `tracing-opentelemetry` recognises. That gives collectors the conventional
/// `nomarkup.bidding.v1.BidService/PlaceBid` rather than a constant.
fn server_span(path: &str, headers: &http::HeaderMap) -> Span {
    let span = tracing::info_span!(
        "grpc.server",
        otel.name = field::Empty,
        otel.kind = "server",
        otel.status_code = field::Empty,
        rpc.system = "grpc",
        rpc.service = field::Empty,
        rpc.method = field::Empty,
        rpc.grpc.status_code = field::Empty,
    );

    // Everything below costs real work — a header scan plus a `traceparent`
    // parse. On a sub-millisecond budget it is worth not doing it at all when
    // the subscriber has filtered this level out (benches, `RUST_LOG=warn`,
    // no subscriber installed).
    if span.is_disabled() {
        return span;
    }

    // "/nomarkup.bidding.v1.BidService/PlaceBid" -> service + method.
    let full_method = path.trim_start_matches('/');
    let (service, method) = full_method
        .split_once('/')
        .unwrap_or((full_method, "unknown"));

    span.record("otel.name", full_method);
    span.record("rpc.service", service);
    span.record("rpc.method", method);

    // Join the caller's trace. The Go tier sets
    // `propagation.TraceContext{}` and attaches otelgrpc handlers, so a
    // `traceparent` header is present on every gateway- or service-originated
    // call. `set_parent` clears the pending sampling decision, so the
    // ParentBased sampler re-runs against the caller's flags — which is what
    // makes "gateway sampled it" mean "the engine samples it too".
    //
    // No parent (health probes, cron sweeps, direct debugging) simply yields
    // an empty context and this span becomes a root, as it should.
    let parent_cx =
        global::get_text_map_propagator(|propagator| propagator.extract(&HeaderExtractor(headers)));
    span.set_parent(parent_cx);

    span
}

pin_project! {
    /// Holds the RPC's server span open for the life of the response and
    /// stamps the gRPC status onto it on the way out.
    pub struct ResponseFuture<F> {
        #[pin]
        inner: Instrumented<F>,
    }
}

impl<F, ResBody, E> std::future::Future for ResponseFuture<F>
where
    F: std::future::Future<Output = Result<http::Response<ResBody>, E>>,
{
    type Output = F::Output;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut this = self.project();
        let output = ready!(this.inner.as_mut().poll(cx));

        if let Ok(response) = &output {
            record_grpc_status(this.inner.as_ref().get_ref().span(), response.headers());
        }

        Poll::Ready(output)
    }
}

/// Record the gRPC status, when the response carries one in its headers.
///
/// tonic returns handler errors (and the `CatchPanicLayer` fallback) as
/// trailers-only responses, which put `grpc-status` in the HEADERS frame — so
/// the failure cases an operator actually chases are all visible here. A
/// successful unary reply carries its status in real trailers, which a
/// transport-level layer cannot observe; those spans are left `Unset`, which
/// OpenTelemetry already reads as "no error reported".
fn record_grpc_status(span: &Span, headers: &http::HeaderMap) {
    let Some(code) = headers
        .get("grpc-status")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
    else {
        return;
    };

    span.record("rpc.grpc.status_code", code);

    if code != GRPC_STATUS_OK {
        span.record("otel.status_code", "ERROR");
    }
}

#[cfg(test)]
mod tests {
    use super::server_span;

    /// The span must not blow up on paths tonic would never route, because a
    /// hostile client can send any `:path` it likes.
    #[test]
    fn malformed_paths_do_not_panic() {
        for path in ["", "/", "//", "/no-slash-after-service", "/a/b/c", "////"] {
            let span = server_span(path, &http::HeaderMap::new());
            drop(span);
        }
    }

    #[test]
    fn missing_traceparent_is_not_an_error() {
        let span = server_span("/nomarkup.bidding.v1.BidService/PlaceBid", &{
            let mut map = http::HeaderMap::new();
            map.insert(
                http::HeaderName::from_static("content-type"),
                http::HeaderValue::from_static("application/grpc"),
            );
            map
        });
        drop(span);
    }
}
