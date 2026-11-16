//! End-to-end proof that the engine tier actually emits spans, and that those
//! spans join the caller's trace instead of starting an orphan root.
//!
//! Compiling `GrpcTraceLayer` proves nothing — the defect being fixed here was
//! a tracer that was configured and then never used. So these tests drive a
//! real `http::Request` through the real layer with a real
//! `TracerProvider`, and assert on the `SpanData` an exporter actually
//! received.
//!
//! `InMemorySpanExporter` + `with_simple_exporter` gives synchronous export on
//! span close, so there is no flush race to make the suite flaky.

use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use std::task::{Context, Poll};

use opentelemetry::global;
use opentelemetry::trace::{SpanId, SpanKind, Status, TraceId};
use opentelemetry_sdk::export::trace::SpanData;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{Sampler, TracerProvider};
use tower::{Layer, Service};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::layer::SubscriberExt;

use engine_telemetry::GrpcTraceLayer;
use engine_telemetry::test_support::CollectingExporter;

/// A `traceparent` from the W3C spec's own example. Version 00, sampled.
const SAMPLED_TRACEPARENT: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const EXPECTED_TRACE_ID: &str = "4bf92f3577b34da6a3ce929d0e0e4736";
const EXPECTED_PARENT_SPAN_ID: &str = "00f067aa0ba902b7";

const PLACE_BID_PATH: &str = "/nomarkup.bidding.v1.BidService/PlaceBid";

/// The propagator is process-global, so install it exactly once even though
/// the tests in this binary run in parallel.
fn install_propagator() {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        global::set_text_map_propagator(TraceContextPropagator::new());
    });
}

/// Minimal stand-in for the tonic router: returns a canned response with the
/// given `grpc-status` header, or none at all when `grpc_status` is `None`
/// (the successful-unary shape, where the status lives in real trailers).
#[derive(Clone, Copy)]
struct StubRouter {
    grpc_status: Option<&'static str>,
    /// Emit a nested span, standing in for the engines' `#[instrument]`
    /// hot-path instrumentation.
    emit_child: bool,
}

impl<B> Service<http::Request<B>> for StubRouter {
    type Response = http::Response<()>;
    type Error = std::convert::Infallible;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, _req: http::Request<B>) -> Self::Future {
        let grpc_status = self.grpc_status;
        let emit_child = self.emit_child;
        Box::pin(async move {
            // Yield once so the response is produced across a real await
            // point — the span has to survive being polled more than once.
            tokio::task::yield_now().await;

            if emit_child {
                // Stands in for the engines' `#[instrument]` hot-path spans
                // (`place_bid`, `render_processed`, `compute_score`, ...),
                // which are created inside the handler with no explicit
                // parent and must inherit one from the layer's server span.
                let child = tracing::info_span!("engine.work", candidate_count = 42);
                let _entered = child.enter();
                tokio::task::yield_now().await;
            }

            let mut builder = http::Response::builder().status(http::StatusCode::OK);
            if let Some(status) = grpc_status {
                builder = builder.header("grpc-status", status);
            }
            Ok(builder.body(()).expect("static response is well-formed"))
        })
    }
}

/// Drive one request through the layer under a scoped subscriber and return
/// every span the exporter received.
fn spans_for(headers: &[(&str, &str)], grpc_status: Option<&'static str>) -> Vec<SpanData> {
    spans_for_router(headers, grpc_status, false)
}

