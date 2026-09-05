package service

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Registered on the default registry; exported by the observability server's
// promhttp handler (cmd/server/observability.go) — same pattern as the user
// and payment services.
var (
	// pushCooldownSkipsTotal counts pushes skipped by the send-ledger
	// cooldown (IOS-SYS.NT.1). class is promotional|transactional; limit is
	// which cap tripped (per_type | class_total | hourly_storm).
	pushCooldownSkipsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "notification_push_cooldown_skips_total",
		Help: "Push dispatches skipped by the per-user send-ledger cooldown.",
	}, []string{"class", "limit"})

	// staleDeviceTokensPrunedTotal counts device-token rows deleted after
	// APNs reported them permanently gone — 410 Unregistered or 400
	// BadDeviceToken (IOS-SYS.NT.4).
	staleDeviceTokensPrunedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "notification_stale_device_tokens_pruned_total",
		Help: "Device tokens deleted after APNs reported them unregistered.",
	})
)
