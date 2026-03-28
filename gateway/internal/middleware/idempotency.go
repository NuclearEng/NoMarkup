package middleware

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

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
	idempotencyKeyHeader     = "Idempotency-Key"
	idempotencyPrefix        = "idempotency"
	idempotencyTTL           = 24 * time.Hour
	maxIdempotencyCacheSize  = 1 << 20 // 1MB — skip caching responses larger than this
	idempotencyPendingTTL    = 30 * time.Second
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
// When a request arrives with a previously-seen Idempotency-Key, the
// middleware returns the cached response and sets the
// X-Idempotency-Replayed header to "true".
//
// Pass nil for cacheClient to disable caching (the middleware will still
// require the header but will not deduplicate).
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
			redisKey := cache.Key(idempotencyPrefix, key)
			pendingKey := cache.Key(idempotencyPrefix, "pending", key)

			if cacheClient != nil {
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
					slog.Warn("idempotency: failed to claim pending key, proceeding without lock",
						"key", key,
						"error", err,
					)
					// Fall through — better to risk a duplicate than to block.
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

			// Cache the response so subsequent requests with the same key
			// receive an identical reply. Skip caching if the response body
			// exceeds the size limit to avoid bloating Redis.
			if cacheClient != nil {
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

// idempotencyRecorder captures the response status code and body so
// they can be stored in Redis for future replay.
type idempotencyRecorder struct {
	http.ResponseWriter
	statusCode    int
	body          *bytes.Buffer
	wroteHeader   bool
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
