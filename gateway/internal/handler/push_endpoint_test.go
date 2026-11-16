package handler

import (
	"strings"
	"testing"
)

// TestValidatePushEndpoint pins the SSRF guard on push_subscriptions.endpoint.
// The endpoint is a client-supplied URL the notification service later POSTs
// to, so every case below that expects an error is an internal target an
// authenticated user must not be able to make us reach.
func TestValidatePushEndpoint(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		// Real endpoints issued by browser push services.
		{"fcm", "https://fcm.googleapis.com/fcm/send/abc123", false},
		{"fcm explicit 443", "https://fcm.googleapis.com:443/fcm/send/abc", false},
		{"mozilla", "https://updates.push.services.mozilla.com/wpush/v2/gAAA", false},
		{"mozilla subdomain", "https://autopush.push.services.mozilla.com/wpush/v2/x", false},
		{"apple", "https://web.push.apple.com/QWERTY", false},
		{"wns", "https://db5p.notify.windows.com/w/?token=abc", false},

		// SSRF targets.
		{"metadata by ip", "http://169.254.169.254/latest/meta-data/", true},
		{"metadata https", "https://169.254.169.254/latest/meta-data/", true},
		{"loopback", "http://127.0.0.1:8080/internal", true},
		{"rfc1918", "https://10.0.0.5/admin", true},
		{"cluster dns", "https://payment.nomarkup.svc.cluster.local:50053/", true},
		{"bare hostname", "https://payment/", true},
		{"arbitrary host", "https://evil.example.com/collect", true},
		{"nonstandard port on allowed host", "https://fcm.googleapis.com:8080/x", true},

		// Scheme and shape.
		{"http on allowed host", "http://fcm.googleapis.com/fcm/send/x", true},
		{"file scheme", "file:///etc/passwd", true},
		{"gopher scheme", "gopher://fcm.googleapis.com/x", true},
		{"credentials in url", "https://user:pass@fcm.googleapis.com/x", true},
		{"empty", "", true},
		{"no host", "https:///fcm/send/x", true},
		{"too long", "https://fcm.googleapis.com/" + strings.Repeat("a", 2100), true},

		// Suffix entries must not match the bare registrable domain, and must
		// not match an attacker-registered host that merely ends in the label.
		{"bare suffix domain", "https://push.services.mozilla.com.evil.tld/x", true},
		{"lookalike prefix", "https://fcm.googleapis.com.evil.tld/x", true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := validatePushEndpoint(tc.raw)
			if tc.wantErr && err == nil {
				t.Fatalf("validatePushEndpoint(%q) = nil, want error", tc.raw)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("validatePushEndpoint(%q) = %v, want nil", tc.raw, err)
			}
		})
	}
}

// TestPushHostAllowedSuffixMatching guards the suffix rule specifically: a
// leading-dot entry must match subdomains and nothing else.
func TestPushHostAllowedSuffixMatching(t *testing.T) {
	t.Parallel()

	allowed := []string{
		"autopush.push.services.mozilla.com",
		"db5p.notify.windows.com",
		"fcm.googleapis.com",
	}
	for _, h := range allowed {
		if !pushHostAllowed(h) {
			t.Errorf("pushHostAllowed(%q) = false, want true", h)
		}
	}

	denied := []string{
		"notify.windows.com.evil.tld",
		"evil-fcm.googleapis.com.attacker.net",
		"localhost",
		"metadata.google.internal",
		"",
	}
	for _, h := range denied {
		if pushHostAllowed(h) {
			t.Errorf("pushHostAllowed(%q) = true, want false", h)
		}
	}
}
