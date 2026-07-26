package domain

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ── At-rest coordinate privacy ───────────────────────────────────────────
//
// A geometry(Point,4326) beside an encrypted street address is the same
// secret in a second encoding: anyone with database read access reverse
// geocodes the point and recovers the address. Encrypting the address alone
// is decorative.
//
// The points cannot simply be encrypted, because some of them are functional
// — a GiST index cannot be built over ciphertext and ST_DWithin cannot read
// it. So the columns that hold a customer's home coordinate are COARSENED at
// rest to a grid, and the exact point is preserved encrypted alongside for
// the readers that genuinely need it (see migrations 104 and 105).
//
// For this service the column in question is properties.location — the
// coordinate of a customer's saved home, sitting beside the address column
// migration 033 encrypted. Migration 105 established by reading every query
// that it is functional for nobody:
//
//   - It carries NO spatial index. properties has only idx_properties_user,
//     idx_properties_zip, idx_properties_user_fk and the pii flag index.
//   - No ST_DWithin, ST_Distance or ST_DistanceSphere anywhere in Go, Rust or
//     SQL references it. (The ST_DistanceSphere calls in this package's
//     repository are all against provider_profiles.service_location, a
//     different column with a different, documented trade-off.)
//   - Every read is a plain projection of the ordinates back to the OWNING
//     user: CreateProperty's RETURNING, ListProperties and getPropertyByID,
//     plus services/job lifting the linked property's point to seed a new
//     job's service centre.
//
// So the column is coarsened at rest and the exact point is encrypted into
// properties.location_encrypted, which the read paths prefer.
//
// This file is a deliberate byte-for-byte copy of
// services/job/internal/domain/geo.go. The two modules do not import each
// other — crypto is a sibling copy in gateway/, services/payment/ and
// services/job/ for the same reason — but the BEHAVIOUR must stay identical
// to that copy and to the SQL pii_coarsen_point(), or pii_exact_geometry_audit
// (migration 107) cannot tell a coarsened row from an exact one.

// CoarsenGrid is the at-rest privacy grid for PII point coordinates, in
// degrees.
//
// 0.01 degrees is ~1.11 km of latitude everywhere, and ~0.85-1.0 km of
// longitude across the continental US. A cell that size covers a
// neighbourhood rather than a building, which is what closes the
// reverse-geocode path; going finer (0.001 deg, ~111 m) would resolve to a
// single block and give back most of what the coarsening was for.
//
// The cost is bounded by half a cell diagonal, ~0.79 km, and it is paid only
// where the exact point is unavailable — i.e. on a property row written
// before migration 105 that the backfill has not reached. Nothing filters,
// sorts or scores on properties.location, so the only visible effect is the
// owner's own map pin.
//
// This value is mirrored by pii_coarsen_ordinate() in migration 104. Changing
// one without the other silently breaks the pii_exact_geometry_audit view,
// which decides "has this row been coarsened" by comparing a point against
// its own image under the SQL function.
const CoarsenGrid = 0.01

// coarsenOrdinate snaps one ordinate to CoarsenGrid.
//
// This is deliberately the plainest possible float64 expression, and it must
// stay that way. pii_exact_geometry_audit (migration 107) decides whether a
// row has been coarsened by testing ST_Equals(g, pii_coarsen_point(g)), so a
// single ULP of disagreement between this function and its SQL mirror makes
// every row the services write report as "still exact" forever.
//
// The SQL mirror is therefore written to reproduce THIS arithmetic, rather
// than this being written to match SQL — see migration 104. Two tempting
// "improvements" were measured against 20,162 vectors (uniform random plus
// every exact .005 half-grid boundary) and both break parity:
//
//   - Doing the rounding in exact decimal (PostgreSQL NUMERIC) disagrees on
//     4871 of them: decimal sees 0.145/0.01 as exactly 14.5 and rounds up,
//     while binary float64 division yields 14.499999999999998 and rounds down.
//   - Re-rounding the result to strip the trailing residue (so 35*0.01 reads
//     0.35 rather than 0.35000000000000003) disagrees for the same reason in
//     the other direction.
//
// The residue is not a defect to be cleaned up; it is the shared, deterministic
// output of the same IEEE-754 operations on both sides. Leave it alone.
func coarsenOrdinate(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return v
	}
	return math.Round(v/CoarsenGrid) * CoarsenGrid
}

// CoarsenPoint snaps a latitude/longitude pair to the at-rest privacy grid.
// It is idempotent: coarsening an already-coarse point returns it unchanged,
// which is what lets pii_exact_geometry_audit use "is this point its own
// image" as the test for whether a row has been processed.
func CoarsenPoint(lat, lng float64) (float64, float64) {
	return coarsenOrdinate(lat), coarsenOrdinate(lng)
}

// FormatExactPoint renders a point for encryption as "<lat>,<lng>".
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
func FormatExactPoint(lat, lng float64) string {
	return strconv.FormatFloat(lat, 'f', 7, 64) + "," + strconv.FormatFloat(lng, 'f', 7, 64)
}

// ParseExactPoint reverses FormatExactPoint.
//
// It is strict — two fields, both parseable, both in range. A malformed value
// here means the decrypted plaintext was not a point, which is a corruption
// or a key mix-up, and callers must fall back to the (coarse) geometry column
// rather than proceed with a zero coordinate: 0,0 is a real location in the
// Gulf of Guinea and would silently match nothing.
func ParseExactPoint(s string) (lat, lng float64, err error) {
	latStr, lngStr, ok := strings.Cut(s, ",")
	if !ok {
		return 0, 0, fmt.Errorf("parse exact point: want \"<lat>,<lng>\", got %d fields", 1)
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
