package handler

import (
	"crypto/rand"
	"errors"
	"testing"
	"time"

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

// TestDecryptEmployeePII pins the per-VALUE contract that replaced the
// per-ROW pii_encrypted_v1 branch.
//
// The old decryptIfEncrypted took the row flag and trusted it. Because the flag
// is per ROW while encryption is per COLUMN, both of its wrong answers were
// reachable on a real row: flag TRUE over a column the backfill never touched
// tried to decrypt plaintext, and flag FALSE over a column the encrypting
// update path had already rewritten returned raw base64 to the caller. The
// "mixed row" cases below are exactly those two, and they now pass without the
// flag being consulted at all.
func TestDecryptEmployeePII(t *testing.T) {
	t.Parallel()
	c := newCipher(t)
	ct, err := c.EncryptString("512-555-0123")
	if err != nil {
		t.Fatal(err)
	}
	dobCT, err := c.EncryptString("1990-04-17")
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name  string
		value string
		want  string
	}{
		{"legacy plaintext passes through", "512-555-0001", "512-555-0001"},
		{"ciphertext decrypts", ct, "512-555-0123"},
		{"empty stays empty", "", ""},
		{"encrypted date of birth decrypts", dobCT, "1990-04-17"},
		// Mixed row, direction 1: this column is still plaintext while the row
		// flag says TRUE. The old code decrypted it and failed.
		{"mixed row: plaintext column on a flagged row", "WA-58213", "WA-58213"},
		{"mixed row: plaintext email on a flagged row", "alice@example.com", "alice@example.com"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := decryptEmployeePII(c, tc.value)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Errorf("got %q want %q", got, tc.want)
			}
		})
	}

	// Mixed row, direction 2: the column IS ciphertext. Whatever any row flag
	// says, the caller must get plaintext and never the stored base64.
	t.Run("mixed row: ciphertext column on an unflagged row", func(t *testing.T) {
		t.Parallel()
		got, err := decryptEmployeePII(c, ct)
		if err != nil {
			t.Fatal(err)
		}
		if got == ct {
			t.Fatal("returned the RAW stored ciphertext — a caller must never receive base64")
		}
		if got != "512-555-0123" {
			t.Errorf("got %q want %q", got, "512-555-0123")
		}
	})
}

// TestDecryptEmployeePIIUnopenable: a value that IS our wire format but which
// no configured key opens is a KEY problem. It must error, not be passed
// through as if it were legacy plaintext.
func TestDecryptEmployeePIIUnopenable(t *testing.T) {
	t.Parallel()
	var foreign [crypto.KeySize]byte
	for i := range foreign {
		foreign[i] = byte(211 - i)
	}
	orphan, err := crypto.New(&foreign, nil).EncryptString("512-555-0123")
	if err != nil {
		t.Fatal(err)
	}

	got, err := decryptEmployeePII(newCipher(t), orphan)
	if err == nil {
		t.Fatalf("expected an error for unopenable ciphertext, got %q", got)
	}
	if !errors.Is(err, crypto.ErrDecryptFailed) {
		t.Errorf("error = %v, want ErrDecryptFailed", err)
	}
	if got == orphan {
		t.Error("returned the RAW stored ciphertext")
	}
}

// TestDecryptEmployeePIINoCipher: with no key configured we cannot tell
// ciphertext from plaintext, so the read must fail rather than risk emitting
// base64 as if it were an email address.
func TestDecryptEmployeePIINoCipher(t *testing.T) {
	t.Parallel()
	if got, err := decryptEmployeePII(nil, "anything"); err == nil {
		t.Fatalf("expected an error with a nil cipher, got %q", got)
	}
	// An empty column is still not an error — there is nothing to leak.
	if got, err := decryptEmployeePII(nil, ""); err != nil || got != "" {
		t.Errorf("empty value: got (%q, %v), want (\"\", nil)", got, err)
	}
}

// TestIsoDate pins the exact plaintext format that goes into the cipher: the
// encrypted column must hold precisely what scanEmployee hands back to clients.
func TestIsoDate(t *testing.T) {
	t.Parallel()
	if got := isoDate(nil); got != "" {
		t.Errorf("nil date: got %q, want empty", got)
	}
	d := time.Date(1990, time.April, 17, 13, 45, 0, 0, time.UTC)
	if got := isoDate(&d); got != "1990-04-17" {
		t.Errorf("got %q, want %q", got, "1990-04-17")
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
