package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

// ExperimentAssignment carries the decided variant for a request.
// Use in handlers: variant := GetExperiment(r.Context(), "new_ranking_v1")
type ExperimentAssignment struct {
	Key     string
	Variant string // e.g. "control", "treatment_a"
	Bucket  uint32 // 0..999 for logging / analysis
}

// experimentCtxKey avoids collisions.
type experimentCtxKey struct{}

// WithExperiment injects deterministic assignment(s) for the request.
// Bucketing is stable per (userID or IP or device) + experiment key using SHA256.
// Percentage is 0-100. When flagKey is non-empty we also respect the feature flag.
func WithExperiment(db *pgxpool.Pool, cacheClient *cache.Client, key string, percent int, flagKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if percent <= 0 {
				next.ServeHTTP(w, r)
				return
			}
			if flagKey != "" && flagDisabled(r.Context(), db, cacheClient, flagKey) {
				next.ServeHTTP(w, r)
				return
			}

			subject := r.Header.Get("X-Device-ID")
			if subject == "" {
				if uid := r.Context().Value("userID"); uid != nil {
					subject = uid.(string)
				}
			}
			if subject == "" {
				subject = r.RemoteAddr
			}

			variant, bucket := assignVariant(subject, key, percent)
			ctx := context.WithValue(r.Context(), experimentCtxKey{}, ExperimentAssignment{
				Key: key, Variant: variant, Bucket: bucket,
			})
			// Log exposure (in real life: write to analytics events table or Kafka).
			slog.Debug("experiment exposure", "key", key, "variant", variant, "bucket", bucket, "subject", subject[:min(8, len(subject))])
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetExperiment returns the assignment (or zero value).
func GetExperiment(ctx context.Context, key string) (ExperimentAssignment, bool) {
	if v := ctx.Value(experimentCtxKey{}); v != nil {
		ea := v.(ExperimentAssignment)
		if ea.Key == key || key == "" {
			return ea, true
		}
	}
	return ExperimentAssignment{}, false
}

// assignVariant returns variant + bucket (0-999) using stable hash.
func assignVariant(subject, key string, percent int) (string, uint32) {
	h := sha256.Sum256([]byte(subject + "|" + key))
	bucket := binary.BigEndian.Uint32(h[:4]) % 1000
	if int(bucket) < percent*10 { // percent*10 because bucket is 0-999
		return "treatment", bucket
	}
	return "control", bucket
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Example wiring (in router):
// r.With(middleware.WithExperiment(db, cache, "trust_boost_2026q2", 10, "trust_ranking"))...
// Then in a handler:
// if ea, ok := middleware.GetExperiment(r.Context(), "trust_boost_2026q2"); ok && ea.Variant == "treatment" { ... }
