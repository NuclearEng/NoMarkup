#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::missing_errors_doc,
    clippy::doc_markdown,
    clippy::missing_const_for_fn,
    clippy::similar_names,
    clippy::module_name_repetitions,
    clippy::suboptimal_flops,
    clippy::collapsible_if,
    clippy::match_same_arms,
    clippy::too_many_lines,
    clippy::too_many_arguments,
    clippy::needless_pass_by_value,
    clippy::manual_let_else,
    clippy::items_after_statements,
    clippy::empty_line_after_doc_comments,
    clippy::implicit_hasher,
    clippy::redundant_clone,
    clippy::map_unwrap_or,
    clippy::option_if_let_else,
    clippy::unused_self,
    clippy::redundant_closure_for_method_calls,
    clippy::redundant_else,
    clippy::if_not_else,
    clippy::unnecessary_wraps,
    clippy::needless_for_each,
    clippy::doc_overindented_list_items,
    clippy::result_large_err,
    clippy::trivially_copy_pass_by_ref,
    clippy::must_use_unit,
    clippy::must_use_candidate,
    clippy::type_complexity,
    clippy::unreadable_literal,
    clippy::double_must_use
)]

mod engine;
mod grpc;
mod metrics;
mod models;
mod scoring;

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use opentelemetry::KeyValue;
use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::SpanExporter;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::runtime::Tokio;
use opentelemetry_sdk::trace::TracerProvider;
use sqlx::postgres::PgPoolOptions;
use tokio::signal::unix::{SignalKind, signal};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

use tower_http::catch_panic::CatchPanicLayer;

use crate::engine::TrustScorer;
use crate::grpc::{TrustServiceImpl, TrustServiceServer};

/// Panic boundary for the gRPC service stack (CLAUDE.md §9: "panics are bugs —
/// catch at the service boundary"). A panic inside any handler is caught by the
/// `CatchPanicLayer` and routed here instead of resetting the HTTP/2 stream.
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

/// Deployment environment, mirroring the Go services' canonical `ENVIRONMENT`
/// contract (`services/payment/cmd/server/main.go`): `development` | `staging`
/// | `production`, required, no default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Environment {
    Development,
    Staging,
    Production,
}

impl Environment {
    const fn is_development(self) -> bool {
        matches!(self, Self::Development)
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::Development => "development",
            Self::Staging => "staging",
            Self::Production => "production",
        }
    }
}

/// Parse the canonical `ENVIRONMENT` value.
fn parse_environment(raw: &str) -> anyhow::Result<Environment> {
    match raw {
        "development" => Ok(Environment::Development),
        "staging" => Ok(Environment::Staging),
        "production" => Ok(Environment::Production),
        other => Err(anyhow::anyhow!(
            "ENVIRONMENT must be one of development|staging|production, got {other:?}"
        )),
    }
}

/// Read and validate `ENVIRONMENT`.
///
/// Required with no default, exactly like the Go services: a missing value must
/// never silently select the development branch of any config below, because
/// that is how a production pod ends up pointed at `localhost`.
fn load_environment() -> anyhow::Result<Environment> {
    let raw = std::env::var("ENVIRONMENT")
        .map_err(|_| anyhow::anyhow!("ENVIRONMENT is required (development|staging|production)"))?;

    parse_environment(&raw)
}

/// Read a config value that may only fall back to a development default.
///
/// The pool below is built with `connect_lazy`, so a wrong or missing
/// `DATABASE_URL` does not fail at startup — the process boots green, the
/// readiness probe passes, traffic is routed to it, and only the first query
/// discovers there is no database. Failing here instead keeps a misconfigured
/// pod out of rotation entirely.
fn require_env(key: &str, environment: Environment, dev_default: &str) -> anyhow::Result<String> {
    resolve_required(key, environment, std::env::var(key).ok(), dev_default)
}

/// Pure core of [`require_env`], split out so the fail-fast rule is testable
/// without mutating process environment (`std::env::set_var` is `unsafe` in the
/// 2024 edition, and `unsafe_code` is denied workspace-wide).
fn resolve_required(
    key: &str,
    environment: Environment,
    value: Option<String>,
    dev_default: &str,
) -> anyhow::Result<String> {
    let value = value.unwrap_or_default();
    if !value.trim().is_empty() {
        return Ok(value);
    }

    if environment.is_development() {
        tracing::warn!(
            var = key,
            default = dev_default,
            "ENVIRONMENT=development: falling back to development default"
        );
        return Ok(dev_default.to_string());
    }

    Err(anyhow::anyhow!(
        "{key} is required when ENVIRONMENT={} (development defaults must never apply in a deployed environment)",
        environment.as_str()
    ))
}

