package crypto

import (
	"crypto/rand"
	"errors"
	"strings"
	"testing"
)

func newTestCipher(t *testing.T) *Cipher {
	t.Helper()
	var key [KeySize]byte
	if _, err := rand.Read(key[:]); err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return New(&key, nil)
}

// TestLooksLikeCiphertextRejectsRealPII pins the claim the whole
// plaintext-vs-ciphertext discriminator rests on: the actual values stored in
// these columns cannot be mistaken for our wire format.
func TestLooksLikeCiphertextRejectsRealPII(t *testing.T) {
	t.Parallel()
	for _, s := range []string{
		"12-3456789",                       // EIN/TIN
		"123456789",                        // EIN/TIN undashed
		"POL-0099887766",                   // insurance policy number
		"GL 4471192",                       // policy number with a space
		"512-555-0001",                     // phone
		"456 Service Rd, Austin, TX 78702", // service address
		"JBSWY3DPEHPK3PXP",                 // TOTP seed
		"",                                 // empty
		"abcd",                             // short but base64-legal
		strings.Repeat("A", 55),            // one char below the 56-char floor
	} {
		if LooksLikeCiphertext(s) {
			t.Errorf("LooksLikeCiphertext(%q) = true; real PII must never look like ciphertext", s)
		}
	}
}

func TestLooksLikeCiphertextAcceptsRealCiphertext(t *testing.T) {
	t.Parallel()
	c := newTestCipher(t)
	for _, s := range []string{"x", "12-3456789", strings.Repeat("y", 4096)} {
		ct, err := c.EncryptString(s)
		if err != nil {
			t.Fatalf("encrypt: %v", err)
		}
		if !LooksLikeCiphertext(ct) {
			t.Errorf("LooksLikeCiphertext(encrypt(%q)) = false", s)
		}
	}
}

// TestDecryptStringOrPassthrough covers the three outcomes the mixed
// legacy/backfilled state requires — most importantly that ciphertext no key
// opens is an ERROR, never passed through as if it were plaintext.
func TestDecryptStringOrPassthrough(t *testing.T) {
	t.Parallel()
	var primary, foreign [KeySize]byte
	if _, err := rand.Read(primary[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := rand.Read(foreign[:]); err != nil {
		t.Fatal(err)
	}
	c := New(&primary, nil)

	ct, err := c.EncryptString("12-3456789")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	orphan, err := New(&foreign, nil).EncryptString("12-3456789")
	if err != nil {
		t.Fatalf("encrypt foreign: %v", err)
	}

	// 1. Ciphertext decrypts.
	if got, err := c.DecryptStringOrPassthrough(ct); err != nil || got != "12-3456789" {
		t.Errorf("ciphertext: got (%q, %v), want (%q, nil)", got, err, "12-3456789")
	}
	// 2. Legacy plaintext passes through untouched.
	for _, plain := range []string{"12-3456789", "POL-0099887766", "456 Service Rd, Austin, TX 78702", ""} {
		got, err := c.DecryptStringOrPassthrough(plain)
		if err != nil || got != plain {
			t.Errorf("plaintext %q: got (%q, %v), want (%q, nil)", plain, got, err, plain)
		}
	}
	// 3. Wire-format ciphertext no key opens is a loud failure, and the raw
	//    value is never returned.
	got, err := c.DecryptStringOrPassthrough(orphan)
	if !errors.Is(err, ErrDecryptFailed) {
		t.Errorf("orphan ciphertext: err = %v, want ErrDecryptFailed", err)
	}
	if got == orphan {
		t.Error("orphan ciphertext was returned verbatim; it must never be passed through")
	}
}
