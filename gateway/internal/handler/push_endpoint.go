package handler

// Web Push endpoint validation.
//
// `push_subscriptions.endpoint` is a URL supplied by the client that the
// notification service later POSTs to (services/notification/internal/
// service/web_push.go). Without validation that is a server-side request
// forgery primitive: any authenticated user can point the endpoint at an
// internal host:port and have the notification pod issue the request from
// inside the trust boundary, then trigger it with a self-directed
// notification (watchlist -> auction_closing_soon, price_drop, ...).
//
// The W3C push endpoint set is small, stable, and fully enumerable — every
// endpoint is issued by a browser vendor's push service — so an allowlist is
// both viable and the tightest available control. Fail-closed by default,
// matching the WS_ALLOWED_ORIGINS posture in ws_origins.go.
//
// The notification service repeats the check at the point of egress (it is a
// separate Go module, so the logic is intentionally duplicated rather than
// shared) and additionally pins the resolved IP at dial time to defeat DNS
// rebinding. Neither layer is sufficient alone: this one stops the row from
// being persisted, that one stops a row that predates this check.

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
)

// defaultPushEndpointHosts is the allowlist of Web Push service hosts.
// An entry beginning with "." matches any subdomain of that suffix; every
// other entry must match the host exactly.
//
//	Chrome / Edge / Chromium  -> fcm.googleapis.com, android.googleapis.com
//	Firefox                   -> *.push.services.mozilla.com
//	Edge (legacy WNS)         -> *.notify.windows.com
//	Safari / iOS              -> web.push.apple.com
var defaultPushEndpointHosts = []string{
	"fcm.googleapis.com",
	"android.googleapis.com",
	"updates.push.services.mozilla.com",
	".push.services.mozilla.com",
	".notify.windows.com",
	"web.push.apple.com",
	".push.apple.com",
}

var (
	pushEndpointHostsCache []string
	pushEndpointHostsOnce  sync.Once
)

// pushEndpointHosts returns the effective allowlist. WEB_PUSH_ALLOWED_HOSTS
// (comma-separated) is *appended* to the defaults rather than replacing them,
// so an operator adding a host for a new browser vendor cannot accidentally
// break delivery to the existing ones. In development, loopback is allowed so
// local e2e runs can exercise the subscribe flow against a stub receiver.
func pushEndpointHosts() []string {
	pushEndpointHostsOnce.Do(func() {
		hosts := make([]string, 0, len(defaultPushEndpointHosts)+4)
		hosts = append(hosts, defaultPushEndpointHosts...)

		for _, h := range strings.Split(os.Getenv("WEB_PUSH_ALLOWED_HOSTS"), ",") {
			h = strings.ToLower(strings.TrimSpace(stripScheme(h)))
			if h != "" {
				hosts = append(hosts, h)
			}
		}

		if isDevelopmentEnv() {
			hosts = append(hosts, "localhost", "127.0.0.1")
		}

		pushEndpointHostsCache = hosts
	})
	return pushEndpointHostsCache
}

// maxPushEndpointLen bounds the stored URL. The W3C spec does not cap it;
// in practice every real endpoint is well under 1KB.
const maxPushEndpointLen = 2048

// validatePushEndpoint returns nil when raw is a Web Push endpoint we are
// willing to POST to later. The error text is safe to return to the client —
// it names no internal host and reveals nothing about what was reachable.
func validatePushEndpoint(raw string) error {
	if raw == "" {
		return fmt.Errorf("endpoint is required")
	}
	if len(raw) > maxPushEndpointLen {
		return fmt.Errorf("endpoint too long")
	}

	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("endpoint is not a valid URL")
	}

	// Scheme: https only. http would send the VAPID Authorization JWT in the
	// clear, and anything else (file:, gopher:, ...) is not a push endpoint.
	// Development additionally tolerates http so a local stub receiver works.
	switch strings.ToLower(u.Scheme) {
	case "https":
	case "http":
		if !isDevelopmentEnv() {
			return fmt.Errorf("endpoint must use https")
		}
	default:
		return fmt.Errorf("endpoint must use https")
	}

	// Credentials in the URL are never present on a real push endpoint and
	// would be replayed on every delivery.
	if u.User != nil {
		return fmt.Errorf("endpoint must not contain credentials")
	}

	host := strings.ToLower(u.Hostname())
	if host == "" {
		return fmt.Errorf("endpoint must have a host")
	}

	// Port: push services are always on 443. Pinning it removes port
	// scanning as a capability even if a host somehow passes the allowlist.
	if port := u.Port(); port != "" && port != "443" {
		if !isDevelopmentEnv() {
			return fmt.Errorf("endpoint must use the default https port")
		}
	}

	// An IP literal is never a legitimate push endpoint and is the direct
	// route to link-local / RFC1918 targets.
	if ip := net.ParseIP(host); ip != nil {
		if !(isDevelopmentEnv() && ip.IsLoopback()) {
			return fmt.Errorf("endpoint host is not an allowed push service")
		}
		return nil
	}

	if !pushHostAllowed(host) {
		return fmt.Errorf("endpoint host is not an allowed push service")
	}
	return nil
}

// pushHostAllowed reports whether host matches the allowlist. Suffix entries
// (".push.services.mozilla.com") match subdomains only — never the bare
// registrable domain — so an attacker-registered lookalike cannot match by
// being a prefix of an allowed host.
func pushHostAllowed(host string) bool {
	for _, allowed := range pushEndpointHosts() {
		if strings.HasPrefix(allowed, ".") {
			if strings.HasSuffix(host, allowed) {
				return true
			}
			continue
		}
		if host == allowed {
			return true
		}
	}
	return false
}