fn spans_for_router(
    headers: &[(&str, &str)],
    grpc_status: Option<&'static str>,
    emit_child: bool,
) -> Vec<SpanData> {
    install_propagator();

    let exporter = CollectingExporter::new();
    let provider = TracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        // Mirrors the production sampler from `engine_telemetry::init`, so
        // these tests exercise the real head-sampling behaviour rather than a
        // permissive test-only one.
        .with_sampler(Sampler::ParentBased(Box::new(Sampler::AlwaysOn)))
        .build();

    let subscriber = tracing_subscriber::registry().with(OpenTelemetryLayer::new(
        opentelemetry::trace::TracerProvider::tracer(&provider, "test"),
    ));

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("current-thread runtime builds");

    // Thread-local default + a current-thread runtime means every poll of the
    // future below happens under this subscriber, with no global state shared
    // between parallel tests.
    let _guard = tracing::subscriber::set_default(subscriber);

    runtime.block_on(async move {
        let mut service = GrpcTraceLayer.layer(StubRouter {
            grpc_status,
            emit_child,
        });

        let mut builder = http::Request::builder().uri(PLACE_BID_PATH);
        for (key, value) in headers {
            builder = builder.header(*key, *value);
        }
        let request = builder.body(()).expect("static request is well-formed");

        let response = service
            .call(request)
            .await
            .expect("stub router never fails");
        assert_eq!(response.status(), http::StatusCode::OK);
    });

    // Dropping the future closed the span; the simple processor exported it
    // synchronously. Flush anyway so a future switch to a batch processor
    // fails loudly rather than silently.
    provider.force_flush();

    exporter.finished_spans()
}

/// The whole point: a span exists at all, with the conventional gRPC name and
/// server kind.
#[test]
fn a_grpc_request_produces_exactly_one_server_span() {
    let spans = spans_for(&[("traceparent", SAMPLED_TRACEPARENT)], None);

    assert_eq!(spans.len(), 1, "expected one span per RPC, got {spans:?}");
    let span = &spans[0];

    assert_eq!(
        span.name, "nomarkup.bidding.v1.BidService/PlaceBid",
        "span should be named for the full gRPC method, not the tracing macro's constant"
    );
    assert_eq!(span.span_kind, SpanKind::Server);
}

/// The part most likely to be silently wrong: the span must land *inside* the
/// caller's trace, not start a fresh one.
#[test]
fn incoming_traceparent_becomes_the_parent_not_a_new_root() {
    let spans = spans_for(&[("traceparent", SAMPLED_TRACEPARENT)], None);
    let span = &spans[0];

    let expected_trace_id = TraceId::from_hex(EXPECTED_TRACE_ID).expect("valid trace id");
    let expected_parent = SpanId::from_hex(EXPECTED_PARENT_SPAN_ID).expect("valid span id");

    assert_eq!(
        span.span_context.trace_id(),
        expected_trace_id,
        "trace id must match the incoming traceparent — a different id means the \
         engine started an orphan trace and the gateway's trace still dead-ends here"
    );
    assert_eq!(
        span.parent_span_id, expected_parent,
        "the caller's span id must be recorded as this span's parent"
    );
    assert!(span.span_context.is_sampled());
}

/// The complement: with no incoming context the engine is the root, and it
/// must not invent a parent.
#[test]
fn a_request_without_traceparent_starts_a_root_span() {
    let spans = spans_for(&[("content-type", "application/grpc")], None);
    let span = &spans[0];

    assert_eq!(
        span.parent_span_id,
        SpanId::INVALID,
        "an unparented call must be a root span"
    );
    assert_ne!(
        span.span_context.trace_id(),
        TraceId::from_hex(EXPECTED_TRACE_ID).expect("valid trace id"),
        "no incoming context means a freshly generated trace id"
    );
    assert!(span.span_context.trace_id() != TraceId::INVALID);
}

/// A garbage `traceparent` must degrade to a root span, never fail the RPC.
/// Anything reachable from the network gets a hostile-input test.
#[test]
fn a_malformed_traceparent_degrades_to_a_root_span() {
    for bad in [
        "",
        "garbage",
        "00-notahexvalue-00f067aa0ba902b7-01",
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7",
        "00-00000000000000000000000000000000-0000000000000000-00",
    ] {
        let spans = spans_for(&[("traceparent", bad)], None);
        assert_eq!(spans.len(), 1, "the RPC still gets a span for {bad:?}");
        assert_eq!(
            spans[0].parent_span_id,
            SpanId::INVALID,
            "{bad:?} should have been ignored, not adopted as a parent"
        );
    }
}

