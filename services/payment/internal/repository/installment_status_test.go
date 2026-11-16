package repository

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestUpdateScheduledInstallmentStatus_SecondPaidDoesNotIncrementAttempts proves
// the paid UPDATE counts a row once. A second confirm of an already-paid
// installment is a no-op. A missing row is still an error. The processing
// branch is unchanged and does not consume an attempt.
func TestUpdateScheduledInstallmentStatus_SecondPaidDoesNotIncrementAttempts(t *testing.T) {
	pool := newScratchInstallmentPool(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `
		CREATE TABLE scheduled_installments (
			id UUID PRIMARY KEY,
			status TEXT NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 0,
			paid_at TIMESTAMPTZ,
			stripe_payment_intent_id TEXT,
			last_attempt_at TIMESTAMPTZ,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`)
	require.NoError(t, err)

	repo := NewPostgresRepository(pool)
	firstID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO scheduled_installments (id, status, attempts)
		VALUES ($1, 'processing', 0)`, firstID)
	require.NoError(t, err)

	pi := "pi_paid_once"
	require.NoError(t, repo.UpdateScheduledInstallmentStatus(ctx, firstID, "processing", &pi))
	status, attempts, storedPI := readInstallmentAttempt(t, pool, firstID)
	require.Equal(t, "processing", status)
	require.Equal(t, 0, attempts)
	require.Equal(t, pi, storedPI)

	require.NoError(t, repo.UpdateScheduledInstallmentStatus(ctx, firstID, "paid", &pi))
	status, attempts, storedPI = readInstallmentAttempt(t, pool, firstID)
	require.Equal(t, "paid", status)
	require.Equal(t, 1, attempts)
	require.Equal(t, pi, storedPI)

	again := "pi_paid_again"
	require.NoError(t, repo.UpdateScheduledInstallmentStatus(ctx, firstID, "paid", &again))
	status, attempts, storedPI = readInstallmentAttempt(t, pool, firstID)
	require.Equal(t, "paid", status)
	require.Equal(t, 1, attempts, "a second paid update must not increment attempts")
	require.Equal(t, pi, storedPI, "an already-paid row is left unchanged")

	seeded := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO scheduled_installments (id, status, attempts, stripe_payment_intent_id)
		VALUES ($1, 'paid', 2, $2)`, seeded, pi)
	require.NoError(t, err)
	require.NoError(t, repo.UpdateScheduledInstallmentStatus(ctx, seeded, "paid", &again))
	status, attempts, storedPI = readInstallmentAttempt(t, pool, seeded)
	require.Equal(t, "paid", status)
	require.Equal(t, 2, attempts)
	require.Equal(t, pi, storedPI)

	err = repo.UpdateScheduledInstallmentStatus(ctx, uuid.NewString(), "paid", &pi)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not found")
}

func readInstallmentAttempt(t *testing.T, pool *pgxpool.Pool, id string) (string, int, string) {
	t.Helper()
	var status string
	var attempts int
	var pi *string
	err := pool.QueryRow(context.Background(), `
		SELECT status, attempts, stripe_payment_intent_id
		FROM scheduled_installments WHERE id = $1`, id).Scan(&status, &attempts, &pi)
	require.NoError(t, err)
	stored := ""
	if pi != nil {
		stored = *pi
	}
	return status, attempts, stored
}

// newScratchInstallmentPool starts a throwaway Postgres so the paid UPDATE can
// be executed. Skips when initdb/postgres are not installed.
func newScratchInstallmentPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	initdb, err := exec.LookPath("initdb")
	if err != nil {
		t.Skip("initdb not on PATH")
	}
	pg, err := exec.LookPath("postgres")
	if err != nil {
		t.Skip("postgres not on PATH")
	}

	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	out, err := exec.Command(initdb, "-D", dataDir, "-U", "nomarkup", "--auth=trust", "--no-locale").CombinedOutput()
	if err != nil {
		t.Fatalf("initdb: %v\n%s", err, out)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}

	logPath := filepath.Join(dir, "server.log")
	// /tmp keeps the socket path under the 103-byte limit. t.TempDir is too long.
	proc := exec.Command(pg,
		"-D", dataDir,
		"-p", strconv.Itoa(port),
		"-h", "127.0.0.1",
		"-k", "/tmp",
		"-c", "listen_addresses=127.0.0.1",
		"-c", "unix_socket_directories=/tmp",
	)
	logf, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	proc.Stdout = logf
	proc.Stderr = logf
	if err := proc.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if proc.Process != nil {
			_ = proc.Process.Signal(syscall.SIGTERM)
		}
		done := make(chan struct{})
		go func() {
			_ = proc.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			if proc.Process != nil {
				_ = proc.Process.Kill()
			}
			<-done
		}
		_ = logf.Close()
	})

	dsn := "postgres://nomarkup@127.0.0.1:" + strconv.Itoa(port) + "/postgres?sslmode=disable"
	deadline := time.Now().Add(20 * time.Second)
	var pool *pgxpool.Pool
	var lastErr error
	for time.Now().Before(deadline) {
		pool, lastErr = pgxpool.New(context.Background(), dsn)
		if lastErr == nil {
			pingCtx, cancel := context.WithTimeout(context.Background(), time.Second)
			lastErr = pool.Ping(pingCtx)
			cancel()
			if lastErr == nil {
				break
			}
			pool.Close()
			pool = nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	if pool == nil {
		logBody, _ := os.ReadFile(logPath)
		t.Fatalf("postgres did not start: %v\n%s", lastErr, logBody)
	}
	t.Cleanup(pool.Close)
	return pool
}
