// Package crypto wraps libsodium-compatible XSalsa20-Poly1305 (nacl/secretbox)
// for encrypting at-rest PII columns the gateway directly owns
// (provider_employees today). Storage format matches
// services/user/internal/crypto.Cipher: base64(nonce || ciphertext) where
// nonce is 24 bytes and ciphertext includes the 16-byte Poly1305 tag.
//
// Keys are 32 random bytes, base64-encoded in the ENCRYPTION_KEY env var.
// Optional ENCRYPTION_KEY_PREVIOUS provides a decryption-only key for the
// rotation grace period — see docs/operations/encryption-key-rotation.md.
//
// This is intentionally a sibling implementation rather than an import of
// services/user — the gateway module deliberately does not depend on the
// user service package tree, mirroring the wire format byte-for-byte so the
// encrypt-pii tool can produce/consume rows interchangeably.
package crypto

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"golang.org/x/crypto/nacl/secretbox"
)

// KeySize is the required length of an unwrapped encryption key in bytes.
const KeySize = 32

// NonceSize is the secretbox nonce length in bytes.
const NonceSize = 24

// ErrCiphertextTooShort indicates a stored ciphertext is shorter than the
// minimum nonce + tag overhead.
var ErrCiphertextTooShort = errors.New("ciphertext too short")

// ErrDecryptFailed indicates the ciphertext could not be authenticated.
// Callers should treat this as either tampering or a wrong/rotated key.
var ErrDecryptFailed = errors.New("decryption failed: tampered or wrong key")

// ErrKeyMissing indicates ENCRYPTION_KEY is unset or invalid in production.
var ErrKeyMissing = errors.New("ENCRYPTION_KEY missing or invalid")

// Cipher encrypts and decrypts string PII using nacl/secretbox.
type Cipher struct {
	primary  *[KeySize]byte
	previous *[KeySize]byte // optional, decrypt-only during key rotation
}

// New returns a Cipher with the given primary key. If previous is non-nil it
// will be tried as a fallback during decryption only.
func New(primary, previous *[KeySize]byte) *Cipher {
	return &Cipher{primary: primary, previous: previous}
}

// FromEnv constructs a Cipher from ENCRYPTION_KEY (and optional
// ENCRYPTION_KEY_PREVIOUS). A missing or invalid primary key is an ERROR
// everywhere except development, where an ephemeral key is generated and a
// WARN is logged so the service can still boot.
//
// The gate is "is this development?", NOT "is this production?". That
// polarity matters: the previous `env == "production"` check meant STAGING —
// which is explicitly ENVIRONMENT=staging in the overlay, and which runs
// multiple replicas — silently generated a DIFFERENT random key per pod.
// Every PII field written by one replica was undecryptable by another and by
// the same pod after any restart: silent, permanent data corruption with a
// log line that says "DEV ONLY". Anything not recognizably development now
// fails closed.
func FromEnv() (*Cipher, error) {
	primaryB64 := os.Getenv("ENCRYPTION_KEY")
	prevB64 := os.Getenv("ENCRYPTION_KEY_PREVIOUS")
	env := os.Getenv("ENVIRONMENT")

	primary, err := decodeKey(primaryB64)
	if err != nil {
		if !isDevelopmentEnv(env) {
			return nil, fmt.Errorf("%w: %v", ErrKeyMissing, err)
		}
		slog.Warn("ENCRYPTION_KEY missing or invalid; generating ephemeral key (DEV ONLY)",
			"error", err,
		)
		primary = &[KeySize]byte{}
		if _, err := rand.Read(primary[:]); err != nil {
			return nil, fmt.Errorf("generate ephemeral encryption key: %w", err)
		}
	}

	var previous *[KeySize]byte
	if prevB64 != "" {
		previous, err = decodeKey(prevB64)
		if err != nil {
			return nil, fmt.Errorf("ENCRYPTION_KEY_PREVIOUS invalid: %w", err)
		}
	}

	return New(primary, previous), nil
}

func decodeKey(b64 string) (*[KeySize]byte, error) {
	if b64 == "" {
		return nil, errors.New("empty key")
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		raw, err = base64.RawURLEncoding.DecodeString(b64)
		if err != nil {
			return nil, fmt.Errorf("base64 decode: %w", err)
		}
	}
	if len(raw) != KeySize {
		return nil, fmt.Errorf("expected %d bytes, got %d", KeySize, len(raw))
	}
	var key [KeySize]byte
	copy(key[:], raw)
	return &key, nil
}

// EncryptString encrypts plaintext with the primary key. An empty plaintext
// returns the empty string unchanged so callers can pass-through optional
// fields without special-casing.
func (c *Cipher) EncryptString(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	var nonce [NonceSize]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", fmt.Errorf("encrypt: generate nonce: %w", err)
	}
	sealed := secretbox.Seal(nonce[:], []byte(plaintext), &nonce, c.primary)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// DecryptString decrypts ciphertext produced by EncryptString. An empty
