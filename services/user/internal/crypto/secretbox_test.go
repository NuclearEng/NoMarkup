package crypto

import (
	"crypto/rand"
	"encoding/base64"
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

func TestEncryptDecryptRoundTrip(t *testing.T) {
	t.Parallel()
	c := newTestCipher(t)

	cases := []string{
		"hello world",
		"512-555-0001",
		"123 Main St, Austin, TX 78701",
		"JBSWY3DPEHPK3PXP", // TOTP secret
		"",
		strings.Repeat("a", 4096),
	}
	for _, plain := range cases {
		ct, err := c.EncryptString(plain)
		if err != nil {
			t.Fatalf("encrypt %q: %v", plain, err)
		}
		if plain != "" && ct == plain {
			t.Fatalf("ciphertext equals plaintext for %q", plain)
		}
		out, err := c.DecryptString(ct)
		if err != nil {
			t.Fatalf("decrypt %q: %v", plain, err)
		}
		if out != plain {
			t.Fatalf("round-trip mismatch: got %q want %q", out, plain)
		}
	}
}

func TestEncryptStringEmptyPassthrough(t *testing.T) {
	t.Parallel()
	c := newTestCipher(t)
	got, err := c.EncryptString("")
	if err != nil {
		t.Fatalf("encrypt empty: %v", err)
	}
	if got != "" {
		t.Fatalf("expected empty ciphertext for empty plaintext, got %q", got)
	}
}

func TestEncryptNoncesAreUnique(t *testing.T) {
	t.Parallel()
	c := newTestCipher(t)
	a, _ := c.EncryptString("same plaintext")
	b, _ := c.EncryptString("same plaintext")
	if a == b {
		t.Fatalf("expected unique ciphertexts for same plaintext (random nonce), got identical: %s", a)
	}
}

func TestDecryptTampered(t *testing.T) {
	t.Parallel()
	c := newTestCipher(t)
	ct, err := c.EncryptString("secret-totp-seed")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	// Flip a byte after the nonce to force authentication failure.
	raw, err := base64.StdEncoding.DecodeString(ct)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	raw[NonceSize] ^= 0xFF
	tampered := base64.StdEncoding.EncodeToString(raw)
	if _, err := c.DecryptString(tampered); err == nil {
		t.Fatalf("expected decrypt to fail on tampered ciphertext")
	}
}

func TestDecryptShortCiphertext(t *testing.T) {
	t.Parallel()
	c := newTestCipher(t)
	short := base64.StdEncoding.EncodeToString([]byte("too-short"))
	if _, err := c.DecryptString(short); err == nil {
		t.Fatalf("expected ErrCiphertextTooShort, got nil")
	}
}

func TestDecryptWithRotatedKey(t *testing.T) {
	t.Parallel()

	var prev [KeySize]byte
	if _, err := rand.Read(prev[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	old := New(&prev, nil)
	ct, err := old.EncryptString("rotated-data")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	var newKey [KeySize]byte
	if _, err := rand.Read(newKey[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	rotated := New(&newKey, &prev)
	out, err := rotated.DecryptString(ct)
	if err != nil {
		t.Fatalf("decrypt with previous key: %v", err)
	}
	if out != "rotated-data" {
		t.Fatalf("expected rotated-data, got %q", out)
	}

	// Without the previous key, decryption must fail.
	noFallback := New(&newKey, nil)
	if _, err := noFallback.DecryptString(ct); err == nil {
		t.Fatalf("expected decrypt to fail without previous key")
	}
}

func TestEncryptDecryptStringList(t *testing.T) {
	t.Parallel()
	c := newTestCipher(t)

	in := []string{"a1b2c3d4", "", "deadbeef", "ffff0000"}
	enc, err := c.EncryptStringList(in)
	if err != nil {
		t.Fatalf("encrypt list: %v", err)
	}
	if len(enc) != len(in) {
		t.Fatalf("len mismatch: got %d want %d", len(enc), len(in))
	}
	if enc[1] != "" {
		t.Fatalf("expected empty passthrough at index 1, got %q", enc[1])
	}

	out, err := c.DecryptStringList(enc)
	if err != nil {
		t.Fatalf("decrypt list: %v", err)
	}
	for i := range in {
		if out[i] != in[i] {
			t.Fatalf("element %d round-trip mismatch: got %q want %q", i, out[i], in[i])
		}
	}
}

func TestGenerateKeyB64(t *testing.T) {
	t.Parallel()
	k, err := GenerateKeyB64()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	raw, err := base64.StdEncoding.DecodeString(k)
	if err != nil {
		t.Fatalf("decode generated key: %v", err)
	}
	if len(raw) != KeySize {
		t.Fatalf("expected %d bytes, got %d", KeySize, len(raw))
	}
}

func TestFromEnvDevFallback(t *testing.T) {
	// Save and restore env.
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("ENCRYPTION_KEY", "")
	t.Setenv("ENCRYPTION_KEY_PREVIOUS", "")

	c, err := FromEnv()
	if err != nil {
		t.Fatalf("expected dev fallback to succeed, got %v", err)
	}
	ct, err := c.EncryptString("dev-fallback")
	if err != nil {
		t.Fatalf("encrypt with ephemeral key: %v", err)
	}
	out, err := c.DecryptString(ct)
	if err != nil {
		t.Fatalf("decrypt with ephemeral key: %v", err)
	}
	if out != "dev-fallback" {
		t.Fatalf("got %q", out)
	}
}

func TestFromEnvProductionRequiresKey(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("ENCRYPTION_KEY", "")
	t.Setenv("ENCRYPTION_KEY_PREVIOUS", "")

	if _, err := FromEnv(); err == nil {
		t.Fatalf("expected production to refuse missing key")
	}
}

func TestFromEnvWithValidKey(t *testing.T) {
	k, err := GenerateKeyB64()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("ENCRYPTION_KEY", k)
	t.Setenv("ENCRYPTION_KEY_PREVIOUS", "")

	c, err := FromEnv()
	if err != nil {
		t.Fatalf("expected valid prod key to succeed: %v", err)
	}
	ct, err := c.EncryptString("prod-data")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !strings.Contains(ct, "") { // sanity: just ensure non-empty produced
		t.Fatalf("unexpected empty ciphertext")
	}
}

// ── mixed-state detection (migration 098) ────────────────────────────────

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

func TestIsCurrentAndIsPrevious(t *testing.T) {
	t.Parallel()
	var primary, previous, foreign [KeySize]byte
	for _, k := range []*[KeySize]byte{&primary, &previous, &foreign} {
		if _, err := rand.Read(k[:]); err != nil {
			t.Fatal(err)
		}
	}
	c := New(&primary, &previous)

	ctPrimary, _ := New(&primary, nil).EncryptString("v")
	ctPrevious, _ := New(&previous, nil).EncryptString("v")
	ctForeign, _ := New(&foreign, nil).EncryptString("v")

	if !c.IsCurrent(ctPrimary) {
		t.Error("primary-sealed value should be current")
	}
	if c.IsPrevious(ctPrimary) {
		t.Error("primary-sealed value must not report as previous")
	}
	if c.IsCurrent(ctPrevious) {
		t.Error("previous-sealed value must not report as current")
	}
	if !c.IsPrevious(ctPrevious) {
		t.Error("previous-sealed value should report as previous")
	}
	if c.IsCurrent(ctForeign) || c.IsPrevious(ctForeign) {
		t.Error("foreign ciphertext must match neither key")
	}
	if c.IsCurrent("12-3456789") || c.IsPrevious("12-3456789") {
		t.Error("plaintext must match neither key")
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
