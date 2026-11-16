package observability

import (
	"net/http"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// defaultOutboundTimeout bounds a traced outbound call. Matches the
// meilisearch-go client default so swapping in this transport does not change
// timeout behaviour.
const defaultOutboundTimeout = 5 * time.Second

// NewTracedHTTPClient returns an http.Client whose transport emits a CLIENT
// span per request, for third-party clients that accept an *http.Client but
// have no OpenTelemetry integration of their own (Meilisearch is the one in
// this tree).
//
// peerService names the dependency in the span so a trace reads
// "meilisearch POST /indexes/listings/search" rather than a bare "HTTP POST".
// Meilisearch paths embed index names, which is a small fixed set, so the span
// name stays low-cardinality.
func NewTracedHTTPClient(peerService string) *http.Client {
	transport := otelhttp.NewTransport(
		http.DefaultTransport,
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return peerService + " " + r.Method + " " + r.URL.Path
		}),
	)
	return &http.Client{
		Transport: transport,
		Timeout:   defaultOutboundTimeout,
	}
}