// input returns the empty string. If the primary key fails and a previous
// key is configured, decryption is retried with the previous key (rotation
// grace).
func (c *Cipher) DecryptString(ciphertext string) (string, error) {
	if ciphertext == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", fmt.Errorf("decrypt: base64 decode: %w", err)
	}
	if len(raw) < NonceSize+secretbox.Overhead {
		return "", ErrCiphertextTooShort
	}
	var nonce [NonceSize]byte
	copy(nonce[:], raw[:NonceSize])
	box := raw[NonceSize:]

	if plain, ok := secretbox.Open(nil, box, &nonce, c.primary); ok {
		return string(plain), nil
	}
	if c.previous != nil {
		if plain, ok := secretbox.Open(nil, box, &nonce, c.previous); ok {
			return string(plain), nil
		}
	}
	return "", ErrDecryptFailed
}

// LooksLikeCiphertext reports whether s has the STRUCTURE of a value produced
// by EncryptString: standard base64 that decodes to at least
// NonceSize+secretbox.Overhead (24+16 = 40) bytes.
//
// This is a shape test only — it says nothing about whether any key can open
// the value. It exists so callers can tell the two failure modes apart:
//
//   - !LooksLikeCiphertext(s)  → s was never our ciphertext; it is legacy
//     plaintext and must be passed through untouched.
//   - LooksLikeCiphertext(s) but DecryptString fails → s IS our wire format
//     but no configured key opens it. That is a KEY problem, never a
//     "plaintext" one, and callers must fail loudly rather than pass the
//     base64 through or (worse) encrypt it a second time.
//
// The 40-byte floor is what makes the shape test useful against the values it
// guards: a base64 string must be at least 56 characters to decode to 40
// bytes, whereas the short punctuated identifiers in this schema — a licence
// number ("WA-58213"), a date of birth ("1995-01-01") — miss on both counts,
// being far under 56 characters and containing '-', which is not in the
// standard base64 alphabet.
//
// Mirrors services/user/internal/crypto.LooksLikeCiphertext exactly.
func LooksLikeCiphertext(s string) bool {
	if len(s) < base64.StdEncoding.EncodedLen(NonceSize+secretbox.Overhead) {
		return false
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return false
	}
	return len(raw) >= NonceSize+secretbox.Overhead
}

// IsCurrent reports whether s is ciphertext that authenticates under the
// PRIMARY key — i.e. it is already at the current key version and
// re-encrypting it would be a destructive double-encryption.
//
// Authentication (not shape) is the discriminator: secretbox.Open verifies a
// Poly1305 tag, so a value that was not sealed under this exact key is
// rejected with overwhelming probability. False NEGATIVES are the direction
// that matters, and they are handled by LooksLikeCiphertext: anything shaped
// like our wire format that will not open is escalated, never silently
// re-encrypted.
func (c *Cipher) IsCurrent(s string) bool {
	if s == "" || c == nil || c.primary == nil {
		return false
	}
	return opensWith(s, c.primary)
}

// IsPrevious reports whether s authenticates under the PREVIOUS (rotation)
// key but not the primary — i.e. it is stale ciphertext awaiting a re-key.
func (c *Cipher) IsPrevious(s string) bool {
	if s == "" || c == nil || c.previous == nil {
		return false
	}
	if c.primary != nil && opensWith(s, c.primary) {
		return false
	}
	return opensWith(s, c.previous)
}

// opensWith reports whether s is base64 secretbox output that key authenticates.
func opensWith(s string, key *[KeySize]byte) bool {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(raw) < NonceSize+secretbox.Overhead {
		return false
	}
	var nonce [NonceSize]byte
	copy(nonce[:], raw[:NonceSize])
	_, ok := secretbox.Open(nil, raw[NonceSize:], &nonce, key)
	return ok
}

// DecryptStringOrPassthrough is the mixed-state read path. It returns:
//
//   - (plaintext, nil)       — s authenticated under primary or previous.
//   - (s, nil)               — s is not our wire format at all, so it is
//     legacy plaintext written before the column was
//     encrypted; return it unchanged.
//   - ("", ErrDecryptFailed) — s IS our wire format but no configured key
//     opens it. Never return the raw ciphertext to a
//     caller.
//
// Use this instead of a per-row pii_encrypted_v1 flag. The flag is per ROW but
// encryption is per COLUMN, so a row whose email was re-written through the
// encrypting update path is flagged TRUE even while a sibling column is still
// the plaintext the backfill never re-visited. Per-value detection cannot
// drift that way. See migration 098.
//
// Mirrors services/user/internal/crypto.DecryptStringOrPassthrough exactly.
func (c *Cipher) DecryptStringOrPassthrough(s string) (string, error) {
	if s == "" {
		return "", nil
	}
	plain, err := c.DecryptString(s)
	if err == nil {
		return plain, nil
	}
	if LooksLikeCiphertext(s) {
		return "", fmt.Errorf("%w (value is secretbox-shaped but no configured key opens it)", ErrDecryptFailed)
	}
	return s, nil
}

// isDevelopmentEnv reports whether env names the development environment.
// Trimmed and case-insensitive so a stray space or capital letter in a
// ConfigMap cannot silently downgrade crypto; anything unrecognized is
// treated as NOT development, which is the fail-closed direction.
func isDevelopmentEnv(env string) bool {
	return strings.EqualFold(strings.TrimSpace(env), "development")
}
