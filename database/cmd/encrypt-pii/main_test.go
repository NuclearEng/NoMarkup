package main

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"testing"
)

func mustKey(t *testing.T) *[keySize]byte {
	t.Helper()
	var k [keySize]byte
	if _, err := rand.Read(k[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return &k
}

func mustEncrypt(t *testing.T, key *[keySize]byte, s string) string {
	t.Helper()
	ct, err := encrypt(key, s)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	return ct
}

// ── the discriminator ────────────────────────────────────────────────────

// TestLooksLikeCiphertextRejectsRealPII is the load-bearing claim behind the
// "plaintext" class: the actual values in these columns cannot be mistaken for
// our wire format.
func TestLooksLikeCiphertextRejectsRealPII(t *testing.T) {
	t.Parallel()
	plaintexts := []string{
		"12-3456789",                       // EIN/TIN, canonical form
		"123456789",                        // EIN/TIN, undashed
		"POL-0099887766",                   // insurance policy number
		"GL 4471192",                       // policy number with a space
		"512-555-0001",                     // phone
		"456 Service Rd, Austin, TX 78702", // service address
		"JBSWY3DPEHPK3PXP",                 // TOTP seed (base32, 16 chars)
		"",                                 // empty
		"abcd",                             // short, valid base64 alphabet
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // 55 chars: one below the floor
	}
	for _, s := range plaintexts {
		if looksLikeCiphertext(s) {
			t.Errorf("looksLikeCiphertext(%q) = true; real PII must never be mistaken for ciphertext", s)
		}
	}
}

func TestLooksLikeCiphertextAcceptsRealCiphertext(t *testing.T) {
	t.Parallel()
	key := mustKey(t)
	// The shortest possible payload: encrypting a single character still yields
	// nonce(24) + tag(16) + 1 = 41 bytes.
	for _, s := range []string{"x", "12-3456789", strings.Repeat("y", 4096)} {
		ct := mustEncrypt(t, key, s)
		if !looksLikeCiphertext(ct) {
			t.Errorf("looksLikeCiphertext(encrypt(%q)) = false", s)
		}
	}
}

func TestClassify(t *testing.T) {
	t.Parallel()
	primary, previous, foreign := mustKey(t), mustKey(t), mustKey(t)
	kr := keyring{primary: primary, previous: previous}

	tests := []struct {
		name      string
		value     string
		want      valueClass
		wantPlain string
	}{
		{"empty", "", classEmpty, ""},
		{"under primary", mustEncrypt(t, primary, "12-3456789"), classCurrent, ""},
		{"under previous", mustEncrypt(t, previous, "12-3456789"), classRekey, "12-3456789"},
		{"legacy plaintext ein", "12-3456789", classPlaintext, "12-3456789"},
		{"legacy plaintext policy", "POL-0099887766", classPlaintext, "POL-0099887766"},
		{"foreign key ciphertext", mustEncrypt(t, foreign, "12-3456789"), classUnknown, ""},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, plain := classify(kr, tc.value)
			if got != tc.want {
				t.Errorf("classify = %v, want %v", got, tc.want)
			}
			if plain != tc.wantPlain {
				t.Errorf("plaintext = %q, want %q", plain, tc.wantPlain)
			}
		})
	}
}

// TestClassifyWithoutPreviousKey: with no PREVIOUS configured, old-key
// ciphertext must classify as UNKNOWN (fatal), never as plaintext. This is the
// exact condition under which the old tool double-encrypted.
func TestClassifyWithoutPreviousKey(t *testing.T) {
	t.Parallel()
	primary, old := mustKey(t), mustKey(t)
	kr := keyring{primary: primary} // operator forgot ENCRYPTION_KEY_PREVIOUS

	class, _ := classify(kr, mustEncrypt(t, old, "12-3456789"))
	if class != classUnknown {
		t.Fatalf("classify = %v, want %v — old ciphertext with no PREVIOUS must be fatal, not re-encrypted", class, classUnknown)
	}
}

// ── idempotency: the anti-double-encryption guarantee ────────────────────

