//go:build dbtest

// Package repository — DB-backed PII encryption integration tests.
//
// These tests require a running Postgres on $DATABASE_URL with migration 031
// applied and rows already encrypted via `make encrypt-pii`. Run with:
//   DATABASE_URL=... ENCRYPTION_KEY=... go test -tags=dbtest ./internal/repository/...
package repository

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/user/internal/crypto"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

func domainUpdateUserPhone(phone string) domain.UpdateUserInput {
	return domain.UpdateUserInput{Phone: &phone}
}

func newTestRepo(t *testing.T) *PostgresRepository {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set; skipping db-backed test")
	}
	cipher, err := crypto.FromEnv()
	if err != nil {
		t.Fatalf("crypto: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return NewPostgresRepository(pool, cipher)
}

// TestPIIRoundTripExistingRow assumes the dev fixtures already exist with
// ENCRYPTION_KEY backfilled — the seed user 0..03 should expose plaintext
// when read back.
func TestPIIRoundTripExistingRow(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	u, err := repo.GetUserByID(ctx, "00000000-0000-0000-0000-000000000003")
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	if u.Phone != "512-555-0001" {
		t.Errorf("phone: got %q, want %q", u.Phone, "512-555-0001")
	}
	if u.MFASecret != "JBSWY3DPEHPK3PXP" {
		t.Errorf("mfa_secret: got %q, want %q", u.MFASecret, "JBSWY3DPEHPK3PXP")
	}

	p, err := repo.GetProviderProfile(ctx, "00000000-0000-0000-0000-000000000003")
	if err != nil {
		t.Fatalf("get provider: %v", err)
	}
	if p.ServiceAddress != "456 Service Rd, Austin, TX 78702" {
		t.Errorf("service_address: got %q", p.ServiceAddress)
	}
}

// TestPIICiphertextOnDisk confirms that the raw column value is NOT the
// plaintext, regardless of what GetUserByID returns. This is the key
// audit-defeating assertion: even with DB read access, the operator never
// sees plaintext PII.
func TestPIICiphertextOnDisk(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	var phone, mfaSecret *string
	if err := repo.pool.QueryRow(ctx,
		`SELECT phone, mfa_secret FROM users WHERE id = $1`,
		"00000000-0000-0000-0000-000000000003",
	).Scan(&phone, &mfaSecret); err != nil {
		t.Fatalf("raw query: %v", err)
	}
	if phone == nil || *phone == "512-555-0001" {
		t.Errorf("expected ciphertext on disk, got plaintext: %v", phone)
	}
	if mfaSecret == nil || *mfaSecret == "JBSWY3DPEHPK3PXP" {
		t.Errorf("expected ciphertext on disk for mfa_secret, got: %v", mfaSecret)
	}
}

// TestUpdatePhoneEncrypts writes a new phone via the repo, then reads the raw
// row to confirm the column on disk is base64 ciphertext, not plaintext.
func TestUpdatePhoneEncrypts(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	newPhone := "512-555-9999"
	updated, err := repo.UpdateUser(ctx, "00000000-0000-0000-0000-000000000003", domainUpdateUserPhone(newPhone))
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Phone != newPhone {
		t.Errorf("returned plaintext mismatch: got %q want %q", updated.Phone, newPhone)
	}

	var raw *string
	if err := repo.pool.QueryRow(ctx,
		`SELECT phone FROM users WHERE id = $1`,
		"00000000-0000-0000-0000-000000000003",
	).Scan(&raw); err != nil {
		t.Fatalf("raw select: %v", err)
	}
	if raw == nil || *raw == newPhone {
		t.Errorf("expected ciphertext on disk; got %v", raw)
	}
}
