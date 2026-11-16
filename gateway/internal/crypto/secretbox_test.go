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
	// Must be explicitly development. An EMPTY value used to reach this
	// fallback too, which is what let staging pods generate a different
	// ephemeral key each — see TestFromEnv_NonDevelopmentFailsClosed.
	t.Setenv("ENVIRONMENT", "development")
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

// TestFromEnv_NonDevelopmentFailsClosed pins the polarity of the environment
// gate. The check is "is this development?" — NOT "is this production?".
//
// Under the old `env == "production"` check, every value below fell through to
// the ephemeral-key branch. That mattered most for "staging", which the
// overlay sets explicitly and which runs multiple replicas: each pod generated
// its own random key, so PII written by one was undecryptable by another and
// by itself after a restart — silent, permanent corruption, logged as
// "DEV ONLY". Anything not recognizably development must fail closed.
func TestFromEnv_NonDevelopmentFailsClosed(t *testing.T) {
	for _, env := range []string{"", "staging", "prod", "Production", "test", "qa"} {
		name := env
		if name == "" {
			name = "empty"
		}
		t.Run(name, func(t *testing.T) {
			t.Setenv("ENCRYPTION_KEY", "")
			t.Setenv("ENCRYPTION_KEY_PREVIOUS", "")
			t.Setenv("ENVIRONMENT", env)
			if _, err := FromEnv(); err == nil {
				t.Errorf("FromEnv with ENVIRONMENT=%q and no key: expected an error, got nil", env)
			}
		})
	}
}

// Casing and surrounding whitespace must not flip a security decision.
func TestFromEnv_DevelopmentIsCaseAndSpaceInsensitive(t *testing.T) {
	for _, env := range []string{"development", "Development", " development ", "DEVELOPMENT"} {
		t.Run(env, func(t *testing.T) {
			t.Setenv("ENCRYPTION_KEY", "")
			t.Setenv("ENCRYPTION_KEY_PREVIOUS", "")
			t.Setenv("ENVIRONMENT", env)
			if _, err := FromEnv(); err != nil {
				t.Errorf("FromEnv with ENVIRONMENT=%q: expected the dev fallback, got %v", env, err)
			}
		})
	}
}
