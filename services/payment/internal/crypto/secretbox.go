// Package crypto wraps libsodium-compatible XSalsa20-Poly1305 (nacl/secretbox)
// for decrypting at-rest PII columns the payment service reads when generating
// provider tax forms (provider_profiles.service_address today). Storage format
// matches services/user/internal/crypto.Cipher and gateway/internal/crypto:
// base64(nonce || ciphertext) where nonce is 24 bytes and ciphertext includes
// the 16-byte Poly1305 tag.
//
// Keys are 32 random bytes, base64-encoded in the ENCRYPTION_KEY env var.
// Optional ENCRYPTION_KEY_PREVIOUS provides a decryption-only key for the
// rotation grace period — see docs/operations/encryption-key-rotation.md.
//
// This is intentionally a sibling implementation rather than an import of
// services/user — the payment module deliberately does not depend on the
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
// ENCRYPTION_KEY_PREVIOUS). In production (ENVIRONMENT=production) a missing
// or invalid primary key returns an error. In development an ephemeral key
// is generated and a WARN is logged so the service can still boot.
func FromEnv() (*Cipher, error) {
	primaryB64 := os.Getenv("ENCRYPTION_KEY")
	prevB64 := os.Getenv("ENCRYPTION_KEY_PREVIOUS")
	env := os.Getenv("ENVIRONMENT")

	primary, err := decodeKey(primaryB64)
	if err != nil {
		if env == "production" {
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
