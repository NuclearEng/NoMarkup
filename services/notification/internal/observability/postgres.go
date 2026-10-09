package observability

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

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

// --- Pool sizing and per-connection timeouts (RES-02) ---
//
// pgxpool's defaults are max(4, runtime.NumCPU()) connections with NO minimum,
// NO maximum lifetime, NO idle timeout and NO statement/lock timeouts. Two
// separate failure modes follow from that:
//
//  1. Connection exhaustion. On a 16-core node every pool defaults to 16.
//  2. Unbounded query lifetime. With no statement_timeout the server never
//     cancels a hung query, so its connection is pinned forever and
//     pool.Acquire blocks indefinitely instead of returning an error — the
//     service degrades into a hang rather than into a 5xx an operator can see.
//
// SIZING ARITHMETIC — re-derive this if replica counts or Postgres sizing
// change; the numbers are the whole justification for the defaults below.
//
//	Stock PostgreSQL 16 ships max_connections = 100. Subtract
//	superuser_reserved_connections (3) plus operator, migration and backup
//	sessions (~7) => ~90 usable on the primary.
//
//	Pools against the PRIMARY (replica counts from deploy/k8s/base/*/deployment.yaml):
//	  gateway write pool      3 replicas x 1 pool =  3
//	  user                    2 x 1               =  2
//	  job                     2 x 1               =  2
//	  payment                 2 x 1               =  2
//	  chat                    2 x 1               =  2
//	  notification            2 x 1               =  2
//	                                        total = 13 pools
//	  13 pools x defaultMaxConns(6)               = 78  <= 90  OK
//	  (at the pgx default of 16 on a 16-core node this would be 208 — the
//	  defect: connections start being refused at ~2 replicas per service.)
//
//	Pools against the READ REPLICA:
//	  gateway read pool       3 x 1 pool x 6      = 18
//
//	NOT included: the Rust engines (bidding, fraud, trust) each hardcode
//	sqlx .max_connections(20); at 2 replicas that is 120 more against the same
//	primary. The Go tier alone now fits stock Postgres, the full mesh does not.
//	Production must raise max_connections to >= 300 or front the primary with a
//	pooler — engines/ is out of scope for this change and is tracked separately.
//
// Raising DB_MAX_CONNS therefore REQUIRES raising the server's
// max_connections by (delta x 13) for the primary.
const (
	// defaultMaxConns is per pool, per pod. See the arithmetic above.
	defaultMaxConns = 6
	// defaultMinConns keeps one warm connection so a cold pod does not pay TCP
	// + TLS + auth on its first request, without holding idle capacity that
	// other pods need.
	defaultMinConns = 1
	// defaultMaxConnLifetime recycles connections so a long-lived pod does not
	// pin a backend that has accumulated cache/temp-table bloat, and so a
	// failed-over primary is picked up without a restart.
	defaultMaxConnLifetime = 30 * time.Minute
	// defaultMaxConnLifetimeJitter spreads recycling out; without it every
	// connection opened at pod start expires in the same second.
	defaultMaxConnLifetimeJitter = 5 * time.Minute
	// defaultMaxConnIdleTime returns capacity to the server after a traffic
	// trough instead of holding the high-water mark until the pod restarts.
	defaultMaxConnIdleTime = 5 * time.Minute
	// defaultHealthCheckPeriod is how often idle connections are probed, so a
	// connection killed server-side is discovered by the pool and not by a
	// request.
	defaultHealthCheckPeriod = 30 * time.Second

	// defaultStatementTimeout bounds a single statement server-side. CLAUDE.md
	// §8 budgets DB query p95 < 20ms, so 10s is ~500x the budget: it never
	// trips on a merely-slow query, and it guarantees a pathological one
	// releases its connection instead of pinning it for the life of the pod.
	defaultStatementTimeout = 10 * time.Second
	// defaultLockTimeout is deliberately much tighter than the statement
	// timeout: waiting on a row lock is a queue, and a queue on a money table
	// under contention is how one slow writer becomes a stalled pool.
	defaultLockTimeout = 3 * time.Second
	// defaultIdleInTxTimeout kills a session left idle inside a transaction —
	// the failure mode where a leaked BEGIN holds its locks (and its
	// connection) until the pod is restarted.
	defaultIdleInTxTimeout = 30 * time.Second
)

// PoolSettings is the resilience configuration applied to every pgx pool.
// A zero-valued duration disables the corresponding server-side timeout.
type PoolSettings struct {
	MaxConns              int32
	MinConns              int32
	MaxConnLifetime       time.Duration
	MaxConnLifetimeJitter time.Duration
	MaxConnIdleTime       time.Duration
	HealthCheckPeriod     time.Duration

	// StatementTimeout, LockTimeout and IdleInTxTimeout are sent as
	// server-side GUCs in the connection's startup packet, so they apply to
	// every query on the connection without touching a single call site.
	StatementTimeout time.Duration
	LockTimeout      time.Duration
	IdleInTxTimeout  time.Duration
}

