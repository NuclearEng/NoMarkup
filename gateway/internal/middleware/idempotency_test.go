package middleware

import (
	"context"
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

func TestIdempotency_NoStore_RefusesMoneyMutation(t *testing.T) {
	t.Parallel()

	// This test previously asserted the OPPOSITE: with a nil cache the handler
	// ran anyway and the response was simply not cached. That is fail-open on
	// a money path — the caller is required to send an Idempotency-Key, is
	// therefore entitled to assume the call is safe to retry, and the
	// guarantee is silently absent. A retried payment then charges twice, and
	// the customer discovers it rather than we do.
	//
	// 503 with Retry-After is the right answer: a retry is safe, a duplicate
	// charge is not.
	mw := RequireIdempotencyKey(nil)
	handler := mw(jsonHandler(http.StatusCreated, `{"id":"pay_1"}`))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
	req.Header.Set(idempotencyKeyHeader, "key-abc-123")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.NotContains(t, rec.Body.String(), "pay_1", "the handler must not have run")
	assert.NotEmpty(t, rec.Header().Get("Retry-After"), "client needs to know it may retry")
}

// Safe methods and unguarded routes must be unaffected — the refusal is
// deliberately narrow to routes that already demand an Idempotency-Key.
func TestIdempotency_NoStore_LeavesSafeMethodsAlone(t *testing.T) {
	t.Parallel()

	mw := RequireIdempotencyKey(nil)
	handler := mw(jsonHandler(http.StatusOK, `{"ok":true}`))

	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(method, "/api/v1/payments", nil))
		assert.Equal(t, http.StatusOK, rec.Code, "%s must pass through", method)
	}
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

// TestIdempotency_sameKeyReplaysJobBidPath is the money-adjacent place-bid
// shape: POST /jobs/{id}/bids with a sticky Idempotency-Key must not re-enter
// the handler on replay (handler + durable SQL still guard if Redis is cold).
func TestIdempotency_sameKeyReplaysJobBidPath(t *testing.T) {
	cacheClient := testCacheClient(t)

	idempotencyKey := uniqueKey(t)
	mw := RequireIdempotencyKey(cacheClient)

	callCount := 0
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"bid_1","amount_cents":5000,"status":"active"}`))
	})
	handler := mw(inner)

	path := "/api/v1/jobs/11111111-1111-1111-1111-111111111111/bids"
	req1 := httptest.NewRequest(http.MethodPost, path, nil)
	req1.Header.Set(idempotencyKeyHeader, idempotencyKey)
	req1 = req1.WithContext(context.WithValue(req1.Context(), ClaimsContextKey, &Claims{
		UserID: "provider-1",
		Email:  "p@example.com",
		Roles:  []string{"provider"},
	}))
	rec1 := httptest.NewRecorder()
	handler.ServeHTTP(rec1, req1)
	assert.Equal(t, http.StatusCreated, rec1.Code)
	assert.Empty(t, rec1.Header().Get("X-Idempotency-Replayed"))
	require.Equal(t, 1, callCount)

	req2 := httptest.NewRequest(http.MethodPost, path, nil)
	req2.Header.Set(idempotencyKeyHeader, idempotencyKey)
	req2 = req2.WithContext(context.WithValue(req2.Context(), ClaimsContextKey, &Claims{
		UserID: "provider-1",
		Email:  "p@example.com",
		Roles:  []string{"provider"},
	}))
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	assert.Equal(t, http.StatusCreated, rec2.Code)
	assert.Equal(t, "true", rec2.Header().Get("X-Idempotency-Replayed"))
	assert.Contains(t, rec2.Body.String(), `"id":"bid_1"`)
	assert.Equal(t, 1, callCount, "same Idempotency-Key must not re-enter place-bid handler")
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

// withUser returns a copy of req carrying authenticated claims for userID.
func withUser(req *http.Request, userID string) *http.Request {
	return req.WithContext(
		context.WithValue(req.Context(), ClaimsContextKey, &Claims{UserID: userID}),
	)
}

// TestIdempotency_keyIsScopedPerUser is the regression guard for a
// cross-account response leak.
//
// The cache key used to be the client-supplied Idempotency-Key alone, so the
// namespace was global: the full cached response body was replayed for 24h to
// whoever presented that key next. POST /api/v1/payments returns a Stripe
// client_secret, so a collision handed one user a live PaymentIntent secret
// belonging to another. The first-party web client mints a random UUID, but the
// API is public and any third-party client picks its own key.
func TestIdempotency_keyIsScopedPerUser(t *testing.T) {
	cacheClient := testCacheClient(t)

	sharedKey := uniqueKey(t)
	mw := RequireIdempotencyKey(cacheClient)

	var serving string
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"client_secret":"secret_for_` + serving + `"}`))
	})
	handler := mw(inner)

	// Alice posts with the shared key.
	serving = "alice"
	rec1 := httptest.NewRecorder()
	req1 := withUser(httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil), "alice")
	req1.Header.Set(idempotencyKeyHeader, sharedKey)
	handler.ServeHTTP(rec1, req1)
	require.Equal(t, http.StatusCreated, rec1.Code)
	require.Contains(t, rec1.Body.String(), "secret_for_alice")

	// Bob presents the SAME key on the SAME route. He must reach the handler
	// and get his own response — never Alice's cached body.
	serving = "bob"
	rec2 := httptest.NewRecorder()
	req2 := withUser(httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil), "bob")
	req2.Header.Set(idempotencyKeyHeader, sharedKey)
	handler.ServeHTTP(rec2, req2)

	assert.Contains(t, rec2.Body.String(), "secret_for_bob")
	assert.NotContains(t, rec2.Body.String(), "secret_for_alice",
		"Bob must never receive Alice's cached client_secret")
	assert.Empty(t, rec2.Header().Get("X-Idempotency-Replayed"),
		"Bob's request is not a replay — it is a different caller")
}

