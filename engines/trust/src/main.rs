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

    let port = std::env::var("TRUST_ENGINE_PORT").unwrap_or_else(|_| "50057".into());
    let addr = format!("0.0.0.0:{port}");

    tracing::info!("trust engine starting on {}", addr);

    tokio::signal::ctrl_c().await?;
    tracing::info!("trust engine shutting down");
    Ok(())
}
