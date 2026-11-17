package observability

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

// --- Pool sizing and session timeouts (RES-02) ---
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
//
// WHERE THE TIMEOUTS COME FROM — read this before "fixing" a missing timeout.
//
//	statement_timeout, lock_timeout and idle_in_transaction_session_timeout are
//	ROLE-LEVEL DEFAULTS on the application role, set by migration 137
//	(ALTER ROLE ... IN DATABASE ... SET). Request-path pools do NOT send them.
//
//	They used to travel in the connection startup packet. PgBouncer refuses
//	any startup parameter it does not track ("FATAL: unsupported startup
//	parameter: lock_timeout", SQLSTATE 08P01), so behind a pooler no Go
//	service could open a connection; and once the pooler was told to ignore
//	them they never reached Postgres at all, which silently dropped
//	lock_timeout (PgBouncer has no equivalent).
//
//	Setting them with SET after connect is not an option either: production
//	pools in TRANSACTION mode (docs/operations/scaling-blockers.md), where a
//	session-level SET lands on whichever server connection ran that one
//	statement, is not there for the next transaction, and leaks to the next
//	client that is handed the same server connection. A role default is
//	applied by Postgres itself to every server connection the pooler opens,
//	so it holds in every pool mode and with no pooler at all.
//
//	Every new pool therefore VERIFIES what the server actually enforces and
//	logs an error naming the fix when a bound is missing (reportSessionTimeouts).
//	Runbook: docs/operations/pgbouncer.md.
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

	// StatementTimeout, LockTimeout and IdleInTxTimeout are the bounds this
	// pool EXPECTS the server to enforce. By default they are not sent: the
	// role-level defaults from migration 137 supply them, and the pool checks
	// the server's effective values against these on its first connection.
	StatementTimeout time.Duration
	LockTimeout      time.Duration
	IdleInTxTimeout  time.Duration

	// TimeoutsInStartupPacket sends the three timeouts as startup parameters
	// instead of relying on the role defaults, zero included (zero disables
	// the server default). Only correct on a DIRECT Postgres connection: a
	// pooler either refuses the connection (08P01) or silently ignores the
	// values. Batch tools set it because they must override the role default;
	// DB_TIMEOUTS_IN_STARTUP_PACKET=true opts a request-path pool in for a
	// deployment that has no pooler and cannot set role defaults.
	TimeoutsInStartupPacket bool
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

		TimeoutsInStartupPacket: envBool("DB_TIMEOUTS_IN_STARTUP_PACKET", false),
	}
}

