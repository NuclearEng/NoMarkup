//go:build dbtest

// DB-backed tests for the encrypt-pii reconciler. These drive the REAL SQL in
// specs against a real PostgreSQL+PostGIS database, so they catch column-list
// drift and pagination bugs the pure unit tests cannot.
//
// They mutate every row in users / provider_profiles / provider_employees /
// properties, so point them at a SCRATCH database, never a shared one:
//
//	createdb nm_pii_fix && migrate -path database/migrations -database ... up
//	ENCRYPT_PII_TEST_DATABASE_URL=postgres://.../nm_pii_fix \
//	  go test -tags=dbtest ./cmd/encrypt-pii/...
package main

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("ENCRYPT_PII_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("ENCRYPT_PII_TEST_DATABASE_URL not set; skipping db-backed test")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// reset clears the tables the reconciler walks so each test sees only its own
// fixture. Scratch-database only — guarded by the env var above.
func reset(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for _, stmt := range []string{
		`DELETE FROM provider_employees`,
		`DELETE FROM properties`,
		`DELETE FROM provider_profiles`,
		`DELETE FROM users`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("reset (%s): %v", stmt, err)
		}
	}
}

// seedProfile inserts a user plus a provider_profiles row holding the three
// literal column values given, and returns the profile id.
func seedProfile(t *testing.T, pool *pgxpool.Pool, email, addr, ein, policy string, flag bool) string {
	t.Helper()
	ctx := context.Background()
	var userID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (email, display_name, roles)
		 VALUES ($1, 'Test Provider', ARRAY['provider']) RETURNING id::text`,
		email,
	).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	var profileID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO provider_profiles
		     (user_id, business_name, service_address, ein_tin,
		      insurance_policy_number, pii_encrypted_v1)
		 VALUES ($1, 'Acme LLC', $2, $3, $4, $5) RETURNING id::text`,
		userID, addr, ein, policy, flag,
	).Scan(&profileID); err != nil {
		t.Fatalf("insert provider_profile: %v", err)
	}
	return profileID
}

