//! W3C trace-context extraction from gRPC metadata.
//!
//! gRPC metadata is HTTP/2 headers, so the `traceparent` that `otelgrpc`
//! injects on the Go side arrives as an ordinary [`http::HeaderMap`] entry.
//! This is a ~20-line [`Extractor`] rather than a dependency on
//! `opentelemetry-http`, which would pull a second `http`-stack version into
//! the tree for exactly this.

use opentelemetry::propagation::Extractor;

/// Reads W3C trace-context headers (`traceparent`, `tracestate`) out of an
/// incoming request's header map.
pub struct HeaderExtractor<'a>(pub &'a http::HeaderMap);

impl Extractor for HeaderExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        // Non-UTF-8 header values are silently skipped: a malformed
        // `traceparent` must degrade to "start a new trace", never fail the
        // request. Tracing is diagnostics, not a correctness dependency.
        self.0.get(key).and_then(|value| value.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(http::HeaderName::as_str).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::HeaderExtractor;
    use opentelemetry::propagation::Extractor;

    fn headers(pairs: &[(&str, &str)]) -> http::HeaderMap {
        let mut map = http::HeaderMap::new();
        for (k, v) in pairs {
            map.insert(
                http::HeaderName::from_bytes(k.as_bytes()).expect("valid header name"),
                http::HeaderValue::from_str(v).expect("valid header value"),
            );
        }
        map
    }

    #[test]
    fn reads_traceparent() {
        let map = headers(&[(
            "traceparent",
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        )]);
        let extractor = HeaderExtractor(&map);

        assert_eq!(
            extractor.get("traceparent"),
            Some("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
        );
        assert!(extractor.keys().contains(&"traceparent"));
    }

    #[test]
    fn missing_and_non_utf8_headers_are_none_not_panics() {
        let mut map = headers(&[("tracestate", "vendor=value")]);
        map.insert(
            http::HeaderName::from_static("traceparent"),
            http::HeaderValue::from_bytes(&[0xff, 0xfe]).expect("bytes are a legal header value"),
        );

        let extractor = HeaderExtractor(&map);
        assert_eq!(extractor.get("traceparent"), None);
        assert_eq!(extractor.get("absent"), None);
        assert_eq!(extractor.get("tracestate"), Some("vendor=value"));
    }
}
