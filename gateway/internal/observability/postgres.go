package observability

import (
	"context"
	"fmt"
	"strings"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGXTracerOptions returns the house otelpgx configuration.
//
// Deliberate choices:
//   - Query parameters are NOT recorded (otelpgx.WithIncludeQueryParameters is
//     omitted). Arguments carry emails, addresses and Stripe ids; a trace
//     backend is not a PII store.
//   - The SQL statement text IS recorded as db.query.text. Queries are
//     parameterized per CLAUDE.md §5, so the text is a constant per call site
//     and is the only way to attribute a slow span to a query.
//   - Span names use compactSQL rather than otelpgx's default (the entire
//     statement, unbounded) or its trim mode (the first word, so every read in
//     the system collapses to the single name "query SELECT" and attribution is
//     lost again).
//   - Acquire spans are disabled. They double span volume on every request and
//     pool saturation is better read from pgxpool.Stat() than from traces.
func PGXTracerOptions() []otelpgx.Option {
	return []otelpgx.Option{
		otelpgx.WithTrimSQLInSpanName(),
		otelpgx.WithSpanNameFunc(compactSQL),
		otelpgx.WithDisableAcquireTracer(),
	}
}

// maxSpanNameSQL bounds the SQL kept in a span name. Long enough to identify
// the query at a glance in a trace UI, short enough not to bloat every span.
const maxSpanNameSQL = 80

// compactSQL collapses a formatted SQL statement onto one line and truncates
// it, so span names stay readable and bounded without losing which query ran.
func compactSQL(stmt string) string {
	compact := strings.Join(strings.Fields(stmt), " ")
	if len(compact) > maxSpanNameSQL {
		return compact[:maxSpanNameSQL] + "..."
	}
	return compact
}

// NewPGXPool parses connString, attaches the otelpgx tracer so every query,
// batch and copy produces a child span under the caller's span, and opens the
// pool. Without this a trace shows the gRPC hop with nothing inside it and a
// slow request can be seen but never attributed.
//
// The tracer resolves the global TracerProvider lazily, so when
// OTEL_EXPORTER_OTLP_ENDPOINT is unset the spans are no-ops.
func NewPGXPool(ctx context.Context, connString string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("parse pgx pool config: %w", err)
	}
	cfg.ConnConfig.Tracer = otelpgx.NewTracer(PGXTracerOptions()...)

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}
	return pool, nil
}
