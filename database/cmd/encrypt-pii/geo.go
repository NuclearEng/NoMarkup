package main

// ── At-rest coordinate privacy (migrations 104 / 105 / 107) ──────────────
//
// A geometry(Point,4326) sitting beside an encrypted street address is the
// same secret in a second encoding: anyone with database read access reverse
// geocodes the point and recovers the address. Encrypting the address alone is
// decorative.
//
// The points cannot simply be encrypted — a GiST index cannot be built over
// ciphertext and ST_DWithin cannot read it — so the columns holding a
// customer's home coordinate are COARSENED at rest to a 0.01-degree grid, and
// the EXACT point is preserved encrypted alongside in a sibling *_encrypted
// TEXT column.
//
// ── The ordering rule, and why it is structural ──────────────────────────
// Coarsening is IRREVERSIBLE. Precision that is rounded away is gone, and no
// down migration can restore it. So the exact point must be committed as
// ciphertext BEFORE, or in the same statement as, the coarsening — never
// after. A crash between "coarsen" and "encrypt" would destroy a customer's
// exact location permanently.
//
// This file does not rely on the operator, or on the reader of this comment,
// getting that order right. There is exactly ONE geometry write statement per
// spec, it sets the encrypted column and applies pii_coarsen_point() to the
// geometry columns in the SAME UPDATE, and it is the only statement this file
// can issue. The ordering is therefore atomic by construction rather than by
// discipline: the ciphertext cannot fail to land while the coarsening lands.
//
// ── Why the coarsening runs in SQL and not in Go ─────────────────────────
// pii_exact_geometry_audit (migration 107) decides "has this row been
// processed" by asking whether the stored point equals its own image under
// pii_coarsen_point(). If the backfill computed the grid in Go it would have
// to agree with that SQL function bit for bit, forever, across two rounding
// implementations and two float printers. Applying the SQL function itself
// makes the result what the audit tests for BY CONSTRUCTION. The Go copy below
// exists so a unit test can assert the two agree, not so the backfill can use
// it.
//
// The Go coarsening code mirrors services/job/internal/domain/geo.go. It is a
// deliberate copy: this is a separate Go module and does not import service
// package trees (the crypto primitives in main.go are a sibling copy for the
// same reason). geo_test.go pins the two to the same values.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
)

// coarsenGrid is the at-rest privacy grid for PII point coordinates, in
// degrees. 0.01 deg is ~1.11 km of latitude and ~0.85-1.0 km of longitude
// across the continental US — a neighbourhood, not a building.
//
// Mirrored by pii_coarsen_ordinate() in migration 104 and by
// services/job/internal/domain.CoarsenGrid. Changing one without the others
// silently breaks pii_exact_geometry_audit.
const coarsenGrid = 0.01

// coarsenOrdinate snaps one ordinate to coarsenGrid.
//
// This is deliberately the plainest possible float64 expression and it must
// stay that way — it is a verbatim copy of
// services/job/internal/domain.coarsenOrdinate, and migration 104's SQL mirror
// is written to reproduce THIS arithmetic:
//
//	SELECT (sign(v / 0.01) * floor(abs(v / 0.01) + 0.5)) * 0.01;
//
// all in DOUBLE PRECISION. Two tempting "improvements" were measured against
// 20,162 vectors (uniform random plus every exact .005 half-grid boundary) and
// both break parity:
//
//   - Doing the rounding in exact decimal (PostgreSQL NUMERIC) disagrees on
//     4871 of them: decimal sees 0.145/0.01 as exactly 14.5 and rounds up,
//     while binary float64 division yields 14.499999999999998 and rounds down.
//   - Re-rounding the result to strip the trailing residue (so 35*0.01 reads
//     0.35 rather than 0.35000000000000003) disagrees for the same reason in
//     the other direction.
//
// The residue is not a defect to be cleaned up; it is the shared, deterministic
// output of the same IEEE-754 operations on both sides. Leave it alone. A
// single ULP of disagreement makes pii_exact_geometry_audit report every
// coarsened row as still-exact forever, which would silently retire the only
// question the audit exists to answer. TestCoarsenMatchesSQL in geo_db_test.go
// pins the two together.
func coarsenOrdinate(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return v
	}
	return math.Round(v/coarsenGrid) * coarsenGrid
}

// coarsenPoint snaps a latitude/longitude pair to the at-rest privacy grid. It
// is idempotent, which is what lets pii_exact_geometry_audit use "is this point
// its own image" as the processed test.
func coarsenPoint(lat, lng float64) (float64, float64) {
	return coarsenOrdinate(lat), coarsenOrdinate(lng)
}