// DefaultPoolSettings returns the service defaults, each overridable by env so
// a differently-sized deployment can be tuned without a rebuild.
func DefaultPoolSettings() PoolSettings {
	return PoolSettings{
		MaxConns:              int32(envInt("DB_MAX_CONNS", defaultMaxConns)),
		MinConns:              int32(envInt("DB_MIN_CONNS", defaultMinConns)),
		MaxConnLifetime:       envDuration("DB_MAX_CONN_LIFETIME", defaultMaxConnLifetime),
		MaxConnLifetimeJitter: envDuration("DB_MAX_CONN_LIFETIME_JITTER", defaultMaxConnLifetimeJitter),
		MaxConnIdleTime:       envDuration("DB_MAX_CONN_IDLE_TIME", defaultMaxConnIdleTime),
		HealthCheckPeriod:     envDuration("DB_HEALTH_CHECK_PERIOD", defaultHealthCheckPeriod),
		StatementTimeout:      envDuration("DB_STATEMENT_TIMEOUT", defaultStatementTimeout),
		LockTimeout:           envDuration("DB_LOCK_TIMEOUT", defaultLockTimeout),
		IdleInTxTimeout:       envDuration("DB_IDLE_IN_TX_TIMEOUT", defaultIdleInTxTimeout),
	}
}

// BatchPoolSettings returns settings for offline/batch commands (reindex,
// backfills). Statement timeout is disabled because a full-table scan
// legitimately exceeds the request-path budget; the caller's context deadline
// is the bound instead. Pool size is small: batch tools run one at a time and
// must not eat the request tier's connection budget.
func BatchPoolSettings() PoolSettings {
	s := DefaultPoolSettings()
	s.MaxConns = int32(envInt("DB_MAX_CONNS", 4))
	s.MinConns = 0
	s.StatementTimeout = envDuration("DB_STATEMENT_TIMEOUT", 0)
	s.IdleInTxTimeout = envDuration("DB_IDLE_IN_TX_TIMEOUT", 0)
	return s
}

// apply writes the settings onto a parsed pool config.
//
// Values explicitly present in the connection string always win: an operator
// who pinned pool_max_conns or statement_timeout in DATABASE_URL meant it.
func (s PoolSettings) apply(cfg *pgxpool.Config, connString string) {
	if !dsnHasPoolParam(connString) {
		cfg.MaxConns = s.MaxConns
		cfg.MinConns = s.MinConns
		cfg.MaxConnLifetime = s.MaxConnLifetime
		cfg.MaxConnLifetimeJitter = s.MaxConnLifetimeJitter
		cfg.MaxConnIdleTime = s.MaxConnIdleTime
		cfg.HealthCheckPeriod = s.HealthCheckPeriod
	}

	if cfg.ConnConfig.RuntimeParams == nil {
		cfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	setRuntimeParam(cfg.ConnConfig.RuntimeParams, "statement_timeout", s.StatementTimeout)
	setRuntimeParam(cfg.ConnConfig.RuntimeParams, "lock_timeout", s.LockTimeout)
	setRuntimeParam(cfg.ConnConfig.RuntimeParams, "idle_in_transaction_session_timeout", s.IdleInTxTimeout)
}

// setRuntimeParam sets a PostgreSQL timeout GUC (bare integers are
// milliseconds) unless the connection string already specified it. A
// non-positive duration means "leave the server default alone".
func setRuntimeParam(params map[string]string, name string, d time.Duration) {
	if _, alreadySet := params[name]; alreadySet {
		return
	}
	if d <= 0 {
		return
	}
	params[name] = strconv.FormatInt(d.Milliseconds(), 10)
}

// dsnHasPoolParam reports whether the connection string carries any pgxpool
// sizing parameter, in which case the DSN is treated as authoritative.
func dsnHasPoolParam(connString string) bool {
	for _, p := range []string{
		"pool_max_conns", "pool_min_conns", "pool_max_conn_lifetime",
		"pool_max_conn_idle_time", "pool_health_check_period",
	} {
		if strings.Contains(connString, p) {
			return true
		}
	}
	return false
}

func envInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 0 {
		slog.Warn("invalid integer env var, using default", "env", key, "value", raw, "default", fallback)
		return fallback
	}
	return v
}

func envDuration(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		slog.Warn("invalid duration env var, using default", "env", key, "value", raw, "default", fallback)
		return fallback
	}
	return d
}

// NewPGXPool parses connString, attaches the otelpgx tracer so every query,
// batch and copy produces a child span under the caller's span, applies the
// RES-02 pool sizing and timeouts, and opens the pool. Without the tracer a
// trace shows the gRPC hop with nothing inside it and a slow request can be
// seen but never attributed; without the sizing the pool is unbounded in every
// dimension that matters under load.
//
// The tracer resolves the global TracerProvider lazily, so when
// OTEL_EXPORTER_OTLP_ENDPOINT is unset the spans are no-ops.
func NewPGXPool(ctx context.Context, connString string) (*pgxpool.Pool, error) {
	return NewPGXPoolWithSettings(ctx, connString, DefaultPoolSettings())
}

// NewPGXPoolWithSettings is NewPGXPool with explicit sizing — used by batch
// commands whose query profile does not fit the request-path budgets.
func NewPGXPoolWithSettings(ctx context.Context, connString string, settings PoolSettings) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("parse pgx pool config: %w", err)
	}
	cfg.ConnConfig.Tracer = otelpgx.NewTracer(PGXTracerOptions()...)
	settings.apply(cfg, connString)

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}

	slog.Info("pgx pool initialized",
		"max_conns", cfg.MaxConns,
		"min_conns", cfg.MinConns,
		"max_conn_lifetime", cfg.MaxConnLifetime,
		"max_conn_idle_time", cfg.MaxConnIdleTime,
		"statement_timeout", cfg.ConnConfig.RuntimeParams["statement_timeout"],
		"lock_timeout", cfg.ConnConfig.RuntimeParams["lock_timeout"],
		"idle_in_transaction_session_timeout", cfg.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"],
	)

	return pool, nil
}
