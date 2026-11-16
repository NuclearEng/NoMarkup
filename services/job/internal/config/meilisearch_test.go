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