// TestReconcileValueIdempotent runs the reconciler repeatedly over the same
// value and asserts exactly ONE encryption ever happens: the first pass
// converts plaintext to ciphertext, every later pass returns the identical
// bytes and reports no change.
func TestReconcileValueIdempotent(t *testing.T) {
	t.Parallel()
	primary := mustKey(t)
	kr := keyring{primary: primary}
	const plain = "12-3456789"

	first, changed, err := reconcileValue(kr, plain)
	if err != nil {
		t.Fatalf("pass 1: %v", err)
	}
	if !changed {
		t.Fatal("pass 1: expected a change (plaintext -> ciphertext)")
	}
	if got, ok := open(primary, first); !ok || got != plain {
		t.Fatalf("pass 1: ciphertext does not open to %q (ok=%v got=%q)", plain, ok, got)
	}

	current := first
	for i := 2; i <= 5; i++ {
		next, changed, err := reconcileValue(kr, current)
		if err != nil {
			t.Fatalf("pass %d: %v", i, err)
		}
		if changed {
			t.Fatalf("pass %d: reported a change; a second run must be a no-op, not a re-encryption", i)
		}
		if next != current {
			t.Fatalf("pass %d: value mutated (%q -> %q)", i, current, next)
		}
		// The decisive assertion: still ONE layer of encryption. If the value
		// had been double-encrypted, opening it would yield base64 ciphertext
		// rather than the original plaintext.
		got, ok := open(primary, next)
		if !ok {
			t.Fatalf("pass %d: value no longer opens under the primary key", i)
		}
		if got != plain {
			t.Fatalf("pass %d: DOUBLE ENCRYPTION — one unseal yields %q, want %q", i, got, plain)
		}
		current = next
	}
}

// TestReconcileValueRekeysPreviousToPrimary proves the rotation itself:
// PREVIOUS-key ciphertext is decrypted and re-sealed under PRIMARY, with the
// plaintext preserved and exactly one layer of encryption in the result.
func TestReconcileValueRekeysPreviousToPrimary(t *testing.T) {
	t.Parallel()
	oldKey, newKey := mustKey(t), mustKey(t)
	const plain = "456 Service Rd, Austin, TX 78702"

	stale := mustEncrypt(t, oldKey, plain)
	kr := keyring{primary: newKey, previous: oldKey}

	rekeyed, changed, err := reconcileValue(kr, stale)
	if err != nil {
		t.Fatalf("rekey: %v", err)
	}
	if !changed {
		t.Fatal("expected a change: stale ciphertext must be re-keyed")
	}
	if rekeyed == stale {
		t.Fatal("value unchanged; it was not re-encrypted under the new key")
	}
	// Readable under the NEW key...
	got, ok := open(newKey, rekeyed)
	if !ok {
		t.Fatal("re-keyed value does not open under the new primary key")
	}
	if got != plain {
		t.Fatalf("re-keyed plaintext = %q, want %q (a double encryption would show base64 here)", got, plain)
	}
	// ...and NOT under the old one.
	if _, ok := open(oldKey, rekeyed); ok {
		t.Fatal("re-keyed value still opens under the old key; it was not re-sealed")
	}

	// Running again with the same keyring must now be a no-op.
	again, changed, err := reconcileValue(kr, rekeyed)
	if err != nil {
		t.Fatalf("second rekey pass: %v", err)
	}
	if changed || again != rekeyed {
		t.Fatal("rotation is not idempotent: a second pass rewrote an already-current value")
	}
}

// TestReconcileValueRefusesUnknownKey is the "refuse to run destructively"
// guarantee at the value level.
func TestReconcileValueRefusesUnknownKey(t *testing.T) {
	t.Parallel()
	primary, foreign := mustKey(t), mustKey(t)
	kr := keyring{primary: primary}

	_, _, err := reconcileValue(kr, mustEncrypt(t, foreign, "12-3456789"))
	if !errors.Is(err, errUnknownKey) {
		t.Fatalf("err = %v, want errUnknownKey — unopenable ciphertext must abort, never be re-encrypted", err)
	}
}

// TestOldToolWouldHaveDestroyedData documents the bug being fixed: it
// reproduces the old code path (encrypt the raw column value with no decrypt)
// and shows the result is unrecoverable in one unseal, then shows the new
// reconciler declines to produce it.
func TestOldToolWouldHaveDestroyedData(t *testing.T) {
	t.Parallel()
	oldKey, newKey := mustKey(t), mustKey(t)
	const plain = "12-3456789"
	stale := mustEncrypt(t, oldKey, plain)

	// What the old tool did: encrypt(newKey, <raw column value>).
	doubled := mustEncrypt(t, newKey, stale)
	got, ok := open(newKey, doubled)
	if !ok {
		t.Fatal("setup: doubled value should open once")
	}
	if got == plain {
		t.Fatal("setup is wrong: one unseal should NOT yield the plaintext")
	}
	if got != stale {
		t.Fatalf("setup: one unseal should yield the inner ciphertext, got %q", got)
	}
	// Recovering the plaintext needs a SECOND unseal with the OLD key — which
	// no read path in the platform performs.
	if inner, ok := open(oldKey, got); !ok || inner != plain {
		t.Fatalf("setup: second unseal with the old key should recover %q", plain)
	}

	// The new reconciler, given the same input and both keys, produces a value
	// that opens to the plaintext in ONE step.
	kr := keyring{primary: newKey, previous: oldKey}
	fixed, _, err := reconcileValue(kr, stale)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if v, ok := open(newKey, fixed); !ok || v != plain {
		t.Fatalf("new tool: one unseal yields (%q, %v), want %q", v, ok, plain)
	}
}

