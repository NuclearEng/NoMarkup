package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPrivateNoStore(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		handler http.HandlerFunc
		want    string
	}{
		{
			name: "default applied when handler sets no Cache-Control",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"ok":true}`))
			},
			want: "private, no-store",
		},
		{
			name: "handler-set Cache-Control wins over the default",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				// Mirrors writeCachedJSON: an explicit per-handler policy
				// must overwrite the subtree default.
				w.Header().Set("Cache-Control",
					"public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400")
				w.WriteHeader(http.StatusOK)
			},
			want: "public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400",
		},
		{
			name: "handler-set private policy with max-age wins",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				// Mirrors calendar_export's authed-but-briefly-cacheable read.
				w.Header().Set("Cache-Control", "private, max-age=300")
				w.WriteHeader(http.StatusOK)
			},
			want: "private, max-age=300",
		},
		{
			name: "default applied on error responses too",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "nope", http.StatusUnauthorized)
			},
			want: "private, no-store",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)

			PrivateNoStore(tt.handler).ServeHTTP(rec, req)

			if got := rec.Header().Get("Cache-Control"); got != tt.want {
				t.Fatalf("Cache-Control = %q, want %q", got, tt.want)
			}
		})
	}
}
