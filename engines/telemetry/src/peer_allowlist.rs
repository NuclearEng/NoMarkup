//! Optional mesh peer allowlist for Rust engine gRPC servers.
//!
//! Mirrors Go `pkg/grpmtls` `MESH_PEER_ALLOWLIST` + unary/stream interceptors:
//! when the env var is non-empty, inbound RPCs whose peer SPIFFE URI SAN (or
//! certificate CN) is not on the list are rejected with `PermissionDenied`.
//! Empty / unset (default) is a no-op so local `cargo test` and compose without
//! mTLS keep working.
//!
//! Do not arm the allowlist without mTLS — plaintext peers have no cert and
//! fail closed.

use std::collections::HashSet;
use std::hash::BuildHasher;

use tonic::service::Interceptor;
use tonic::service::interceptor::{InterceptorLayer, interceptor};
use tonic::{Request, Status};
use x509_parser::prelude::*;

/// Preferred mesh SPIFFE URI prefix (matches `scripts/gen-mesh-certs.sh`).
const SPIFFE_SERVICE_PREFIX: &str = "spiffe://nomarkup/service/";

/// Parse a comma-separated list of mesh service names into a set.
///
/// Empty / whitespace-only tokens are skipped. Returns an empty set when the
/// result would be empty so callers can use `is_empty()` as "disabled".
#[must_use]
pub fn parse_peer_allowlist(s: &str) -> HashSet<String> {
    let s = s.trim();
    if s.is_empty() {
        return HashSet::new();
    }
    let mut out = HashSet::new();
    for part in s.split(',') {
        let name = part.trim();
        if !name.is_empty() {
            out.insert(name.to_owned());
        }
    }
    out
}

/// Read `MESH_PEER_ALLOWLIST` from the environment.
#[must_use]
pub fn peer_allowlist_from_env() -> HashSet<String> {
    parse_peer_allowlist(&std::env::var("MESH_PEER_ALLOWLIST").unwrap_or_default())
}

/// Whether `name` is permitted.
///
/// Empty allowlist → always true (feature off). Missing / unknown name → false
/// when the feature is armed (fail closed).
#[must_use]
pub fn peer_allowed<S: BuildHasher>(name: &str, allowed: &HashSet<String, S>) -> bool {
    if allowed.is_empty() {
        return true;
    }
    allowed.contains(name)
}

/// Extract the mesh service identity from a leaf certificate DER.
///
/// Prefer SPIFFE URI SAN (`spiffe://nomarkup/service/<name>`); fall back to the
/// leaf Common Name. Returns `None` when the DER is unparseable or has neither.
#[must_use]
pub fn peer_service_name_from_der(der: &[u8]) -> Option<String> {
    let (_, cert) = X509Certificate::from_der(der).ok()?;

    if let Ok(Some(san)) = cert.subject_alternative_name() {
        for general in &san.value.general_names {
            if let GeneralName::URI(uri) = general
                && let Some(name) = spiffe_service_name(uri)
            {
                return Some(name);
            }
        }
    }

    cert.subject()
        .iter_common_name()
        .next()
        .and_then(|attr| attr.as_str().ok().map(str::to_owned))
        .filter(|s| !s.is_empty())
}

/// Map a SPIFFE URI string to a mesh service name (pure; unit-tested).
#[must_use]
pub fn spiffe_service_name(uri: &str) -> Option<String> {
    // Mesh-prefixed URI: strip prefix once. Empty remainder → None (do not
    // fall through to generic path parsing — matches Go PeerServiceName).
    if let Some(rest) = uri.strip_prefix(SPIFFE_SERVICE_PREFIX) {
        let name = rest.trim_matches('/');
        return if name.is_empty() {
            None
        } else {
            Some(name.to_owned())
        };
    }
    // Generic SPIFFE: last path segment of spiffe://trust-domain/path/...
    if let Some(rest) = uri.strip_prefix("spiffe://") {
        let path = rest.split_once('/').map_or("", |(_, p)| p);
        let seg = path.trim_matches('/').rsplit('/').next().unwrap_or("");
        if !seg.is_empty() {
            return Some(seg.to_owned());
        }
    }
    None
}

/// Tonic interceptor that enforces [`MESH_PEER_ALLOWLIST`](peer_allowlist_from_env).
///
/// When `allowed` is empty the interceptor is a no-op (default OFF).
#[derive(Clone, Debug, Default)]
pub struct PeerAllowlist {
    allowed: HashSet<String>,
}

impl PeerAllowlist {
    /// Build from an explicit set (empty = disabled).
    #[must_use]
    pub fn new(allowed: HashSet<String>) -> Self {
        Self { allowed }
    }

    /// Load from `MESH_PEER_ALLOWLIST`.
    #[must_use]
    pub fn from_env() -> Self {
        Self::new(peer_allowlist_from_env())
    }

