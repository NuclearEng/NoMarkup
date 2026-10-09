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
// ── Three shapes of column, one discriminator ────────────────────────────
// Migrations 104-107 extended the inventory past "TEXT column, encrypted in
// place". The classifier above is unchanged and still decides every case; what
// differs is where the plaintext comes from and what else moves with it.
//
//	in place   — a TEXT column that becomes its own ciphertext. The original
//	             031/033 shape, plus jobs.service_address (104) and
//	             provider_licenses.license_number (106). Note that neither
//	             `jobs` nor `provider_licenses` has a pii_encrypted_v1 column
//	             and neither should ever gain one: a row flag over per-column
//	             encryption is the drift bug migration 098 exists to document.
//	             tableSpec.hasFlag records which tables carry the legacy flag.
//
//	date pair  — a DATE column drained into a sibling *_encrypted TEXT column
//	             (106: users.dob, provider_employees.date_of_birth). secretbox
//	             output is base64 text and a DATE cannot hold it. The date is
//	             formatted "YYYY-MM-DD", encrypted into the sibling, and the
//	             DATE is set to NULL in the SAME UPDATE — so a surviving
//	             non-NULL DATE always means "not yet processed", which is
//	             exactly what pii_plaintext_audit (107) tests.
//
//	geometry   — an exact point encrypted into a sibling *_encrypted column
//	             while the geometry itself is coarsened to a privacy grid
//	             (104/105: jobs.service_location + approximate_location,
//	             properties.location). Coarsening is IRREVERSIBLE, so the
//	             encryption and the coarsening are one statement. See geo.go,
//	             which owns that half in full.
//
// Two audit views decide whether a run is finished, and a successful run must
// drain BOTH to zero: pii_plaintext_audit and pii_exact_geometry_audit
// (migration 107).
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

// ── DATE columns draining into sibling TEXT columns (migration 106) ──────

// dateDecision is what reconcileDatePair concluded for one DATE/ciphertext
// pair.
type dateDecision struct {
	// enc is the value to bind for the *_encrypted column. It is the pair's
	// EXISTING value whenever the ciphertext must not be rewritten.
	enc       *string
	write     bool
	encrypted bool
	rekeyed   bool
	// warn describes a state that is handled but should not exist.
	warn string
}

