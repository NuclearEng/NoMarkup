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
	if err := backfillProviderEmployees(ctx, conn, key, *dryRun); err != nil {
		log.Fatalf("backfill provider_employees: %v", err)
	}
	if err := backfillProperties(ctx, conn, key, *dryRun); err != nil {
		log.Fatalf("backfill properties: %v", err)
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

// backfillProviderEmployees encrypts email, phone, license_number,
// insurance_policy_number on each provider_employees row where
// pii_encrypted_v1 is FALSE. Idempotent.
func backfillProviderEmployees(ctx context.Context, conn *pgx.Conn, key *[keySize]byte, dryRun bool) error {
	processed := 0
	for {
		rows, err := conn.Query(ctx, `
			SELECT id, email, phone, license_number, insurance_policy_number
			FROM provider_employees
			WHERE pii_encrypted_v1 = FALSE
			ORDER BY created_at ASC
			LIMIT $1`, batchSize)
		if err != nil {
			return fmt.Errorf("query batch: %w", err)
		}

		type rowData struct {
			id           string
			email        *string
			phone        *string
			licenseNum   *string
			insurancePol *string
		}
		var batch []rowData
		for rows.Next() {
			var rd rowData
			if err := rows.Scan(&rd.id, &rd.email, &rd.phone, &rd.licenseNum, &rd.insurancePol); err != nil {
				rows.Close()
				return fmt.Errorf("scan provider_employees: %w", err)
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
			encEmail, err := maybeEncrypt(key, rd.email)
			if err != nil {
				return fmt.Errorf("encrypt email %s: %w", rd.id, err)
			}
			encPhone, err := maybeEncrypt(key, rd.phone)
			if err != nil {
				return fmt.Errorf("encrypt phone %s: %w", rd.id, err)
			}
			encLicense, err := maybeEncrypt(key, rd.licenseNum)
			if err != nil {
				return fmt.Errorf("encrypt license %s: %w", rd.id, err)
			}
			encIns, err := maybeEncrypt(key, rd.insurancePol)
			if err != nil {
				return fmt.Errorf("encrypt insurance %s: %w", rd.id, err)
			}

			if dryRun {
				log.Printf("DRY provider_employee=%s email=%v phone=%v license=%v insurance=%v",
					rd.id, encEmail != nil, encPhone != nil, encLicense != nil, encIns != nil)
				continue
			}

			_, err = conn.Exec(ctx, `
				UPDATE provider_employees
				SET email = $2,
				    phone = $3,
				    license_number = $4,
				    insurance_policy_number = $5,
				    pii_encrypted_v1 = TRUE,
				    updated_at = now()
				WHERE id = $1 AND pii_encrypted_v1 = FALSE`,
				rd.id, encEmail, encPhone, encLicense, encIns)
			if err != nil {
				return fmt.Errorf("update provider_employee %s: %w", rd.id, err)
			}
			processed++
		}

		log.Printf("provider_employees batch processed (total=%d)", processed)
		if dryRun {
			break
		}
	}
	log.Printf("provider_employees backfill done (encrypted %d rows)", processed)
	return nil
}

// backfillProperties encrypts address and notes on each properties row.
// city/state/zip_code/location are intentionally left plaintext (see
// migration 033 comment).
func backfillProperties(ctx context.Context, conn *pgx.Conn, key *[keySize]byte, dryRun bool) error {
	processed := 0
	for {
		rows, err := conn.Query(ctx, `
			SELECT id, address, notes
			FROM properties
			WHERE pii_encrypted_v1 = FALSE
			  AND deleted_at IS NULL
			ORDER BY created_at ASC
			LIMIT $1`, batchSize)
		if err != nil {
			return fmt.Errorf("query batch: %w", err)
		}

		type rowData struct {
			id      string
			address *string
			notes   *string
		}
		var batch []rowData
		for rows.Next() {
			var rd rowData
			// address is NOT NULL in the schema but pgx still scans into *string fine.
			if err := rows.Scan(&rd.id, &rd.address, &rd.notes); err != nil {
				rows.Close()
				return fmt.Errorf("scan properties: %w", err)
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
			encAddr, err := maybeEncrypt(key, rd.address)
			if err != nil {
				return fmt.Errorf("encrypt address %s: %w", rd.id, err)
			}
			encNotes, err := maybeEncrypt(key, rd.notes)
			if err != nil {
				return fmt.Errorf("encrypt notes %s: %w", rd.id, err)
			}

			if dryRun {
				log.Printf("DRY property=%s address=%v notes=%v",
					rd.id, encAddr != nil, encNotes != nil)
				continue
			}

			// address is NOT NULL — keep encAddr non-nil even when the source
			// is empty (which shouldn't happen given the schema constraint).
			if encAddr == nil {
				empty := ""
				encAddr = &empty
			}

			_, err = conn.Exec(ctx, `
				UPDATE properties
				SET address = $2,
				    notes = $3,
				    pii_encrypted_v1 = TRUE,
				    updated_at = now()
				WHERE id = $1 AND pii_encrypted_v1 = FALSE`,
				rd.id, encAddr, encNotes)
			if err != nil {
				return fmt.Errorf("update property %s: %w", rd.id, err)
			}
			processed++
		}

		log.Printf("properties batch processed (total=%d)", processed)
		if dryRun {
			break
		}
	}
	log.Printf("properties backfill done (encrypted %d rows)", processed)
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
