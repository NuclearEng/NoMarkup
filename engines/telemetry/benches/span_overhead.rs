//! What one server span actually costs per RPC.
//!
//! The engine budgets in CLAUDE.md §8 are tight enough (bid p99 < 1ms) that
//! "add tracing" is not self-evidently free, and the per-engine benches cannot
//! answer this: they call engine functions directly, with no subscriber
//! installed, so `#[instrument]` compiles down to almost nothing there. This
//! bench installs a real subscriber and a real sampler so the number is the
//! one production actually pays.
//!
//! Three arms:
//!   * `baseline_no_layer` — the stub router alone, no layer at all.
//!   * `layer_disabled_no_subscriber` — layered, but no subscriber installed:
//!     what a filtered-out level costs.
//!   * `layer_sampled_with_exporter` — layered, subscriber plus a real span
//!     pipeline, `traceparent` present and sampled. The worst case.

use std::future::Future;
use std::hint::black_box;
use std::task::{Context, Poll};

use criterion::{Criterion, criterion_group, criterion_main};
use opentelemetry::global;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{Sampler, TracerProvider};
use tower::{Layer, Service};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::layer::SubscriberExt;

use engine_telemetry::GrpcTraceLayer;
use engine_telemetry::test_support::CollectingExporter;

const PLACE_BID_PATH: &str = "/nomarkup.bidding.v1.BidService/PlaceBid";
const SAMPLED_TRACEPARENT: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

#[derive(Clone, Copy)]
struct StubRouter;

impl<B> Service<http::Request<B>> for StubRouter {
    type Response = http::Response<()>;
    type Error = std::convert::Infallible;
    type Future = std::future::Ready<Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, _req: http::Request<B>) -> Self::Future {
        std::future::ready(Ok(http::Response::builder()
            .status(http::StatusCode::OK)
            .body(())
            .expect("static response is well-formed")))
    }
}

fn request() -> http::Request<()> {
    http::Request::builder()
        .uri(PLACE_BID_PATH)
        .header("traceparent", SAMPLED_TRACEPARENT)
        .body(())
        .expect("static request is well-formed")
}

/// Poll a future to completion on the current thread.
///
/// Nothing here ever pends, so a no-op waker suffices and we avoid dragging a
/// tokio runtime's timer and IO overhead into the measurement.
fn drive<F: Future>(future: F) -> F::Output {
    let mut future = Box::pin(future);
    let waker = std::task::Waker::noop();
    let mut cx = Context::from_waker(waker);
    loop {
        if let Poll::Ready(output) = future.as_mut().poll(&mut cx) {
            return output;
        }
    }
}

fn bench_span_overhead(c: &mut Criterion) {
    global::set_text_map_propagator(TraceContextPropagator::new());

    let mut group = c.benchmark_group("grpc_server_span");

    group.bench_function("baseline_no_layer", |b| {
        let mut service = StubRouter;
        b.iter(|| {
            let response = drive(service.call(request())).expect("stub never fails");
            black_box(response.status())
        });
    });

    group.bench_function("layer_disabled_no_subscriber", |b| {
        let mut service = GrpcTraceLayer.layer(StubRouter);
        b.iter(|| {
            let response = drive(service.call(request())).expect("stub never fails");
            black_box(response.status())
        });
    });

    // A full span pipeline: sampler, span builder, attribute recording, and an
    // exporter on the other end.
    let exporter = CollectingExporter::new();
    let provider = TracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .with_sampler(Sampler::ParentBased(Box::new(Sampler::AlwaysOn)))
        .build();
    let subscriber = tracing_subscriber::registry().with(OpenTelemetryLayer::new(
        opentelemetry::trace::TracerProvider::tracer(&provider, "bench"),
    ));
    let _guard = tracing::subscriber::set_default(subscriber);

    group.bench_function("layer_sampled_with_exporter", |b| {
        let mut service = GrpcTraceLayer.layer(StubRouter);
        b.iter(|| {
            let response = drive(service.call(request())).expect("stub never fails");
            // Keep the exporter's buffer bounded over millions of iterations.
            exporter.reset();
            black_box(response.status())
        });
    });

    group.finish();
}

criterion_group!(benches, bench_span_overhead);
criterion_main!(benches);
