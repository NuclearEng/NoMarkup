package config

import "testing"

func TestResolveMeilisearchURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		host string
		want string
	}{
		{
			name: "neither set returns empty",
			url:  "",
			host: "",
			want: "",
		},
		{
			name: "canonical MEILISEARCH_URL wins",
			url:  "http://meilisearch:7700",
			host: "",
			want: "http://meilisearch:7700",
		},
		{
			name: "deprecated MEILISEARCH_HOST fallback",
			url:  "",
			host: "http://localhost:7700",
			want: "http://localhost:7700",
		},
		{
			name: "URL takes precedence over HOST",
			url:  "http://meilisearch:7700",
			host: "http://localhost:9999",
			want: "http://meilisearch:7700",
		},
		{
			name: "bare host:port gets http scheme",
			url:  "meilisearch:7700",
			host: "",
			want: "http://meilisearch:7700",
		},
		{
			name: "bare host:port via HOST fallback gets http scheme",
			url:  "",
			host: "localhost:7700",
			want: "http://localhost:7700",
		},
		{
			name: "https scheme preserved",
			url:  "https://search.no-markup.com",
			host: "",
			want: "https://search.no-markup.com",
		},
		{
			name: "whitespace-only treated as unset",
			url:  "   ",
			host: "  ",
			want: "",
		},
		{
			name: "surrounding whitespace trimmed",
			url:  " http://meilisearch:7700 ",
			host: "",
			want: "http://meilisearch:7700",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// t.Setenv forbids t.Parallel(); env mutation is process-global.
			t.Setenv("MEILISEARCH_URL", tt.url)
			t.Setenv("MEILISEARCH_HOST", tt.host)

			if got := ResolveMeilisearchURL(); got != tt.want {
				t.Errorf("ResolveMeilisearchURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestMissingProductionVars(t *testing.T) {
	tests := []struct {
		name     string
		database string
		redis    string
		want     []string
	}{
		{
			name:     "both set returns nil",
			database: "postgresql://localhost:5432/nomarkup",
			redis:    "redis://localhost:6379",
			want:     nil,
		},
		{
			name:     "both missing reports both",
			database: "",
			redis:    "",
			want:     []string{"DATABASE_URL", "REDIS_URL"},
		},
		{
			name:     "only DATABASE_URL missing",
			database: "",
			redis:    "redis://localhost:6379",
			want:     []string{"DATABASE_URL"},
		},
		{
			name:     "only REDIS_URL missing",
			database: "postgresql://localhost:5432/nomarkup",
			redis:    "",
			want:     []string{"REDIS_URL"},
		},
		{
			name:     "whitespace-only counts as missing",
			database: "   ",
			redis:    "\t",
			want:     []string{"DATABASE_URL", "REDIS_URL"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// t.Setenv forbids t.Parallel(); env mutation is process-global.
			t.Setenv("DATABASE_URL", tt.database)
			t.Setenv("REDIS_URL", tt.redis)

			got := MissingProductionVars()
			if len(got) != len(tt.want) {
				t.Fatalf("MissingProductionVars() = %v, want %v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("MissingProductionVars()[%d] = %q, want %q", i, got[i], tt.want[i])
				}
			}
		})
	}
}
