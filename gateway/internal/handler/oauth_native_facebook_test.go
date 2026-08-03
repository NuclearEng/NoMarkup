package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNativeFacebookSignIn_NotConfigured(t *testing.T) {
	t.Setenv("FACEBOOK_CLIENT_ID", "")
	t.Setenv("FACEBOOK_CLIENT_SECRET", "")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	body, err := json.Marshal(map[string]string{
		"authorization_code": "abc",
		"redirect_uri":       "nomarkup://oauth2redirect/facebook",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/facebook/native", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.NativeFacebookSignIn(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
}

func TestNativeFacebookSignIn_MissingCodeAndToken(t *testing.T) {
	t.Setenv("FACEBOOK_CLIENT_ID", "test-app-id")
	t.Setenv("FACEBOOK_CLIENT_SECRET", "test-secret")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	body, err := json.Marshal(map[string]string{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/facebook/native", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.NativeFacebookSignIn(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestNativeFacebookSignIn_CodeWithoutRedirectURI(t *testing.T) {
	t.Setenv("FACEBOOK_CLIENT_ID", "test-app-id")
	t.Setenv("FACEBOOK_CLIENT_SECRET", "test-secret")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	body, err := json.Marshal(map[string]string{
		"authorization_code": "abc",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/facebook/native", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.NativeFacebookSignIn(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestNativeFacebookSignIn_InvalidJSON(t *testing.T) {
	t.Setenv("FACEBOOK_CLIENT_ID", "test-app-id")
	t.Setenv("FACEBOOK_CLIENT_SECRET", "test-secret")

	h := NewOAuthHandler(nil, false, "test-session-secret")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/facebook/native", bytes.NewReader([]byte(`{not-json`)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.NativeFacebookSignIn(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}