/// Resolve to the first of SIGTERM or SIGINT, returning the signal name.
///
/// The previous `serve_with_shutdown(addr, tokio::signal::ctrl_c())` listened
/// for SIGINT only. Kubernetes terminates pods with **SIGTERM**, which hit the
/// default disposition and killed the process instantly — no drain, no
/// in-flight completion — on every rolling deploy.
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
/// in `deploy/k8s/base/trust/deployment.yaml`), so a pod that stops answering
/// the instant SIGTERM lands is still in the Service's endpoint list and keeps
/// being handed new RPCs. Sleeping here lets at least one readiness probe
/// observe `NOT_SERVING`, so the pod leaves rotation *before* it drains.
/// Override with `SHUTDOWN_GRACE_SECS`; zero in development so a local Ctrl-C
/// exits immediately.
fn shutdown_grace(environment: Environment) -> Duration {
    const DEPLOYED_GRACE_SECS: u64 = 5;

    let default_secs = if environment.is_development() {
        0
    } else {
        DEPLOYED_GRACE_SECS
    };

    let secs = std::env::var("SHUTDOWN_GRACE_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(default_secs);

    Duration::from_secs(secs)
}

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

        let name = std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| service_name.to_string());

        let provider = TracerProvider::builder()
            .with_batch_exporter(exporter, Tokio)
            .with_resource(Resource::new([KeyValue::new("service.name", name.clone())]))
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

/// Maximum sqlx pool connections, from `DB_MAX_CONNS`.
///
/// Previously hardcoded to 20. Stock PostgreSQL allows roughly 90 usable
/// connections, and the Go tier alone already budgets ~78 across 13 pools
/// (see `services/*/internal/observability`). Three engines x 20 x 2 replicas
/// adds another 120, so the mesh as a whole overshot the server limit and
/// Postgres would begin refusing connections under load — the engines just
/// happened to be the ones nobody had counted.
///
/// 6 matches the Go tier's per-pool budget. An invalid or zero value falls
/// back to the default rather than failing startup: this is a capacity knob,
/// not a security control, and refusing to boot over a typo'd tuning value
/// would be worse than using a sane default.
fn db_max_connections() -> u32 {
    const DEFAULT_MAX_CONNS: u32 = 6;
    std::env::var("DB_MAX_CONNS")
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(DEFAULT_MAX_CONNS)
}

#[tokio::main]
async fn main() -> ExitCode {
    init_tracing("trust-engine");

    let code = match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            let detail = format!("{e:#}");
            tracing::error!(error = detail.as_str(), "trust engine exited with error");
            ExitCode::FAILURE
        }
    };

    global::shutdown_tracer_provider();
    code
}

