package handler

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
)

// memWorkSessionStore is an in-memory workSessionStore with the same open /
// refresh / close semantics as pgWorkSessionStore, for handler tests.
type memWorkSessionStore struct {
	mu       sync.Mutex
	sessions map[string][]persistedWorkSession // key: contract|provider, oldest first
	fail     error
}

func newMemWorkSessionStore() *memWorkSessionStore {
	return &memWorkSessionStore{sessions: map[string][]persistedWorkSession{}}
}

func (m *memWorkSessionStore) key(c, p string) string { return c + "|" + p }

func (m *memWorkSessionStore) RecordCheckIn(_ context.Context, c, p string, _, _ float64, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail != nil {
		return m.fail
	}
	list := m.sessions[m.key(c, p)]
	if n := len(list); n > 0 && list[n-1].checkedOutAt == nil {
		list[n-1] = persistedWorkSession{checkedInAt: at}
		return nil
	}
	m.sessions[m.key(c, p)] = append(list, persistedWorkSession{checkedInAt: at})
	return nil
}

func (m *memWorkSessionStore) RecordCheckOut(_ context.Context, c, p string, _, _ float64, at time.Time, d int, in time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail != nil {
		return m.fail
	}
	list := m.sessions[m.key(c, p)]
	if n := len(list); n > 0 && list[n-1].checkedOutAt == nil {
		list[n-1].checkedOutAt = &at
		list[n-1].durationMinutes = d
		return nil
	}
	m.sessions[m.key(c, p)] = append(list, persistedWorkSession{checkedInAt: in, checkedOutAt: &at, durationMinutes: d})
	return nil
}

func (m *memWorkSessionStore) OpenCheckIn(_ context.Context, c, p string) (time.Time, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail != nil {
		return time.Time{}, false, m.fail
	}
	list := m.sessions[m.key(c, p)]
	if n := len(list); n > 0 && list[n-1].checkedOutAt == nil {
		return list[n-1].checkedInAt, true, nil
	}
	return time.Time{}, false, nil
}

func (m *memWorkSessionStore) Latest(_ context.Context, c, p string) (persistedWorkSession, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail != nil {
		return persistedWorkSession{}, false, m.fail
	}
	list := m.sessions[m.key(c, p)]
	if len(list) == 0 {
		return persistedWorkSession{}, false, nil
	}
	return list[len(list)-1], true, nil
}

const wsTestContract = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

func workspaceTestRouter(h *WorkspaceHandler) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/checkin", h.CheckIn)
	r.Post("/api/v1/contracts/{id}/checkout", h.CheckOut)
	r.Get("/api/v1/contracts/{id}/work-session", h.GetWorkSession)
	return r
}

func doWorkspace(t *testing.T, r http.Handler, method, path string, body interface{}) (int, map[string]interface{}) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&buf).Encode(body))
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "provider-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	out := map[string]interface{}{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func keysOf(m map[string]interface{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// The response shapes are the contract the web and iOS clients read; moving
// the store from Redis to Postgres must not change them.
func TestWorkSession_roundTripThroughStore_shapesUnchanged(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	store := newMemWorkSessionStore()
	h.sessions = store
	r := workspaceTestRouter(h)
	base := "/api/v1/contracts/" + wsTestContract

	code, got := doWorkspace(t, r, http.MethodGet, base+"/work-session", nil)
	require.Equal(t, http.StatusOK, code)
	assert.ElementsMatch(t, []string{"status", "checked_in_at", "checked_out_at", "duration_minutes"}, keysOf(got))
	assert.Equal(t, "not_started", got["status"])

	code, got = doWorkspace(t, r, http.MethodPost, base+"/checkin", map[string]float64{"lat": 30.27, "lng": -97.74})
	require.Equal(t, http.StatusOK, code)
	assert.ElementsMatch(t, []string{"checked_in_at"}, keysOf(got))
	_, err := time.Parse(time.RFC3339, got["checked_in_at"].(string))
	require.NoError(t, err)

	code, got = doWorkspace(t, r, http.MethodGet, base+"/work-session", nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "checked_in", got["status"])
	assert.Nil(t, got["checked_out_at"])
	assert.Nil(t, got["duration_minutes"])

	code, got = doWorkspace(t, r, http.MethodPost, base+"/checkout", map[string]float64{"lat": 30.27, "lng": -97.74})
	require.Equal(t, http.StatusOK, code)
	assert.ElementsMatch(t, []string{"checked_out_at", "duration_minutes"}, keysOf(got))
	assert.EqualValues(t, 0, got["duration_minutes"])

	code, got = doWorkspace(t, r, http.MethodGet, base+"/work-session", nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "checked_out", got["status"])
	assert.NotNil(t, got["checked_out_at"])
	assert.EqualValues(t, 0, got["duration_minutes"])

	// A second check-out has no open session.
	code, _ = doWorkspace(t, r, http.MethodPost, base+"/checkout", map[string]float64{"lat": 30.27, "lng": -97.74})
	assert.Equal(t, http.StatusBadRequest, code)

	// A fresh check-in opens a new session rather than reviving the old one.
	code, _ = doWorkspace(t, r, http.MethodPost, base+"/checkin", map[string]float64{"lat": 30.27, "lng": -97.74})
	require.Equal(t, http.StatusOK, code)
	_, got = doWorkspace(t, r, http.MethodGet, base+"/work-session", nil)
	assert.Equal(t, "checked_in", got["status"])
	assert.Len(t, store.sessions[store.key(wsTestContract, "provider-1")], 2)
}

