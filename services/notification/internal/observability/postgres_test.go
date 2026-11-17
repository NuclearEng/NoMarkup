package observability

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testDSN is a live PostgreSQL the pool tests dial. Skipped when unset.
func testDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping live pool test")
	}
	return dsn
}

// TestDefaultPoolSettingsAreBounded is the regression test for RES-02: pgx
// defaults leave every one of these at zero (unbounded), which is the defect.
func TestDefaultPoolSettingsAreBounded(t *testing.T) {
	s := DefaultPoolSettings()

	tests := []struct {
		name string
		got  int64
	}{
		{"MaxConns", int64(s.MaxConns)},
		{"MaxConnLifetime", int64(s.MaxConnLifetime)},
		{"MaxConnIdleTime", int64(s.MaxConnIdleTime)},
		{"HealthCheckPeriod", int64(s.HealthCheckPeriod)},
		{"StatementTimeout", int64(s.StatementTimeout)},
		{"LockTimeout", int64(s.LockTimeout)},
		{"IdleInTxTimeout", int64(s.IdleInTxTimeout)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got <= 0 {
				t.Errorf("%s = %d, want > 0 (an unset value is the unbounded default this fixes)", tt.name, tt.got)
			}
		})
	}

	// The connection budget documented in the sizing comment: 13 pools against
	// the primary must stay inside ~90 usable connections.
	const primaryPools = 13
	const usableConnections = 90
	if total := int(s.MaxConns) * primaryPools; total > usableConnections {
		t.Errorf("%d pools x MaxConns %d = %d connections, exceeds the %d-connection budget",
			primaryPools, s.MaxConns, total, usableConnections)
	}
	if s.LockTimeout >= s.StatementTimeout {
		t.Errorf("LockTimeout %v should be tighter than StatementTimeout %v", s.LockTimeout, s.StatementTimeout)
	}
}

func TestPoolSettingsFromEnv(t *testing.T) {
	t.Setenv("DB_MAX_CONNS", "11")
	t.Setenv("DB_STATEMENT_TIMEOUT", "2500ms")
	t.Setenv("DB_LOCK_TIMEOUT", "bogus") // must fall back, not crash

	s := DefaultPoolSettings()
	if s.MaxConns != 11 {
		t.Errorf("MaxConns = %d, want 11", s.MaxConns)
	}
	if s.StatementTimeout != 2500*time.Millisecond {
		t.Errorf("StatementTimeout = %v, want 2.5s", s.StatementTimeout)
	}
	if s.LockTimeout != defaultLockTimeout {
		t.Errorf("LockTimeout = %v, want the %v default after an invalid value", s.LockTimeout, defaultLockTimeout)
	}
}

// TestRequestPoolsSendNoTimeoutStartupParameters is the regression test for
// the PgBouncer outage: a pooler refuses a connection whose startup packet
// carries statement_timeout / lock_timeout / idle_in_transaction_session_timeout
// ("unsupported startup parameter", SQLSTATE 08P01). Request-path pools must
// not send them; the role defaults from migration 137 supply the values.
func TestRequestPoolsSendNoTimeoutStartupParameters(t *testing.T) {
	tests := []struct {
		name         string
		dsn          string
		wantMaxConns int32
		wantParams   map[string]string
	}{
		{
			name:         "plain dsn sends no timeout parameters",
			dsn:          "postgres://u:p@localhost:5432/db",
			wantMaxConns: defaultMaxConns,
			wantParams:   map[string]string{},
		},
		{
			name:         "explicit pool sizing in the dsn wins",
			dsn:          "postgres://u:p@localhost:5432/db?pool_max_conns=25",
			wantMaxConns: 25,
			wantParams:   map[string]string{},
		},
		{
			name:         "a timeout the operator pinned in the dsn is kept",
			dsn:          "postgres://u:p@localhost:5432/db?statement_timeout=1234",
			wantMaxConns: defaultMaxConns,
			wantParams:   map[string]string{gucStatementTimeout: "1234"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := pgxpool.ParseConfig(tt.dsn)
			if err != nil {
				t.Fatalf("ParseConfig: %v", err)
			}
			DefaultPoolSettings().apply(cfg, tt.dsn)

			if cfg.MaxConns != tt.wantMaxConns {
				t.Errorf("MaxConns = %d, want %d", cfg.MaxConns, tt.wantMaxConns)
			}
			for _, name := range []string{gucStatementTimeout, gucLockTimeout, gucIdleInTxTimeout} {
				got, sent := cfg.ConnConfig.RuntimeParams[name]
				want, wantSent := tt.wantParams[name]
				if sent != wantSent || got != want {
					t.Errorf("startup parameter %s = %q (sent=%v), want %q (sent=%v)", name, got, sent, want, wantSent)
				}
			}
		})
	}
}

