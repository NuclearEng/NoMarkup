//! Mesh mTLS for Rust engine gRPC servers.
//!
//! Mirrors `pkg/grpmtls` on the Go side: when `GRPC_TLS_CERT_FILE`,
//! `GRPC_TLS_KEY_FILE`, and `GRPC_TLS_CA_FILE` are all set (or `GRPC_MTLS=true`
//! forces them), the server requires a client certificate signed by the mesh
//! CA. When unset, the server stays plaintext so local `cargo test` and
//! docker-compose without certs keep working.

use std::path::Path;

use tonic::transport::{Certificate, Identity, ServerTlsConfig};

/// Load server TLS config from the same env vars as Go `pkg/grpmtls`.
///
/// Returns `Ok(None)` when mTLS is not configured (insecure plaintext).
///
/// # Errors
///
/// Returns `Err` when the TLS paths are partially set, when `GRPC_MTLS` forces
/// mTLS without a complete set of paths, or when a certificate file cannot be
/// read. Every case is fatal by design: a server that silently falls back to
/// plaintext after being told to require mTLS is the failure this guards.
pub fn load_server_tls() -> Result<Option<ServerTlsConfig>, String> {
    let force = truthy(&std::env::var("GRPC_MTLS").unwrap_or_default());
    let cert_file = std::env::var("GRPC_TLS_CERT_FILE").unwrap_or_default();
    let key_file = std::env::var("GRPC_TLS_KEY_FILE").unwrap_or_default();
    let ca_file = std::env::var("GRPC_TLS_CA_FILE").unwrap_or_default();

    let any = !cert_file.is_empty() || !key_file.is_empty() || !ca_file.is_empty();
    let all = !cert_file.is_empty() && !key_file.is_empty() && !ca_file.is_empty();

    if force && !all {
        return Err(
            "GRPC_MTLS is set but GRPC_TLS_CERT_FILE / GRPC_TLS_KEY_FILE / GRPC_TLS_CA_FILE are incomplete"
                .into(),
        );
    }
    if any && !all {
        return Err(
            "partial TLS paths set; provide all three of GRPC_TLS_CERT_FILE, GRPC_TLS_KEY_FILE, GRPC_TLS_CA_FILE (or none)"
                .into(),
        );
    }
    if !all {
        return Ok(None);
    }

    let cert = read_pem(&cert_file)?;
    let key = read_pem(&key_file)?;
    let ca = read_pem(&ca_file)?;

    let identity = Identity::from_pem(cert, key);
    let client_ca = Certificate::from_pem(ca);
    // Require a mesh client cert. Kubelet native gRPC probes cannot present
    // one — switch liveness/readiness to the HTTP metrics port when mTLS is
    // armed.
    let tls = ServerTlsConfig::new()
        .identity(identity)
        .client_ca_root(client_ca);

    Ok(Some(tls))
}

fn read_pem(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("read {}: {e}", Path::new(path).display()))
}

fn truthy(v: &str) -> bool {
    matches!(
        v.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_server_tls_none_when_unset() {
        // Env is process-global; only assert the no-path path when vars are empty.
        // Other tests may set them; we only check the pure function of empty.
        // Use a scoped approach: if any path is set in the ambient env, skip.
        if std::env::var("GRPC_TLS_CERT_FILE").is_ok_and(|s| !s.is_empty()) {
            return;
        }
        if std::env::var("GRPC_MTLS").is_ok_and(|s| truthy(&s)) {
            return;
        }
        let got = load_server_tls().expect("load");
        assert!(got.is_none());
    }
}
