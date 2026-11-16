package middleware

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

// idempotencyStoreUnavailable counts money mutations refused because the
// idempotency store could not be reached. This should be flat at zero; any
// non-zero rate means customers are being told to retry payments, which is a
// page-worthy condition rather than a log line.
var idempotencyStoreUnavailable = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "idempotency_store_unavailable_total",
		Help: "Money mutations refused because the idempotency store was unreachable.",
	},
	[]string{"path"},
)

// writeIdempotencyError emits a JSON error with the shape the rest of the API
// uses, so a client parsing errors does not need a special case here.
func writeIdempotencyError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write([]byte(`{"error":"` + msg + `"}`))
}

// Wiring instructions for router.go:
//
//   idempotencyMW := middleware.RequireIdempotencyKey(cacheClient)
//
//   r.Route("/api/v1", func(r chi.Router) {
//       r.Use(authMW.Handler)
//
//       // Payment routes — idempotency required on mutations
//       r.Route("/payments", func(r chi.Router) {
//           r.Use(idempotencyMW)
//           // ... existing payment routes
//       })
//   })
//
// The middleware also covers POST/PUT to Stripe-related provider routes
// (e.g. /providers/me/stripe/account). To apply there, wrap individual
// handlers or add the middleware to the relevant sub-router.

const (
	idempotencyKeyHeader    = "Idempotency-Key"
	idempotencyPrefix       = "idempotency"
	idempotencyTTL          = 24 * time.Hour
	maxIdempotencyCacheSize = 1 << 20 // 1MB — skip caching responses larger than this
	idempotencyPendingTTL   = 30 * time.Second
)

// cachedResponse is the JSON structure persisted in Redis for replayed responses.
type cachedResponse struct {
	StatusCode int               `json:"status_code"`
	Body       string            `json:"body"`
	Headers    map[string]string `json:"headers"`
}