/// W3C requires forward-compatible parsing: an unknown *version* prefix with
/// otherwise well-formed fields is still honoured. Pinned as a test because
/// the intuitive expectation ("unknown version means ignore it") is wrong, and
/// getting it wrong would silently split traces the day the spec bumps.
#[test]
fn an_unknown_traceparent_version_is_still_honoured() {
    let spans = spans_for(
        &[(
            "traceparent",
            "99-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        )],
        None,
    );

    assert_eq!(
        spans[0].span_context.trace_id(),
        TraceId::from_hex(EXPECTED_TRACE_ID).expect("valid trace id")
    );
    assert_eq!(
        spans[0].parent_span_id,
        SpanId::from_hex(EXPECTED_PARENT_SPAN_ID).expect("valid span id")
    );
}

/// The diagnostic attributes an operator filters on.
#[test]
fn rpc_attributes_are_recorded() {
    let spans = spans_for(&[("traceparent", SAMPLED_TRACEPARENT)], None);
    let attributes = attribute_map(&spans[0]);

    assert_eq!(
        attributes.get("rpc.system").map(String::as_str),
        Some("grpc")
    );
    assert_eq!(
        attributes.get("rpc.service").map(String::as_str),
        Some("nomarkup.bidding.v1.BidService")
    );
    assert_eq!(
        attributes.get("rpc.method").map(String::as_str),
        Some("PlaceBid")
    );
}

/// tonic reports handler errors as trailers-only responses, so a failing RPC
/// carries `grpc-status` in its headers. That is the case an operator is
/// actually chasing, and it must mark the span as an error.
#[test]
fn a_failed_rpc_marks_the_span_as_an_error() {
    let spans = spans_for(&[("traceparent", SAMPLED_TRACEPARENT)], Some("7"));
    let span = &spans[0];

    assert_eq!(span.status, Status::error(""));
    assert_eq!(
        attribute_map(span).get("rpc.grpc.status_code").cloned(),
        Some("7".to_string())
    );
}

/// A `grpc-status: 0` header is a success and must not be flagged.
#[test]
fn an_ok_status_header_does_not_mark_an_error() {
    let spans = spans_for(&[("traceparent", SAMPLED_TRACEPARENT)], Some("0"));
    assert_ne!(spans[0].status, Status::error(""));
}

/// Head sampling is delegated to the caller: a `traceparent` whose flags say
/// "not sampled" must produce no exported span at all. This is what keeps the
/// tier's tracing cost tied to the gateway's single sampling knob.
#[test]
fn an_unsampled_parent_suppresses_the_span() {
    let spans = spans_for(
        &[(
            "traceparent",
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
        )],
        None,
    );

    assert!(
        spans.is_empty(),
        "parent-based sampling should have dropped this span, got {spans:?}"
    );
}

fn attribute_map(span: &SpanData) -> std::collections::HashMap<String, String> {
    span.attributes
        .iter()
        .map(|kv| (kv.key.to_string(), kv.value.to_string()))
        .collect()
}

/// The other half of the fix: the transport layer creates the server span, but
/// the per-engine `#[instrument]` spans are what actually carry the diagnostic
/// attributes. They are created inside the handler with no explicit parent, so
/// they are only useful if `tracing`'s context propagates through the
/// `Instrumented` future into the caller's trace. This asserts that whole
/// chain — caller `traceparent` → server span → engine span — end to end.
#[test]
fn engine_child_spans_inherit_the_callers_trace() {
    let spans = spans_for_router(&[("traceparent", SAMPLED_TRACEPARENT)], None, true);

    assert_eq!(
        spans.len(),
        2,
        "expected a server span and a child, got {spans:?}"
    );

    let child = spans
        .iter()
        .find(|s| s.name == "engine.work")
        .expect("the engine span was exported");
    let server = spans
        .iter()
        .find(|s| s.name == "nomarkup.bidding.v1.BidService/PlaceBid")
        .expect("the server span was exported");

    let expected_trace_id = TraceId::from_hex(EXPECTED_TRACE_ID).expect("valid trace id");

    assert_eq!(
        child.span_context.trace_id(),
        expected_trace_id,
        "the engine's own work must land in the caller's trace, not a new one"
    );
    assert_eq!(
        child.parent_span_id,
        server.span_context.span_id(),
        "the engine span must hang off the server span"
    );
    assert_eq!(
        attribute_map(child)
            .get("candidate_count")
            .map(String::as_str),
        Some("42"),
        "hot-path attributes must survive export"
    );
}
