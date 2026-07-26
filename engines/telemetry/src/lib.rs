//! Shared OpenTelemetry wiring for the Rust engine tier.
//!
//! # Why this crate exists
//!
//! Four of the six engines (`bidding`, `fraud`, `trust`, `imaging`) each carried
//! their own byte-identical copy of an OTLP exporter setup, and two (`pricing`,
//! `underwriting`) had none at all. None of them ever created a span, and none
//! of them installed a `TextMapPropagator` — so even the four that exported
//! shipped an empty tracer, and any trace arriving from the Go tier died at the
//! engine boundary.
//!
//! Everything an engine needs to be traceable now lives here, so the six
//! `main.rs` files stay near-identical (a deliberate property of this tree) and
//! there is exactly one place to fix propagation, sampling, or resource
//! attributes.
//!
//! # Propagation contract
//!
//! The gateway and every Go service call
//! `otel.SetTextMapPropagator(propagation.TraceContext{})` and attach
//! `otelgrpc` stats handlers, which inject the **W3C `traceparent`** header into
//! gRPC metadata (gRPC metadata *is* HTTP/2 headers, so it arrives as a plain
//! `http::HeaderMap` entry). [`init`] installs the matching
//! [`TraceContextPropagator`] and [`GrpcTraceLayer`] extracts from it, so engine
//! spans become children of the caller's span instead of orphan roots.
//!
//! # Sampling
//!
//! [`Sampler::ParentBased`] wrapping [`Sampler::TraceIdRatioBased`]. The parent
//! decision dominates in practice: the gateway is the trace root, so an engine
//! only pays for spans on requests the gateway already chose to sample, and the
//! head-sampling rate stays a single knob at the edge. The ratio configured
//! here (`OTEL_TRACES_SAMPLER_ARG`, default `1.0`) therefore applies only to
//! *unparented* calls — health probes, cron-driven sweeps, direct debugging.

mod grpc;
mod mtls;
mod propagation;

#[cfg(feature = "test-util")]
pub mod test_support;

pub use grpc::{GrpcTrace, GrpcTraceLayer};
pub use mtls::load_server_tls;

use opentelemetry::KeyValue;
use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{SpanExporter, WithExportConfig};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::runtime::Tokio;
use opentelemetry_sdk::trace::{Sampler, TracerProvider};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

/// Default head-sampling ratio for spans with no incoming parent.
const DEFAULT_ROOT_SAMPLE_RATIO: f64 = 1.0;

/// Install the process-wide tracing subscriber, and — when
/// `OTEL_EXPORTER_OTLP_ENDPOINT` is set — an OTLP span exporter.
///
/// `service_name` is the fallback `service.name` resource attribute;
/// `OTEL_SERVICE_NAME` overrides it.
///
/// This never fails the caller: an engine that cannot reach a collector must
/// still boot and serve traffic. A broken exporter downgrades to local JSON
/// logs and says so.
///
/// The W3C propagator is installed **unconditionally**, including on the
/// no-exporter path. It is what makes `traceparent` extraction work, and
/// leaving it out is exactly the failure this crate exists to prevent.
pub fn init(service_name: &str) {
    global::set_text_map_propagator(TraceContextPropagator::new());

    let env_filter = EnvFilter::from_default_env();
    let fmt_layer = fmt::layer().json();

    let Some(endpoint) = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok() else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt_layer)
            .init();

        tracing::info!("tracing enabled (local only, no OTLP exporter)");
        return;
    };

    let Ok(exporter) = SpanExporter::builder()
        .with_tonic()
        .with_endpoint(&endpoint)
        .build()
    else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt_layer)
            .init();

        tracing::warn!("failed to create OTLP exporter, continuing without tracing export");
        return;
    };

    let name = std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| service_name.to_string());

    let provider = TracerProvider::builder()
        .with_batch_exporter(exporter, Tokio)
        .with_sampler(sampler_from_env())
        .with_resource(Resource::new([KeyValue::new("service.name", name.clone())]))
        .build();

    global::set_tracer_provider(provider.clone());

    let otel_layer = OpenTelemetryLayer::new(provider.tracer(name));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .with(otel_layer)
        .init();

    tracing::info!("tracing enabled with OTLP exporter");
}

/// Flush and tear down the exporter. Call once, on the way out of `main`.
pub fn shutdown() {
    global::shutdown_tracer_provider();
}

/// Build the sampler described in the module docs.
fn sampler_from_env() -> Sampler {
    Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(root_sample_ratio(
        std::env::var("OTEL_TRACES_SAMPLER_ARG").ok().as_deref(),
    ))))
}

/// Pure core of [`sampler_from_env`], split out so the parsing rules are
/// testable without mutating process environment (`std::env::set_var` is
/// `unsafe` under the 2024 edition, and `unsafe_code` is denied workspace-wide).
///
/// A malformed or out-of-range value falls back to the default rather than
/// failing startup: sampling density is an observability knob, not a security
/// control, and refusing to boot over a typo'd ratio would be worse than
/// tracing more than intended.
fn root_sample_ratio(raw: Option<&str>) -> f64 {
    raw.and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|r| r.is_finite() && (0.0..=1.0).contains(r))
        .unwrap_or(DEFAULT_ROOT_SAMPLE_RATIO)
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_ROOT_SAMPLE_RATIO, root_sample_ratio};

    #[test]
    fn ratio_parses_valid_values() {
        assert!((root_sample_ratio(Some("0.05")) - 0.05).abs() < f64::EPSILON);
        assert!((root_sample_ratio(Some("  1.0  ")) - 1.0).abs() < f64::EPSILON);
        assert!((root_sample_ratio(Some("0")) - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn ratio_rejects_garbage_and_out_of_range_without_panicking() {
        for bad in [
            None,
            Some(""),
            Some("half"),
            Some("-0.5"),
            Some("2.0"),
            Some("NaN"),
            Some("inf"),
        ] {
            assert!(
                (root_sample_ratio(bad) - DEFAULT_ROOT_SAMPLE_RATIO).abs() < f64::EPSILON,
                "{bad:?} should fall back to the default ratio"
            );
        }
    }
}
