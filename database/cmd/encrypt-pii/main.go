// encrypt-pii is a one-shot backfill that converts plaintext PII columns to
// nacl/secretbox ciphertext (and argon2id hashes for mfa_backup_codes), then
// flips the per-row pii_encrypted_v1 flag added by migration 031.
//
// It is idempotent: rows with pii_encrypted_v1 = TRUE are skipped, so it can
// safely be re-run after a key rotation. To re-key, set ENCRYPTION_KEY to
// the new key, ENCRYPTION_KEY_PREVIOUS to the current one, then:
//
//	1. Reset the flag for every row:
//	     UPDATE users SET pii_encrypted_v1 = FALSE;
//	     UPDATE provider_profiles SET pii_encrypted_v1 = FALSE;
//	   (this requires updating the read paths to first decrypt with PREVIOUS,
//	   not just toggle the flag — rotation is a careful op, see
//	   docs/operations/encryption-key-rotation.md)
//	2. Run this tool again with both keys set.
//
// Usage:
//
//	DATABASE_URL=... ENCRYPTION_KEY=... go run ./database/cmd/encrypt-pii
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/nacl/secretbox"
)

const (
	keySize   = 32
	nonceSize = 24
	batchSize = 200
)

func main() {
	dryRun := flag.Bool("dry-run", false, "log what would change without writing")
	flag.Parse()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	keyB64 := os.Getenv("ENCRYPTION_KEY")
	if keyB64 == "" {
		log.Fatal("ENCRYPTION_KEY is required (32 random bytes, base64)")
	}
	key, err := decodeKey(keyB64)
	if err != nil {
		log.Fatalf("decode ENCRYPTION_KEY: %v", err)
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	log.Printf("encrypt-pii starting (dry-run=%v)", *dryRun)

	if err := backfillUsers(ctx, conn, key, *dryRun); err != nil {
		log.Fatalf("backfill users: %v", err)
	}
	if err := backfillProviderProfiles(ctx, conn, key, *dryRun); err != nil {
		log.Fatalf("backfill provider_profiles: %v", err)
	}
	log.Printf("encrypt-pii complete")
}

// backfillUsers encrypts users.phone, users.mfa_secret, and argon2id-hashes
// users.mfa_backup_codes for rows where pii_encrypted_v1 is FALSE.
func backfillUsers(ctx context.Context, conn *pgx.Conn, key *[keySize]byte, dryRun bool) error {
	processed := 0
	for {
		rows, err := conn.Query(ctx, `
			SELECT id, phone, mfa_secret, mfa_backup_codes
			FROM users
			WHERE pii_encrypted_v1 = FALSE
			  AND deleted_at IS NULL
			ORDER BY created_at ASC
			LIMIT $1`, batchSize)
		if err != nil {
			return fmt.Errorf("query batch: %w", err)
		}

		type rowData struct {
			id          string
			phone       *string
			mfaSecret   *string
			backupCodes []string
		}
		var batch []rowData
		for rows.Next() {
			var rd rowData
			if err := rows.Scan(&rd.id, &rd.phone, &rd.mfaSecret, &rd.backupCodes); err != nil {
				rows.Close()
				return fmt.Errorf("scan: %w", err)
			}
			batch = append(batch, rd)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("rows iter: %w", err)
		}
		if len(batch) == 0 {
			break
		}

		for _, rd := range batch {
			var encryptedPhone *string
			if rd.phone != nil && *rd.phone != "" {
				ct, err := encrypt(key, *rd.phone)
				if err != nil {
					return fmt.Errorf("encrypt phone for user %s: %w", rd.id, err)
				}
				encryptedPhone = &ct
			} else {
				encryptedPhone = rd.phone
			}

			var encryptedSecret *string
			if rd.mfaSecret != nil && *rd.mfaSecret != "" {
				ct, err := encrypt(key, *rd.mfaSecret)
				if err != nil {
					return fmt.Errorf("encrypt mfa_secret for user %s: %w", rd.id, err)
				}
				encryptedSecret = &ct
			} else {
				encryptedSecret = rd.mfaSecret
			}

			var hashedCodes []string
			if rd.backupCodes != nil {
				hashedCodes = make([]string, len(rd.backupCodes))
				for i, raw := range rd.backupCodes {
					if raw == "" {
						hashedCodes[i] = ""
						continue
					}
					// If already argon2id-prefixed, leave it (idempotent re-runs).
					if strings.HasPrefix(raw, "argon2id$") {
						hashedCodes[i] = raw
						continue
					}
					hashed, err := argon2idHash(raw)
					if err != nil {
						return fmt.Errorf("hash backup code for user %s: %w", rd.id, err)
					}
					hashedCodes[i] = hashed
				}
			}

			if dryRun {
				log.Printf("DRY user=%s phone_set=%v mfa_secret_set=%v backup_codes=%d",
					rd.id, encryptedPhone != nil, encryptedSecret != nil, len(hashedCodes))
				continue
			}

			_, err := conn.Exec(ctx, `
				UPDATE users
				SET phone = $2,
				    mfa_secret = $3,
				    mfa_backup_codes = $4,
				    pii_encrypted_v1 = TRUE,
				    updated_at = now()
				WHERE id = $1 AND pii_encrypted_v1 = FALSE`,
				rd.id, encryptedPhone, encryptedSecret, hashedCodes)
			if err != nil {
				return fmt.Errorf("update user %s: %w", rd.id, err)
			}
			processed++
		}

		log.Printf("users batch processed (total=%d)", processed)
		if dryRun {
			break
		}
	}
	log.Printf("users backfill done (encrypted %d rows)", processed)
	return nil
}

// backfillProviderProfiles encrypts service_address, ein_tin,
// insurance_policy_number on each provider_profiles row.
func backfillProviderProfiles(ctx context.Context, conn *pgx.Conn, key *[keySize]byte, dryRun bool) error {
	processed := 0
	for {
		rows, err := conn.Query(ctx, `
			SELECT id, service_address, ein_tin, insurance_policy_number
			FROM provider_profiles
			WHERE pii_encrypted_v1 = FALSE
			ORDER BY created_at ASC
			LIMIT $1`, batchSize)
		if err != nil {
			return fmt.Errorf("query batch: %w", err)
		}

		type rowData struct {
			id            string
			serviceAddr   *string
			einTin        *string
			insurancePol  *string
		}
		var batch []rowData
		for rows.Next() {
			var rd rowData
			if err := rows.Scan(&rd.id, &rd.serviceAddr, &rd.einTin, &rd.insurancePol); err != nil {
				rows.Close()
				return fmt.Errorf("scan provider_profiles: %w", err)
			}
			batch = append(batch, rd)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("rows iter: %w", err)
		}
		if len(batch) == 0 {
			break
		}

		for _, rd := range batch {
			encryptedAddr, err := maybeEncrypt(key, rd.serviceAddr)
			if err != nil {
				return fmt.Errorf("encrypt service_address %s: %w", rd.id, err)
			}
			encryptedEIN, err := maybeEncrypt(key, rd.einTin)
			if err != nil {
				return fmt.Errorf("encrypt ein_tin %s: %w", rd.id, err)
			}
			encryptedIns, err := maybeEncrypt(key, rd.insurancePol)
			if err != nil {
				return fmt.Errorf("encrypt insurance_policy_number %s: %w", rd.id, err)
			}

			if dryRun {
				log.Printf("DRY provider_profile=%s addr=%v ein=%v insurance=%v",
					rd.id, encryptedAddr != nil, encryptedEIN != nil, encryptedIns != nil)
				continue
			}

			_, err = conn.Exec(ctx, `
				UPDATE provider_profiles
				SET service_address = $2,
				    ein_tin = $3,
				    insurance_policy_number = $4,
				    pii_encrypted_v1 = TRUE,
				    updated_at = now()
				WHERE id = $1 AND pii_encrypted_v1 = FALSE`,
				rd.id, encryptedAddr, encryptedEIN, encryptedIns)
			if err != nil {
				return fmt.Errorf("update provider_profile %s: %w", rd.id, err)
			}
			processed++
		}

		log.Printf("provider_profiles batch processed (total=%d)", processed)
		if dryRun {
			break
		}
	}
	log.Printf("provider_profiles backfill done (encrypted %d rows)", processed)
	return nil
}

func maybeEncrypt(key *[keySize]byte, s *string) (*string, error) {
	if s == nil || *s == "" {
		return s, nil
	}
	ct, err := encrypt(key, *s)
	if err != nil {
		return nil, err
	}
	return &ct, nil
}

// encrypt produces base64(nonce||ciphertext) — same wire format as
// services/user/internal/crypto.Cipher.EncryptString.
func encrypt(key *[keySize]byte, plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	var nonce [nonceSize]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", fmt.Errorf("nonce: %w", err)
	}
	sealed := secretbox.Seal(nonce[:], []byte(plaintext), &nonce, key)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// argon2idHash matches the encoding used by
// services/user/internal/service/mfa.go: argon2id$<saltB64>$<hashB64>.
func argon2idHash(input string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("salt: %w", err)
	}
	hash := argon2.IDKey([]byte(input), salt, 3, 64*1024, 4, 32)
	return fmt.Sprintf("argon2id$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

func decodeKey(b64 string) (*[keySize]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		raw, err = base64.RawURLEncoding.DecodeString(b64)
		if err != nil {
			return nil, fmt.Errorf("base64: %w", err)
		}
	}
	if len(raw) != keySize {
		return nil, errors.New("expected 32 bytes")
	}
	var k [keySize]byte
	copy(k[:], raw)
	return &k, nil
}
