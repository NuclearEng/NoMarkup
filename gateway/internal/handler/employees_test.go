package handler

import (
	"crypto/rand"
	"testing"

	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
)

func newCipher(t *testing.T) *crypto.Cipher {
	t.Helper()
	var k [crypto.KeySize]byte
	if _, err := rand.Read(k[:]); err != nil {
		t.Fatal(err)
	}
	return crypto.New(&k, nil)
}

func TestEncryptIfNonEmpty(t *testing.T) {
	t.Parallel()
	c := newCipher(t)

	t.Run("empty passes through", func(t *testing.T) {
		t.Parallel()
		got, err := encryptIfNonEmpty(c, "")
		if err != nil {
			t.Fatal(err)
		}
		if got != "" {
			t.Errorf("expected empty, got %q", got)
		}
	})

	t.Run("non-empty is ciphertext", func(t *testing.T) {
		t.Parallel()
		got, err := encryptIfNonEmpty(c, "alice@example.com")
		if err != nil {
			t.Fatal(err)
		}
		if got == "alice@example.com" {
			t.Error("expected ciphertext, got plaintext")
		}
		// Round-trip back.
		pt, err := c.DecryptString(got)
		if err != nil {
			t.Fatal(err)
		}
		if pt != "alice@example.com" {
			t.Errorf("round-trip: got %q", pt)
		}
	})
}

func TestDecryptIfEncrypted(t *testing.T) {
	t.Parallel()
	c := newCipher(t)
	ct, err := c.EncryptString("512-555-0123")
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name         string
		value        string
		piiEncrypted bool
		want         string
	}{
		{"legacy plaintext", "512-555-0001", false, "512-555-0001"},
		{"encrypted row decrypts", ct, true, "512-555-0123"},
		{"empty encrypted stays empty", "", true, ""},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := decryptIfEncrypted(c, tc.value, tc.piiEncrypted)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Errorf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestEncryptOptional(t *testing.T) {
	t.Parallel()
	c := newCipher(t)

	t.Run("nil pointer", func(t *testing.T) {
		t.Parallel()
		got, err := encryptOptional(c, nil)
		if err != nil {
			t.Fatal(err)
		}
		if got != nil {
			t.Errorf("expected nil, got %v", *got)
		}
	})

	t.Run("empty pointer", func(t *testing.T) {
		t.Parallel()
		s := ""
		got, err := encryptOptional(c, &s)
		if err != nil {
			t.Fatal(err)
		}
		if got == nil || *got != "" {
			t.Errorf("expected non-nil empty, got %v", got)
		}
	})

	t.Run("non-empty pointer is ciphertext", func(t *testing.T) {
		t.Parallel()
		s := "license-123"
		got, err := encryptOptional(c, &s)
		if err != nil {
			t.Fatal(err)
		}
		if got == nil || *got == "license-123" {
			t.Errorf("expected ciphertext, got %v", got)
		}
	})
}