func TestCheckIn_storeFailureIs503(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	store := newMemWorkSessionStore()
	store.fail = errors.New("db down")
	h.sessions = store
	code, got := doWorkspace(t, workspaceTestRouter(h), http.MethodPost,
		"/api/v1/contracts/"+wsTestContract+"/checkin", map[string]float64{"lat": 1, "lng": 2})
	assert.Equal(t, http.StatusServiceUnavailable, code)
	assert.Equal(t, "failed to save check-in", got["error"])
}

func TestGetWorkSession_storeFailureWithoutLegacyIsNotStarted(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	store := newMemWorkSessionStore()
	store.fail = errors.New("db down")
	h.sessions = store
	code, got := doWorkspace(t, workspaceTestRouter(h), http.MethodGet,
		"/api/v1/contracts/"+wsTestContract+"/work-session", nil)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, "not_started", got["status"])
}

func TestLegacyWorkSessionResult(t *testing.T) {
	t.Parallel()
	in := checkInData{Timestamp: time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)}
	out := checkOutData{Timestamp: time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC), DurationMinutes: 60}

	res, found := legacyWorkSessionResult(checkInData{}, false, checkOutData{}, false)
	assert.False(t, found)
	assert.Equal(t, "not_started", res["status"])

	res, found = legacyWorkSessionResult(in, true, checkOutData{}, false)
	assert.True(t, found)
	assert.Equal(t, "checked_in", res["status"])
	assert.Equal(t, "2026-11-01T09:00:00Z", res["checked_in_at"])
	assert.Nil(t, res["checked_out_at"])

	res, _ = legacyWorkSessionResult(in, true, out, true)
	assert.Equal(t, "checked_out", res["status"])
	assert.Equal(t, "2026-11-01T10:00:00Z", res["checked_out_at"])
	assert.Equal(t, 60, res["duration_minutes"])
}

func TestFormatWorkSessionPoint_roundTripsThroughParseExactPoint(t *testing.T) {
	t.Parallel()
	for _, p := range [][2]float64{{30.2672, -97.7431}, {-33.8688, 151.2093}, {0.0000001, -0.0000001}, {90, -180}} {
		s := formatWorkSessionPoint(p[0], p[1])
		lat, lng, err := parseExactPoint(s)
		require.NoError(t, err, s)
		assert.InDelta(t, p[0], lat, 1e-7)
		assert.InDelta(t, p[1], lng, 1e-7)
	}
	assert.Equal(t, "30.2672000,-97.7431000", formatWorkSessionPoint(30.2672, -97.7431))
}

func TestPgWorkSessionStore_sealPoint(t *testing.T) {
	t.Parallel()
	var key [crypto.KeySize]byte
	_, err := rand.Read(key[:])
	require.NoError(t, err)
	c := crypto.New(&key, nil)

	ct, err := pgWorkSessionStore{cipher: c}.sealPoint(context.Background(), 30.2672, -97.7431)
	require.NoError(t, err)
	require.NotNil(t, ct)
	assert.NotContains(t, *ct, "30.2672", "point must not be stored in clear")
	plain, err := c.DecryptString(*ct)
	require.NoError(t, err)
	assert.Equal(t, "30.2672000,-97.7431000", plain)

	// No cipher: the point is dropped, never stored in clear.
	ct, err = pgWorkSessionStore{}.sealPoint(context.Background(), 30.2672, -97.7431)
	require.NoError(t, err)
	assert.Nil(t, ct)
}

func TestNewWorkspaceHandler_nilDBHasNoStore(t *testing.T) {
	t.Parallel()
	h := NewWorkspaceHandler(nil, nil, nil)
	assert.Nil(t, h.sessions)
	at, ok, err := h.openSessionCheckInAt(context.Background(), "c", "p")
	require.NoError(t, err)
	assert.False(t, ok)
	assert.True(t, at.IsZero())
}
