#![deny(clippy::all, clippy::pedantic)]

pub mod behavioral;
mod engine;
mod grpc;
mod models;

use std::sync::Arc;

use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::{fmt, EnvFilter};

use crate::engine::FraudDetector;
use crate::grpc::{FraudServiceImpl, FraudServiceServer};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    fmt()
        .json()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost:5433/nomarkup".into());
    let port = std::env::var("FRAUD_ENGINE_PORT").unwrap_or_else(|_| "50056".into());
    let addr = format!("0.0.0.0:{port}").parse()?;

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect_lazy(&database_url)?;

    let engine = Arc::new(FraudDetector::new(pool));
    let service = FraudServiceImpl::new(engine);

    tracing::info!("fraud engine starting on {}", addr);

    tonic::transport::Server::builder()
        .add_service(FraudServiceServer::new(service))
        .serve_with_shutdown(addr, async {
            tokio::signal::ctrl_c()
                .await
                .expect("failed to listen for ctrl_c");
            tracing::info!("fraud engine shutting down");
        })
        .await?;

    Ok(())
}