// ── argon2id backup codes ────────────────────────────────────────────────

func TestReconcileBackupCodeIdempotent(t *testing.T) {
	t.Parallel()
	hashed, changed, err := reconcileBackupCode("ABCD-1234")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !changed {
		t.Fatal("expected the raw code to be hashed")
	}
	if !strings.HasPrefix(hashed, argon2idPrefix) {
		t.Fatalf("hash %q lacks the %q prefix", hashed, argon2idPrefix)
	}
	again, changed, err := reconcileBackupCode(hashed)
	if err != nil {
		t.Fatalf("rehash: %v", err)
	}
	if changed || again != hashed {
		t.Fatal("re-hashing an already-hashed backup code must be a no-op")
	}
}

// ── DATE columns draining into sibling TEXT columns (migration 106) ──────

var testDateSpec = dateColSpec{dateCol: "dob", encCol: "dob_encrypted"}

// TestReconcileDatePair covers every combination of (DATE present?) x (what the
// sibling ciphertext column holds). The invariant across all of them: the tool
// never asks for the DATE to be cleared without a readable ciphertext for it
// existing in the same UPDATE.
func TestReconcileDatePair(t *testing.T) {
	t.Parallel()
	primary, previous := mustKey(t), mustKey(t)
	kr := keyring{primary: primary, previous: previous}
	const dob = "1985-03-14"
	const otherDOB = "1990-11-02"

	tests := []struct {
		name string
		pair datePair
		// want* describe the decision.
		wantWrite     bool
		wantEncrypted bool
		wantRekeyed   bool
		wantWarn      bool
		// wantPlain is what the resulting ciphertext must unseal to.
		wantPlain string
	}{
		{
			name: "nothing set at all",
			pair: datePair{},
		},
		{
			name:          "first backfill: plaintext DATE, no ciphertext",
			pair:          datePair{date: strp(dob)},
			wantWrite:     true,
			wantEncrypted: true,
			wantPlain:     dob,
		},
		{
			name:      "already drained: DATE NULL, ciphertext current",
			pair:      datePair{enc: strp(mustEncrypt(t, primary, dob))},
			wantPlain: dob,
		},
		{
			// Partially applied earlier run. The ciphertext wins; the DATE is
			// cleared; the operator is told.
			name:      "both present: ciphertext wins and the DATE is cleared",
			pair:      datePair{date: strp(otherDOB), enc: strp(mustEncrypt(t, primary, dob))},
			wantWrite: true,
			wantWarn:  true,
			wantPlain: dob,
		},
		{
			name:        "rotation: DATE NULL, ciphertext under PREVIOUS",
			pair:        datePair{enc: strp(mustEncrypt(t, previous, dob))},
			wantWrite:   true,
			wantRekeyed: true,
			wantPlain:   dob,
		},
		{
			name:        "rotation on a row the backfill never finished",
			pair:        datePair{date: strp(otherDOB), enc: strp(mustEncrypt(t, previous, dob))},
			wantWrite:   true,
			wantRekeyed: true,
			wantWarn:    true,
			wantPlain:   dob,
		},
		{
			name:          "sibling column holds an unencrypted date",
			pair:          datePair{enc: strp(dob)},
			wantWrite:     true,
			wantEncrypted: true,
			wantPlain:     dob,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			d, err := reconcileDatePair(kr, testDateSpec, tc.pair)
			if err != nil {
				t.Fatalf("reconcileDatePair: %v", err)
			}
			if d.write != tc.wantWrite {
				t.Errorf("write = %v, want %v", d.write, tc.wantWrite)
			}
			if d.encrypted != tc.wantEncrypted {
				t.Errorf("encrypted = %v, want %v", d.encrypted, tc.wantEncrypted)
			}
			if d.rekeyed != tc.wantRekeyed {
				t.Errorf("rekeyed = %v, want %v", d.rekeyed, tc.wantRekeyed)
			}
			if (d.warn != "") != tc.wantWarn {
				t.Errorf("warn = %q, wantWarn = %v", d.warn, tc.wantWarn)
			}
			if tc.wantPlain == "" {
				if d.enc != nil {
					t.Errorf("enc = %q, want nil", *d.enc)
				}
				return
			}
			if d.enc == nil {
				t.Fatal("enc is nil; expected a ciphertext")
			}
			got, ok := open(primary, *d.enc)
			if !ok {
				t.Fatal("result does not open under the primary key")
			}
			if got != tc.wantPlain {
				t.Fatalf("one unseal yields %q, want %q (a double encryption would show base64)", got, tc.wantPlain)
			}
		})
	}
}

