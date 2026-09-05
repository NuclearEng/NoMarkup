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

// TestVerifyInternalSecretEmptyExpected covers SEC-03 fail-closed behavior when
// no secret is configured. Mutates process env — not parallel.
func TestVerifyInternalSecretEmptyExpected(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/ws", nil)

	t.Run("production rejects empty expected", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "production")
		t.Setenv("APP_ENV", "production")
		if got := verifyInternalSecret(r, ""); got {
			t.Error("verifyInternalSecret() = true, want false when empty secret in production")
		}
	})

	t.Run("staging rejects empty expected", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "staging")
		t.Setenv("APP_ENV", "")
		if got := verifyInternalSecret(r, ""); got {
			t.Error("verifyInternalSecret() = true, want false when empty secret outside development")
		}
	})

	t.Run("unset environment rejects empty expected", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "")
		t.Setenv("APP_ENV", "")
		if got := verifyInternalSecret(r, ""); got {
			t.Error("verifyInternalSecret() = true, want false when ENVIRONMENT unset (not development)")
		}
	})

	t.Run("development allows empty expected", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "development")
		t.Setenv("APP_ENV", "")
		if got := verifyInternalSecret(r, ""); !got {
			t.Error("verifyInternalSecret() = false, want true for empty secret in development")
		}
	})

	t.Run("APP_ENV development allows empty expected", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "")
		t.Setenv("APP_ENV", "development")
		if got := verifyInternalSecret(r, ""); !got {
			t.Error("verifyInternalSecret() = false, want true for empty secret when APP_ENV=development")
		}
	})
}

func TestRequireInternalWSSecret(t *testing.T) {
	// Not parallel: mutates process env.

	t.Run("production empty refuses", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "production")
		t.Setenv("APP_ENV", "")
		t.Setenv("INTERNAL_WS_SECRET", "")
		t.Setenv("GATEWAY_CHAT_SECRET", "")
		if err := RequireInternalWSSecret(); err == nil {
			t.Fatal("expected error when production and secret empty")
		}
	})

	t.Run("production with secret ok", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "production")
		t.Setenv("INTERNAL_WS_SECRET", "prod-secret")
		if err := RequireInternalWSSecret(); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("development empty allowed", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "development")
		t.Setenv("INTERNAL_WS_SECRET", "")
		t.Setenv("GATEWAY_CHAT_SECRET", "")
		if err := RequireInternalWSSecret(); err != nil {
			t.Fatalf("development should allow empty secret, got: %v", err)
		}
	})

	t.Run("unset env treated as non-dev refuses", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "")
		t.Setenv("APP_ENV", "")
		t.Setenv("INTERNAL_WS_SECRET", "")
		t.Setenv("GATEWAY_CHAT_SECRET", "")
		if err := RequireInternalWSSecret(); err == nil {
			t.Fatal("expected error when ENVIRONMENT unset and secret empty")
		}
	})
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

func TestStripOriginScheme(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in, want string
	}{
		{"https://app.no-markup.com", "app.no-markup.com"},
		{"http://localhost:3000", "localhost:3000"},
		{"wss://no-markup.com", "no-markup.com"},
		{"app.no-markup.com", "app.no-markup.com"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := stripOriginScheme(tt.in); got != tt.want {
			t.Errorf("stripOriginScheme(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