// formatExactPoint renders a point for encryption as "<lat>,<lng>".
//
// Fixed 7 decimal places (~11 mm) rather than strconv's shortest round-trip
// form. The point is determinism, not constant width: FormatFloat's shortest
// form would emit "30.2672" for one row and "30.26720000000001" for another
// depending on the binary residue, so the same coordinate could round-trip to
// two different strings and a re-encryption would look like a change.
//
// This does NOT produce a fixed-length string — the integer part still varies
// (19 to 22 bytes across the range), so secretbox ciphertext length reveals
// roughly the digit-count and sign of the coordinate. That leak is empty here:
// the coarsened point sits in the geometry column beside it in the clear and
// already publishes the magnitude outright. Do not add zero-padding to "fix"
// it — that would change the stored plaintext and break every value written
// before the change.
func formatExactPoint(lat, lng float64) string {
	return strconv.FormatFloat(lat, 'f', 7, 64) + "," + strconv.FormatFloat(lng, 'f', 7, 64)
}

// parseExactPoint reverses formatExactPoint. Strict: two fields, both
// parseable, both in range. A malformed value means the decrypted plaintext was
// not a point — a corruption or a key mix-up — and this tool treats that as
// fatal whenever it would otherwise coarsen the geometry the value is supposed
// to be preserving.
func parseExactPoint(s string) (lat, lng float64, err error) {
	latStr, lngStr, ok := strings.Cut(s, ",")
	if !ok {
		return 0, 0, errors.New(`parse exact point: want "<lat>,<lng>", got 1 field`)
	}
	lat, err = strconv.ParseFloat(strings.TrimSpace(latStr), 64)
	if err != nil {
		return 0, 0, fmt.Errorf("parse exact point latitude: %w", err)
	}
	lng, err = strconv.ParseFloat(strings.TrimSpace(lngStr), 64)
	if err != nil {
		return 0, 0, fmt.Errorf("parse exact point longitude: %w", err)
	}
	// NaN must be rejected EXPLICITLY. strconv.ParseFloat accepts the literal
	// "NaN", and every ordering comparison against NaN is false — so
	// `lat < -90 || lat > 90` waves it straight through, and a NaN coordinate
	// then reaches ST_MakePoint and silently poisons ST_DWithin (every
	// distance against NaN is NULL, so the row matches nothing and no error is
	// ever raised). Infinities are already caught by the range checks below;
	// NaN is the one non-finite value that is not.
	if math.IsNaN(lat) || math.IsNaN(lng) {
		return 0, 0, fmt.Errorf("parse exact point: coordinate is NaN")
	}
	if lat < -90 || lat > 90 {
		return 0, 0, fmt.Errorf("parse exact point: latitude %g outside [-90,90]", lat)
	}
	if lng < -180 || lng > 180 {
		return 0, 0, fmt.Errorf("parse exact point: longitude %g outside [-180,180]", lng)
	}
	return lat, lng, nil
}

// isErasureSentinel reports whether a point is the GDPR-erasure marker.
//
// services/user/internal/repository/gdpr.go writes ST_MakePoint(0, 0) into the
// NOT NULL geometry columns of an erased account. That is not a location, it is
// the absence of one, and encrypting it would re-create a "preserved exact
// point" for a user who asked to be forgotten. Note that (0,0) is already its
// own image under the grid, so skipping such rows still drains
// pii_exact_geometry_audit to zero.
func isErasureSentinel(lat, lng float64) bool {
	return lat == 0 && lng == 0
}

// ── geometry table specification ─────────────────────────────────────────

// geoSpec describes one table's PII point geometry. As in tableSpec, the SQL is
// stored as complete literals rather than assembled from fragments, so no
// identifier is ever interpolated and every statement this tool can run is
// auditable by reading this file.
//
// selectSQL must project, in order: id::text, the encrypted column, ST_Y and
// ST_X of the AUTHORITATIVE geometry (the one whose exact value is preserved),
// then one boolean per entry of geomCols reporting whether that column is
// already coarse. It takes ($1 = keyset cursor, $2 = limit), ordered by id.
//
// updateSQL must take $1 = id and $2 = the encrypted value, and must apply
// pii_coarsen_point() to EVERY column in geomCols in the same statement. That
// co-location is the ordering guarantee; see the file header.
type geoSpec struct {
	name      string
	encCol    string
	geomCols  []string
	selectSQL string
	updateSQL string
}