func TestStartupPacketOptInSendsAllThreeTimeouts(t *testing.T) {
	t.Setenv("DB_TIMEOUTS_IN_STARTUP_PACKET", "true")

	dsn := "postgres://u:p@localhost:5432/db?statement_timeout=1234"
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	DefaultPoolSettings().apply(cfg, dsn)

	want := map[string]string{
		gucStatementTimeout: "1234", // the dsn value still wins
		gucLockTimeout:      "3000",
		gucIdleInTxTimeout:  "30000",
	}
	for name, wantValue := range want {
		if got := cfg.ConnConfig.RuntimeParams[name]; got != wantValue {
			t.Errorf("startup parameter %s = %q, want %q", name, got, wantValue)
		}
	}
}

// Batch pools must override the role default, so they send an explicit 0
// (disabled) rather than nothing: with nothing, the 10s role default would
// cut the batch statement.
func TestBatchPoolSettingsDisableStatementTimeout(t *testing.T) {
	s := BatchPoolSettings()
	if s.StatementTimeout != 0 {
		t.Errorf("batch StatementTimeout = %v, want 0 (bounded by the caller's context instead)", s.StatementTimeout)
	}
	if !s.TimeoutsInStartupPacket {
		t.Fatal("batch pools must send their timeouts in the startup packet to override the role default")
	}

	dsn := "postgres://u:p@localhost:5432/db"
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	s.apply(cfg, dsn)

	want := map[string]string{
		gucStatementTimeout: "0",
		gucLockTimeout:      "3000",
		gucIdleInTxTimeout:  "0",
	}
	for name, wantValue := range want {
		got, sent := cfg.ConnConfig.RuntimeParams[name]
		if !sent || got != wantValue {
			t.Errorf("startup parameter %s = %q (sent=%v), want %q", name, got, sent, wantValue)
		}
	}
}

func TestCompareSessionTimeouts(t *testing.T) {
	request := PoolSettings{StatementTimeout: 10 * time.Second, LockTimeout: 3 * time.Second, IdleInTxTimeout: 30 * time.Second}
	batch := PoolSettings{StatementTimeout: 0, LockTimeout: 3 * time.Second, IdleInTxTimeout: 0}

	tests := []struct {
		name string
		want PoolSettings
		got  sessionTimeouts
		// findings as "setting:unbounded|looser"
		findings []string
	}{
		{
			name:     "role defaults in effect",
			want:     request,
			got:      sessionTimeouts{Statement: 10 * time.Second, Lock: 3 * time.Second, IdleInTx: 30 * time.Second},
			findings: nil,
		},
		{
			name: "no role defaults: every bound is missing",
			want: request,
			got:  sessionTimeouts{},
			findings: []string{
				"statement_timeout:unbounded", "lock_timeout:unbounded", "idle_in_transaction_session_timeout:unbounded",
			},
		},
		{
			name:     "only lock_timeout missing (the pooler-ignored state)",
			want:     request,
			got:      sessionTimeouts{Statement: 10 * time.Second, IdleInTx: 30 * time.Second},
			findings: []string{"lock_timeout:unbounded"},
		},
		{
			name:     "a stricter server is fine",
			want:     request,
			got:      sessionTimeouts{Statement: 5 * time.Second, Lock: time.Second, IdleInTx: 10 * time.Second},
			findings: nil,
		},
		{
			name:     "a looser server is reported",
			want:     request,
			got:      sessionTimeouts{Statement: 60 * time.Second, Lock: 3 * time.Second, IdleInTx: 30 * time.Second},
			findings: []string{"statement_timeout:looser"},
		},
		{
			name:     "batch pool reached Postgres directly",
			want:     batch,
			got:      sessionTimeouts{Lock: 3 * time.Second},
			findings: nil,
		},
		{
			name:     "batch pool behind a pooler keeps the role default",
			want:     batch,
			got:      sessionTimeouts{Statement: 10 * time.Second, Lock: 3 * time.Second, IdleInTx: 30 * time.Second},
			findings: []string{"statement_timeout:looser", "idle_in_transaction_session_timeout:looser"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got []string
			for _, f := range compareSessionTimeouts(tt.want, tt.got) {
				kind := "looser"
				if f.Unbounded {
					kind = "unbounded"
				}
				got = append(got, f.Name+":"+kind)
			}
			if strings.Join(got, ",") != strings.Join(tt.findings, ",") {
				t.Errorf("findings = %v, want %v", got, tt.findings)
			}
			// Must not panic on any combination; it only logs.
			reportSessionTimeouts(tt.want, tt.got)
		})
	}
}

