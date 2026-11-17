package service

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Search reindex durability metrics (ARC-16). Search is fail-soft (not money),
// but silent drop after Meilisearch blips made the catalog drift from Postgres
// with no pageable signal. These counters register on the default Prometheus
// registry scraped by the job-service observability server (/metrics).
//
// Labels stay low-cardinality: index ∈ {jobs,listings}, op ∈ {index,remove},
// reason ∈ closed sets below.
var (
	searchRetryEnqueuedTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "search_retry_enqueued_total",
			Help: "Search index/remove tasks escalated to the durable Postgres retry outbox (search_retry_outbox) after in-process retries exhausted.",
		},
		[]string{"index", "op"},
	)

	searchRetryEnqueueFailedTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "search_retry_enqueue_failed_total",
			Help: "Durable enqueue/reschedule writes that failed (database error) or were skipped (no queue). Task may be lost until the next lifecycle event or full rebuild.",
		},
		[]string{"index", "op", "reason"},
	)

	searchRetryProcessedTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "search_retry_processed_total",
			Help: "Durable search retry outcomes after a worker claim.",
		},
		[]string{"index", "op", "result"},
	)

	searchRetryDeadLetterTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "search_retry_dead_letter_total",
			Help: "Search retry tasks abandoned after max durable attempts. Page-worthy: entity missing from search until manual reindex.",
		},
		[]string{"index", "op"},
	)

	searchRetryQueueDepth = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "search_retry_queue_depth",
			Help: "Current number of pending (not dead-lettered) search retry tasks in search_retry_outbox (updated each worker tick).",
		},
	)
)

// Closed label values for search_retry_enqueue_failed_total reason=.
const (
	searchRetryReasonNoQueue = "no_queue"
	searchRetryReasonDBErr   = "db_error"
)

// Closed label values for search_retry_processed_total result=.
const (
	searchRetryResultSuccess    = "success"
	searchRetryResultReschedule = "reschedule"
	searchRetryResultDeadLetter = "dead_letter"
	searchRetryResultSkip       = "skip" // entity gone / no longer indexable
)
