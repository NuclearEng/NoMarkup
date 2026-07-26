package middleware

import (
	"net/url"
	"strings"
	"testing"
)

// TestRedactQuery pins the credential-redaction rules for the access log.
// Every "must redact" case below is a real route that carries a credential in
// the query string because a browser WebSocket client cannot set headers.
func TestRedactQuery(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		raw        string
		mustRedact []string // substrings that must NOT appear in the output
		mustKeep   []string // substrings that must appear
	}{
		{
			name:       "ws chat access token",
			raw:        "token=eyJhbGciOiJSUzI1NiJ9.payload.signature",
			mustRedact: []string{"eyJhbGciOiJSUzI1NiJ9", "signature"},
			mustKeep:   []string{"token", redactedPlaceholder},
		},
		{
			name:       "calendar ical token",
			raw:        "token=ical_long_lived_secret_value",
			mustRedact: []string{"ical_long_lived_secret_value"},
			mustKeep:   []string{"token"},
		},
		{
			name:       "oauth callback code and state",
			raw:        "code=4%2F0AY0e-g7&state=csrf_nonce_value",
			mustRedact: []string{"4/0AY0e-g7", "csrf_nonce_value"},
			mustKeep:   []string{"code", "state"},
		},
		{
			name:       "case insensitive key match",
			raw:        "Token=supersecret&ACCESS_TOKEN=alsosecret",
			mustRedact: []string{"supersecret", "alsosecret"},
		},
		{
			name:       "sensitive param among benign ones",
			raw:        "page=2&token=secretvalue&sort=recent",
			mustRedact: []string{"secretvalue"},
			mustKeep:   []string{"page", "sort", "recent"},
		},
		{
			name:       "repeated sensitive param redacts every value",
			raw:        "token=first&token=second",
			mustRedact: []string{"first", "second"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := redactQuery(tc.raw)
			decoded, err := url.QueryUnescape(got)
			if err != nil {
				decoded = got
			}
			for _, secret := range tc.mustRedact {
				if strings.Contains(got, secret) || strings.Contains(decoded, secret) {
					t.Errorf("redactQuery(%q) = %q; must not contain %q", tc.raw, got, secret)
				}
			}
			for _, keep := range tc.mustKeep {
				if !strings.Contains(got, keep) && !strings.Contains(decoded, keep) {
					t.Errorf("redactQuery(%q) = %q; expected it to contain %q", tc.raw, got, keep)
				}
			}
		})
	}
}

// A query with nothing sensitive must pass through byte-for-byte, so ordinary
// request logs stay exactly as useful as before.
func TestRedactQuery_benignQueryUnchanged(t *testing.T) {
	t.Parallel()

	raw := "page=2&page_size=20&sort=recent"
	if got := redactQuery(raw); got != raw {
		t.Errorf("redactQuery(%q) = %q; benign query must be unchanged", raw, got)
	}
}

func TestRedactQuery_empty(t *testing.T) {
	t.Parallel()

	if got := redactQuery(""); got != "" {
		t.Errorf("redactQuery(\"\") = %q; want empty", got)
	}
}

// An unparseable query is dropped wholesale rather than logged raw — that is
// precisely the case where a naive scan would miss an embedded credential.
func TestRedactQuery_unparseableIsDropped(t *testing.T) {
	t.Parallel()

	raw := "token=abc%ZZdef"
	got := redactQuery(raw)
	if strings.Contains(got, "abc") || strings.Contains(got, "def") {
		t.Errorf("redactQuery(%q) = %q; unparseable query must not leak its contents", raw, got)
	}
	if got != redactedPlaceholder {
		t.Errorf("redactQuery(%q) = %q; want %q", raw, got, redactedPlaceholder)
	}
}