func TestExplainConnectError(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantNamed  bool
		wantSubstr string
	}{
		{
			name:       "pgbouncer refusing lock_timeout",
			err:        fmt.Errorf("failed to connect: %w", &pgconn.PgError{Severity: "FATAL", Code: "08P01", Message: "unsupported startup parameter: lock_timeout"}),
			wantNamed:  true,
			wantSubstr: "ignore_startup_parameters",
		},
		{
			name:      "another protocol violation is left alone",
			err:       &pgconn.PgError{Severity: "FATAL", Code: "08P01", Message: "invalid startup packet layout"},
			wantNamed: false,
		},
		{
			name:      "bad password is left alone",
			err:       &pgconn.PgError{Severity: "FATAL", Code: "28P01", Message: "password authentication failed"},
			wantNamed: false,
		},
		{
			name:      "a network error is left alone",
			err:       errors.New("dial tcp 127.0.0.1:5432: connect: connection refused"),
			wantNamed: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := explainConnectError(tt.err)
			if named := errors.Is(got, ErrStartupParameterRejected); named != tt.wantNamed {
				t.Fatalf("errors.Is(ErrStartupParameterRejected) = %v, want %v (err: %v)", named, tt.wantNamed, got)
			}
			if !tt.wantNamed {
				if got != tt.err {
					t.Errorf("unrelated error was rewritten: %v", got)
				}
				return
			}
			if !strings.Contains(got.Error(), tt.wantSubstr) || !strings.Contains(got.Error(), "lock_timeout") {
				t.Errorf("error %q should name the parameter and the pooler setting", got)
			}
			var pgErr *pgconn.PgError
			if !errors.As(got, &pgErr) {
				t.Error("the original PgError must stay reachable through errors.As")
			}
		})
	}
}

