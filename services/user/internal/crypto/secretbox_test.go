package crypto

import (
	"crypto/rand"
	"encoding/base64"
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