var geoSpecs = []geoSpec{
	{
		// jobs.service_location and jobs.approximate_location currently hold the
		// SAME exact value: the single INSERT in
		// services/job/internal/repository/postgres.go wrote both from one
		// parameter pair, so the "zip centroid for pre-award display" is
		// byte-identical to the customer's exact home point — and it is the
		// column served to the unauthenticated, edge-cached GET
		// /api/v1/jobs/map. The exact point is encrypted ONCE (from
		// service_location, the authoritative column per migration 104) and BOTH
		// geometries are coarsened.
		name:     "jobs",
		encCol:   "service_location_encrypted",
		geomCols: []string{"service_location", "approximate_location"},
		selectSQL: `
			SELECT id::text, service_location_encrypted,
			       ST_Y(service_location), ST_X(service_location),
			       (service_location IS NULL
			         OR ST_Equals(service_location, pii_coarsen_point(service_location))),
			       (approximate_location IS NULL
			         OR ST_Equals(approximate_location, pii_coarsen_point(approximate_location)))
			  FROM jobs
			 WHERE deleted_at IS NULL AND id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		updateSQL: `
			UPDATE jobs
			   SET service_location_encrypted = $2,
			       service_location = pii_coarsen_point(service_location),
			       approximate_location = pii_coarsen_point(approximate_location)
			 WHERE id::text = $1`,
	},
	{
		// properties.location is read by no proximity query and carries no
		// spatial index (migration 105 header). It stays a populated NOT NULL
		// geometry because GDPR erasure writes ST_MakePoint(0,0) into it.
		name:     "properties",
		encCol:   "location_encrypted",
		geomCols: []string{"location"},
		selectSQL: `
			SELECT id::text, location_encrypted,
			       ST_Y(location), ST_X(location),
			       (location IS NULL
			         OR ST_Equals(location, pii_coarsen_point(location)))
			  FROM properties
			 WHERE deleted_at IS NULL AND id::text > $1
			 ORDER BY id::text
			 LIMIT $2`,
		updateSQL: `
			UPDATE properties
			   SET location_encrypted = $2,
			       location = pii_coarsen_point(location)
			 WHERE id::text = $1`,
	},
}

// geoRow is one scanned geometry record.
type geoRow struct {
	id  string
	enc *string
	// lat/lng are the AUTHORITATIVE geometry's ordinates, NULL only when that
	// geometry is NULL.
	lat *float64
	lng *float64
	// coarse[i] reports whether geomCols[i] is already its own image under
	// pii_coarsen_point (computed in SQL, so it is exactly what the audit view
	// asks).
	coarse []bool
}

// exact reports whether ANY of the row's geometry columns still holds an
// un-coarsened point — i.e. whether this row is listed by
// pii_exact_geometry_audit.
func (r geoRow) exact() bool {
	for _, c := range r.coarse {
		if !c {
			return true
		}
	}
	return false
}

// ── the geometry decision ────────────────────────────────────────────────

type geoAction int

const (
	geoNothing     geoAction = iota // nothing to do; issues no write
	geoSentinel                     // (0,0) erasure marker; deliberately skipped
	geoEncrypt                      // exact point sealed under PRIMARY for the first time
	geoRekey                        // existing ciphertext moved from PREVIOUS to PRIMARY
	geoCoarsenOnly                  // ciphertext already current; only the geometry moves
)

func (a geoAction) String() string {
	switch a {
	case geoNothing:
		return "nothing"
	case geoSentinel:
		return "sentinel"
	case geoEncrypt:
		return "encrypt"
	case geoRekey:
		return "rekey"
	default:
		return "coarsen-only"
	}
}

// geoDecision is what reconcileGeoRow concluded for one row.
type geoDecision struct {
	// enc is the value to bind to $2. It is the row's EXISTING value whenever
	// the ciphertext must not be rewritten, so the UPDATE is a no-op on that
	// column.
	enc    *string
	write  bool
	action geoAction
	// coarsens reports that the UPDATE will actually move a geometry, as
	// opposed to re-applying the grid to an already-coarse one (which
	// pii_coarsen_point makes a no-op).
	coarsens bool
	// warn describes a state that is handled but should not exist.
	warn string
}

// reconcileGeoRow decides what to do with one geometry row, WITHOUT touching
// the database. Every ciphertext it produces has already survived
// verifyRoundTrip by the time it is returned.
//
// ── The single most dangerous case, guarded explicitly ───────────────────
// If the encrypted column is ALREADY CURRENT (opens under PRIMARY) the stored
// ciphertext is NEVER overwritten. It cannot be re-derived from the geometry,
// because on any row this tool has already processed the geometry is the
// COARSE point — re-encrypting it would silently replace the preserved exact
// coordinate with the grid intersection it was rounded to, and the loss would
// be undetectable afterwards (the value still decrypts, it is just wrong, and
// wrong in a way that looks like a plausible location). classCurrent therefore
// short-circuits before any formatting or encryption happens.
func reconcileGeoRow(kr keyring, spec geoSpec, r geoRow) (geoDecision, error) {
	d := geoDecision{enc: r.enc, action: geoNothing}

	if r.lat == nil || r.lng == nil {
		// No point at all. Nothing to preserve and nothing to coarsen.
		return d, nil
	}
	if isErasureSentinel(*r.lat, *r.lng) {
		d.action = geoSentinel
		return d, nil
	}
	exact := r.exact()

	cur := ""
	if r.enc != nil {
		cur = *r.enc
	}
	class, plain := classify(kr, cur)

	switch class {
	case classUnknown:
		// Somebody's ciphertext under a key we were not given. Encrypting it
		// again would make it unrecoverable, and coarsening the geometry beside
		// it would destroy the only readable copy of the point.
		return d, fmt.Errorf("%s.%s id=%s: %w", spec.name, spec.encCol, r.id, errUnknownKey)

	case classCurrent:
		// DO NOT OVERWRITE — see the doc comment above. The stored ciphertext is
		// the exact point; the geometry beside it may already be the coarse one.
		d.action = geoCoarsenOnly
		got, ok := open(kr.primary, cur)
		if !ok {
			// classify said it opens; if it does not, something is very wrong.
			return d, fmt.Errorf("%s.%s id=%s: value classified current but does not open", spec.name, spec.encCol, r.id)
		}
		if _, _, err := parseExactPoint(got); err != nil {
			if exact {
				// About to round the geometry away while the copy that is
				// supposed to preserve it is not a point. Refuse.
				return d, fmt.Errorf(
					"%s.%s id=%s: REFUSING to coarsen: the current ciphertext does not decrypt to a point (%w)",
					spec.name, spec.encCol, r.id, err)
			}
			d.warn = fmt.Sprintf("%s.%s id=%s: current ciphertext does not decrypt to a point (%v); geometry is already coarse so the exact point is unrecoverable",
				spec.name, spec.encCol, r.id, err)
			return d, nil
		}
		if !exact {
			// Fully processed already. This is what makes a second run free.
			return d, nil
		}
		// Encrypted copy present but the geometry was never coarsened: a
		// partially applied state (an app write path that encrypts without
		// coarsening, or a hand-edited row). Finish the job, keep the copy.
		d.write = true
		d.coarsens = true
		d.warn = fmt.Sprintf("%s id=%s: %s was already current while %v still held an EXACT point; coarsening the geometry and KEEPING the stored ciphertext",
			spec.name, spec.encCol, r.id, spec.geomCols)
		return d, nil

	case classRekey:
		// Rotation. The exact point lives in the PREVIOUS-key ciphertext; move
		// it to PRIMARY. The geometry is not re-derived from and not consulted:
		// pii_coarsen_point is idempotent, so an already-coarse geometry comes
		// out byte-identical and only a still-exact one moves.
		if _, _, err := parseExactPoint(plain); err != nil {
			return d, fmt.Errorf("%s.%s id=%s: re-keyed value does not decrypt to a point: %w",
				spec.name, spec.encCol, r.id, err)
		}
		ct, err := sealPoint(kr, plain)
		if err != nil {
			return d, fmt.Errorf("%s.%s id=%s: %w", spec.name, spec.encCol, r.id, err)
		}
		d.enc = &ct
		d.write = true
		d.action = geoRekey
		d.coarsens = exact
		return d, nil

	case classPlaintext:
		// The encrypted column holds something that is not our wire format. For
		// a point column the only legitimate such value is an un-sealed
		// "<lat>,<lng>" literal; seal it in place. Anything else is a corruption
		// and must not be traded for a coarsened geometry.
		if _, _, err := parseExactPoint(cur); err != nil {
			return d, fmt.Errorf("%s.%s id=%s: column holds a non-ciphertext value that is not a point: %w",
				spec.name, spec.encCol, r.id, err)
		}
		ct, err := sealPoint(kr, cur)
		if err != nil {
			return d, fmt.Errorf("%s.%s id=%s: %w", spec.name, spec.encCol, r.id, err)
		}
		d.enc = &ct
		d.write = true
		d.action = geoEncrypt
		d.coarsens = exact
		return d, nil

	case classEmpty:
		if !exact {
			// The geometry is already on the grid and nothing preserved the
			// exact point — the row predates this work and its precision is
			// already gone. Sealing the coarse point here would record a grid
			// intersection under a column that promises an EXACT coordinate,
			// which is a lie the read paths would believe. Leave it NULL; the
			// audit view (which reports exactness, not presence) stays empty.
			return d, nil
		}
		pt := formatExactPoint(*r.lat, *r.lng)
		ct, err := sealPoint(kr, pt)
		if err != nil {
			return d, fmt.Errorf("%s.%s id=%s: %w", spec.name, spec.encCol, r.id, err)
		}
		d.enc = &ct
		d.write = true
		d.action = geoEncrypt
		d.coarsens = true
		return d, nil

	default:
		return d, fmt.Errorf("%s.%s id=%s: unhandled value class %d", spec.name, spec.encCol, r.id, class)
	}
}

// sealPoint encrypts a formatted point under PRIMARY and proves it reads back.
// Every ciphertext this file writes goes through here.
func sealPoint(kr keyring, point string) (string, error) {
	ct, err := encrypt(kr.primary, point)
	if err != nil {
		return "", fmt.Errorf("encrypt exact point: %w", err)
	}
	if err := verifyRoundTrip(kr.primary, ct, point); err != nil {
		return "", fmt.Errorf("exact point: %w", err)
	}
	return ct, nil
}

// ── scanning and the write pass ──────────────────────────────────────────

// scanGeoTable streams every row of spec in id order and hands each to visit.
func scanGeoTable(ctx context.Context, db querier, spec geoSpec, visit func(geoRow) error) error {
	cursor := ""
	for {
		batch, err := fetchGeoBatch(ctx, db, spec, cursor)
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

func fetchGeoBatch(ctx context.Context, db querier, spec geoSpec, cursor string) ([]geoRow, error) {
	rows, err := db.Query(ctx, spec.selectSQL, cursor, batchSize)
	if err != nil {
		return nil, fmt.Errorf("%s geo: query batch: %w", spec.name, err)
	}
	defer rows.Close()

	var out []geoRow
	for rows.Next() {
		r := geoRow{coarse: make([]bool, len(spec.geomCols))}
		dest := make([]any, 0, 4+len(spec.geomCols))
		dest = append(dest, &r.id, &r.enc, &r.lat, &r.lng)
		for i := range r.coarse {
			dest = append(dest, &r.coarse[i])
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("%s geo: scan: %w", spec.name, err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%s geo: rows iter: %w", spec.name, err)
	}
	return out, nil
}

// reconcileGeoTable runs the write pass for one geometry spec. Each row that
// needs work gets exactly ONE statement, which seals the exact point and
// coarsens the geometry together.
func reconcileGeoTable(ctx context.Context, db querier, spec geoSpec, kr keyring, dryRun bool) (stats, error) {
	var st stats

	err := scanGeoTable(ctx, db, spec, func(r geoRow) error {
		st.rowsSeen++
		d, err := reconcileGeoRow(kr, spec, r)
		if err != nil {
			return err
		}
		if d.warn != "" {
			log.Printf("WARN %s", d.warn)
		}
		switch d.action {
		case geoSentinel:
			st.sentinelSkipped++
		case geoEncrypt:
			st.pointsEncrypted++
		case geoRekey:
			st.pointsRekeyed++
		case geoCoarsenOnly:
			st.pointsAlreadyCurrent++
		}
		if d.coarsens {
			st.geomsCoarsened++
		}
		if !d.write {
			return nil
		}
		if dryRun {
			log.Printf("DRY %s id=%s would_write=true action=%s coarsens=%v",
				spec.name, r.id, d.action, d.coarsens)
			st.rowsWritten++
			return nil
		}
		if _, err := db.Exec(ctx, spec.updateSQL, r.id, d.enc); err != nil {
			return fmt.Errorf("%s geo: update id=%s: %w", spec.name, r.id, err)
		}
		st.rowsWritten++
		return nil
	})
	if err != nil {
		return st, err
	}

	log.Printf("%s geo: rows=%d written=%d points_encrypted=%d points_rekeyed=%d geometries_coarsened=%d already_current=%d erasure_sentinels=%d",
		spec.name, st.rowsSeen, st.rowsWritten, st.pointsEncrypted, st.pointsRekeyed,
		st.geomsCoarsened, st.pointsAlreadyCurrent, st.sentinelSkipped)
	return st, nil
}
