// encrypt-pii reconciles the at-rest PII columns declared by migrations 031
// and 033 to the CURRENT encryption key. It is both the first-time backfill
// (plaintext → ciphertext) and the key-rotation tool (old-key ciphertext →
// new-key ciphertext).
//
// ── What changed and why (read this before editing) ──────────────────────
// The previous version read the raw column and called encrypt() on it with no
// decrypt step, gated only on `pii_encrypted_v1 = FALSE`. The documented
// rotation procedure told operators to clear that flag and re-run with
// ENCRYPTION_KEY_PREVIOUS set — but PREVIOUS was never read by the code, so the
// run ENCRYPTED THE OLD CIPHERTEXT A SECOND TIME. Recovering such a value
// requires replaying both keys in the right order through two unseal rounds,
// which nothing in the platform does; in practice the data was gone.
//
// This version never encrypts a value it has not first proven is plaintext, and
// never re-encrypts a value that is already current. Correctness rests on one
// primitive: secretbox.Open authenticates a Poly1305 tag, so "does this value
// open under key K" is a decisive, forgery-resistant test rather than a guess.
//
// ── The discriminator ────────────────────────────────────────────────────
// Every value lands in exactly one class:
//
//	empty     — NULL or "". Left alone.
//	current   — opens under PRIMARY. Already at the target key: SKIPPED.
//	            This is what makes a second run a no-op instead of a
//	            double-encryption.
//	rekey     — opens under PREVIOUS but not PRIMARY. Decrypted with PREVIOUS,
//	            re-encrypted under PRIMARY. This is the actual rotation.
//	plaintext — does NOT have the shape of our wire format (base64 decoding to
//	            at least NonceSize+Overhead = 40 bytes). Encrypted under
//	            PRIMARY. An EIN/TIN ("12-3456789") contains '-', outside the
//	            base64 alphabet, and is 10 chars where 56 is the floor; policy
//	            numbers are likewise short. Plaintext cannot masquerade as
//	            ciphertext here.
//	unknown   — HAS the shape of our wire format but opens under NEITHER key.
//	            This is the dangerous case: it is somebody's ciphertext under a
//	            key we were not given. Encrypting it would be exactly the
//	            destruction described above. The tool REFUSES TO RUN.
//
// The unknown check runs as a PRE-FLIGHT PASS over every table before a single
// byte is written, so a misconfigured key aborts the run before it can do
// partial damage rather than halfway through.
//
// Every value the tool encrypts is decrypted again with PRIMARY and compared
// byte-for-byte against the source plaintext BEFORE the UPDATE is issued. A
// value that does not survive that round trip aborts the run.
//
// ── Rotation ─────────────────────────────────────────────────────────────
// There is no flag to clear. Run with both keys set:
//
//	DATABASE_URL=... ENCRYPTION_KEY=$NEW ENCRYPTION_KEY_PREVIOUS=$OLD \
//	  go run ./database/cmd/encrypt-pii
//
// Rows already under $NEW are skipped; rows under $OLD are re-keyed; plaintext
// stragglers are encrypted. Run it as many times as you like.
//
// mfa_backup_codes are argon2id hashes (one-way), not ciphertext; they are
// hashed once and thereafter recognized by their "argon2id$" prefix.
//
// Usage:
//
//	DATABASE_URL=... ENCRYPTION_KEY=... go run ./database/cmd/encrypt-pii [-dry-run]
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/nacl/secretbox"
)

const (
	keySize   = 32
	nonceSize = 24
	batchSize = 200

	// argon2idPrefix marks an already-hashed MFA backup code.
	argon2idPrefix = "argon2id$"
)

// errUnknownKey is returned when a value is structurally our ciphertext but no
// configured key opens it. It is always fatal.
var errUnknownKey = errors.New("value is secretbox ciphertext but neither ENCRYPTION_KEY nor ENCRYPTION_KEY_PREVIOUS opens it")

// ── key material ─────────────────────────────────────────────────────────

// keyring holds the primary (encrypt + decrypt) and optional previous
// (decrypt-only) keys.
type keyring struct {
	primary  *[keySize]byte
	previous *[keySize]byte
}

// ── value classification ─────────────────────────────────────────────────

type valueClass int

const (
	classEmpty valueClass = iota
	classCurrent
	classRekey
	classPlaintext
	classUnknown
)

func (c valueClass) String() string {
	switch c {
	case classEmpty:
		return "empty"
	case classCurrent:
		return "current"
	case classRekey:
		return "rekey"
	case classPlaintext:
		return "plaintext"
	default:
		return "unknown"
	}
}

