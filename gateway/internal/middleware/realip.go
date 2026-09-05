package middleware

import (
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
)

// Default trusted proxy CIDRs when TRUSTED_PROXIES is unset: loopback + RFC1918.
var defaultTrustedProxyCIDRs = []string{
	"127.0.0.0/8",
	"::1/128",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"fc00::/7", // IPv6 ULA
}

var (
	trustedProxyNets  []*net.IPNet
	trustedProxiesOnce sync.Once
)

// loadTrustedProxies parses CIDRs from TRUSTED_PROXIES once. When the env var
// is unset, default to loopback + RFC1918 and log a warning.
func loadTrustedProxies() []*net.IPNet {
	trustedProxiesOnce.Do(func() {
		raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
		var cidrs []string
		if raw == "" {
			slog.Warn("TRUSTED_PROXIES not set; trusting only loopback and RFC1918 private ranges for X-Forwarded-For / X-Real-IP headers")
			cidrs = defaultTrustedProxyCIDRs
		} else {
			for _, c := range strings.Split(raw, ",") {
				c = strings.TrimSpace(c)
				if c != "" {
					cidrs = append(cidrs, c)
				}
			}
		}

		nets := make([]*net.IPNet, 0, len(cidrs))
		for _, c := range cidrs {
			_, n, err := net.ParseCIDR(c)
			if err != nil {
				slog.Warn("invalid CIDR in TRUSTED_PROXIES, skipping", "cidr", c, "error", err)
				continue
			}
			nets = append(nets, n)
		}
		trustedProxyNets = nets
	})
	return trustedProxyNets
}

// isTrustedProxy reports whether the given IP string belongs to a configured
// trusted-proxy CIDR.
func isTrustedProxy(ipStr string) bool {
	ip := net.ParseIP(strings.TrimSpace(ipStr))
	if ip == nil {
		return false
	}
	for _, n := range loadTrustedProxies() {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// remoteIP returns the IP portion of r.RemoteAddr, stripping the port.
func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ClientIP returns the best-effort client IP for the request. It honors
// X-Forwarded-For and X-Real-IP ONLY when the direct peer (r.RemoteAddr) is
// a trusted proxy per TRUSTED_PROXIES (or the default loopback + RFC1918
// allowlist). Otherwise it returns the direct peer IP, ignoring any
// attacker-controlled proxy headers.
func ClientIP(r *http.Request) string {
	peer := remoteIP(r)

	if isTrustedProxy(peer) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// Leftmost entry is the original client (the proxy appends).
			if ip := strings.TrimSpace(strings.SplitN(xff, ",", 2)[0]); ip != "" {
				return ip
			}
		}
		if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
			return xri
		}
	}
	return peer
}