// reconcileDatePair decides how to drain one DATE column into its sibling
// *_encrypted column.
//
// The rules, and the reasoning behind the awkward one:
//
//	DATE NULL      — the row is done, or the date was never set. Untouched.
//	                 This is what makes a second run free: the DATE is the only
//	                 thing that says "work remains", and it is cleared in the
//	                 same UPDATE that writes the ciphertext.
//	ciphertext current — the encrypted copy is authoritative and is NEVER
//	                 rewritten (rewriting means re-sealing, and a fresh nonce on
//	                 an unchanged value is churn at best). If a DATE is ALSO
//	                 present the two disagree in principle, and the CIPHERTEXT
//	                 WINS: it was written by the runtime path or an earlier run,
//	                 whereas a surviving DATE means a partially applied state.
//	                 That case is logged WARN because it should not exist.
//	ciphertext rekey — rotation: decrypt under PREVIOUS, re-seal under PRIMARY.
//	unknown        — secretbox-shaped, opens under neither key. Fatal, exactly
//	                 as everywhere else in this tool.
//
// The caller pairs the returned ciphertext with a literal `dateCol = NULL` in
// the same UPDATE, so the plaintext date is never cleared unless its
// replacement lands in the same statement.
func reconcileDatePair(kr keyring, spec dateColSpec, p datePair) (dateDecision, error) {
	d := dateDecision{enc: p.enc}

	cur := ""
	if p.enc != nil {
		cur = *p.enc
	}
	class, plain := classify(kr, cur)

	switch class {
	case classUnknown:
		return d, fmt.Errorf("%s: %w", spec.encCol, errUnknownKey)

	case classCurrent:
		if p.date == nil {
			return d, nil
		}
		// Both present. Keep the ciphertext, drop the plaintext.
		d.write = true
		d.warn = fmt.Sprintf("%s was already current while %s still held a plaintext date; keeping the ciphertext and clearing the DATE (a partially applied earlier run)",
			spec.encCol, spec.dateCol)
		return d, nil

	case classRekey:
		ct, err := encrypt(kr.primary, plain)
		if err != nil {
			return d, fmt.Errorf("%s: %w", spec.encCol, err)
		}
		if err := verifyRoundTrip(kr.primary, ct, plain); err != nil {
			return d, fmt.Errorf("%s: %w", spec.encCol, err)
		}
		d.enc = &ct
		d.write = true
		d.rekeyed = true
		if p.date != nil {
			d.warn = fmt.Sprintf("%s held stale ciphertext while %s still held a plaintext date; re-keying the ciphertext and clearing the DATE",
				spec.encCol, spec.dateCol)
		}
		return d, nil

	case classPlaintext:
		// The *_encrypted column holds something that is not our wire format —
		// in practice a raw "YYYY-MM-DD" written by a path that forgot the
		// cipher. Seal it; it is the value the read paths already prefer.
		ct, err := encrypt(kr.primary, cur)
		if err != nil {
			return d, fmt.Errorf("%s: %w", spec.encCol, err)
		}
		if err := verifyRoundTrip(kr.primary, ct, cur); err != nil {
			return d, fmt.Errorf("%s: %w", spec.encCol, err)
		}
		d.enc = &ct
		d.write = true
		d.encrypted = true
		if p.date != nil {
			d.warn = fmt.Sprintf("%s held an unencrypted value while %s still held a plaintext date; sealing the former and clearing the latter",
				spec.encCol, spec.dateCol)
		}
		return d, nil

	case classEmpty:
		if p.date == nil {
			// Never set, or already drained. Nothing to do.
			return d, nil
		}
		ct, err := encrypt(kr.primary, *p.date)
		if err != nil {
			return d, fmt.Errorf("%s: %w", spec.encCol, err)
		}
		if err := verifyRoundTrip(kr.primary, ct, *p.date); err != nil {
			return d, fmt.Errorf("%s: %w", spec.encCol, err)
		}
		d.enc = &ct
		d.write = true
		d.encrypted = true
		return d, nil

	default:
		return d, fmt.Errorf("%s: unhandled value class %d", spec.encCol, class)
	}
}

// ── table specification ──────────────────────────────────────────────────

// dateColSpec is a DATE column being drained into a sibling *_encrypted TEXT
// column (migration 106). dateCol is projected as text and bound to nothing —
// the update always writes NULL into it, because the only way this tool leaves
// a date behind is by not writing the row at all.
type dateColSpec struct {
	dateCol string
	encCol  string
}

// tableSpec describes one table's PII surface. SQL is stored as complete
// literals rather than assembled from fragments so no identifier is ever
// interpolated and every statement is auditable by reading this file.
//
// selectSQL must project, in order: id::text, pii_encrypted_v1 IF AND ONLY IF
// hasFlag, then piiCols, then for each dateCols entry the PAIR
// (to_char(dateCol,'YYYY-MM-DD'), encCol), then hashCols. It takes ($1 = keyset
// cursor, $2 = limit) and must be ordered by id so the cursor advances.
//
// updateSQL must take $1 = id, then the reconciled pii values, then one
// reconciled ciphertext per dateCols entry (with the DATE column set to a
// literal NULL beside it), then the reconciled hash arrays, in the same order.
//
// hasFlag is false for tables with no pii_encrypted_v1 column — `jobs` and
// `provider_licenses`, which deliberately never get one (migrations 104/106).
// The flag was only ever advisory; correctness comes from classifying each
// VALUE, and these two specs are the proof that nothing depends on it.
type tableSpec struct {
	name      string
	hasFlag   bool
	piiCols   []string
	dateCols  []dateColSpec
	hashCols  []string
	selectSQL string
	updateSQL string
}

