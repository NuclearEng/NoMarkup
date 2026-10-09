package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	reviewv1 "github.com/nomarkup/nomarkup/proto/review/v1"
)

func TestProtoReviewToJSON_AlwaysIncludesPhotoURLs(t *testing.T) {
	t.Parallel()

	t.Run("empty", func(t *testing.T) {
		t.Parallel()
		out := protoReviewToJSON(&reviewv1.Review{Id: "r-1"}, nil)
		got, ok := out["photo_urls"]
		if !ok {
			t.Fatal("photo_urls missing from JSON when proto has none")
		}
		urls, ok := got.([]string)
		if !ok {
			t.Fatalf("photo_urls type %T, want []string", got)
		}
		if len(urls) != 0 {
			t.Fatalf("photo_urls = %v, want empty", urls)
		}
	})

	t.Run("populated", func(t *testing.T) {
		t.Parallel()
		want := []string{"https://cdn.example.com/reviews/a.jpg"}
		out := protoReviewToJSON(&reviewv1.Review{
			Id:        "r-1",
			PhotoUrls: want,
		}, nil)
		got, ok := out["photo_urls"].([]string)
		if !ok {
			t.Fatalf("photo_urls type %T, want []string", out["photo_urls"])
		}
		if len(got) != 1 || got[0] != want[0] {
			t.Fatalf("photo_urls = %v, want %v", got, want)
		}
	})
}

func TestNormalizeReviewPhotoURLs(t *testing.T) {
	t.Parallel()

	t.Run("trims and dedupes", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		got, ok := normalizeReviewPhotoURLs(rec, []string{
			"https://cdn.example.com/a.jpg",
			" https://cdn.example.com/a.jpg ",
			"http://cdn.example.com/b.jpg",
			"",
		})
		if !ok {
			t.Fatalf("ok=false, body=%s", rec.Body.String())
		}
		if len(got) != 2 {
			t.Fatalf("len=%d want 2: %v", len(got), got)
		}
		if rec.Code != 0 && rec.Code != http.StatusOK {
			t.Fatalf("unexpected status %d", rec.Code)
		}
	})

	t.Run("rejects non-http", func(t *testing.T) {
		t.Parallel()
		rec := httptest.NewRecorder()
		_, ok := normalizeReviewPhotoURLs(rec, []string{"ftp://files.example.com/a.jpg"})
		if ok {
			t.Fatal("expected rejection")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status=%d want 400", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "http(s)") {
			t.Fatalf("body=%s", rec.Body.String())
		}
	})

	t.Run("rejects more than 5", func(t *testing.T) {
		t.Parallel()
		in := make([]string, 6)
		for i := range in {
			in[i] = "https://cdn.example.com/" + strings.Repeat("x", i+1) + ".jpg"
		}
		rec := httptest.NewRecorder()
		_, ok := normalizeReviewPhotoURLs(rec, in)
		if ok {
			t.Fatal("expected rejection")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status=%d want 400", rec.Code)
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("json: %v body=%s", err, rec.Body.String())
		}
	})
}
