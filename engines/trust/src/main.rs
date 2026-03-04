#![deny(clippy::all, clippy::pedantic)]

mod engine;
mod grpc;
mod models;
mod scoring;

use std::sync::Arc;

use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_otlp::SpanExporter;
use opentelemetry_sdk::runtime::Tokio;
use opentelemetry_sdk::trace::TracerProvider;
use opentelemetry_sdk::Resource;
use sqlx::postgres::PgPoolOptions;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::engine::TrustScorer;
use crate::grpc::{TrustServiceImpl, TrustServiceServer};

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
    init_tracing("trust-engine");

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost:5433/nomarkup".into());
    let port = std::env::var("TRUST_ENGINE_PORT").unwrap_or_else(|_| "50057".into());
    let addr = format!("0.0.0.0:{port}").parse()?;

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect_lazy(&database_url)?;

    let engine = Arc::new(TrustScorer::new(pool));
    let service = TrustServiceImpl::new(engine);

    tracing::info!("trust engine starting on {}", addr);

    tonic::transport::Server::builder()
        .add_service(TrustServiceServer::new(service))
        .serve_with_shutdown(addr, async {
            tokio::signal::ctrl_c()
                .await
                .expect("failed to listen for ctrl_c");
            tracing::info!("trust engine shutting down");
        })
        .await?;

    global::shutdown_tracer_provider();
    Ok(())
}