// TestReconcileDatePairNeverClearsADateWithoutPreservingIt is the safety
// invariant, stated directly: updateSQL writes `dob = NULL` unconditionally, so
// any decision that permits a write while a DATE is present MUST carry a
// ciphertext that unseals to a date.
func TestReconcileDatePairNeverClearsADateWithoutPreservingIt(t *testing.T) {
	t.Parallel()
	primary, previous := mustKey(t), mustKey(t)
	kr := keyring{primary: primary, previous: previous}
	const dob = "1985-03-14"

	pairs := []datePair{
		{date: strp(dob)},
		{date: strp(dob), enc: strp(mustEncrypt(t, primary, "1990-11-02"))},
		{date: strp(dob), enc: strp(mustEncrypt(t, previous, "1990-11-02"))},
		{date: strp(dob), enc: strp("1990-11-02")},
	}
	for _, p := range pairs {
		d, err := reconcileDatePair(kr, testDateSpec, p)
		if err != nil {
			t.Fatalf("reconcileDatePair: %v", err)
		}
		if !d.write {
			t.Fatal("a surviving plaintext DATE must always produce a write")
		}
		if d.enc == nil {
			t.Fatal("the DATE would be cleared with nothing preserving it")
		}
		if _, ok := open(primary, *d.enc); !ok {
			t.Fatal("the value replacing the DATE does not open under the primary key")
		}
	}
}

// TestReconcileDatePairIsIdempotent: feed the decision back in as the database
// would hold it. A second pass must write nothing and must not re-seal.
func TestReconcileDatePairIsIdempotent(t *testing.T) {
	t.Parallel()
	primary := mustKey(t)
	kr := keyring{primary: primary}
	const dob = "1985-03-14"

	d, err := reconcileDatePair(kr, testDateSpec, datePair{date: strp(dob)})
	if err != nil {
		t.Fatalf("pass 1: %v", err)
	}
	stored := *d.enc

	for i := 2; i <= 5; i++ {
		// The DATE is now NULL, exactly as the UPDATE left it.
		d, err = reconcileDatePair(kr, testDateSpec, datePair{enc: strp(stored)})
		if err != nil {
			t.Fatalf("pass %d: %v", i, err)
		}
		if d.write {
			t.Fatalf("pass %d issued a write; repeat runs must be free", i)
		}
		if *d.enc != stored {
			t.Fatalf("pass %d mutated the ciphertext", i)
		}
		if got, ok := open(primary, *d.enc); !ok || got != dob {
			t.Fatalf("pass %d: unseal = (%q, %v), want %q — DOUBLE ENCRYPTION", i, got, ok, dob)
		}
	}
}

func TestReconcileDatePairRefusesUnknownKey(t *testing.T) {
	t.Parallel()
	primary, foreign := mustKey(t), mustKey(t)
	kr := keyring{primary: primary}

	_, err := reconcileDatePair(kr, testDateSpec, datePair{
		date: strp("1985-03-14"),
		enc:  strp(mustEncrypt(t, foreign, "1990-11-02")),
	})
	if !errors.Is(err, errUnknownKey) {
		t.Fatalf("err = %v, want errUnknownKey", err)
	}
}

// ── key handling ─────────────────────────────────────────────────────────

func TestDecodeKey(t *testing.T) {
	t.Parallel()
	k := mustKey(t)
	std := base64.StdEncoding.EncodeToString(k[:])
	got, err := decodeKey(std)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if *got != *k {
		t.Error("round-trip mismatch")
	}
	for _, bad := range []string{"", "not-base64!!", base64.StdEncoding.EncodeToString([]byte("short"))} {
		if _, err := decodeKey(bad); err == nil {
			t.Errorf("decodeKey(%q) should have failed", bad)
		}
	}
}