// TestLivePoolAppliesTimeouts proves that with the startup-packet opt-in (a
// direct connection) the GUCs reach the server and a runaway query is
// cancelled — the behaviour that stops a hung query from pinning a connection
// forever. Skipped when TEST_DATABASE_URL is a pooler: it refuses the packet.
func TestLivePoolAppliesTimeouts(t *testing.T) {
	dsn := testDSN(t)
	if os.Getenv("TEST_DATABASE_IS_POOLER") != "" {
		t.Skip("startup-packet timeouts need a direct Postgres connection")
	}
	t.Setenv("DB_TIMEOUTS_IN_STARTUP_PACKET", "true")

	t.Setenv("DB_STATEMENT_TIMEOUT", "300ms")
	t.Setenv("DB_LOCK_TIMEOUT", "200ms")
	t.Setenv("DB_MAX_CONNS", "3")

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	pool, err := NewPGXPool(ctx, dsn)
	if err != nil {
		t.Fatalf("NewPGXPool: %v", err)
	}
	defer pool.Close()

	var statementTimeout, lockTimeout, idleInTx string
	if err := pool.QueryRow(ctx, "SHOW statement_timeout").Scan(&statementTimeout); err != nil {
		t.Fatalf("SHOW statement_timeout: %v", err)
	}
	if err := pool.QueryRow(ctx, "SHOW lock_timeout").Scan(&lockTimeout); err != nil {
		t.Fatalf("SHOW lock_timeout: %v", err)
	}
	if err := pool.QueryRow(ctx, "SHOW idle_in_transaction_session_timeout").Scan(&idleInTx); err != nil {
		t.Fatalf("SHOW idle_in_transaction_session_timeout: %v", err)
	}

	if statementTimeout != "300ms" {
		t.Errorf("server statement_timeout = %q, want 300ms", statementTimeout)
	}
	if lockTimeout != "200ms" {
		t.Errorf("server lock_timeout = %q, want 200ms", lockTimeout)
	}
	if idleInTx != "30s" {
		t.Errorf("server idle_in_transaction_session_timeout = %q, want 30s", idleInTx)
	}

	if got := pool.Config().MaxConns; got != 3 {
		t.Errorf("pool MaxConns = %d, want 3", got)
	}

	// A query that would run for 5s must be cancelled by the server at 300ms
	// instead of pinning its connection.
	start := time.Now()
	_, err = pool.Exec(ctx, "SELECT pg_sleep(5)")
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("pg_sleep(5) completed; statement_timeout was not enforced")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "statement timeout") && !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error = %v, want a statement timeout", err)
	}
	if elapsed > 3*time.Second {
		t.Errorf("query took %v; the 300ms statement_timeout did not release the connection", elapsed)
	}

	// The pool must still be usable — the cancelled connection is returned,
	// not leaked.
	var one int
	if err := pool.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil || one != 1 {
		t.Errorf("pool unusable after a timed-out query: %v", err)
	}
}

// roleTimeoutMigration returns the SQL of migration 137, found by walking up
// from the package directory to the repository's database/migrations.
func roleTimeoutMigration(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	for {
		path := filepath.Join(dir, "database", "migrations", "137_role_session_timeouts.up.sql")
		if sql, err := os.ReadFile(path); err == nil {
			return string(sql)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("database/migrations/137_role_session_timeouts.up.sql not found above the package directory")
		}
		dir = parent
	}
}

// TestLivePoolInheritsRoleDefaultTimeouts is the live half of the PgBouncer
// regression: a default request-path pool sends no timeout startup parameter
// and still ends up bounded, because migration 137 made the three timeouts
// defaults of the role. It passes unchanged through PgBouncer in transaction
// mode (set TEST_DATABASE_URL to the pooler), which is the point.
func TestLivePoolInheritsRoleDefaultTimeouts(t *testing.T) {
	dsn := testDSN(t)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Apply the migration's own SQL: idempotent, and a no-op on a migrated
	// database. Role defaults bind at session start, so do it on a throwaway
	// pool and open the pool under test afterwards.
	setup, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("setup pool: %v", err)
	}
	if _, err := setup.Exec(ctx, roleTimeoutMigration(t)); err != nil {
		setup.Close()
		t.Fatalf("apply migration 137: %v", err)
	}
	setup.Close()

	pool, err := NewPGXPool(ctx, dsn)
	if err != nil {
		t.Fatalf("NewPGXPool: %v", err)
	}
	defer pool.Close()

	for _, name := range []string{gucStatementTimeout, gucLockTimeout, gucIdleInTxTimeout} {
		if _, sent := pool.Config().ConnConfig.RuntimeParams[name]; sent {
			t.Errorf("pool sent %s as a startup parameter; a pooler would refuse the connection", name)
		}
	}

	want := map[string]string{
		gucStatementTimeout: "10s",
		gucLockTimeout:      "3s",
		gucIdleInTxTimeout:  "30s",
	}
	for name, wantValue := range want {
		var got string
		if err := pool.QueryRow(ctx, "SELECT current_setting($1)", name).Scan(&got); err != nil {
			t.Fatalf("current_setting(%s): %v", name, err)
		}
		if got != wantValue {
			t.Errorf("server %s = %q, want %q from the role default", name, got, wantValue)
		}
	}

	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	defer conn.Release()
	got, err := readSessionTimeouts(ctx, conn.Conn())
	if err != nil {
		t.Fatalf("readSessionTimeouts: %v", err)
	}
	if findings := compareSessionTimeouts(DefaultPoolSettings(), got); len(findings) != 0 {
		t.Errorf("startup verification would report %v on a migrated database", findings)
	}
}
