#![deny(clippy::all, clippy::pedantic, unsafe_code)]
#![warn(clippy::nursery)]

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
use sqlx::postgres::PgPoolOptions;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::engine::BiddingEngine;
use crate::grpc::{BidServiceImpl, BidServiceServer};

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
    init_tracing("bidding-engine");

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost:5433/nomarkup".into());
    let port = std::env::var("BID_ENGINE_PORT").unwrap_or_else(|_| "50053".into());
    let addr = format!("0.0.0.0:{port}").parse()?;

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect_lazy(&database_url)?;

    // Redis connection (optional — live auction streaming)
    let redis_conn = match std::env::var("REDIS_URL") {
        Ok(url) => {
            let client = redis::Client::open(url).expect("invalid REDIS_URL");
            match client.get_multiplexed_tokio_connection().await {
                Ok(conn) => {
                    tracing::info!("connected to Redis for live auction streaming");
                    Some(conn)
                }
                Err(e) => {
                    tracing::warn!("failed to connect to Redis, live auction streaming disabled: {}", e);
                    None
                }
            }
        }
        Err(_) => {
            tracing::info!("REDIS_URL not set, live auction streaming disabled");
            None
        }
    };

    let engine = Arc::new(BiddingEngine::new(pool, redis_conn));
    let service = BidServiceImpl::new(engine);

    tracing::info!("bidding engine starting on {}", addr);

    tonic::transport::Server::builder()
        .add_service(BidServiceServer::new(service))
        .serve_with_shutdown(addr, async {
            if let Err(e) = tokio::signal::ctrl_c().await {
                tracing::error!(error = %e, "failed to listen for ctrl_c");
            }
            tracing::info!("bidding engine shutting down");
        })
        .await?;

    global::shutdown_tracer_provider();
    Ok(())
}
