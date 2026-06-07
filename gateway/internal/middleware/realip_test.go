package middleware

import (
	"net/http"
	"testing"
)

// These tests exercise the trust-aware ClientIP helper that fixes the
// "X-Forwarded-For trusted unconditionally" finding. They rely on the default
// trusted-proxy allowlist (loopback + RFC1918) which is active when
// TRUSTED_PROXIES is unset. We deliberately do not set TRUSTED_PROXIES here so
// the sync.Once-cached allowlist is the documented default; this keeps the test
// deterministic regardless of test ordering.

func newReq(remoteAddr string, headers map[string]string) *http.Request {
	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = remoteAddr
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return r
}

func TestClientIP_UntrustedPeerIgnoresXFF(t *testing.T) {
	t.Parallel()

	// A public (untrusted) direct peer must NOT be able to spoof its IP via
	// X-Forwarded-For. This is the core of the rate-limit-bypass fix.
	r := newReq("203.0.113.7:54321", map[string]string{
		"X-Forwarded-For": "1.2.3.4",
		"X-Real-IP":       "5.6.7.8",
	})
	got := ClientIP(r)
	if got != "203.0.113.7" {
		t.Fatalf("untrusted peer: expected direct peer IP 203.0.113.7, got %q (XFF must be ignored)", got)
	}
}

func TestClientIP_TrustedPeerHonorsXFF(t *testing.T) {
	t.Parallel()

	// A loopback peer is in the default trusted allowlist, so XFF leftmost wins.
	r := newReq("127.0.0.1:9999", map[string]string{
		"X-Forwarded-For": "9.9.9.9, 10.0.0.1",
	})
	got := ClientIP(r)
	if got != "9.9.9.9" {
		t.Fatalf("trusted peer: expected leftmost XFF 9.9.9.9, got %q", got)
	}
}

func TestClientIP_TrustedPeerHonorsXRealIP(t *testing.T) {
	t.Parallel()

	// RFC1918 peer trusted by default; with no XFF, X-Real-IP is honored.
	r := newReq("10.1.2.3:443", map[string]string{
		"X-Real-IP": "8.8.8.8",
	})
	got := ClientIP(r)
	if got != "8.8.8.8" {
		t.Fatalf("trusted peer: expected X-Real-IP 8.8.8.8, got %q", got)
	}
}

func TestClientIP_NoProxyHeadersReturnsPeer(t *testing.T) {
	t.Parallel()

	r := newReq("198.51.100.42:1234", nil)
	got := ClientIP(r)
	if got != "198.51.100.42" {
		t.Fatalf("expected direct peer 198.51.100.42, got %q", got)
	}
}

func TestClientIP_MalformedRemoteAddr(t *testing.T) {
	t.Parallel()

	// SplitHostPort fails -> fall back to the raw RemoteAddr string. Such a peer
	// is not a valid IP, hence untrusted, so proxy headers are ignored.
	r := newReq("not-an-addr", map[string]string{
		"X-Forwarded-For": "1.1.1.1",
	})
	got := ClientIP(r)
	if got != "not-an-addr" {
		t.Fatalf("expected raw RemoteAddr fallback, got %q", got)
	}
}

func TestIsTrustedProxy(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		ip   string
		want bool
	}{
		{"loopback v4", "127.0.0.1", true},
		{"loopback v6", "::1", true},
		{"rfc1918 10", "10.255.0.1", true},
		{"rfc1918 172", "172.16.5.5", true},
		{"rfc1918 192", "192.168.1.1", true},
		{"public", "203.0.113.1", false},
		{"public dns", "8.8.8.8", false},
		{"empty", "", false},
		{"garbage", "nope", false},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isTrustedProxy(tt.ip); got != tt.want {
				t.Fatalf("isTrustedProxy(%q) = %v, want %v", tt.ip, got, tt.want)
			}
		})
	}
}
