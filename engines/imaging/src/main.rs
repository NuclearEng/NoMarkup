#![deny(clippy::all, clippy::pedantic)]

mod engine;
mod grpc;
mod models;

use std::sync::Arc;

use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_otlp::SpanExporter;
use opentelemetry_sdk::runtime::Tokio;
use opentelemetry_sdk::trace::TracerProvider;
use opentelemetry_sdk::Resource;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::engine::ImagePipeline;
use crate::grpc::{ImagingServiceImpl, ImagingServiceServer};

fn init_tracing(service_name: &str) {
    let env_filter = EnvFilter::from_default_env();
    let fmt_layer = fmt::layer().json();

    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok();

    if let Some(endpoint) = endpoint {
        let exporter = SpanExporter::builder()
            .with_tonic()
            .with_endpoint(&endpoint)
            .build()
            .expect("failed to create OTLP exporter");

        let name = std::env::var("OTEL_SERVICE_NAME")
            .unwrap_or_else(|_| service_name.to_string());

        let provider = TracerProvider::builder()
            .with_batch_exporter(exporter, Tokio)
            .with_resource(
                Resource::new([KeyValue::new("service.name", name.clone())]),
            )
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
    let s3_config = aws_config::from_env()
        .endpoint_url(&endpoint)
        .load()
        .await;

    let s3_client = aws_sdk_s3::Client::from_conf(
        aws_sdk_s3::config::Builder::from(&s3_config)
            .force_path_style(true) // Required for MinIO
            .build(),
    );

    let pipeline = Arc::new(ImagePipeline::new(s3_client, bucket, public_url));
    let service = ImagingServiceImpl::new(pipeline);

    let addr = format!("0.0.0.0:{port}").parse()?;
    tracing::info!("imaging engine starting on {}", addr);

    tonic::transport::Server::builder()
        .add_service(ImagingServiceServer::new(service))
        .serve_with_shutdown(addr, async {
            tokio::signal::ctrl_c()
                .await
                .expect("failed to listen for ctrl_c");
            tracing::info!("imaging engine shutting down");
        })
        .await?;

    global::shutdown_tracer_provider();
    Ok(())
}