    /// True when the allowlist is armed (non-empty).
    #[must_use]
    pub fn is_enabled(&self) -> bool {
        !self.allowed.is_empty()
    }

    /// Sorted peer names for structured logs (stable order).
    #[must_use]
    pub fn peers_sorted(&self) -> Vec<String> {
        let mut v: Vec<String> = self.allowed.iter().cloned().collect();
        v.sort_unstable();
        v
    }

    /// Pure allow check (empty set = always allow).
    #[must_use]
    pub fn allows(&self, name: &str) -> bool {
        peer_allowed(name, &self.allowed)
    }

    /// Consume into a tonic interceptor layer for `Server::builder().layer(...)`.
    #[must_use]
    pub fn into_layer(self) -> InterceptorLayer<Self> {
        interceptor(self)
    }
}

impl Interceptor for PeerAllowlist {
    fn call(&mut self, request: Request<()>) -> Result<Request<()>, Status> {
        if self.allowed.is_empty() {
            return Ok(request);
        }

        let name = request
            .peer_certs()
            .as_deref()
            .and_then(|certs| certs.first())
            .and_then(|c| peer_service_name_from_der(c.as_ref()))
            .unwrap_or_default();

        if self.allows(&name) {
            Ok(request)
        } else {
            Err(Status::permission_denied(format!(
                "mesh peer \"{name}\" not in MESH_PEER_ALLOWLIST"
            )))
        }
    }
}

/// Tower layer for `Server::builder().layer(...)` — no-op when allowlist empty.
#[must_use]
pub fn peer_allowlist_layer() -> InterceptorLayer<PeerAllowlist> {
    interceptor(PeerAllowlist::from_env())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_peer_allowlist_empty_and_tokens() {
        assert!(parse_peer_allowlist("").is_empty());
        assert!(parse_peer_allowlist("  ,  , ").is_empty());
        let got = parse_peer_allowlist(" gateway ,payment, job ");
        assert_eq!(got.len(), 3);
        assert!(got.contains("gateway"));
        assert!(got.contains("payment"));
        assert!(got.contains("job"));
    }

    #[test]
    fn peer_allowed_empty_is_noop() {
        let empty = HashSet::new();
        assert!(peer_allowed("", &empty));
        assert!(peer_allowed("anyone", &empty));
    }

    #[test]
    fn peer_allowed_fail_closed_when_armed() {
        let allowed = parse_peer_allowlist("gateway,payment");
        assert!(peer_allowed("gateway", &allowed));
        assert!(peer_allowed("payment", &allowed));
        assert!(!peer_allowed("fraud", &allowed));
        assert!(!peer_allowed("", &allowed));
    }

    #[test]
    fn spiffe_service_name_prefers_mesh_prefix() {
        assert_eq!(
            spiffe_service_name("spiffe://nomarkup/service/gateway").as_deref(),
            Some("gateway")
        );
        assert_eq!(
            spiffe_service_name("spiffe://other/path/to/chat").as_deref(),
            Some("chat")
        );
        assert_eq!(spiffe_service_name("https://example.com/x"), None);
        assert_eq!(spiffe_service_name("spiffe://nomarkup/service/"), None);
    }

    #[test]
    fn peer_service_name_from_spiffe_der() {
        let der = include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/peer_spiffe_gateway.der"
        ));
        assert_eq!(
            peer_service_name_from_der(der).as_deref(),
            Some("gateway"),
            "SPIFFE URI SAN should win over CN=ignored"
        );
    }

    #[test]
    fn peer_service_name_from_cn_der() {
        let der = include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/peer_cn_job.der"
        ));
        assert_eq!(peer_service_name_from_der(der).as_deref(), Some("job"));
    }

    #[test]
    fn peer_service_name_rejects_garbage_der() {
        assert_eq!(peer_service_name_from_der(b"not-a-cert"), None);
        assert_eq!(peer_service_name_from_der(&[]), None);
    }

    #[test]
    fn interceptor_empty_allowlist_is_noop() {
        let mut i = PeerAllowlist::new(HashSet::new());
        let req = Request::new(());
        assert!(i.call(req).is_ok());
    }

    #[test]
    fn interceptor_deny_missing_peer_when_armed() {
        // Allowlist armed but no TLS peer certs on the request → fail closed.
        let mut i = PeerAllowlist::new(parse_peer_allowlist("gateway"));
        let err = i.call(Request::new(())).expect_err("must deny");
        assert_eq!(err.code(), tonic::Code::PermissionDenied);
        assert!(err.message().contains("MESH_PEER_ALLOWLIST"));
    }

    #[test]
    fn peers_sorted_stable() {
        let al = PeerAllowlist::new(parse_peer_allowlist("zulu,alpha,mid"));
        assert_eq!(al.peers_sorted(), vec!["alpha", "mid", "zulu"]);
        assert!(al.is_enabled());
    }
}