// looksLikeCiphertext reports whether s has the STRUCTURE of encrypt() output:
// standard base64 decoding to at least nonceSize+secretbox.Overhead bytes.
// Shape only — it says nothing about which key, if any, opens the value.
func looksLikeCiphertext(s string) bool {
	if len(s) < base64.StdEncoding.EncodedLen(nonceSize+secretbox.Overhead) {
		return false
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return false
	}
	return len(raw) >= nonceSize+secretbox.Overhead
}

// open attempts to unseal s with key. ok is false for any malformed input.
func open(key *[keySize]byte, s string) (string, bool) {
	if key == nil {
		return "", false
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(raw) < nonceSize+secretbox.Overhead {
		return "", false
	}
	var nonce [nonceSize]byte
	copy(nonce[:], raw[:nonceSize])
	plain, ok := secretbox.Open(nil, raw[nonceSize:], &nonce, key)
	if !ok {
		return "", false
	}
	return string(plain), true
}

// classify assigns s to exactly one class. The returned plaintext is populated
// for classRekey (decrypted under PREVIOUS) and classPlaintext (s itself); it
// is empty otherwise. Order matters: PRIMARY is tried first so an
// already-current value can never be mistaken for something needing a rewrite.
func classify(kr keyring, s string) (valueClass, string) {
	if s == "" {
		return classEmpty, ""
	}
	if _, ok := open(kr.primary, s); ok {
		return classCurrent, ""
	}
	if plain, ok := open(kr.previous, s); ok {
		return classRekey, plain
	}
	if looksLikeCiphertext(s) {
		return classUnknown, ""
	}
	return classPlaintext, s
}

// reconcileValue returns the value that should be stored so s ends up encrypted
// under PRIMARY, and whether a write is needed.
//
// The only path that produces new ciphertext runs through verifyRoundTrip, so
// the tool cannot write a value it is unable to read back.
func reconcileValue(kr keyring, s string) (out string, changed bool, err error) {
	class, plain := classify(kr, s)
	switch class {
	case classEmpty, classCurrent:
		// classCurrent is the anti-double-encryption guarantee: a value already
		// sealed under PRIMARY is returned byte-for-byte unchanged.
		return s, false, nil
	case classUnknown:
		return "", false, errUnknownKey
	case classRekey, classPlaintext:
		ct, err := encrypt(kr.primary, plain)
		if err != nil {
			return "", false, err
		}
		if err := verifyRoundTrip(kr.primary, ct, plain); err != nil {
			return "", false, err
		}
		return ct, true, nil
	default:
		return "", false, fmt.Errorf("unhandled value class %d", class)
	}
}

// verifyRoundTrip re-opens freshly produced ciphertext and constant-time
// compares it against the source plaintext. Cheap insurance against writing a
// value nothing can read back.
func verifyRoundTrip(key *[keySize]byte, ciphertext, want string) error {
	got, ok := open(key, ciphertext)
	if !ok {
		return errors.New("verify: freshly encrypted value does not open under the primary key")
	}
	if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		return errors.New("verify: round-tripped plaintext does not match the source")
	}
	return nil
}

// reconcileBackupCode hashes an MFA backup code unless it is already hashed.
// These are one-way argon2id digests, not ciphertext — they are never re-keyed.
func reconcileBackupCode(raw string) (string, bool, error) {
	if raw == "" || strings.HasPrefix(raw, argon2idPrefix) {
		return raw, false, nil
	}
	hashed, err := argon2idHash(raw)
	if err != nil {
		return "", false, err
	}
	return hashed, true, nil
}

// ── table specification ──────────────────────────────────────────────────

// tableSpec describes one table's PII surface. SQL is stored as complete
// literals rather than assembled from fragments so no identifier is ever
// interpolated and every statement is auditable by reading this file.
//
// selectSQL must project: id::text, pii_encrypted_v1, then piiCols in order,
// then hashCols in order. It takes ($1 = keyset cursor, $2 = limit) and must
// be ordered by id so the cursor advances.
//
// updateSQL must take $1 = id, then the reconciled pii values, then the
// reconciled hash arrays, in the same order.
type tableSpec struct {
	name      string
	piiCols   []string
	hashCols  []string
	selectSQL string
	updateSQL string
}

