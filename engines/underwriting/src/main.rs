//! Underwriting engine server. Pure-function gRPC service — no DB, no clock.

#![forbid(unsafe_code)]

use std::net::SocketAddr;

use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

use underwriting::grpc::UnderwritingServer;
use underwriting::proto::underwriting_service_server::UnderwritingServiceServer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let port: u16 = std::env::var("UNDERWRITING_ENGINE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(50060);
    let addr: SocketAddr = ([0, 0, 0, 0], port).into();

    // gRPC health service so bin/dev / k8s probes can report readiness.
    let (mut health_reporter, health_service) = tonic_health::server::health_reporter();
    health_reporter
        .set_serving::<UnderwritingServiceServer<UnderwritingServer>>()
        .await;

    tracing::info!(
        port,
        model_version = underwriting::MODEL_VERSION,
        "underwriting engine listening"
    );

    Server::builder()
        .add_service(health_service)
        .add_service(UnderwritingServiceServer::new(UnderwritingServer))
        .serve(addr)
        .await?;

    Ok(())
}