// TestVerifyRoundTripCatchesMismatch guards the pre-write verification.
func TestVerifyRoundTripCatchesMismatch(t *testing.T) {
	t.Parallel()
	key, other := mustKey(t), mustKey(t)
	ct := mustEncrypt(t, key, "hello")

	if err := verifyRoundTrip(key, ct, "hello"); err != nil {
		t.Fatalf("valid round trip rejected: %v", err)
	}
	if err := verifyRoundTrip(key, ct, "goodbye"); err == nil {
		t.Error("expected a mismatch error")
	}
	if err := verifyRoundTrip(other, ct, "hello"); err == nil {
		t.Error("expected an unopenable error under the wrong key")
	}
}

// TestSpecsAreWellFormed keeps the literal SQL in sync with the column lists
// it is scanned against.
func TestSpecsAreWellFormed(t *testing.T) {
	t.Parallel()
	for _, s := range specs {
		s := s
		t.Run(s.name, func(t *testing.T) {
			t.Parallel()
			if len(s.piiCols) == 0 {
				t.Fatal("spec has no PII columns")
			}
			// Every PII and hash column must appear in both statements.
			for _, col := range append(append([]string{}, s.piiCols...), s.hashCols...) {
				if !strings.Contains(s.selectSQL, col) {
					t.Errorf("selectSQL does not project %q", col)
				}
				if !strings.Contains(s.updateSQL, col) {
					t.Errorf("updateSQL does not set %q", col)
				}
			}
			// The legacy advisory flag exists on the 031/033 tables only.
			// `jobs` and `provider_licenses` deliberately have no such column
			// (migrations 104/106) and the SQL must not reference one.
			if s.hasFlag {
				if !strings.Contains(s.selectSQL, "pii_encrypted_v1") {
					t.Error("selectSQL must project pii_encrypted_v1")
				}
				if !strings.Contains(s.updateSQL, "pii_encrypted_v1 = TRUE") {
					t.Error("updateSQL must set pii_encrypted_v1")
				}
			} else {
				if strings.Contains(s.selectSQL, "pii_encrypted_v1") ||
					strings.Contains(s.updateSQL, "pii_encrypted_v1") {
					t.Error("this table has no pii_encrypted_v1 column; the SQL must not reference one")
				}
			}
			// Each DATE column is projected as text beside its ciphertext
			// sibling, and the update clears it in the SAME statement that
			// writes the ciphertext. That co-location is what makes "a non-NULL
			// DATE means unprocessed" true, which is what pii_plaintext_audit
			// (migration 107) tests.
			for _, dc := range s.dateCols {
				if !strings.Contains(s.selectSQL, "to_char("+dc.dateCol+", 'YYYY-MM-DD')") {
					t.Errorf("selectSQL must project %q as YYYY-MM-DD text", dc.dateCol)
				}
				if !strings.Contains(s.selectSQL, dc.encCol) {
					t.Errorf("selectSQL does not project %q", dc.encCol)
				}
				if !strings.Contains(s.updateSQL, dc.dateCol+" = NULL, "+dc.encCol+" = $") {
					t.Errorf("updateSQL must clear %q and write %q in the same statement", dc.dateCol, dc.encCol)
				}
			}
			// Keyset pagination must be present or scanTable loops forever.
			if !strings.Contains(s.selectSQL, "$1") || !strings.Contains(s.selectSQL, "ORDER BY id::text") {
				t.Error("selectSQL must paginate on the id cursor and order by id::text")
			}
			// The update must be single-row scoped.
			if !strings.Contains(s.updateSQL, "WHERE id::text = $1") {
				t.Error("updateSQL must be scoped to one id")
			}
			// The bind list is assembled positionally in reconcileTable as
			// id, pii..., dates..., hashes... — so the statement must have
			// exactly that many placeholders, numbered contiguously. Adding a
			// column to one side and not the other is the drift this catches.
			wantBinds := 1 + len(s.piiCols) + len(s.dateCols) + len(s.hashCols)
			for i := 1; i <= wantBinds; i++ {
				if !strings.Contains(s.updateSQL, "$"+strconv.Itoa(i)) {
					t.Errorf("updateSQL is missing placeholder $%d", i)
				}
			}
			if strings.Contains(s.updateSQL, "$"+strconv.Itoa(wantBinds+1)) {
				t.Errorf("updateSQL binds more than the %d values reconcileTable supplies", wantBinds)
			}
		})
	}
}
