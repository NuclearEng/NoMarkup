package handler

import (
	"log/slog"
	"os"
	"strings"
	"sync"
)

// wsOriginPatterns returns the list of allowed WebSocket Origin header patterns
// to pass to nhooyr.io/websocket's AcceptOptions.OriginPatterns.
//
// Sources (merged, deduped):
//   - WS_ALLOWED_ORIGINS env var (comma-separated). If unset, defaults to the
//     production public hostnames.
//   - When ENVIRONMENT=development (or APP_ENV=development), localhost:3000 is
//     allowed as well to support local dev.
//
// This is fail-closed: if WS_ALLOWED_ORIGINS is unset the function returns the
// hardcoded production default — there is no "allow everything" bypass.
var (
	wsOriginPatternsCache []string
	wsOriginPatternsOnce  sync.Once
)

func wsOriginPatterns() []string {
	wsOriginPatternsOnce.Do(func() {
		raw := strings.TrimSpace(os.Getenv("WS_ALLOWED_ORIGINS"))
		var patterns []string
		if raw == "" {
			patterns = []string{"app.nomarkup.com", "nomarkup.com"}
		} else {
			for _, p := range strings.Split(raw, ",") {
				p = strings.TrimSpace(p)
				p = stripScheme(p)
				if p != "" {
					patterns = append(patterns, p)
				}
			}
		}

		if isDevelopmentEnv() {
			patterns = append(patterns, "localhost:3000", "localhost:3002", "127.0.0.1:3000", "127.0.0.1:3002")
		}

		wsOriginPatternsCache = patterns
		slog.Info("websocket origin patterns loaded", "patterns", patterns)
	})
	return wsOriginPatternsCache
}

// isDevelopmentEnv is true when either ENVIRONMENT or APP_ENV is "development".
// The gateway config uses ENVIRONMENT; Sentry init uses APP_ENV — honor both
// so local dev in either convention works.
func isDevelopmentEnv() bool {
	return strings.EqualFold(os.Getenv("ENVIRONMENT"), "development") ||
		strings.EqualFold(os.Getenv("APP_ENV"), "development")
}

// stripScheme removes the scheme from a URL-like origin string so that the
// pattern is suitable for nhooyr's OriginPatterns (which matches on host).
func stripScheme(s string) string {
	for _, prefix := range []string{"https://", "http://", "wss://", "ws://"} {
		if strings.HasPrefix(s, prefix) {
			return strings.TrimPrefix(s, prefix)
		}
	}
	return s
}
