//! Pricing engine server. Pure-function gRPC service — no DB, no clock.

use std::net::SocketAddr;

use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

use pricing::grpc::PricingServer;
use pricing::proto::pricing_service_server::PricingServiceServer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let port: u16 = std::env::var("PRICING_ENGINE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(50061);
    let addr: SocketAddr = ([0, 0, 0, 0], port).into();

    let (mut health_reporter, health_service) = tonic_health::server::health_reporter();
    health_reporter
        .set_serving::<PricingServiceServer<PricingServer>>()
        .await;

    tracing::info!(
        port,
        model_version = pricing::MODEL_VERSION,
        "pricing engine listening"
    );

    Server::builder()
        .add_service(health_service)
        .add_service(PricingServiceServer::new(PricingServer))
        .serve(addr)
        .await?;

    Ok(())
}