async fn run() -> anyhow::Result<()> {
    let environment = load_environment()?;

    let database_url = require_env(
        "DATABASE_URL",
        environment,
        "postgres://localhost:5433/nomarkup",
    )?;
    let port = std::env::var("TRUST_ENGINE_PORT").unwrap_or_else(|_| "50057".into());
    let addr = format!("0.0.0.0:{port}").parse()?;

    let pool = PgPoolOptions::new()
        .max_connections(db_max_connections())
        .connect_lazy(&database_url)?;

    let engine = Arc::new(TrustScorer::new(pool));
    let service = TrustServiceImpl::new(engine);

    // Prometheus /metrics exposition (optional, see CLAUDE.md §11).
    if let Ok(metrics_port) = std::env::var("TRUST_METRICS_PORT") {
        match format!("0.0.0.0:{metrics_port}").parse() {
            Ok(metrics_addr) => {
                tokio::spawn(async move {
                    if let Err(e) = crate::metrics::serve_metrics(metrics_addr).await {
                        tracing::warn!(error = %e, "trust metrics server exited");
                    }
                });
            }
            Err(e) => {
                tracing::warn!(error = %e, port = %metrics_port, "invalid TRUST_METRICS_PORT, metrics disabled");
            }
        }
    } else {
        tracing::info!("TRUST_METRICS_PORT not set, /metrics endpoint disabled");
    }

    // gRPC health check — see bidding/src/main.rs for design notes. The
    // reporter handle is kept alive so the shutdown path can flip it to
    // NOT_SERVING before draining.
    let (mut health_reporter, health_service) = tonic_health::server::health_reporter();
    health_reporter
        .set_serving::<TrustServiceServer<TrustServiceImpl>>()
        .await;

    let grace = shutdown_grace(environment);
    let shutdown = async move {
        let signal = shutdown_signal().await;

        // Leave rotation BEFORE draining — see bidding/src/main.rs.
        health_reporter
            .set_not_serving::<TrustServiceServer<TrustServiceImpl>>()
            .await;

        tracing::info!(
            signal,
            grace_secs = grace.as_secs(),
            "shutdown signal received; health NOT_SERVING, waiting for rotation before drain"
        );

        if !grace.is_zero() {
            tokio::time::sleep(grace).await;
        }

        tracing::info!("trust engine draining in-flight requests");
    };

    tracing::info!(
        environment = environment.as_str(),
        "trust engine starting on {}",
        addr
    );

    tonic::transport::Server::builder()
        .layer(CatchPanicLayer::custom(handle_panic))
        .add_service(health_service)
        .add_service(TrustServiceServer::new(service))
        .serve_with_shutdown(addr, shutdown)
        .await?;

    tracing::info!("trust engine shut down cleanly");
    Ok(())
}

#[cfg(test)]
mod config_tests {
    use super::{Environment, parse_environment, resolve_required, shutdown_grace};

    const DEV_DEFAULT: &str = "postgres://localhost:5433/nomarkup";
    const KEY: &str = "DATABASE_URL";

    #[test]
    fn environment_accepts_only_the_three_canonical_values() {
        assert_eq!(
            parse_environment("development").expect("development"),
            Environment::Development
        );
        assert_eq!(
            parse_environment("staging").expect("staging"),
            Environment::Staging
        );
        assert_eq!(
            parse_environment("production").expect("production"),
            Environment::Production
        );

        for bad in ["", "prod", "Production", "dev", "test"] {
            let err = parse_environment(bad).expect_err("must reject non-canonical value");
            assert!(
                err.to_string().contains("development|staging|production"),
                "error should name the allowed values, got: {err}"
            );
        }
    }

    /// The defect: a missing value fell back to a localhost default and the
    /// process booted green in production. It must now fail fast instead.
    #[test]
    fn missing_config_is_fatal_outside_development() {
        for environment in [Environment::Staging, Environment::Production] {
            for value in [None, Some(String::new()), Some("   ".to_string())] {
                let err = resolve_required(KEY, environment, value, DEV_DEFAULT)
                    .expect_err("missing config must be fatal in a deployed environment");
                let msg = err.to_string();
                assert!(msg.contains(KEY), "error should name the variable: {msg}");
                assert!(
                    !msg.contains(DEV_DEFAULT),
                    "the development default must never be used here: {msg}"
                );
            }
        }
    }

    #[test]
    fn development_still_gets_its_default() {
        let resolved = resolve_required(KEY, Environment::Development, None, DEV_DEFAULT)
            .expect("development falls back");
        assert_eq!(resolved, DEV_DEFAULT);
    }

    #[test]
    fn an_explicit_value_always_wins() {
        for environment in [
            Environment::Development,
            Environment::Staging,
            Environment::Production,
        ] {
            let resolved = resolve_required(
                KEY,
                environment,
                Some("explicit-value".to_string()),
                DEV_DEFAULT,
            )
            .expect("explicit value accepted");
            assert_eq!(resolved, "explicit-value");
        }
    }

    /// Deployed environments wait for a readiness probe to observe
    /// NOT_SERVING before draining; local development exits immediately.
    #[test]
    fn shutdown_grace_is_zero_only_in_development() {
        // SHUTDOWN_GRACE_SECS is unset in the test process, so these exercise
        // the defaults.
        assert!(std::env::var("SHUTDOWN_GRACE_SECS").is_err());
        assert!(shutdown_grace(Environment::Development).is_zero());
        assert!(!shutdown_grace(Environment::Staging).is_zero());
        assert!(!shutdown_grace(Environment::Production).is_zero());
    }
}
