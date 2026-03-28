package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// uniqueKey returns a random idempotency key to ensure test isolation
// across runs (Redis keys from a previous run won't collide).
func uniqueKey(t *testing.T) string {
	t.Helper()
	b := make([]byte, 8)
	_, err := rand.Read(b)
	require.NoError(t, err)
	return t.Name() + "-" + hex.EncodeToString(b)
}

// testCacheClient attempts to connect to a local Redis instance for
// integration tests. Returns nil and skips the test if Redis is not
// reachable.
func testCacheClient(t *testing.T) *cache.Client {
	t.Helper()
	c := cache.New("redis://localhost:6379")
	if c == nil {
		t.Skip("Redis unavailable, skipping integration test")
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// jsonHandler returns a handler that writes a JSON body with the given
// status code. Useful for simulating downstream payment handlers.
func jsonHandler(status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}
}

// --- RequireIdempotencyKey tests ---

func TestIdempotency_POST_without_key_returns_400(t *testing.T) {
	t.Parallel()

	// nil cache — header enforcement still works without Redis.
	mw := RequireIdempotencyKey(nil)
	handler := mw(jsonHandler(http.StatusCreated, `{"id":"pay_1"}`))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "Idempotency-Key header is required")
}

func TestIdempotency_PUT_without_key_returns_400(t *testing.T) {
	t.Parallel()

	mw := RequireIdempotencyKey(nil)
	handler := mw(jsonHandler(http.StatusOK, `{"updated":true}`))

	req := httptest.NewRequest(http.MethodPut, "/api/v1/payments/pay_1", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "Idempotency-Key header is required")
}

func TestIdempotency_GET_passes_without_key(t *testing.T) {
	t.Parallel()

	mw := RequireIdempotencyKey(nil)
	handler := mw(jsonHandler(http.StatusOK, `{"payments":[]}`))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/payments", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "payments")
}

func TestIdempotency_DELETE_passes_without_key(t *testing.T) {
	t.Parallel()

	mw := RequireIdempotencyKey(nil)
	handler := mw(jsonHandler(http.StatusOK, `{"deleted":true}`))

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/payments/methods/pm_1", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestIdempotency_POST_with_key_proceeds_no_cache(t *testing.T) {
	t.Parallel()

	// nil cache — key accepted, handler runs, no caching.
	mw := RequireIdempotencyKey(nil)
	handler := mw(jsonHandler(http.StatusCreated, `{"id":"pay_1"}`))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
	req.Header.Set(idempotencyKeyHeader, "key-abc-123")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	assert.Contains(t, rec.Body.String(), "pay_1")
	assert.Empty(t, rec.Header().Get("X-Idempotency-Replayed"))
}

func TestIdempotency_cached_response_replayed(t *testing.T) {
	cacheClient := testCacheClient(t)

	idempotencyKey := uniqueKey(t)
	mw := RequireIdempotencyKey(cacheClient)

	callCount := 0
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"pay_1","status":"created"}`))
	})
	handler := mw(inner)

	// --- First request: should reach the handler ---
	req1 := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
	req1.Header.Set(idempotencyKeyHeader, idempotencyKey)
	rec1 := httptest.NewRecorder()

	handler.ServeHTTP(rec1, req1)

	assert.Equal(t, http.StatusCreated, rec1.Code)
	assert.Contains(t, rec1.Body.String(), `"id":"pay_1"`)
	assert.Empty(t, rec1.Header().Get("X-Idempotency-Replayed"))
	require.Equal(t, 1, callCount, "handler should have been called once")

	// --- Second request with same key: should return cached response ---
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
	req2.Header.Set(idempotencyKeyHeader, idempotencyKey)
	rec2 := httptest.NewRecorder()

	handler.ServeHTTP(rec2, req2)

	assert.Equal(t, http.StatusCreated, rec2.Code)
	assert.Contains(t, rec2.Body.String(), `"id":"pay_1"`)
	assert.Equal(t, "true", rec2.Header().Get("X-Idempotency-Replayed"))
	assert.Equal(t, 1, callCount, "handler should NOT have been called again")
}

func TestIdempotency_different_keys_produce_different_responses(t *testing.T) {
	cacheClient := testCacheClient(t)

	requestNum := 0
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestNum++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if requestNum == 1 {
			_, _ = w.Write([]byte(`{"id":"pay_1"}`))
		} else {
			_, _ = w.Write([]byte(`{"id":"pay_2"}`))
		}
	})

	mw := RequireIdempotencyKey(cacheClient)
	handler := mw(inner)

	// First key
	keyA := uniqueKey(t)
	req1 := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
	req1.Header.Set(idempotencyKeyHeader, keyA)
	rec1 := httptest.NewRecorder()
	handler.ServeHTTP(rec1, req1)

	assert.Equal(t, http.StatusCreated, rec1.Code)
	assert.Contains(t, rec1.Body.String(), `"id":"pay_1"`)

	// Second key — different response
	keyB := uniqueKey(t)
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
	req2.Header.Set(idempotencyKeyHeader, keyB)
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)

	assert.Equal(t, http.StatusCreated, rec2.Code)
	assert.Contains(t, rec2.Body.String(), `"id":"pay_2"`)
	assert.Equal(t, 2, requestNum, "handler should have been called twice for different keys")
}
