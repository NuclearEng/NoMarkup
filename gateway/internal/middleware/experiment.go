package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
)

// ExperimentAssignment carries the decided variant for a request.
// Use in handlers: variant := GetExperiment(r.Context(), "new_ranking_v1")
//
// ARC-10: this is the multi-variant / handler-level companion to
// feature_flags.rollout_percent on RequireFlag. Prefer RequireFlag +
// rollout_percent for kill-switch + sticky % gates; use WithExperiment when a
// handler needs control vs treatment without 503'ing the control cohort.
type ExperimentAssignment struct {
	Key     string
	Variant string // e.g. "control", "treatment"
	Bucket  uint32 // 0..999 for logging / analysis
}

// experimentCtxKey avoids collisions.
type experimentCtxKey struct{}

// experimentExposuresTotal counts deterministic assignments (ARC-10 exposure).
// Labels stay low-cardinality: experiment key + variant only.
var experimentExposuresTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "experiment_exposures_total",
		Help: "Deterministic experiment assignments (ARC-10 exposure foundation).",
	},
	[]string{"key", "variant"},
)

// WithExperiment injects deterministic assignment(s) for the request.
// Bucketing is stable per (userID or device) + experiment key using SHA256.
// Percentage is 0-100. When flagKey is non-empty we also respect the feature flag
// (binary + rollout rules via flagDisabled).
func WithExperiment(db *pgxpool.Pool, cacheClient *cache.Client, key string, percent int, flagKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if percent <= 0 {
				next.ServeHTTP(w, r)
				return
			}
			if flagKey != "" && flagDisabled(r.Context(), db, cacheClient, flagKey, experimentSubject(r)) {
				next.ServeHTTP(w, r)
				return
			}

			subject := experimentSubject(r)
			if subject == "" {
				// No sticky identity — skip assignment rather than bucket everyone
				// into the empty-string cohort.
				next.ServeHTTP(w, r)
				return
			}

			variant, bucket := assignVariant(subject, key, percent)
			ctx := context.WithValue(r.Context(), experimentCtxKey{}, ExperimentAssignment{
				Key: key, Variant: variant, Bucket: bucket,
			})
			experimentExposuresTotal.WithLabelValues(key, variant).Inc()
			slog.Debug("experiment exposure",
				"key", key,
				"variant", variant,
				"bucket", bucket,
				"subject_prefix", subject[:min(8, len(subject))],
			)
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

// experimentSubject prefers authenticated user ID, then X-Device-ID.
func experimentSubject(r *http.Request) string {
	if claims, ok := GetClaims(r.Context()); ok && claims != nil && claims.UserID != "" {
		return claims.UserID
	}
	if dev := r.Header.Get("X-Device-ID"); dev != "" {
		return dev
	}
	return ""
}

// assignVariant returns variant + bucket (0-999) using stable hash.
// percent is 0-100; treatment when bucket < percent*10.
func assignVariant(subject, key string, percent int) (string, uint32) {
	h := sha256.Sum256([]byte(subject + "|" + key))
	bucket := binary.BigEndian.Uint32(h[:4]) % 1000
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
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
