//! Verifies the gRPC readiness contract on shutdown.
//!
//! Every engine registers `grpc.health.v1.Health` and calls `set_serving` once
//! at startup, but the reporter handle used to be dropped immediately — so
//! readiness was permanently equal to liveness and Kubernetes kept routing new
//! RPCs to a pod that was already draining.
//!
//! The wiring under test lives in each engine's `src/main.rs` and cannot be
//! imported from a test binary, so — following `panic_boundary_test.rs` — this
//! keeps a copy of the exact shutdown shape and asserts against a real server
//! over a real socket:
//!
//!   1. a live server reports `SERVING`,
//!   2. once the shutdown signal fires, a probe observes `NOT_SERVING` **while
//!      the server is still accepting connections** — i.e. the pod leaves
//!      rotation before it drains, not after,
//!   3. the server then shuts down cleanly.

use std::time::Duration;

use tokio::sync::oneshot;
use tonic::transport::Server;

use pricing::grpc::PricingServer;
use pricing::proto::pricing_service_server::PricingServiceServer;

use tonic_health::pb::{HealthCheckRequest, health_client::HealthClient};

/// The gRPC health service name for the pricing service, as tonic-health
/// derives it from the generated server type.
fn service_name() -> String {
    <PricingServiceServer<PricingServer> as tonic::server::NamedService>::NAME.to_string()
}

async fn check(endpoint: &str, service: &str) -> Result<i32, Box<dyn std::error::Error>> {
    let mut client = HealthClient::new(
        tonic::transport::Channel::from_shared(endpoint.to_string())?
            .connect()
            .await?,
    );

    let status = client
        .check(HealthCheckRequest {
            service: service.to_string(),
        })
        .await?
        .into_inner()
        .status;

    // Close the connection before returning so each probe is a fresh dial —
    // this test is about what a Kubernetes probe sees, not about reuse.
    drop(client);

    Ok(status)
}

#[tokio::test(flavor = "multi_thread")]
async fn health_flips_to_not_serving_before_the_server_drains() {
    const SERVING: i32 = 1;
    const NOT_SERVING: i32 = 2;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ephemeral port");
    let addr = listener.local_addr().expect("local addr");
    let endpoint = format!("http://{addr}");
    drop(listener);

    let (mut health_reporter, health_service) = tonic_health::server::health_reporter();
    health_reporter
        .set_serving::<PricingServiceServer<PricingServer>>()
        .await;

    // Stands in for the SIGTERM/SIGINT future in `main.rs`.
    let (signal_tx, signal_rx) = oneshot::channel::<()>();
    // Lets the test observe the moment NOT_SERVING has been published, without
    // racing the grace-period sleep.
    let (flipped_tx, flipped_rx) = oneshot::channel::<()>();

    let server = tokio::spawn(async move {
        Server::builder()
            .add_service(health_service)
            .add_service(PricingServiceServer::new(PricingServer))
            .serve_with_shutdown(addr, async move {
                signal_rx.await.expect("shutdown signal");

                // Exactly the ordering in main.rs: leave rotation, *then*
                // hold the socket open for the grace period, *then* drain.
                health_reporter
                    .set_not_serving::<PricingServiceServer<PricingServer>>()
                    .await;

                flipped_tx.send(()).expect("notify test");

                tokio::time::sleep(Duration::from_secs(2)).await;
            })
            .await
    });

    // Wait for the listener to come up.
    let service = service_name();
    let mut status = None;
    for _ in 0..100 {
        if let Ok(s) = check(&endpoint, &service).await {
            status = Some(s);
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(status, Some(SERVING), "a live server must report SERVING");

    // Fire the shutdown signal and wait until NOT_SERVING has been published.
    signal_tx.send(()).expect("send shutdown signal");
    flipped_rx.await.expect("reporter flipped");

    // The grace period is still running, so the server is *still accepting
    // connections* — which is the whole point: readiness must go red before
    // the socket goes away, or the load balancer never learns to stop sending
    // traffic here.
    assert_eq!(
        check(&endpoint, &service)
            .await
            .expect("draining server still answers"),
        NOT_SERVING,
        "a draining server must report NOT_SERVING while still reachable"
    );

    server
        .await
        .expect("server task joins")
        .expect("server shuts down cleanly");
}