// A genuine retry by the SAME user on the SAME route must still replay, or the
// middleware would stop doing its job.
func TestIdempotency_sameUserSameRouteStillReplays(t *testing.T) {
	cacheClient := testCacheClient(t)

	key := uniqueKey(t)
	mw := RequireIdempotencyKey(cacheClient)

	calls := 0
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"pay_1"}`))
	}))

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		req := withUser(httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil), "alice")
		req.Header.Set(idempotencyKeyHeader, key)
		handler.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusCreated, rec.Code)
	}
	assert.Equal(t, 1, calls, "the retry must be served from cache, not re-executed")
}

// The same user reusing one key across DIFFERENT routes must not have a
// /payments response replayed for a /subscriptions call.
func TestIdempotency_keyIsScopedPerRoute(t *testing.T) {
	cacheClient := testCacheClient(t)

	key := uniqueKey(t)
	mw := RequireIdempotencyKey(cacheClient)

	var serving string
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"route":"` + serving + `"}`))
	}))

	serving = "payments"
	rec1 := httptest.NewRecorder()
	req1 := withUser(httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil), "alice")
	req1.Header.Set(idempotencyKeyHeader, key)
	handler.ServeHTTP(rec1, req1)
	require.Contains(t, rec1.Body.String(), "payments")

	serving = "subscriptions"
	rec2 := httptest.NewRecorder()
	req2 := withUser(httptest.NewRequest(http.MethodPost, "/api/v1/subscriptions", nil), "alice")
	req2.Header.Set(idempotencyKeyHeader, key)
	handler.ServeHTTP(rec2, req2)

	assert.Contains(t, rec2.Body.String(), "subscriptions",
		"a different route must not replay the previous route's response")
}


// Transient failures must not be sticky. Caching a 5xx under the client's
// Idempotency-Key for 24h traps retries on the error instead of re-attempting
// the mutation once the underlying service recovers.
func TestIdempotency_doesNotCache5xx(t *testing.T) {
	cacheClient := testCacheClient(t)

	key := uniqueKey(t)
	mw := RequireIdempotencyKey(cacheClient)

	callCount := 0
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		if callCount == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"upstream unavailable"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"pay_recovered"}`))
	}))

	// First attempt: transient 500 — must reach the handler and must not stick.
	rec1 := httptest.NewRecorder()
	req1 := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
	req1.Header.Set(idempotencyKeyHeader, key)
	handler.ServeHTTP(rec1, req1)
	require.Equal(t, http.StatusInternalServerError, rec1.Code)
	assert.Empty(t, rec1.Header().Get("X-Idempotency-Replayed"))

	// Retry with the same key: handler must re-execute and succeed.
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
	req2.Header.Set(idempotencyKeyHeader, key)
	handler.ServeHTTP(rec2, req2)
	assert.Equal(t, http.StatusCreated, rec2.Code)
	assert.Contains(t, rec2.Body.String(), "pay_recovered")
	assert.Empty(t, rec2.Header().Get("X-Idempotency-Replayed"))
	assert.Equal(t, 2, callCount, "5xx responses must not be cached for replay")
}

// 429 / 503 are also transient and must not pin the client for the full TTL.
func TestIdempotency_doesNotCache429Or503(t *testing.T) {
	cacheClient := testCacheClient(t)

	for _, status := range []int{http.StatusTooManyRequests, http.StatusServiceUnavailable} {
		status := status
		t.Run(http.StatusText(status), func(t *testing.T) {
			key := uniqueKey(t)
			mw := RequireIdempotencyKey(cacheClient)

			callCount := 0
			handler := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				callCount++
				if callCount == 1 {
					w.WriteHeader(status)
					_, _ = w.Write([]byte(`{"error":"try later"}`))
					return
				}
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(`{"id":"pay_ok"}`))
			}))

			rec1 := httptest.NewRecorder()
			req1 := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
			req1.Header.Set(idempotencyKeyHeader, key)
			handler.ServeHTTP(rec1, req1)
			require.Equal(t, status, rec1.Code)

			rec2 := httptest.NewRecorder()
			req2 := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
			req2.Header.Set(idempotencyKeyHeader, key)
			handler.ServeHTTP(rec2, req2)
			assert.Equal(t, http.StatusCreated, rec2.Code)
			assert.Equal(t, 2, callCount, "status %d must not be cached", status)
		})
	}
}

// Successful 2xx responses remain sticky so true retries do not re-execute.
func TestIdempotency_caches2xxOnly(t *testing.T) {
	cacheClient := testCacheClient(t)

	key := uniqueKey(t)
	mw := RequireIdempotencyKey(cacheClient)

	callCount := 0
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"pay_ok"}`))
	}))

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/payments", nil)
		req.Header.Set(idempotencyKeyHeader, key)
		handler.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
	}
	assert.Equal(t, 1, callCount)
}

func TestIsIdempotencyCacheable(t *testing.T) {
	t.Parallel()
	assert.True(t, isIdempotencyCacheable(200))
	assert.True(t, isIdempotencyCacheable(201))
	assert.True(t, isIdempotencyCacheable(204))
	assert.False(t, isIdempotencyCacheable(400))
	assert.False(t, isIdempotencyCacheable(409))
	assert.False(t, isIdempotencyCacheable(429))
	assert.False(t, isIdempotencyCacheable(500))
	assert.False(t, isIdempotencyCacheable(503))
}