func readProfile(t *testing.T, pool *pgxpool.Pool, id string) (addr, ein, policy string, flag bool) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(service_address,''), COALESCE(ein_tin,''),
		        COALESCE(insurance_policy_number,''), pii_encrypted_v1
		   FROM provider_profiles WHERE id::text = $1`, id,
	).Scan(&addr, &ein, &policy, &flag); err != nil {
		t.Fatalf("read profile: %v", err)
	}
	return
}

const (
	fixtureAddr   = "456 Service Rd, Austin, TX 78702"
	fixtureEIN    = "12-3456789"
	fixturePolicy = "POL-0099887766"
)

// TestRunMixedStateAndIdempotency is the headline DB test. One row carries all
// three states at once — the exact mixed state the per-row pii_encrypted_v1
// flag cannot represent:
//
//	service_address         → ciphertext under the PREVIOUS key (needs re-key)
//	ein_tin                 → legacy PLAINTEXT (needs first encryption)
//	insurance_policy_number → ciphertext under the PRIMARY key (must be untouched)
//
// After one run every column must open to its plaintext in ONE unseal under the
// primary key. After a second run nothing may change at all.
func TestRunMixedStateAndIdempotency(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()

	oldKey, newKey := mustKey(t), mustKey(t)
	kr := keyring{primary: newKey, previous: oldKey}

	staleAddr := mustEncrypt(t, oldKey, fixtureAddr)
	currentPolicy := mustEncrypt(t, newKey, fixturePolicy)

	// flag=TRUE deliberately: the row IS flagged encrypted, yet ein_tin is
	// plaintext. Anything that trusted the flag would skip it forever.
	id := seedProfile(t, pool, "mixed@example.com", staleAddr, fixtureEIN, currentPolicy, true)

	if err := run(ctx, pool, kr, false); err != nil {
		t.Fatalf("run 1: %v", err)
	}

	addr1, ein1, policy1, flag1 := readProfile(t, pool, id)
	if !flag1 {
		t.Error("pii_encrypted_v1 should be TRUE after a run")
	}

	// Every column: exactly one unseal under the primary key yields plaintext.
	for _, c := range []struct{ name, stored, want string }{
		{"service_address", addr1, fixtureAddr},
		{"ein_tin", ein1, fixtureEIN},
		{"insurance_policy_number", policy1, fixturePolicy},
	} {
		if c.stored == c.want {
			t.Errorf("%s: still PLAINTEXT on disk (%q)", c.name, c.stored)
			continue
		}
		got, ok := open(newKey, c.stored)
		if !ok {
			t.Errorf("%s: does not open under the primary key", c.name)
			continue
		}
		if got != c.want {
			t.Errorf("%s: one unseal gives %q, want %q — this is a DOUBLE ENCRYPTION",
				c.name, got, c.want)
		}
	}

	// The already-current value must be byte-identical: not re-sealed with a
	// fresh nonce, not touched at all.
	if policy1 != currentPolicy {
		t.Errorf("insurance_policy_number was rewritten though it was already current:\n got %q\nwant %q",
			policy1, currentPolicy)
	}
	// The stale value must NOT still open under the old key.
	if _, ok := open(oldKey, addr1); ok {
		t.Error("service_address still opens under the OLD key; it was not re-keyed")
	}

	// ── second run: a strict no-op ──────────────────────────────────────
	if err := run(ctx, pool, kr, false); err != nil {
		t.Fatalf("run 2: %v", err)
	}
	addr2, ein2, policy2, _ := readProfile(t, pool, id)
	if addr2 != addr1 || ein2 != ein1 || policy2 != policy1 {
		t.Fatalf("second run mutated the row — NOT idempotent:\n addr %q -> %q\n ein  %q -> %q\n pol  %q -> %q",
			addr1, addr2, ein1, ein2, policy1, policy2)
	}
	// And still exactly one layer of encryption.
	if got, ok := open(newKey, ein2); !ok || got != fixtureEIN {
		t.Fatalf("after two runs ein_tin unseals to (%q, %v), want %q", got, ok, fixtureEIN)
	}
}

// TestRunEncryptsFirstTimeBackfill covers the plain backfill case: a legacy
// row, flag FALSE, all plaintext, no previous key.
func TestRunEncryptsFirstTimeBackfill(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()

	key := mustKey(t)
	kr := keyring{primary: key}
	id := seedProfile(t, pool, "legacy@example.com", fixtureAddr, fixtureEIN, fixturePolicy, false)

	if err := run(ctx, pool, kr, false); err != nil {
		t.Fatalf("run: %v", err)
	}
	addr, ein, policy, flag := readProfile(t, pool, id)
	if !flag {
		t.Error("flag not set")
	}
	for _, c := range []struct{ name, stored, want string }{
		{"service_address", addr, fixtureAddr},
		{"ein_tin", ein, fixtureEIN},
		{"insurance_policy_number", policy, fixturePolicy},
	} {
		if got, ok := open(key, c.stored); !ok || got != c.want {
			t.Errorf("%s: unseal = (%q, %v), want %q", c.name, got, ok, c.want)
		}
	}
}

// TestRunRefusesUnknownKey is the destructive-run guard end to end: a row
// encrypted under a key we were not given must abort the whole run, and the
// database must be left completely untouched.
func TestRunRefusesUnknownKey(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()

	primary, foreign := mustKey(t), mustKey(t)
	kr := keyring{primary: primary} // no PREVIOUS — this is the operator error

	orphan := mustEncrypt(t, foreign, fixtureEIN)
	id := seedProfile(t, pool, "orphan@example.com", fixtureAddr, orphan, "", false)

	err := run(ctx, pool, kr, false)
	if err == nil {
		t.Fatal("run succeeded; it must refuse to touch ciphertext it cannot open")
	}
	t.Logf("refused as expected: %v", err)

	// Nothing may have been written — not even the plaintext service_address
	// on the same row, because the pre-flight aborts before the write pass.
	addr, ein, _, flag := readProfile(t, pool, id)
	if addr != fixtureAddr {
		t.Errorf("service_address was modified despite the abort: %q", addr)
	}
	if ein != orphan {
		t.Errorf("ein_tin was modified despite the abort: %q", ein)
	}
	if flag {
		t.Error("pii_encrypted_v1 was flipped despite the abort")
	}
}

// TestRunDryRunWritesNothing.
func TestRunDryRunWritesNothing(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()

	key := mustKey(t)
	id := seedProfile(t, pool, "dry@example.com", fixtureAddr, fixtureEIN, fixturePolicy, false)

	if err := run(ctx, pool, keyring{primary: key}, true); err != nil {
		t.Fatalf("dry run: %v", err)
	}
	addr, ein, policy, flag := readProfile(t, pool, id)
	if addr != fixtureAddr || ein != fixtureEIN || policy != fixturePolicy || flag {
		t.Fatalf("dry run mutated the row: addr=%q ein=%q policy=%q flag=%v", addr, ein, policy, flag)
	}
}

// TestRunPaginatesPastOneBatch guards the keyset cursor: with more rows than
// batchSize, every row must still be processed exactly once and the loop must
// terminate.
func TestRunPaginatesPastOneBatch(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()

	key := mustKey(t)
	const n = batchSize + 37
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		ids = append(ids, seedProfile(t, pool,
			"bulk"+itoa(i)+"@example.com", fixtureAddr, fixtureEIN, "", false))
	}

	if err := run(ctx, pool, keyring{primary: key}, false); err != nil {
		t.Fatalf("run: %v", err)
	}
	for _, id := range ids {
		_, ein, _, flag := readProfile(t, pool, id)
		if !flag {
			t.Fatalf("row %s not processed (flag still false)", id)
		}
		if got, ok := open(key, ein); !ok || got != fixtureEIN {
			t.Fatalf("row %s: ein unseal = (%q, %v)", id, got, ok)
		}
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var buf [12]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(buf[pos:])
}
