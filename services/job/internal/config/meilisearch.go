// Package config resolves shared environment configuration for the job
// service binaries (cmd/server and cmd/reindex-listings).
package config

import (
	"log/slog"
	"os"
	"strings"
)

// ResolveMeilisearchURL resolves the Meilisearch endpoint URL from the
// environment.
//
// MEILISEARCH_URL is the canonical variable (.env.example, CLAUDE.md §12, and
// the k8s configmaps all supply it). MEILISEARCH_HOST is honored as a
// deprecated fallback so older tooling keeps working, with a slog warning.
// The result is normalized to a full URL — a bare "host:port" gets an
// "http://" scheme prepended, since the meilisearch client requires a URL.
// Returns "" when neither variable is set (search disabled in dev).
func ResolveMeilisearchURL() string {
	url := strings.TrimSpace(os.Getenv("MEILISEARCH_URL"))
	if url == "" {
		if host := strings.TrimSpace(os.Getenv("MEILISEARCH_HOST")); host != "" {
			slog.Warn("MEILISEARCH_HOST is deprecated; set MEILISEARCH_URL instead", "host", host)
			url = host
		}
	}
	if url == "" {
		return ""
	}
	if !strings.Contains(url, "://") {
		url = "http://" + url
	}
	return url
}
