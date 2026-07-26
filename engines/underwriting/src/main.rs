//! Underwriting engine server. Pure-function gRPC service — no DB, no clock.

use std::net::SocketAddr;
use std::time::Duration;

use tokio::signal::unix::{SignalKind, signal};
use tonic::transport::Server;
use tower_http::catch_panic::CatchPanicLayer;
use tracing_subscriber::EnvFilter;

use underwriting::grpc::UnderwritingServer;
use underwriting::proto::underwriting_service_server::UnderwritingServiceServer;

/// Panic boundary for the gRPC service stack (CLAUDE.md §9: "panics are bugs —
/// catch at the service boundary"). A panic inside any handler is caught by the
/// `CatchPanicLayer` and routed here instead of resetting the HTTP/2 stream.
///
/// This matters more here than the pure-function shape suggests: the workspace
/// does not set `panic = "abort"`, so an uncaught panic unwinds out of the
/// handler and kills the whole HTTP/2 connection — and the Go gateway
/// multiplexes every concurrent underwriting call over one connection, so a
/// single bad request would take out every in-flight credit-limit decision
/// with it.
///
/// We log the panic via `tracing::error!` so the crash is observable, then
/// return a trailers-only gRPC error frame: HTTP 200 with `content-type:
/// application/grpc` and `grpc-status: 13` (Internal). This is what a gRPC
/// client expects — a bare HTTP 500 with no grpc-status reads as an opaque
/// transport error, not a `Status`.
///
/// The body is `tonic::body::BoxBody` (`UnsyncBoxBody<Bytes, Status>`), whose
/// error type unifies with the `Box<dyn Error + Send + Sync>` the layered tonic
/// server stack expects.
// Signature is fixed by tower's `CatchPanicLayer::custom` (takes the payload by value).
#[allow(clippy::needless_pass_by_value)]
fn handle_panic(
    err: Box<dyn std::any::Any + Send + 'static>,
) -> http::Response<tonic::body::BoxBody> {
    let details = if let Some(s) = err.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = err.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic payload".to_string()
    };

    tracing::error!(panic = %details, "gRPC handler panicked; returning Internal");

    http::Response::builder()
        .status(http::StatusCode::OK)
        .header(http::header::CONTENT_TYPE, "application/grpc")
        .header("grpc-status", "13")
        .header("grpc-message", "internal error")
        .body(tonic::body::empty_body())
        .expect("static gRPC panic response is always well-formed")
}

/// Resolve to the first of SIGTERM or SIGINT, returning the signal name.
///
/// This server previously called plain `.serve()` with no shutdown signal at
/// all: Kubernetes' SIGTERM hit the default disposition on every rolling
/// deploy and killed the process instantly, with no drain of in-flight RPCs.
async fn shutdown_signal() -> &'static str {
    let mut sigterm = signal(SignalKind::terminate())
        .inspect_err(|e| tracing::error!(error = %e, "failed to install SIGTERM handler"))
        .ok();
    let mut sigint = signal(SignalKind::interrupt())
        .inspect_err(|e| tracing::error!(error = %e, "failed to install SIGINT handler"))
        .ok();

    match (sigterm.as_mut(), sigint.as_mut()) {
        (Some(term), Some(int)) => {
            tokio::select! {
                _ = term.recv() => "SIGTERM",
                _ = int.recv() => "SIGINT",
            }
        }
        (Some(term), None) => {
            term.recv().await;
            "SIGTERM"
        }
        (None, Some(int)) => {
            int.recv().await;
            "SIGINT"
        }
        (None, None) => {
            // Should be unreachable on Linux. Never resolving is the safe
            // failure: keep serving rather than exiting immediately and
            // crash-looping the deployment.
            tracing::error!("no shutdown signal handler installed; graceful shutdown disabled");
            std::future::pending().await
        }
    }
}

/// How long to keep answering after flipping gRPC health to `NOT_SERVING`.
///
/// Kubernetes probes this same health service on a period (`periodSeconds: 10`
/// in `deploy/k8s/base/underwriting/deployment.yaml`), so a pod that stops
/// answering the instant SIGTERM lands is still in the Service's endpoint list
/// and keeps being handed new RPCs. Sleeping here lets at least one readiness
/// probe observe `NOT_SERVING`, so the pod leaves rotation *before* it drains.
///
/// `ENVIRONMENT` is read but not required here: unlike the DB- and S3-backed
/// engines this binary has no configuration that could silently fall back to a
/// development default, so there is nothing to fail closed on. Override the
/// wait with `SHUTDOWN_GRACE_SECS`; it is zero in development (or when
/// `ENVIRONMENT` is unset) so a local Ctrl-C exits immediately.
fn shutdown_grace() -> Duration {
    const DEPLOYED_GRACE_SECS: u64 = 5;

    let deployed = matches!(
        std::env::var("ENVIRONMENT").as_deref(),
        Ok("staging" | "production")
    );
    let default_secs = if deployed { DEPLOYED_GRACE_SECS } else { 0 };

    let secs = std::env::var("SHUTDOWN_GRACE_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(default_secs);

    Duration::from_secs(secs)
}

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

    // gRPC health service so bin/dev / k8s probes can report readiness. The
    // reporter handle is kept alive so the shutdown path can flip it to
    // NOT_SERVING before draining.
    let (mut health_reporter, health_service) = tonic_health::server::health_reporter();
    health_reporter
        .set_serving::<UnderwritingServiceServer<UnderwritingServer>>()
        .await;

    let grace = shutdown_grace();
    let shutdown = async move {
        let signal = shutdown_signal().await;

        // Leave rotation BEFORE draining: readiness probes this same health
        // service, so flipping to NOT_SERVING first is what removes the pod
        // from the Service endpoints. Previously the reporter was dropped at
        // startup and readiness stayed equal to liveness forever.
        health_reporter
            .set_not_serving::<UnderwritingServiceServer<UnderwritingServer>>()
            .await;

        tracing::info!(
            signal,
            grace_secs = grace.as_secs(),
            "shutdown signal received; health NOT_SERVING, waiting for rotation before drain"
        );

        if !grace.is_zero() {
            tokio::time::sleep(grace).await;
        }

        tracing::info!("underwriting engine draining in-flight requests");
    };

    tracing::info!(
        port,
        model_version = underwriting::MODEL_VERSION,
        "underwriting engine listening"
    );

    Server::builder()
        .layer(CatchPanicLayer::custom(handle_panic))
        .add_service(health_service)
        .add_service(UnderwritingServiceServer::new(UnderwritingServer))
        .serve_with_shutdown(addr, shutdown)
        .await?;

    tracing::info!("underwriting engine shut down cleanly");
    Ok(())
}
