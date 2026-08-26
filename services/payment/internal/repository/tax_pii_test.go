package repository

import (
	"crypto/rand"
	"errors"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/crypto"
)

func testCipher(t *testing.T) *crypto.Cipher {
	t.Helper()
	var key [crypto.KeySize]byte
	if _, err := rand.Read(key[:]); err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return crypto.New(&key, nil)
}

// TestDecryptTaxFormAddress covers the 1099 read helper: plaintext passes,
// authenticable ciphertext decrypts, and unopenable secretbox-shaped values
// fail closed without emitting the raw base64.
func TestDecryptTaxFormAddress(t *testing.T) {
	t.Parallel()

	c := testCipher(t)
	r := &PostgresRepository{cipher: c}

	const street = "456 Service Rd, Austin, TX 78702"
	ct, err := c.EncryptString(street)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	t.Run("ciphertext decrypts", func(t *testing.T) {
		got, err := r.decryptTaxFormAddress(ct)
		if err != nil {
			t.Fatalf("decrypt: %v", err)
		}
		if got != street {
			t.Fatalf("got %q want %q", got, street)
		}
	})

	t.Run("plaintext passthrough", func(t *testing.T) {
		got, err := r.decryptTaxFormAddress(street)
		if err != nil {
			t.Fatalf("passthrough: %v", err)
		}
		if got != street {
			t.Fatalf("got %q want %q", got, street)
		}
	})

	t.Run("empty", func(t *testing.T) {
		got, err := r.decryptTaxFormAddress("")
		if err != nil || got != "" {
			t.Fatalf("empty: got (%q, %v)", got, err)
		}
	})

	t.Run("orphan ciphertext fails closed", func(t *testing.T) {
		var foreign [crypto.KeySize]byte
		if _, err := rand.Read(foreign[:]); err != nil {
			t.Fatal(err)
		}
		orphan, err := crypto.New(&foreign, nil).EncryptString(street)
		if err != nil {
			t.Fatalf("encrypt foreign: %v", err)
		}
		got, err := r.decryptTaxFormAddress(orphan)
		if !errors.Is(err, crypto.ErrDecryptFailed) {
			t.Fatalf("err = %v, want ErrDecryptFailed", err)
		}
		if got == orphan {
			t.Fatal("orphan ciphertext was returned verbatim; it must never be passed through")
		}
		if got != "" {
			t.Fatalf("fail-closed must return empty plaintext, got %q", got)
		}
	})

	t.Run("nil cipher plaintext passthrough", func(t *testing.T) {
		bare := &PostgresRepository{}
		got, err := bare.decryptTaxFormAddress(street)
		if err != nil || got != street {
			t.Fatalf("nil cipher plaintext: got (%q, %v)", got, err)
		}
	})

	t.Run("nil cipher ciphertext fails closed", func(t *testing.T) {
		bare := &PostgresRepository{}
		got, err := bare.decryptTaxFormAddress(ct)
		if !errors.Is(err, crypto.ErrKeyMissing) {
			t.Fatalf("err = %v, want ErrKeyMissing", err)
		}
		if got == ct {
			t.Fatal("nil-cipher ciphertext was returned verbatim")
		}
	})
}
