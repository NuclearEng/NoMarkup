#![deny(clippy::all, clippy::pedantic)]

#[allow(dead_code)]
mod engine;
#[allow(dead_code)]
mod grpc;
#[allow(dead_code)]
mod models;

use tracing_subscriber::{fmt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    fmt()
        .json()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let port = std::env::var("FRAUD_ENGINE_PORT").unwrap_or_else(|_| "50056".into());
    let addr = format!("0.0.0.0:{port}");

    tracing::info!("fraud engine starting on {}", addr);

    tokio::signal::ctrl_c().await?;
    tracing::info!("fraud engine shutting down");
    Ok(())
}
