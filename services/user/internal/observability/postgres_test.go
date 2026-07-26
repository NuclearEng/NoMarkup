package observability

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

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

func TestPoolSettingsApplyRespectsDSN(t *testing.T) {
	tests := []struct {
		name            string
		dsn             string
		wantMaxConns    int32
		wantStatementMS string
	}{
		{
			name:            "plain dsn gets the defaults",
			dsn:             "postgres://u:p@localhost:5432/db",
			wantMaxConns:    defaultMaxConns,
			wantStatementMS: "10000",
		},
		{
			name:            "explicit pool sizing in the dsn wins",
			dsn:             "postgres://u:p@localhost:5432/db?pool_max_conns=25",
			wantMaxConns:    25,
			wantStatementMS: "10000",
		},
		{
			name:            "explicit statement_timeout in the dsn wins",
			dsn:             "postgres://u:p@localhost:5432/db?statement_timeout=1234",
			wantMaxConns:    defaultMaxConns,
			wantStatementMS: "1234",
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
			if got := cfg.ConnConfig.RuntimeParams["statement_timeout"]; got != tt.wantStatementMS {
				t.Errorf("statement_timeout = %q, want %q", got, tt.wantStatementMS)
			}
			if got := cfg.ConnConfig.RuntimeParams["lock_timeout"]; got != "3000" {
				t.Errorf("lock_timeout = %q, want 3000", got)
			}
		})
	}
}

func TestBatchPoolSettingsDisableStatementTimeout(t *testing.T) {
	s := BatchPoolSettings()
	if s.StatementTimeout != 0 {
		t.Errorf("batch StatementTimeout = %v, want 0 (bounded by the caller's context instead)", s.StatementTimeout)
	}

	dsn := "postgres://u:p@localhost:5432/db"
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	s.apply(cfg, dsn)
	if _, set := cfg.ConnConfig.RuntimeParams["statement_timeout"]; set {
		t.Error("batch pools must not send statement_timeout at all")
	}
}

// TestLivePoolAppliesTimeouts proves the GUCs actually reach the server and a
// runaway query is cancelled — the behaviour that stops a hung query from
// pinning a connection forever.
func TestLivePoolAppliesTimeouts(t *testing.T) {
	dsn := testDSN(t)

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