// BatchPoolSettings returns settings for offline/batch commands (reindex,
// backfills). Statement timeout is disabled because a full-table scan
// legitimately exceeds the request-path budget; the caller's context deadline
// is the bound instead. Pool size is small: batch tools run one at a time and
// must not eat the request tier's connection budget.
//
// The role default would otherwise cut a batch statement at 10s, so batch
// pools send their timeouts in the startup packet — which means a batch tool
// must be pointed at Postgres directly, never at the pooler.
func BatchPoolSettings() PoolSettings {
	s := DefaultPoolSettings()
	s.MaxConns = int32(envInt("DB_MAX_CONNS", 4))
	s.MinConns = 0
	s.StatementTimeout = envDuration("DB_STATEMENT_TIMEOUT", 0)
	s.IdleInTxTimeout = envDuration("DB_IDLE_IN_TX_TIMEOUT", 0)
	s.TimeoutsInStartupPacket = true
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

	if !s.TimeoutsInStartupPacket {
		return
	}
	if cfg.ConnConfig.RuntimeParams == nil {
		cfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	setRuntimeParam(cfg.ConnConfig.RuntimeParams, gucStatementTimeout, s.StatementTimeout)
	setRuntimeParam(cfg.ConnConfig.RuntimeParams, gucLockTimeout, s.LockTimeout)
	setRuntimeParam(cfg.ConnConfig.RuntimeParams, gucIdleInTxTimeout, s.IdleInTxTimeout)
}

const (
	gucStatementTimeout = "statement_timeout"
	gucLockTimeout      = "lock_timeout"
	gucIdleInTxTimeout  = "idle_in_transaction_session_timeout"
)

// setRuntimeParam sets a PostgreSQL timeout GUC (bare integers are
// milliseconds) unless the connection string already specified it. Zero is
// sent as 0, which disables the timeout and overrides the role default.
func setRuntimeParam(params map[string]string, name string, d time.Duration) {
	if _, alreadySet := params[name]; alreadySet {
		return
	}
	if d < 0 {
		d = 0
	}
	params[name] = strconv.FormatInt(d.Milliseconds(), 10)
}

// sessionTimeouts are the values the server reports for one session.
type sessionTimeouts struct {
	Statement time.Duration
	Lock      time.Duration
	IdleInTx  time.Duration
}

// timeoutFinding is one disagreement between what a pool expects and what the
// server enforces.
type timeoutFinding struct {
	Name      string
	Want      time.Duration
	Got       time.Duration
	Unbounded bool // the pool expects a bound and the server enforces none
}

// compareSessionTimeouts lists every timeout the server enforces more loosely
// than the pool expects. A server that is stricter than expected is not a
// finding for a bounded pool; for a pool that asked for no timeout (batch) any
// server-side bound is one, because it will cut the batch statement.
func compareSessionTimeouts(want PoolSettings, got sessionTimeouts) []timeoutFinding {
	var findings []timeoutFinding
	check := func(name string, want, got time.Duration) {
		switch {
		case want > 0 && got == 0:
			findings = append(findings, timeoutFinding{Name: name, Want: want, Got: got, Unbounded: true})
		case want > 0 && got > want, want == 0 && got > 0:
			findings = append(findings, timeoutFinding{Name: name, Want: want, Got: got})
		}
	}
	check(gucStatementTimeout, want.StatementTimeout, got.Statement)
	check(gucLockTimeout, want.LockTimeout, got.Lock)
	check(gucIdleInTxTimeout, want.IdleInTxTimeout, got.IdleInTx)
	return findings
}

// readSessionTimeouts asks the server what this session enforces. pg_settings
// reports all three in milliseconds. The simple protocol keeps the check free
// of prepared statements, so it behaves the same through any pooler.
func readSessionTimeouts(ctx context.Context, conn *pgx.Conn) (sessionTimeouts, error) {
	rows, err := conn.Query(ctx,
		"SELECT name, setting FROM pg_settings WHERE name IN ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')",
		pgx.QueryExecModeSimpleProtocol)
	if err != nil {
		return sessionTimeouts{}, fmt.Errorf("read session timeouts: %w", err)
	}
	defer rows.Close()

	var got sessionTimeouts
	seen := 0
	for rows.Next() {
		var name, setting string
		if err := rows.Scan(&name, &setting); err != nil {
			return sessionTimeouts{}, fmt.Errorf("scan session timeout: %w", err)
		}
		ms, err := strconv.ParseInt(setting, 10, 64)
		if err != nil {
			return sessionTimeouts{}, fmt.Errorf("parse %s=%q: %w", name, setting, err)
		}
		d := time.Duration(ms) * time.Millisecond
		switch name {
		case gucStatementTimeout:
			got.Statement = d
		case gucLockTimeout:
			got.Lock = d
		case gucIdleInTxTimeout:
			got.IdleInTx = d
		}
		seen++
	}
	if err := rows.Err(); err != nil {
		return sessionTimeouts{}, fmt.Errorf("read session timeouts: %w", err)
	}
	if seen != 3 {
		return sessionTimeouts{}, fmt.Errorf("read session timeouts: got %d of 3 settings", seen)
	}
	return got, nil
}

// reportSessionTimeouts logs what the server enforces on a pool's connections
// and, when a bound the pool expects is missing or looser, an error that names
// the cause and the fix. It never fails the connection: an unbounded query is
// a risk, a service that cannot start is an outage.
func reportSessionTimeouts(want PoolSettings, got sessionTimeouts) {
	attrs := []any{
		"statement_timeout", got.Statement.String(),
		"lock_timeout", got.Lock.String(),
		"idle_in_transaction_session_timeout", got.IdleInTx.String(),
	}
	findings := compareSessionTimeouts(want, got)
	if len(findings) == 0 {
		slog.Info("postgres session timeouts in effect", attrs...)
		return
	}
	for _, f := range findings {
		switch {
		case f.Unbounded:
			slog.Error("postgres session timeout is NOT in effect: a hung query or lock wait can pin this pool's connections",
				"setting", f.Name, "expected", f.Want.String(), "effective", "0 (disabled)",
				"cause", "the role-level default is missing for the role in DATABASE_URL",
				"fix", "apply migration 137, or run: ALTER ROLE <app role> IN DATABASE <db> SET "+f.Name+" = '"+f.Want.String()+"'",
				"runbook", "docs/operations/pgbouncer.md")
		case f.Want == 0:
			slog.Error("postgres session timeout will cut this batch pool's statements",
				"setting", f.Name, "expected", "0 (disabled)", "effective", f.Got.String(),
				"cause", "the startup parameter did not reach Postgres; a pooler ignores it",
				"fix", "point this command at Postgres directly, not at the pooler",
				"runbook", "docs/operations/pgbouncer.md")
		default:
			slog.Warn("postgres session timeout is looser than this service expects",
				"setting", f.Name, "expected", f.Want.String(), "effective", f.Got.String(),
				"cause", "the role-level default wins; DB_*_TIMEOUT only takes effect with DB_TIMEOUTS_IN_STARTUP_PACKET=true on a direct connection",
				"runbook", "docs/operations/pgbouncer.md")
		}
	}
}

// ErrStartupParameterRejected is returned when a pooler refuses the
// connection because of a startup parameter it does not track.
var ErrStartupParameterRejected = errors.New("pooler rejected a connection startup parameter")

// explainConnectError turns PgBouncer's "unsupported startup parameter"
// refusal into an error that says what happened and how to fix it. Any other
// error is returned unchanged.
func explainConnectError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	if pgErr.Code != "08P01" || !strings.Contains(pgErr.Message, "unsupported startup parameter") {
		return err
	}
	return fmt.Errorf("%w (%s): PgBouncer refuses startup parameters it does not track. "+
		"Remove the parameter from DATABASE_URL and unset DB_TIMEOUTS_IN_STARTUP_PACKET "+
		"(timeouts come from role defaults, migration 137), point batch commands at Postgres directly, "+
		"or list the parameter in the pooler's ignore_startup_parameters — see docs/operations/pgbouncer.md: %w",
		ErrStartupParameterRejected, pgErr.Message, err)
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

func envBool(key string, fallback bool) bool {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		slog.Warn("invalid boolean env var, using default", "env", key, "value", raw, "default", fallback)
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
// RES-02 pool sizing, and opens the pool. Session timeouts come from the role
// defaults (see the comment above the defaults); the pool verifies them on its
// first connection and logs the result. Without the tracer a
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

	// Check what the server enforces on the first connection that answers.
	// A failed check is retried on the next new connection and never fails
	// the connection itself.
	var verified atomic.Bool
	prevAfterConnect := cfg.AfterConnect
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		if prevAfterConnect != nil {
			if err := prevAfterConnect(ctx, conn); err != nil {
				return err
			}
		}
		if verified.Load() {
			return nil
		}
		got, err := readSessionTimeouts(ctx, conn)
		if err != nil {
			slog.Warn("could not verify postgres session timeouts; will retry on the next connection", "error", err)
			return nil
		}
		if verified.CompareAndSwap(false, true) {
			reportSessionTimeouts(settings, got)
		}
		return nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}

	slog.Info("pgx pool initialized",
		"max_conns", cfg.MaxConns,
		"min_conns", cfg.MinConns,
		"max_conn_lifetime", cfg.MaxConnLifetime,
		"max_conn_idle_time", cfg.MaxConnIdleTime,
		"timeouts_in_startup_packet", settings.TimeoutsInStartupPacket,
	)

	// One probe, so a pooler that refuses the startup packet is reported as
	// exactly that instead of as three anonymous failed pings. Any other
	// failure (database still starting) is left to the caller's own retry.
	probeCtx, cancel := context.WithTimeout(ctx, startupProbeTimeout)
	defer cancel()
	if err := pool.Ping(probeCtx); err != nil {
		if explained := explainConnectError(err); errors.Is(explained, ErrStartupParameterRejected) {
			pool.Close()
			return nil, explained
		}
	}

	return pool, nil
}

// startupProbeTimeout bounds the single connect probe NewPGXPoolWithSettings
// makes; it only delays startup when the database is unreachable.
const startupProbeTimeout = 5 * time.Second
