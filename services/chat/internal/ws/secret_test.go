package ws

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVerifyInternalSecret(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		expected    string
		headerVal   string
		queryVal    string
		wantAllowed bool
	}{
		{
			name:        "no secret configured allows (dev fallback)",
			expected:    "",
			wantAllowed: true,
		},
		{
			name:        "matching header allowed",
			expected:    "s3cret",
			headerVal:   "s3cret",
			wantAllowed: true,
		},
		{
			name:        "matching query param allowed",
			expected:    "s3cret",
			queryVal:    "s3cret",
			wantAllowed: true,
		},
		{
			name:        "missing secret rejected when configured",
			expected:    "s3cret",
			wantAllowed: false,
		},
		{
			name:        "wrong secret rejected",
			expected:    "s3cret",
			headerVal:   "nope",
			wantAllowed: false,
		},
		{
			name:        "header takes precedence over empty query",
			expected:    "s3cret",
			headerVal:   "s3cret",
			queryVal:    "wrong",
			wantAllowed: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			target := "/ws"
			if tt.queryVal != "" {
				target += "?" + internalSecretQueryParam + "=" + tt.queryVal
			}
			r := httptest.NewRequest(http.MethodGet, target, nil)
			if tt.headerVal != "" {
				r.Header.Set(internalSecretHeader, tt.headerVal)
			}

			if got := verifyInternalSecret(r, tt.expected); got != tt.wantAllowed {
				t.Errorf("verifyInternalSecret() = %v, want %v", got, tt.wantAllowed)
			}
		})
	}
}

func TestInternalWSSecret(t *testing.T) {
	// Not parallel: mutates process env.
	t.Setenv("INTERNAL_WS_SECRET", "")
	t.Setenv("GATEWAY_CHAT_SECRET", "")
	if got := InternalWSSecret(); got != "" {
		t.Errorf("expected empty when unset, got %q", got)
	}

	t.Setenv("GATEWAY_CHAT_SECRET", "fallback")
	if got := InternalWSSecret(); got != "fallback" {
		t.Errorf("expected fallback alias, got %q", got)
	}

	t.Setenv("INTERNAL_WS_SECRET", "primary")
	if got := InternalWSSecret(); got != "primary" {
		t.Errorf("expected primary to win, got %q", got)
	}
}
