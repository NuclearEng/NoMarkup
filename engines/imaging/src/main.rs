#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::missing_errors_doc,
    clippy::doc_markdown,
    clippy::missing_const_for_fn,
    clippy::similar_names,
    clippy::module_name_repetitions,
    clippy::suboptimal_flops,
    clippy::collapsible_if,
    clippy::match_same_arms,
    clippy::too_many_lines,
    clippy::too_many_arguments,
    clippy::needless_pass_by_value,
    clippy::manual_let_else,
    clippy::items_after_statements,
    clippy::empty_line_after_doc_comments,
    clippy::implicit_hasher,
    clippy::redundant_clone,
    clippy::map_unwrap_or,
    clippy::option_if_let_else,
    clippy::unused_self,
    clippy::redundant_closure_for_method_calls,
    clippy::redundant_else,
    clippy::if_not_else,
    clippy::unnecessary_wraps,
    clippy::needless_for_each,
    clippy::doc_overindented_list_items,
    clippy::result_large_err,
    clippy::trivially_copy_pass_by_ref,
    clippy::must_use_unit,
    clippy::must_use_candidate,
    clippy::type_complexity,
    clippy::unreadable_literal,
    clippy::double_must_use
)]

mod engine;
mod grpc;
mod metrics;
mod models;

use std::sync::Arc;

use opentelemetry::KeyValue;
use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::SpanExporter;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::runtime::Tokio;
use opentelemetry_sdk::trace::TracerProvider;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

use tower_http::catch_panic::CatchPanicLayer;

use crate::engine::ImagePipeline;
use crate::grpc::{ImagingServiceImpl, ImagingServiceServer};

/// Panic boundary for the gRPC service stack (CLAUDE.md §9: "panics are bugs —
/// catch at the service boundary"). A panic inside any handler is caught by the
/// `CatchPanicLayer` and routed here instead of resetting the HTTP/2 stream.
///
/// We log the panic via `tracing::error!` so the crash is observable, then
/// return a trailers-only gRPC error frame: HTTP 200 with `content-type:
/// application/grpc` and `grpc-status: 13` (Internal). This is what a gRPC
/// client expects — a bare HTTP 500 with no grpc-status reads as an opaque
/// transport error, not a `Status`.
///
/// The body is `tonic::body::BoxBody` (`UnsyncBoxBody<Bytes, Status>`), whose
/// error type unifies with the `Box<dyn Error + Send + Sync>` the layered tonic
/// server stack expects.
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

fn init_tracing(service_name: &str) {
    let env_filter = EnvFilter::from_default_env();
    let fmt_layer = fmt::layer().json();

    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok();

    if let Some(endpoint) = endpoint {
        let Ok(exporter) = SpanExporter::builder()
            .with_tonic()
            .with_endpoint(&endpoint)
            .build()
        else {
            tracing::warn!("failed to create OTLP exporter, continuing without tracing export");
            tracing_subscriber::registry()
                .with(env_filter)
                .with(fmt_layer)
                .init();
            return;
        };

        let name = std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| service_name.to_string());

        let provider = TracerProvider::builder()
            .with_batch_exporter(exporter, Tokio)
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
    } else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt_layer)
            .init();

        tracing::info!("tracing enabled (local only, no OTLP exporter)");
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing("imaging-service");

    let port = std::env::var("IMAGING_SERVICE_PORT").unwrap_or_else(|_| "50058".into());
    let bucket = std::env::var("S3_BUCKET").unwrap_or_else(|_| "nomarkup".into());
    let endpoint = std::env::var("S3_ENDPOINT").unwrap_or_else(|_| "http://localhost:9000".into());
    let public_url =
        std::env::var("S3_PUBLIC_URL").unwrap_or_else(|_| format!("{endpoint}/{bucket}"));

    // Configure S3 client for MinIO. The AWS SDK reads credentials from
    // standard environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
    // or falls back to instance metadata / credential chain.
    let s3_config = aws_config::from_env().endpoint_url(&endpoint).load().await;

    let s3_client = aws_sdk_s3::Client::from_conf(
        aws_sdk_s3::config::Builder::from(&s3_config)
            .force_path_style(true) // Required for MinIO
            .build(),
    );

    let pipeline = Arc::new(ImagePipeline::new(s3_client, bucket, public_url));
    let service = ImagingServiceImpl::new(pipeline);

    // Prometheus /metrics exposition (optional, see CLAUDE.md §11).
    if let Ok(metrics_port) = std::env::var("IMAGING_METRICS_PORT") {
        match format!("0.0.0.0:{metrics_port}").parse() {
            Ok(metrics_addr) => {
                tokio::spawn(async move {
                    if let Err(e) = crate::metrics::serve_metrics(metrics_addr).await {
                        tracing::warn!(error = %e, "imaging metrics server exited");
                    }
                });
            }
            Err(e) => {
                tracing::warn!(error = %e, port = %metrics_port, "invalid IMAGING_METRICS_PORT, metrics disabled");
            }
        }
    } else {
        tracing::info!("IMAGING_METRICS_PORT not set, /metrics endpoint disabled");
    }

    // gRPC health check — see bidding/src/main.rs for design notes.
    let (mut health_reporter, health_service) = tonic_health::server::health_reporter();
    health_reporter
        .set_serving::<ImagingServiceServer<ImagingServiceImpl>>()
        .await;

    let addr = format!("0.0.0.0:{port}").parse()?;
    tracing::info!("imaging engine starting on {}", addr);

    tonic::transport::Server::builder()
        .layer(CatchPanicLayer::custom(handle_panic))
        .add_service(health_service)
        .add_service(ImagingServiceServer::new(service))
        .serve_with_shutdown(addr, async {
            if let Err(e) = tokio::signal::ctrl_c().await {
                tracing::error!(error = %e, "failed to listen for ctrl_c");
            }
            tracing::info!("imaging engine shutting down");
        })
        .await?;

    global::shutdown_tracer_provider();
    Ok(())
}