// RequireIdempotencyKey returns middleware that enforces idempotency on
// POST and PUT requests. GET, DELETE, and other methods pass through
// without requiring the header.
//
// When a request arrives with a previously-seen Idempotency-Key that
// produced a successful (2xx) response, the middleware returns the cached
// response and sets the X-Idempotency-Replayed header to "true". Non-2xx
// outcomes (including 5xx and 429) are not persisted so retries with the
// same key can re-attempt after a transient failure.
//
// Pass nil for cacheClient to refuse money mutations (fail closed) rather
// than silently drop the idempotency guarantee.
func RequireIdempotencyKey(cacheClient *cache.Client) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Only enforce on POST and PUT — safe methods pass through.
			if r.Method != http.MethodPost && r.Method != http.MethodPut {
				next.ServeHTTP(w, r)
				return
			}

			key := r.Header.Get(idempotencyKeyHeader)
			if key == "" {
				http.Error(w, `{"error":"Idempotency-Key header is required for payment mutations"}`, http.StatusBadRequest)
				return
			}

			ctx := r.Context()

			// Scope the cache key to the CALLER and the ROUTE.
			//
			// Previously the key was the client-supplied Idempotency-Key alone,
			// so the namespace was global: the full cached response body was
			// replayed for 24h to whoever presented the same key next, across
			// users and across routes. POST /api/v1/payments returns a Stripe
			// client_secret, so a collision handed one user a live PaymentIntent
			// secret belonging to another. The first-party web client uses
			// crypto.randomUUID(), but the API is public and any third-party or
			// curl client picks its own key — low-entropy keys collide.
			//
			// Scoping by subject makes a cross-user collision impossible rather
			// than improbable. Scoping by route stops the same key replaying a
			// /payments response to a /subscriptions call. Unauthenticated
			// callers fall back to a fixed marker so behaviour is unchanged for
			// any route that does not require auth.
			scope := "anon"
			if claims, ok := GetClaims(ctx); ok && claims.UserID != "" {
				scope = claims.UserID
			}
			route := r.Method + " " + normalizePath(r.URL.Path)

			redisKey := cache.Key(idempotencyPrefix, scope, route, key)
			pendingKey := cache.Key(idempotencyPrefix, "pending", scope, route, key)

			// No store at all means no deduplication whatsoever — the header
			// is demanded and then ignored, which is worse than not requiring
			// it, because the client is told the call is idempotent when it is
			// not. Same reasoning as the store-error branch below: refuse the
			// money mutation rather than silently drop the guarantee.
			if cacheClient == nil {
				slog.ErrorContext(ctx, "idempotency store not configured; refusing money mutation",
					"path", r.URL.Path,
				)
				idempotencyStoreUnavailable.WithLabelValues(normalizePath(r.URL.Path)).Inc()
				w.Header().Set("Retry-After", "5")
				writeIdempotencyError(w, http.StatusServiceUnavailable,
					"payment safety checks are temporarily unavailable, please retry in a moment")
				return
			}

			{
				// 1. Check for a completed (cached) response first.
				var resp cachedResponse
				if cacheClient.GetJSON(ctx, redisKey, &resp) {
					replayCachedResponse(w, resp, key)
					return
				}

				// 2. Claim the key with SET NX to prevent concurrent duplicate
				// execution. If another request already claimed this key, it is
				// currently executing the handler. Return 409 so the client
				// retries after a short delay.
				//
				// NOTE: There is a small window between the GET above and this
				// SET NX where a concurrent request could complete and cache its
				// result. In that (rare) case the SET NX still succeeds because
				// the pending key is distinct from the result key — the second
				// request will simply execute and overwrite the cached result
				// with an identical value. This is safe for idempotent handlers.
				claimed, err := cacheClient.Redis().SetNX(ctx, pendingKey, "processing", idempotencyPendingTTL).Result()
				if err != nil {
					// FAIL CLOSED. This middleware guards money mutations, and
					// its entire purpose is to stop a retry becoming a second
					// charge. If the store backing that guarantee is
					// unreachable, we cannot make the guarantee — and the old
					// behaviour ("better to risk a duplicate than to block")
					// traded a customer being charged twice for a moment of
					// availability. That is the wrong side of the trade on a
					// payment path: 503 tells the client to retry, and a retry
					// is safe; a duplicate charge is not, and is discovered by
					// the customer rather than by us.
					//
					// This is deliberately narrow. It only fires on routes that
					// already REQUIRE an Idempotency-Key — i.e. money mutations
					// the caller has been told are idempotent. Reads and
					// unguarded routes are unaffected.
					slog.ErrorContext(ctx, "idempotency store unavailable; refusing money mutation rather than risking a duplicate",
						"path", r.URL.Path,
						"error", err,
					)
					idempotencyStoreUnavailable.WithLabelValues(normalizePath(r.URL.Path)).Inc()
					w.Header().Set("Retry-After", "2")
					writeIdempotencyError(w, http.StatusServiceUnavailable,
						"payment safety checks are temporarily unavailable, please retry in a moment")
					return
				} else if !claimed {
					// Another request is currently processing this key.
					// Check once more if the result was cached in the
					// meantime (the first request may have finished).
					if cacheClient.GetJSON(ctx, redisKey, &resp) {
						replayCachedResponse(w, resp, key)
						return
					}
					http.Error(w, `{"error":"A request with this Idempotency-Key is already being processed. Please retry."}`, http.StatusConflict)
					return
				}

				// We successfully claimed the key. Ensure the pending marker
				// is cleaned up when we're done, regardless of outcome.
				defer cacheClient.Delete(ctx, pendingKey)
			}

			// Proceed with the handler and capture the response.
			recorder := &idempotencyRecorder{
				ResponseWriter: w,
				statusCode:     http.StatusOK,
				body:           &bytes.Buffer{},
			}
			next.ServeHTTP(recorder, r)

			// Cache ONLY successful (2xx) responses for replay. Caching 5xx
			// (or 429) under a sticky Idempotency-Key traps clients on a
			// transient failure for the full TTL — a retry with the same key
			// would re-serve the error instead of re-attempting the mutation.
			// 4xx validation failures are also left uncached so callers can
			// fix the request body and retry with the same key.
			// Skip caching if the response body exceeds the size limit to
			// avoid bloating Redis.
			if cacheClient != nil && isIdempotencyCacheable(recorder.statusCode) {
				if recorder.body.Len() <= maxIdempotencyCacheSize {
					resp := cachedResponse{
						StatusCode: recorder.statusCode,
						Body:       recorder.body.String(),
						Headers: map[string]string{
							"Content-Type": recorder.Header().Get("Content-Type"),
						},
					}
					cacheClient.SetJSON(ctx, redisKey, resp, idempotencyTTL)
				} else {
					slog.Warn("idempotency: response too large to cache",
						"key", key,
						"size", recorder.body.Len(),
					)
				}
			}
		})
	}
}

// replayCachedResponse writes a previously cached response back to the
// client and sets the X-Idempotency-Replayed header.
func replayCachedResponse(w http.ResponseWriter, resp cachedResponse, key string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Idempotency-Replayed", "true")
	for k, v := range resp.Headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(resp.StatusCode)
	if _, err := io.WriteString(w, resp.Body); err != nil {
		slog.Warn("idempotency: failed to write replayed response",
			"key", key,
			"error", err,
		)
	}
}

// isIdempotencyCacheable reports whether a response status should be
// persisted for Idempotency-Key replay. Only 2xx successes are sticky —
// 5xx/429 and other non-success codes must remain retriable with the
// same key.
func isIdempotencyCacheable(statusCode int) bool {
	return statusCode >= 200 && statusCode < 300
}

// idempotencyRecorder captures the response status code and body so
// they can be stored in Redis for future replay.
type idempotencyRecorder struct {
	http.ResponseWriter
	statusCode  int
	body        *bytes.Buffer
	wroteHeader bool
}

func (r *idempotencyRecorder) WriteHeader(code int) {
	if !r.wroteHeader {
		r.statusCode = code
		r.wroteHeader = true
		r.ResponseWriter.WriteHeader(code)
	}
}

func (r *idempotencyRecorder) Write(b []byte) (int, error) {
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}