var specs = []tableSpec{
	{
		name:     "users",
		hasFlag:  true,
		piiCols:  []string{"phone", "mfa_secret"},
		dateCols: []dateColSpec{{dateCol: "dob", encCol: "dob_encrypted"}},
		hashCols: []string{"mfa_backup_codes"},
		// dob is rendered with to_char rather than scanned as a time.Time so the
		// value encrypted here is byte-identical to what
		// gateway/internal/handler/compliance.go SetDOB writes, with no timezone
		// or layout to disagree about.
		selectSQL: `
			SELECT id::text, pii_encrypted_v1, phone, mfa_secret,
			       to_char(dob, 'YYYY-MM-DD'), dob_encrypted,
			       mfa_backup_codes
			  FROM users
			 WHERE deleted_at IS NULL AND id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		// dob = NULL is unconditional and safe: the reconciler only lets this
		// statement run when either dob is already NULL (no-op) or a ciphertext
		// for it is being written in the same row of the same UPDATE. The
		// plaintext date can therefore never be cleared without its replacement
		// landing atomically.
		updateSQL: `
			UPDATE users
			   SET phone = $2, mfa_secret = $3,
			       dob = NULL, dob_encrypted = $4,
			       mfa_backup_codes = $5,
			       pii_encrypted_v1 = TRUE, updated_at = now()
			 WHERE id::text = $1`,
	},
	{
		name:    "provider_profiles",
		hasFlag: true,
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
		name:     "provider_employees",
		hasFlag:  true,
		piiCols:  []string{"email", "phone", "license_number", "insurance_policy_number"},
		dateCols: []dateColSpec{{dateCol: "date_of_birth", encCol: "date_of_birth_encrypted"}},
		selectSQL: `
			SELECT id::text, pii_encrypted_v1,
			       email, phone, license_number, insurance_policy_number,
			       to_char(date_of_birth, 'YYYY-MM-DD'), date_of_birth_encrypted
			  FROM provider_employees
			 WHERE id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		updateSQL: `
			UPDATE provider_employees
			   SET email = $2, phone = $3, license_number = $4,
			       insurance_policy_number = $5,
			       date_of_birth = NULL, date_of_birth_encrypted = $6,
			       pii_encrypted_v1 = TRUE, updated_at = now()
			 WHERE id::text = $1`,
	},
	{
		// properties.address is NOT NULL; the reconciler preserves non-nil-ness
		// because it only ever maps a non-nil source to a non-nil result.
		// city/state/zip_code stay plaintext on purpose (migration 033).
		// properties.location is NOT handled here — it is a geometry, and
		// geoSpecs in geo.go owns it (migration 105).
		name:    "properties",
		hasFlag: true,
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
	{
		// Migration 104. jobs.service_address is a CUSTOMER HOME address that
		// has been in plaintext since 001. The table has NO pii_encrypted_v1
		// column and must not gain one, so hasFlag is false and every decision
		// is made per VALUE.
		//
		// The paired geometry columns are handled by geoSpecs in geo.go:
		// encrypting the address while leaving an exact point beside it is
		// decorative, since the point reverse-geocodes back to the address.
		name:    "jobs",
		hasFlag: false,
		piiCols: []string{"service_address"},
		selectSQL: `
			SELECT id::text, service_address
			  FROM jobs
			 WHERE deleted_at IS NULL AND id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		updateSQL: `
			UPDATE jobs
			   SET service_address = $2
			 WHERE id::text = $1`,
	},
	{
		// Migration 106. NOT NULL, so there is no NULL sentinel — and none is
		// needed: per-VALUE classification answers "is this row done" by asking
		// whether the value opens under the key. No flag column here either.
		name:    "provider_licenses",
		hasFlag: false,
		piiCols: []string{"license_number"},
		selectSQL: `
			SELECT id::text, license_number
			  FROM provider_licenses
			 WHERE id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		updateSQL: `
			UPDATE provider_licenses
			   SET license_number = $2, updated_at = now()
			 WHERE id::text = $1`,
	},
}

// ── database plumbing ────────────────────────────────────────────────────

// querier is the slice of pgx used here, so tests can drive a pool.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// datePair is one scanned DATE/ciphertext pair. date is the DATE column
// rendered "YYYY-MM-DD" (nil when the column is NULL, which for a processed row
// means "already drained"); enc is the sibling *_encrypted TEXT column.
type datePair struct {
	date *string
	enc  *string
}

// row is one scanned record: its id, its flag (meaningful only when
// spec.hasFlag), its PII values, its date pairs and its hash arrays,
// positionally matching the spec.
type row struct {
	id    string
	flag  bool
	pii   []*string
	dates []datePair
	hash  [][]string
}

// flagSatisfied reports whether the legacy advisory flag needs no attention —
// either because the table has none, or because it is already TRUE.
func (r row) flagSatisfied(spec tableSpec) bool {
	return !spec.hasFlag || r.flag
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
			pii:   make([]*string, len(spec.piiCols)),
			dates: make([]datePair, len(spec.dateCols)),
			hash:  make([][]string, len(spec.hashCols)),
		}
		dest := make([]any, 0, 2+len(spec.piiCols)+2*len(spec.dateCols)+len(spec.hashCols))
		dest = append(dest, &r.id)
		if spec.hasFlag {
			dest = append(dest, &r.flag)
		}
		for i := range r.pii {
			dest = append(dest, &r.pii[i])
		}
		for i := range r.dates {
			dest = append(dest, &r.dates[i].date, &r.dates[i].enc)
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

	// note records one classification and remembers the first few offenders.
	note := func(class valueClass, where string) {
		totals[class]++
		if class == classUnknown && len(offenders) < 20 {
			offenders = append(offenders, where)
		}
	}
	classifyCol := func(v *string, where string) {
		if v == nil {
			totals[classEmpty]++
			return
		}
		class, _ := classify(kr, *v)
		note(class, where)
	}

	for _, spec := range specs {
		err := scanTable(ctx, db, spec, func(r row) error {
			for i, v := range r.pii {
				classifyCol(v, fmt.Sprintf("%s.%s id=%s", spec.name, spec.piiCols[i], r.id))
			}
			// The DATE columns of migration 106 contribute their SIBLING
			// ciphertext column, not the date: a plaintext date is not a value
			// any key could open, and the class that matters here is whether the
			// ciphertext already in the sibling is one we can read.
			for i, p := range r.dates {
				classifyCol(p.enc, fmt.Sprintf("%s.%s id=%s", spec.name, spec.dateCols[i].encCol, r.id))
			}
			return nil
		})
		if err != nil {
			return err
		}
	}

	// The encrypted-point columns of migrations 104/105 go through the same
	// gate. Missing them would be the worst possible omission: the geometry pass
	// COARSENS in the same statement that writes the ciphertext, so a key we
	// cannot open must abort before the run starts, or an unreadable exact point
	// would be traded for a permanently rounded-off geometry.
	for _, spec := range geoSpecs {
		err := scanGeoTable(ctx, db, spec, func(r geoRow) error {
			classifyCol(r.enc, fmt.Sprintf("%s.%s id=%s", spec.name, spec.encCol, r.id))
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

// stats is one pass's counters. The geo fields are reported separately from
// the in-place ones because "how many points were encrypted" and "how many
// geometries were coarsened" are different questions with different failure
// modes — a run that encrypts points without coarsening leaves the exposure
// open, and a run that coarsens without encrypting has destroyed data.
type stats struct {
	rowsSeen    int
	rowsWritten int
	encrypted   int
	rekeyed     int
	skipped     int
	// migration 106: DATE columns drained into sibling TEXT columns.
	datesEncrypted int
	datesRekeyed   int
	// migrations 104/105: exact point geometry.
	pointsEncrypted      int
	pointsRekeyed        int
	geomsCoarsened       int
	pointsAlreadyCurrent int
	sentinelSkipped      int
}

// add accumulates another pass's counters, so run can report one total.
func (s *stats) add(o stats) {
	s.rowsSeen += o.rowsSeen
	s.rowsWritten += o.rowsWritten
	s.encrypted += o.encrypted
	s.rekeyed += o.rekeyed
	s.skipped += o.skipped
	s.datesEncrypted += o.datesEncrypted
	s.datesRekeyed += o.datesRekeyed
	s.pointsEncrypted += o.pointsEncrypted
	s.pointsRekeyed += o.pointsRekeyed
	s.geomsCoarsened += o.geomsCoarsened
	s.pointsAlreadyCurrent += o.pointsAlreadyCurrent
	s.sentinelSkipped += o.sentinelSkipped
}

func reconcileTable(ctx context.Context, db querier, spec tableSpec, kr keyring, dryRun bool) (stats, error) {
	var st stats

	err := scanTable(ctx, db, spec, func(r row) error {
		st.rowsSeen++
		changed := false
		args := make([]any, 0, 1+len(spec.piiCols)+len(spec.dateCols)+len(spec.hashCols))
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

		// Migration 106: DATE -> sibling ciphertext. The decision function
		// pairs its output with the literal `dateCol = NULL` in updateSQL, so
		// the plaintext date and its replacement move in one statement.
		for i, p := range r.dates {
			d, err := reconcileDatePair(kr, spec.dateCols[i], p)
			if err != nil {
				return fmt.Errorf("%s id=%s: %w", spec.name, r.id, err)
			}
			if d.warn != "" {
				log.Printf("WARN %s id=%s: %s", spec.name, r.id, d.warn)
			}
			switch {
			case d.rekeyed:
				st.datesRekeyed++
			case d.encrypted:
				st.datesEncrypted++
			default:
				st.skipped++
			}
			changed = changed || d.write
			if d.enc == nil {
				args = append(args, nil)
			} else {
				args = append(args, *d.enc)
			}
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
		// still needs flipping. A second run therefore issues ZERO updates —
		// including on the flagless tables (jobs, provider_licenses), where
		// flagSatisfied is vacuously true and only a real value change writes.
		if !changed && r.flagSatisfied(spec) {
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

	log.Printf("%s: rows=%d written=%d encrypted=%d rekeyed=%d dates_encrypted=%d dates_rekeyed=%d already_current=%d",
		spec.name, st.rowsSeen, st.rowsWritten, st.encrypted, st.rekeyed,
		st.datesEncrypted, st.datesRekeyed, st.skipped)
	return st, nil
}

// run executes the pre-flight and then the reconcile passes: the in-place /
// date-pair columns first, then the geometry columns.
//
// The order between the two passes does not matter — they touch disjoint
// columns and each is individually idempotent. What matters is that BOTH run,
// because a database is only finished when pii_plaintext_audit AND
// pii_exact_geometry_audit (migration 107) are both empty.
func run(ctx context.Context, db querier, kr keyring, dryRun bool) error {
	if err := preflight(ctx, db, kr); err != nil {
		return err
	}
	var total stats
	for _, spec := range specs {
		st, err := reconcileTable(ctx, db, spec, kr, dryRun)
		if err != nil {
			return err
		}
		total.add(st)
	}
	for _, spec := range geoSpecs {
		st, err := reconcileGeoTable(ctx, db, spec, kr, dryRun)
		if err != nil {
			return err
		}
		total.add(st)
	}
	log.Printf("total: rows=%d written=%d encrypted=%d rekeyed=%d dates_encrypted=%d dates_rekeyed=%d points_encrypted=%d points_rekeyed=%d geometries_coarsened=%d points_already_current=%d erasure_sentinels=%d",
		total.rowsSeen, total.rowsWritten, total.encrypted, total.rekeyed,
		total.datesEncrypted, total.datesRekeyed,
		total.pointsEncrypted, total.pointsRekeyed, total.geomsCoarsened,
		total.pointsAlreadyCurrent, total.sentinelSkipped)
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
