package service

// Egress-side Web Push endpoint hardening.
//
// The gateway validates `endpoint` before it is ever persisted
// (gateway/internal/handler/push_endpoint.go). This file repeats the check at
// the point of egress and adds a dial-time IP guard. The duplication is
// deliberate: the gateway and the notification service are separate Go
// modules, and neither layer alone is sufficient —
//
//   - the gateway check cannot protect rows written before it existed, or by
//     any future writer that bypasses that handler;
//   - this check cannot give the user a clean 400 at subscribe time;
//   - only this layer can pin the *resolved* IP, which is what defeats DNS
//     rebinding (a host that passes the allowlist but resolves to 169.254.x.x
//     at connect time).
//
// Keep the host allowlist in sync with the gateway copy.

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"syscall"
	"time"
)

// allowedPushHosts mirrors defaultPushEndpointHosts in the gateway. An entry
// beginning with "." matches subdomains of that suffix; others match exactly.
var allowedPushHosts = []string{
	"fcm.googleapis.com",
	"android.googleapis.com",
	"updates.push.services.mozilla.com",
	".push.services.mozilla.com",
	".notify.windows.com",
	"web.push.apple.com",
	".push.apple.com",
}

var (
	pushHostsCache []string
	pushHostsOnce  sync.Once
)

func isDevEnv() bool {
	return strings.EqualFold(os.Getenv("APP_ENV"), "development") ||
		strings.EqualFold(os.Getenv("ENVIRONMENT"), "development")
}

func pushHosts() []string {
	pushHostsOnce.Do(func() {
		hosts := make([]string, 0, len(allowedPushHosts)+4)
		hosts = append(hosts, allowedPushHosts...)
		for _, h := range strings.Split(os.Getenv("WEB_PUSH_ALLOWED_HOSTS"), ",") {
			h = strings.ToLower(strings.TrimSpace(h))
			for _, prefix := range []string{"https://", "http://"} {
				h = strings.TrimPrefix(h, prefix)
			}
			if h != "" {
				hosts = append(hosts, h)
			}
		}
		if isDevEnv() {
			hosts = append(hosts, "localhost", "127.0.0.1")
		}
		pushHostsCache = hosts
	})
	return pushHostsCache
}

// validatePushEndpoint rejects any endpoint we are unwilling to POST to.
func validatePushEndpoint(raw string) error {
	if raw == "" || len(raw) > 2048 {
		return fmt.Errorf("web push: endpoint missing or too long")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("web push: endpoint is not a valid URL")
	}

	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && !(scheme == "http" && isDevEnv()) {
		return fmt.Errorf("web push: endpoint must use https")
	}
	if u.User != nil {
		return fmt.Errorf("web push: endpoint must not contain credentials")
	}

	host := strings.ToLower(u.Hostname())
	if host == "" {
		return fmt.Errorf("web push: endpoint must have a host")
	}
	if port := u.Port(); port != "" && port != "443" && !isDevEnv() {
		return fmt.Errorf("web push: endpoint must use the default https port")
	}
	if ip := net.ParseIP(host); ip != nil {
		if isDevEnv() && ip.IsLoopback() {
			return nil
		}
		return fmt.Errorf("web push: endpoint host is not an allowed push service")
	}

	for _, allowed := range pushHosts() {
		if strings.HasPrefix(allowed, ".") {
			if strings.HasSuffix(host, allowed) {
				return nil
			}
			continue
		}
		if host == allowed {
			return nil
		}
	}
	return fmt.Errorf("web push: endpoint host is not an allowed push service")
}

// isBlockedIP reports whether an address is one we refuse to connect to:
// loopback, RFC1918 private, link-local (this is where 169.254.169.254 lives),
// CGNAT, IPv6 ULA, unspecified, and multicast.
func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if isDevEnv() && ip.IsLoopback() {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() {
		return true
	}
	// 100.64.0.0/10 — carrier-grade NAT, routinely used for internal ranges.
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
		return true
	}
	return false
}

// newPushHTTPClient returns the HTTP client used for every Web Push delivery.
//
// The Control hook runs after DNS resolution and immediately before connect,
// on the address actually being dialed — so a hostname that passes the
// allowlist but resolves (or re-resolves) to an internal address is refused
// at the socket layer. Redirects are refused outright: a push service has no
// legitimate reason to redirect, and following one would re-open the very
// hole the allowlist closes.
func newPushHTTPClient() *http.Client {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(network, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return fmt.Errorf("web push: cannot parse dial address")
			}
			if isBlockedIP(net.ParseIP(host)) {
				return fmt.Errorf("web push: refusing to connect to non-public address")
			}
			return nil
		},
	}

	return &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.DialContext(ctx, network, addr)
			},
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxIdleConnsPerHost:   4,
		},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}
