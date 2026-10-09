//go:build dbtest

// DB-backed round-trip tests for the provider_profiles PII-at-rest columns
// added to the runtime path: service_address, ein_tin and
// insurance_policy_number (migration 031).
//
// Unlike encryption_db_test.go these tests seed their own rows, so they need
// only a migrated database — no `make seed`, no `make encrypt-pii`. Point them
// at a SCRATCH database:
//
//	DATABASE_URL=postgres://.../nm_pii_fix ENCRYPTION_KEY=$(openssl rand -base64 32) \
//	  go test -tags=dbtest ./internal/repository/...
package repository

import (
	"context"
	"encoding/base64"
	"testing"

	"github.com/nomarkup/nomarkup/services/user/internal/crypto"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

const (
	testEIN       = "12-3456789"
	testPolicy    = "POL-0099887766"
	testAddress   = "456 Service Rd, Austin, TX 78702"
	testEIN2      = "98-7654321"
	testPolicy2   = "POL-1122334455"
	testAddress2  = "789 Trade Blvd, Austin, TX 78703"
	testPlaintext = "legacy-plaintext-not-ciphertext"
)

// seedProvider inserts a user + provider_profiles row writing the three PII
// columns as LITERAL values (bypassing the repository), so a test can stage
// plaintext, ciphertext, or a mix.
func seedProvider(t *testing.T, repo *PostgresRepository, email, addr, ein, policy string) string {
	t.Helper()
	ctx := context.Background()
	var userID string
	if err := repo.pool.QueryRow(ctx,
		`INSERT INTO users (email, display_name, roles)
		 VALUES ($1, 'PII Test Provider', ARRAY['provider']) RETURNING id::text`,
		email,
	).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := repo.pool.Exec(ctx,
		`INSERT INTO provider_profiles
		     (user_id, business_name, service_address, ein_tin, insurance_policy_number)
		 VALUES ($1, 'Acme LLC', NULLIF($2,''), NULLIF($3,''), NULLIF($4,''))`,
		userID, addr, ein, policy,
	); err != nil {
		t.Fatalf("insert provider_profile: %v", err)
	}
	t.Cleanup(func() {
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM provider_profiles WHERE user_id::text = $1`, userID)
		_, _ = repo.pool.Exec(context.Background(), `DELETE FROM users WHERE id::text = $1`, userID)
	})
	return userID
}

// rawProviderPII reads the three columns straight off disk, bypassing every
// decryption path.
func rawProviderPII(t *testing.T, repo *PostgresRepository, userID string) (addr, ein, policy string, flag bool) {
	t.Helper()
	if err := repo.pool.QueryRow(context.Background(),
		`SELECT COALESCE(service_address,''), COALESCE(ein_tin,''),
		        COALESCE(insurance_policy_number,''), pii_encrypted_v1
		   FROM provider_profiles WHERE user_id::text = $1`, userID,
	).Scan(&addr, &ein, &policy, &flag); err != nil {
		t.Fatalf("raw select: %v", err)
	}
	return
}

// TestProviderPIIWriteEncryptsReadDecrypts is the core round trip: write
// plaintext through the repository, prove the COLUMN holds ciphertext, prove
// the READ hands plaintext back.
func TestProviderPIIWriteEncryptsReadDecrypts(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedProvider(t, repo, "pii-write@example.com", "", "", "")

	addr, ein, policy := testAddress, testEIN, testPolicy
	updated, err := repo.UpdateProviderProfile(ctx, userID, domain.UpdateProviderInput{
		ServiceAddress:        &addr,
		EINTIN:                &ein,
		InsurancePolicyNumber: &policy,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	// 1. The write path returns plaintext to the caller.
	if updated.ServiceAddress != testAddress {
		t.Errorf("returned service_address = %q, want %q", updated.ServiceAddress, testAddress)
	}
	if updated.EINTIN != testEIN {
		t.Errorf("returned ein_tin = %q, want %q", updated.EINTIN, testEIN)
	}
	if updated.InsurancePolicyNumber != testPolicy {
		t.Errorf("returned insurance_policy_number = %q, want %q", updated.InsurancePolicyNumber, testPolicy)
	}

	// 2. The COLUMN holds ciphertext. This is the assertion that fails if the
	//    runtime encryption path regresses: an operator with raw DB access must
	//    never see the EIN.
	rawAddr, rawEIN, rawPolicy, flag := rawProviderPII(t, repo, userID)
	if !flag {
		t.Error("pii_encrypted_v1 not set by the write path")
	}
	for _, c := range []struct{ name, raw, plain string }{
		{"service_address", rawAddr, testAddress},
		{"ein_tin", rawEIN, testEIN},
		{"insurance_policy_number", rawPolicy, testPolicy},
	} {
		if c.raw == c.plain {
			t.Errorf("%s: PLAINTEXT on disk (%q)", c.name, c.raw)
		}
		if !crypto.LooksLikeCiphertext(c.raw) {
			t.Errorf("%s: on-disk value %q is not secretbox-shaped", c.name, c.raw)
		}
		if _, err := base64.StdEncoding.DecodeString(c.raw); err != nil {
			t.Errorf("%s: on-disk value is not base64: %v", c.name, err)
		}
	}

	// 3. A fresh read decrypts.
	got, err := repo.GetProviderProfile(ctx, userID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.EINTIN != testEIN {
		t.Errorf("read-back ein_tin = %q, want %q", got.EINTIN, testEIN)
	}
	if got.InsurancePolicyNumber != testPolicy {
		t.Errorf("read-back insurance_policy_number = %q, want %q", got.InsurancePolicyNumber, testPolicy)
	}
	if got.ServiceAddress != testAddress {
		t.Errorf("read-back service_address = %q, want %q", got.ServiceAddress, testAddress)
	}
}

// TestProviderPIILegacyPlaintextPassesThrough covers the mixed state: a row
// written before the columns were encrypted must still read back correctly
// rather than erroring or returning garbage.
func TestProviderPIILegacyPlaintextPassesThrough(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedProvider(t, repo, "pii-legacy@example.com", testAddress, testEIN, testPolicy)

	got, err := repo.GetProviderProfile(ctx, userID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.EINTIN != testEIN {
		t.Errorf("legacy ein_tin = %q, want passthrough %q", got.EINTIN, testEIN)
	}
	if got.InsurancePolicyNumber != testPolicy {
		t.Errorf("legacy insurance_policy_number = %q, want passthrough %q", got.InsurancePolicyNumber, testPolicy)
	}
	if got.ServiceAddress != testAddress {
		t.Errorf("legacy service_address = %q, want passthrough %q", got.ServiceAddress, testAddress)
	}
}

// TestProviderPIIMixedRowIsHandledPerValue is the case the per-row
// pii_encrypted_v1 flag cannot express: service_address encrypted (because it
// was written through the repository) while ein_tin is still legacy plaintext
// on the SAME row, which the flag reports as TRUE.
func TestProviderPIIMixedRowIsHandledPerValue(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedProvider(t, repo, "pii-mixed@example.com", "", testEIN, testPolicy)

	// Writing only service_address flips the row flag to TRUE while ein_tin
	// and insurance_policy_number stay plaintext.
	addr := testAddress
	if _, err := repo.UpdateProviderProfile(ctx, userID, domain.UpdateProviderInput{ServiceAddress: &addr}); err != nil {
		t.Fatalf("update address: %v", err)
	}
	rawAddr, rawEIN, _, flag := rawProviderPII(t, repo, userID)
	if !flag {
		t.Fatal("precondition: flag should be TRUE")
	}
	if rawAddr == testAddress {
		t.Fatal("precondition: service_address should be ciphertext")
	}
	if rawEIN != testEIN {
		t.Fatalf("precondition: ein_tin should still be plaintext, got %q", rawEIN)
	}

	// Both must read back correctly despite the single, misleading flag.
	got, err := repo.GetProviderProfile(ctx, userID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ServiceAddress != testAddress {
		t.Errorf("service_address = %q, want %q (encrypted value must decrypt)", got.ServiceAddress, testAddress)
	}
	if got.EINTIN != testEIN {
		t.Errorf("ein_tin = %q, want %q (plaintext value must pass through)", got.EINTIN, testEIN)
	}
}

// TestProviderPIIUpdateIsIdempotent proves repeated writes do not stack
// encryption layers: each write starts from caller plaintext, so the stored
// value always unseals in exactly one step.
func TestProviderPIIUpdateIsIdempotent(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedProvider(t, repo, "pii-idem@example.com", "", "", "")

	cipher, err := crypto.FromEnv()
	if err != nil {
		t.Fatalf("cipher: %v", err)
	}

	for i, ein := range []string{testEIN, testEIN2, testEIN} {
		e := ein
		if _, err := repo.UpdateProviderProfile(ctx, userID, domain.UpdateProviderInput{EINTIN: &e}); err != nil {
			t.Fatalf("update %d: %v", i, err)
		}
		_, rawEIN, _, _ := rawProviderPII(t, repo, userID)
		plain, err := cipher.DecryptString(rawEIN)
		if err != nil {
			t.Fatalf("update %d: stored value does not decrypt: %v", i, err)
		}
		if plain != ein {
			t.Fatalf("update %d: one unseal gives %q, want %q (double encryption?)", i, plain, ein)
		}
	}
}

// TestProviderPIIClearingAFieldStaysCleared confirms an empty write does not
// store an encrypted empty string.
func TestProviderPIIClearingAFieldStaysCleared(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	userID := seedProvider(t, repo, "pii-clear@example.com", "", testEIN, "")

	empty := ""
	updated, err := repo.UpdateProviderProfile(ctx, userID, domain.UpdateProviderInput{EINTIN: &empty})
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if updated.EINTIN != "" {
		t.Errorf("returned ein_tin = %q, want empty", updated.EINTIN)
	}
	_, rawEIN, _, _ := rawProviderPII(t, repo, userID)
	if rawEIN != "" {
		t.Errorf("on-disk ein_tin = %q, want empty (not encrypted empty string)", rawEIN)
	}
}

// TestProviderPIIWrongKeyFailsLoud: a value that IS our wire format but opens
// under no configured key must surface an error, never be handed back as
// base64. This is the failure mode the GDPR export used to ship to users.
func TestProviderPIIWrongKeyFailsLoud(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	var foreign [crypto.KeySize]byte
	for i := range foreign {
		foreign[i] = byte(i + 1)
	}
	orphan, err := crypto.New(&foreign, nil).EncryptString(testEIN)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	userID := seedProvider(t, repo, "pii-orphan@example.com", "", orphan, "")

	if _, err := repo.GetProviderProfile(ctx, userID); err == nil {
		t.Fatal("expected an error for ciphertext no configured key can open")
	} else {
		t.Logf("failed loud as expected: %v", err)
	}
}
