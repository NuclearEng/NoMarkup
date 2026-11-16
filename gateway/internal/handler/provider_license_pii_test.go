package handler

// Hermetic tests for provider_licenses.license_number at rest (migration 106).
// The DB round-trip lives in pii_at_rest_db_test.go behind -tags=dbtest.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
)

// TestOpenLicenseNumberBranches pins the per-VALUE contract for the licence
// column. provider_licenses deliberately has NO pii_encrypted_v1 column, so
// these three outcomes are the whole detection story.
func TestOpenLicenseNumberBranches(t *testing.T) {
	t.Parallel()
	c := newCipher(t)

	ct, err := c.EncryptString("WA-58213")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	var foreign [crypto.KeySize]byte
	for i := range foreign {
		foreign[i] = byte(97 + i)
	}
	orphan, err := crypto.New(&foreign, nil).EncryptString("WA-58213")
	if err != nil {
		t.Fatalf("encrypt foreign: %v", err)
	}

	tests := []struct {
		name    string
		stored  string
		want    string
		wantErr bool
	}{
		{"ciphertext decrypts", ct, "WA-58213", false},
		// Migration 062 seeded verified licences in clear, and every row written
		// before 106 is plaintext. Those must keep reading, untouched.
		{"legacy plaintext passes through", "WA-58213", "WA-58213", false},
		{"legacy plaintext with punctuation", "CA #1234567", "CA #1234567", false},
		{"empty", "", "", false},
		// Secretbox-shaped but unopenable is a KEY problem, never a "plaintext"
		// one: erroring is what stops the base64 reaching a caller.
		{"unopenable ciphertext errors", orphan, "", true},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := openLicenseNumber(context.Background(), c, tc.stored)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("openLicenseNumber(%q) = %q, want an error", tc.stored, got)
				}
				if got == tc.stored {
					t.Error("returned the RAW stored ciphertext — the licence read path must never emit base64")
				}
				if !errors.Is(err, crypto.ErrDecryptFailed) {
					t.Errorf("error = %v, want ErrDecryptFailed", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("openLicenseNumber(%q): %v", tc.stored, err)
			}
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// TestOpenLicenseNumberNoCipher: with no key we cannot distinguish ciphertext
// from plaintext, so the read fails closed rather than gambling.
func TestOpenLicenseNumberNoCipher(t *testing.T) {
	t.Parallel()
	got, err := openLicenseNumber(context.Background(), nil, "WA-58213")
	if err == nil {
		t.Fatalf("expected an error with a nil cipher, got %q", got)
	}
	if !errors.Is(err, crypto.ErrKeyMissing) {
		t.Errorf("error = %v, want ErrKeyMissing", err)
	}
}

// TestMaskAppliesToPlaintextNotCiphertext is THE regression this file exists
// for.
//
// The public badge endpoint (ListProviderVerifiedLicenses) masks to last-4 and
// is edge-cached. If masking ran on the stored column while that column held
// ciphertext, the "last 4" served to anonymous callers would be the last four
// base64 characters of a random nonce: it would mask nothing meaningful, it
// would not be stable across a re-encrypt of the same licence, and it would
// silently be wrong rather than visibly broken.
func TestMaskAppliesToPlaintextNotCiphertext(t *testing.T) {
	t.Parallel()
	c := newCipher(t)

	const plaintext = "WA-58213"
	ct, err := c.EncryptString(plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	// Decrypt FIRST, then mask — the order scanLicenseRows uses.
	opened, err := openLicenseNumber(context.Background(), c, ct)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	got := maskLicenseNumber(opened)

	want := "••••" + plaintext[len(plaintext)-4:] // ••••8213
	if got != want {
		t.Errorf("masked licence = %q, want %q (the last 4 of the PLAINTEXT)", got, want)
	}

	// And prove the broken ordering would have produced something else entirely.
	wrong := maskLicenseNumber(ct)
	if wrong == want {
		t.Fatal("masking the ciphertext produced the same result as masking the plaintext; " +
			"this test can no longer detect the regression")
	}
	if strings.Contains(got, ct[len(ct)-4:]) {
		t.Errorf("masked licence %q contains the tail of the CIPHERTEXT %q", got, ct)
	}
}

// TestMaskLicenseNumberShortValues: masking must not manufacture a longer
// string than it was given, and must not index out of range.
func TestMaskLicenseNumberShortValues(t *testing.T) {
	t.Parallel()
	tests := []struct{ in, want string }{
		{"", ""},
		{"1", "1"},
		{"1234", "1234"},
		{"12345", "••••2345"},
		{"  WA-58213  ", "••••8213"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.in, func(t *testing.T) {
			t.Parallel()
			if got := maskLicenseNumber(tc.in); got != tc.want {
				t.Errorf("maskLicenseNumber(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
