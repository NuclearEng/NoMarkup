package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNativeGoogleSignIn_MissingIdentityToken(t *testing.T) {
	t.Parallel()
	h := NewOAuthHandler(nil, false, "test-session-secret")

	body, err := json.Marshal(map[string]string{"identity_token": ""})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google/native", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.NativeGoogleSignIn(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestNativeGoogleSignIn_InvalidJSON(t *testing.T) {
	t.Parallel()
	h := NewOAuthHandler(nil, false, "test-session-secret")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google/native", bytes.NewReader([]byte(`{not-json`)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.NativeGoogleSignIn(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestNativeGoogleSignIn_InvalidTokenUnauthorized(t *testing.T) {
	// t.Setenv cannot combine with t.Parallel.
	// Without a real JWT/JWKS, verification fails → 401 (not 500).
	// Set a dummy client id so the audience list is non-empty and parse fails early.
	t.Setenv("GOOGLE_CLIENT_ID", "test-web-client.apps.googleusercontent.com")
	t.Setenv("GOOGLE_IOS_CLIENT_ID", "test-ios-client.apps.googleusercontent.com")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	body, err := json.Marshal(map[string]string{
		"identity_token": "not.a.real.jwt",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google/native", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.NativeGoogleSignIn(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestGoogleAudienceClientIDs(t *testing.T) {
	// t.Setenv cannot combine with t.Parallel.
	t.Setenv("GOOGLE_CLIENT_ID", "web.apps.googleusercontent.com")
	t.Setenv("GOOGLE_IOS_CLIENT_ID", "ios.apps.googleusercontent.com")
	ids := googleAudienceClientIDs()
	if len(ids) != 2 {
		t.Fatalf("len = %d, want 2: %v", len(ids), ids)
	}

	// Dedup when same value
	t.Setenv("GOOGLE_IOS_CLIENT_ID", "web.apps.googleusercontent.com")
	ids = googleAudienceClientIDs()
	if len(ids) != 1 || ids[0] != "web.apps.googleusercontent.com" {
		t.Fatalf("dedup failed: %v", ids)
	}
}
