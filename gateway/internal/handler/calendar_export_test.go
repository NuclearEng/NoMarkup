package handler

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// memCalendarFeedStore is an in-memory SHA-256 → user_id map for hermetic tests.
type memCalendarFeedStore struct {
	mu   sync.Mutex
	data map[string]string
}

func newMemCalendarFeedStore() *memCalendarFeedStore {
	return &memCalendarFeedStore{data: make(map[string]string)}
}

func (m *memCalendarFeedStore) Put(_ context.Context, hashHex, userID string, _ time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[hashHex] = userID
	return nil
}

func (m *memCalendarFeedStore) Get(_ context.Context, hashHex string) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	uid, ok := m.data[hashHex]
	return uid, ok
}

func testCalendarHandler() *CalendarExportHandler {
	h := NewCalendarExportHandler(nil, nil)
	h.feeds = newMemCalendarFeedStore()
	return h
}

func TestMintFeedRequiresAuth(t *testing.T) {
	t.Parallel()
	h := testCalendarHandler()

	req := httptest.NewRequest(http.MethodPost, "https://api.example.com/api/v1/me/calendar-feed", nil)
	rec := httptest.NewRecorder()
	h.MintFeed(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestMintFeedUnavailableWithoutStore(t *testing.T) {
	t.Parallel()
	h := NewCalendarExportHandler(nil, nil)

	req := httptest.NewRequest(http.MethodPost, "https://api.example.com/api/v1/me/calendar-feed", nil)
	req = addClaimsToRequest(req, "user-123", "u@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	h.MintFeed(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d, want 503 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestMintFeedThenExportICS(t *testing.T) {
	t.Parallel()
	h := testCalendarHandler()

	mintReq := httptest.NewRequest(http.MethodPost, "https://api.example.com/api/v1/me/calendar-feed", nil)
	mintReq = addClaimsToRequest(mintReq, "user-123", "u@example.com", []string{"provider"})
	mintRec := httptest.NewRecorder()
	h.MintFeed(mintRec, mintReq)
	if mintRec.Code != http.StatusOK {
		t.Fatalf("mint: got %d, want 200 (body=%s)", mintRec.Code, mintRec.Body.String())
	}

	var body map[string]string
	if err := json.Unmarshal(mintRec.Body.Bytes(), &body); err != nil {
		t.Fatalf("mint json: %v", err)
	}
	feedURL := body["url"]
	if feedURL == "" {
		t.Fatal("mint response missing url")
	}
	if strings.Contains(feedURL, "token=") {
		t.Fatalf("mint url must not carry a session JWT: %s", feedURL)
	}

	parsed, err := url.Parse(feedURL)
	if err != nil {
		t.Fatalf("parse minted url: %v", err)
	}
	if parsed.Path != "/api/v1/me/calendar.ics" {
		t.Fatalf("path = %q, want /api/v1/me/calendar.ics", parsed.Path)
	}
	feed := parsed.Query().Get("feed")
	if len(feed) < 64 {
		t.Fatalf("feed secret too short (%d chars): %q", len(feed), feed)
	}
	if parsed.Query().Get("token") != "" {
		t.Fatal("minted url must not include token=")
	}

	icsReq := httptest.NewRequest(http.MethodGet, "/api/v1/me/calendar.ics?feed="+url.QueryEscape(feed), nil)
	icsRec := httptest.NewRecorder()
	h.ExportICS(icsRec, icsReq)
	if icsRec.Code != http.StatusOK {
		t.Fatalf("export: got %d, want 200 (body=%s)", icsRec.Code, icsRec.Body.String())
	}
	ics := icsRec.Body.String()
	if !strings.Contains(ics, "BEGIN:VCALENDAR") || !strings.Contains(ics, "END:VCALENDAR") {
		t.Fatalf("expected a VCALENDAR body, got:\n%s", ics)
	}
}

func TestExportICSRandomFeedUnauthorized(t *testing.T) {
	t.Parallel()
	h := testCalendarHandler()

	req := httptest.NewRequest(http.MethodGet,
		"/api/v1/me/calendar.ics?feed=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		nil)
	rec := httptest.NewRecorder()
	h.ExportICS(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestExportICSRejectsAccessJWTQuery(t *testing.T) {
	t.Parallel()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"sub": "user-123",
		"exp": time.Now().Add(15 * time.Minute).Unix(),
		"iss": "nomarkup",
		"aud": "nomarkup-api",
	})
	signed, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}

	// Pass the matching public key so a regression that re-enables ?token=
	// JWT verification would accept this and fail the test.
	h := NewCalendarExportHandler(nil, &key.PublicKey)
	h.feeds = newMemCalendarFeedStore()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/calendar.ics?token="+url.QueryEscape(signed), nil)
	rec := httptest.NewRecorder()
	h.ExportICS(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401 for ?token= access JWT (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestExportICSClaimsStillWork(t *testing.T) {
	t.Parallel()
	h := testCalendarHandler()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/calendar.ics", nil)
	req = addClaimsToRequest(req, "user-123", "u@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	h.ExportICS(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
}
