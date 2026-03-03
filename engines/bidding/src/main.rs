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

    let port = std::env::var("BID_ENGINE_PORT").unwrap_or_else(|_| "50053".into());
    let addr = format!("0.0.0.0:{port}");

    tracing::info!("bidding engine starting on {}", addr);

    // TODO: Initialize gRPC server after proto codegen
    // let addr = addr.parse()?;
    // tonic::transport::Server::builder()
    //     .add_service(BidServiceServer::new(server))
    //     .serve(addr)
    //     .await?;

    tokio::signal::ctrl_c().await?;
    tracing::info!("bidding engine shutting down");
    Ok(())
}
