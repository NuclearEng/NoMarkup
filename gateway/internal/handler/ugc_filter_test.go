package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRejectProhibitedUGC(t *testing.T) {
	t.Parallel()

	t.Run("allows benign", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/listings", nil)
		if rejectProhibitedUGC(rec, req, "Oak dining table", "Gently used, local pickup") {
			t.Fatalf("expected allow, got reject body=%s", rec.Body.String())
		}
		if rec.Code != 0 && rec.Body.Len() > 0 {
			t.Fatalf("should not write response on allow, code=%d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("rejects weapons with guidelines message", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/listings", nil)
		if !rejectProhibitedUGC(rec, req, "AR-15 for sale", "local only") {
			t.Fatal("expected reject")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status=%d want 400", rec.Code)
		}
		var body map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("json: %v body=%s", err, rec.Body.String())
		}
		if body["error"] != communityGuidelinesRejectMsg {
			t.Errorf("error=%q want guidelines message", body["error"])
		}
		// Never leak matched term to client.
		if strings.Contains(strings.ToLower(body["error"]), "ar-15") ||
			strings.Contains(strings.ToLower(body["error"]), "prohibited_weapons") {
			t.Errorf("client body leaked filter internals: %q", body["error"])
		}
	})

	t.Run("rejects substances", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs", nil)
		if !rejectProhibitedUGC(rec, req, "Need courier", "deliver cocaine package") {
			t.Fatal("expected reject")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status=%d want 400", rec.Code)
		}
	})

	t.Run("rejects hate", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/channels/x/messages", nil)
		if !rejectProhibitedUGC(rec, req, "you are a nigger") {
			t.Fatal("expected reject")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status=%d want 400", rec.Code)
		}
	})
}
