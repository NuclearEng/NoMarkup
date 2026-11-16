package main

import "testing"

// The backfill runs as the application role, whose sessions default to the
// request-path timeouts (migration 137). It must opt out explicitly.
func TestBatchConnConfigDisablesRoleTimeouts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		url  string
		want map[string]string
	}{
		{
			name: "plain url disables all three",
			url:  "postgres://u:p@localhost:5432/db",
			want: map[string]string{
				"statement_timeout":                   "0",
				"lock_timeout":                        "0",
				"idle_in_transaction_session_timeout": "0",
			},
		},
		{
			name: "a value pinned in the url is kept",
			url:  "postgres://u:p@localhost:5432/db?lock_timeout=5000",
			want: map[string]string{
				"statement_timeout":                   "0",
				"lock_timeout":                        "5000",
				"idle_in_transaction_session_timeout": "0",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			cfg, err := batchConnConfig(tt.url)
			if err != nil {
				t.Fatalf("batchConnConfig: %v", err)
			}
			for name, want := range tt.want {
				if got := cfg.RuntimeParams[name]; got != want {
					t.Errorf("%s = %q, want %q", name, got, want)
				}
			}
		})
	}

	if _, err := batchConnConfig("postgres://u:p@localhost:notaport/db"); err == nil {
		t.Error("an unparsable url must be an error")
	}
}