var specs = []tableSpec{
	{
		name:     "users",
		piiCols:  []string{"phone", "mfa_secret"},
		hashCols: []string{"mfa_backup_codes"},
		selectSQL: `
			SELECT id::text, pii_encrypted_v1, phone, mfa_secret, mfa_backup_codes
			  FROM users
			 WHERE deleted_at IS NULL AND id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		updateSQL: `
			UPDATE users
			   SET phone = $2, mfa_secret = $3, mfa_backup_codes = $4,
			       pii_encrypted_v1 = TRUE, updated_at = now()
			 WHERE id::text = $1`,
	},
	{
		name:    "provider_profiles",
		piiCols: []string{"service_address", "ein_tin", "insurance_policy_number"},
		selectSQL: `
			SELECT id::text, pii_encrypted_v1,
			       service_address, ein_tin, insurance_policy_number
			  FROM provider_profiles
			 WHERE id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		updateSQL: `
			UPDATE provider_profiles
			   SET service_address = $2, ein_tin = $3, insurance_policy_number = $4,
			       pii_encrypted_v1 = TRUE, updated_at = now()
			 WHERE id::text = $1`,
	},
	{
		name:    "provider_employees",
		piiCols: []string{"email", "phone", "license_number", "insurance_policy_number"},
		selectSQL: `
			SELECT id::text, pii_encrypted_v1,
			       email, phone, license_number, insurance_policy_number
			  FROM provider_employees
			 WHERE id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		updateSQL: `
			UPDATE provider_employees
			   SET email = $2, phone = $3, license_number = $4,
			       insurance_policy_number = $5,
			       pii_encrypted_v1 = TRUE, updated_at = now()
			 WHERE id::text = $1`,
	},
	{
		// properties.address is NOT NULL; the reconciler preserves non-nil-ness
		// because it only ever maps a non-nil source to a non-nil result.
		// city/state/zip_code/location stay plaintext on purpose (migration 033).
		name:    "properties",
		piiCols: []string{"address", "notes"},
		selectSQL: `
			SELECT id::text, pii_encrypted_v1, address, notes
			  FROM properties
			 WHERE deleted_at IS NULL AND id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		updateSQL: `
			UPDATE properties
			   SET address = $2, notes = $3,
			       pii_encrypted_v1 = TRUE, updated_at = now()
			 WHERE id::text = $1`,
	},
}

// ── database plumbing ────────────────────────────────────────────────────

// querier is the slice of pgx used here, so tests can drive a pool.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// row is one scanned record: its id, its flag, its PII values and its hash
// arrays, positionally matching the spec.
type row struct {
	id   string
	flag bool
	pii  []*string
	hash [][]string
}

// scanTable streams every row of spec in id order and hands each to visit.
func scanTable(ctx context.Context, db querier, spec tableSpec, visit func(row) error) error {
	cursor := ""
	for {
		batch, err := fetchBatch(ctx, db, spec, cursor)
		if err != nil {
			return err
		}
		if len(batch) == 0 {
			return nil
		}
		for _, r := range batch {
			if err := visit(r); err != nil {
				return err
			}
		}
		cursor = batch[len(batch)-1].id
	}
}

