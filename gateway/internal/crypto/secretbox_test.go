package crypto

import (
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
)

func newTestCipher(t *testing.T) *Cipher {
	t.Helper()
	var k [KeySize]byte
	if _, err := rand.Read(k[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return New(&k, nil)
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	t.Parallel()
	c := newTestCipher(t)
	cases := []struct {
		name string
		in   string
	}{
		{"plain phone", "512-555-0001"},
		{"email", "alice@example.com"},
		{"unicode", "📞 ☎️ あ"},
		{"empty", ""},
		{"long", strings.Repeat("x", 4096)},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ct, err := c.EncryptString(tc.in)
			if err != nil {
				t.Fatalf("encrypt: %v", err)
			}
			pt, err := c.DecryptString(ct)
			if err != nil {
				t.Fatalf("decrypt: %v", err)
			}
			if pt != tc.in {
				t.Errorf("round-trip mismatch: got %q want %q", pt, tc.in)
			}
		})
	}
}

func TestDecryptWithPreviousKey(t *testing.T) {
	t.Parallel()
	var prev [KeySize]byte
	if _, err := rand.Read(prev[:]); err != nil {
		t.Fatal(err)
	}
	older := New(&prev, nil)
	ct, err := older.EncryptString("rotate-me")
	if err != nil {
		t.Fatalf("encrypt with old key: %v", err)
	}

	var newKey [KeySize]byte
	if _, err := rand.Read(newKey[:]); err != nil {
		t.Fatal(err)
	}
	rotated := New(&newKey, &prev)
	pt, err := rotated.DecryptString(ct)
	if err != nil {
		t.Fatalf("decrypt with previous key: %v", err)
	}
	if pt != "rotate-me" {
		t.Errorf("got %q", pt)
	}
}

func TestDecryptTamperedFails(t *testing.T) {
	t.Parallel()
	c := newTestCipher(t)
	ct, err := c.EncryptString("hello")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	raw, err := base64.StdEncoding.DecodeString(ct)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Flip a byte in the ciphertext body.
	raw[NonceSize] ^= 0xff
	tampered := base64.StdEncoding.EncodeToString(raw)
	if _, err := c.DecryptString(tampered); err == nil {
		t.Error("expected tamper detection")
	}
}

func TestDecryptShortCiphertext(t *testing.T) {
	t.Parallel()
	c := newTestCipher(t)
	if _, err := c.DecryptString(base64.StdEncoding.EncodeToString([]byte("short"))); err == nil {
		t.Error("expected error on short ciphertext")
	}
}

func TestFromEnv_DevFallback(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "")
	t.Setenv("ENCRYPTION_KEY_PREVIOUS", "")
	t.Setenv("ENVIRONMENT", "")
	c, err := FromEnv()
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	ct, err := c.EncryptString("dev-only")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if pt, err := c.DecryptString(ct); err != nil || pt != "dev-only" {
		t.Errorf("dev round-trip failed: pt=%q err=%v", pt, err)
	}
}

func TestFromEnv_ProductionRefusesMissingKey(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "")
	t.Setenv("ENCRYPTION_KEY_PREVIOUS", "")
	t.Setenv("ENVIRONMENT", "production")
	if _, err := FromEnv(); err == nil {
		t.Error("expected production to refuse missing ENCRYPTION_KEY")
	}
}
