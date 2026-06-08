package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestCORS_AllowsIdempotencyKeyPreflight is the regression for the browser-only
// CORS break: payment/advance/insurance mutations send an Idempotency-Key header,
// which makes the browser fire a CORS preflight requesting that header. If it's
// not in AllowedHeaders, the preflight response has no Access-Control-Allow-Origin
// and the browser blocks every idempotent mutation (curl/unit tests bypass the
// preflight, so this is invisible to them).
func TestCORS_AllowsIdempotencyKeyPreflight(t *testing.T) {
	t.Parallel()
	handler := CORS([]string{"http://localhost:3000"}, false)(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }),
	)

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/insurance/quote-requests", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "content-type,idempotency-key")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("preflight Access-Control-Allow-Origin = %q, want the request origin (Idempotency-Key not allow-listed?)", got)
	}
	allowHeaders := strings.ToLower(rec.Header().Get("Access-Control-Allow-Headers"))
	if !strings.Contains(allowHeaders, "idempotency-key") {
		t.Fatalf("Access-Control-Allow-Headers = %q, want it to include Idempotency-Key", allowHeaders)
	}
}