func fetchBatch(ctx context.Context, db querier, spec tableSpec, cursor string) ([]row, error) {
	rows, err := db.Query(ctx, spec.selectSQL, cursor, batchSize)
	if err != nil {
		return nil, fmt.Errorf("%s: query batch: %w", spec.name, err)
	}
	defer rows.Close()

	var out []row
	for rows.Next() {
		r := row{
			pii:  make([]*string, len(spec.piiCols)),
			hash: make([][]string, len(spec.hashCols)),
		}
		dest := make([]any, 0, 2+len(spec.piiCols)+len(spec.hashCols))
		dest = append(dest, &r.id, &r.flag)
		for i := range r.pii {
			dest = append(dest, &r.pii[i])
		}
		for i := range r.hash {
			dest = append(dest, &r.hash[i])
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("%s: scan: %w", spec.name, err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%s: rows iter: %w", spec.name, err)
	}
	return out, nil
}

// ── pre-flight ───────────────────────────────────────────────────────────

// preflight classifies every value in every table WITHOUT writing anything. It
// aborts the whole run if any value is our wire format but opens under no
// configured key.
//
// This pass is the "refuse to run destructively" guard. Doing it up front — not
// row by row during the write pass — means a wrong ENCRYPTION_KEY_PREVIOUS is
// caught while the database is still untouched, instead of after N tables have
// already been rewritten.
func preflight(ctx context.Context, db querier, kr keyring) error {
	totals := map[valueClass]int{}
	var offenders []string

	for _, spec := range specs {
		err := scanTable(ctx, db, spec, func(r row) error {
			for i, v := range r.pii {
				if v == nil {
					totals[classEmpty]++
					continue
				}
				class, _ := classify(kr, *v)
				totals[class]++
				if class == classUnknown && len(offenders) < 20 {
					offenders = append(offenders,
						fmt.Sprintf("%s.%s id=%s", spec.name, spec.piiCols[i], r.id))
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	}

	log.Printf("preflight: empty=%d current=%d rekey=%d plaintext=%d unknown=%d",
		totals[classEmpty], totals[classCurrent], totals[classRekey],
		totals[classPlaintext], totals[classUnknown])

	if totals[classUnknown] > 0 {
		return fmt.Errorf(
			"REFUSING TO RUN: %d value(s) are secretbox ciphertext that neither "+
				"ENCRYPTION_KEY nor ENCRYPTION_KEY_PREVIOUS can open. Encrypting them "+
				"again would make them unrecoverable. Supply the correct key and re-run. "+
				"First offenders: %s",
			totals[classUnknown], strings.Join(offenders, ", "))
	}
	return nil
}

// ── reconcile pass ───────────────────────────────────────────────────────

type stats struct {
	rowsSeen    int
	rowsWritten int
	encrypted   int
	rekeyed     int
	skipped     int
}

func reconcileTable(ctx context.Context, db querier, spec tableSpec, kr keyring, dryRun bool) (stats, error) {
	var st stats

	err := scanTable(ctx, db, spec, func(r row) error {
		st.rowsSeen++
		changed := false
		args := make([]any, 0, 1+len(spec.piiCols)+len(spec.hashCols))
		args = append(args, r.id)

		for i, v := range r.pii {
			if v == nil {
				args = append(args, nil)
				continue
			}
			class, _ := classify(kr, *v)
			out, didChange, err := reconcileValue(kr, *v)
			if err != nil {
				return fmt.Errorf("%s.%s id=%s: %w", spec.name, spec.piiCols[i], r.id, err)
			}
			switch {
			case !didChange:
				st.skipped++
			case class == classRekey:
				st.rekeyed++
			default:
				st.encrypted++
			}
			changed = changed || didChange
			args = append(args, out)
		}

		for i, codes := range r.hash {
			if codes == nil {
				args = append(args, nil)
				continue
			}
			outCodes := make([]string, len(codes))
			for j, c := range codes {
				out, didChange, err := reconcileBackupCode(c)
				if err != nil {
					return fmt.Errorf("%s.%s id=%s: %w", spec.name, spec.hashCols[i], r.id, err)
				}
				outCodes[j] = out
				changed = changed || didChange
			}
			args = append(args, outCodes)
		}

		// Write only when something actually changed, or when the advisory flag
		// still needs flipping. A second run therefore issues ZERO updates.
		if !changed && r.flag {
			return nil
		}
		if dryRun {
			log.Printf("DRY %s id=%s would_write=true values_changed=%v", spec.name, r.id, changed)
			st.rowsWritten++
			return nil
		}
		if _, err := db.Exec(ctx, spec.updateSQL, args...); err != nil {
			return fmt.Errorf("%s: update id=%s: %w", spec.name, r.id, err)
		}
		st.rowsWritten++
		return nil
	})
	if err != nil {
		return st, err
	}

	log.Printf("%s: rows=%d written=%d encrypted=%d rekeyed=%d already_current=%d",
		spec.name, st.rowsSeen, st.rowsWritten, st.encrypted, st.rekeyed, st.skipped)
	return st, nil
}

// run executes the pre-flight and then the reconcile pass over every table.
func run(ctx context.Context, db querier, kr keyring, dryRun bool) error {
	if err := preflight(ctx, db, kr); err != nil {
		return err
	}
	for _, spec := range specs {
		if _, err := reconcileTable(ctx, db, spec, kr, dryRun); err != nil {
			return err
		}
	}
	return nil
}

// ── main ─────────────────────────────────────────────────────────────────

func main() {
	dryRun := flag.Bool("dry-run", false, "classify and report without writing")
	flag.Parse()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	keyB64 := os.Getenv("ENCRYPTION_KEY")
	if keyB64 == "" {
		log.Fatal("ENCRYPTION_KEY is required (32 random bytes, base64)")
	}
	primary, err := decodeKey(keyB64)
	if err != nil {
		log.Fatalf("decode ENCRYPTION_KEY: %v", err)
	}
	kr := keyring{primary: primary}

	if prevB64 := os.Getenv("ENCRYPTION_KEY_PREVIOUS"); prevB64 != "" {
		previous, err := decodeKey(prevB64)
		if err != nil {
			log.Fatalf("decode ENCRYPTION_KEY_PREVIOUS: %v", err)
		}
		if subtle.ConstantTimeCompare(primary[:], previous[:]) == 1 {
			log.Fatal("ENCRYPTION_KEY_PREVIOUS is identical to ENCRYPTION_KEY; " +
				"there is nothing to rotate — unset it or supply the real previous key")
		}
		kr.previous = previous
		log.Printf("rotation mode: PREVIOUS key configured, stale rows will be re-keyed")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	log.Printf("encrypt-pii starting (dry-run=%v)", *dryRun)
	if err := run(ctx, conn, kr, *dryRun); err != nil {
		log.Fatalf("encrypt-pii: %v", err)
	}
	log.Printf("encrypt-pii complete")
}

// ── primitives ───────────────────────────────────────────────────────────

// encrypt produces base64(nonce||ciphertext) — the same wire format as
// services/user/internal/crypto.Cipher.EncryptString and
// gateway/internal/crypto.Cipher.EncryptString.
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
	return fmt.Sprintf("%s%s$%s",
		argon2idPrefix,
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
