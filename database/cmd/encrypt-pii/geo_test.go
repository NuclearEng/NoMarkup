package main

import (
	"errors"
	"math"
	"math/rand"
	"strings"
	"testing"
)

func strp(s string) *string   { return &s }
func f64p(v float64) *float64 { return &v }
func bools(b ...bool) []bool  { return b }
func mustOpen(t *testing.T, key *[keySize]byte, s string) string {
	t.Helper()
	got, ok := open(key, s)
	if !ok {
		t.Fatalf("value does not open under the key")
	}
	return got
}

// ── the grid ─────────────────────────────────────────────────────────────

// TestCoarsenOrdinateRoundsHalfAwayFromZero pins the GRID INDEX each input
// snaps to, rather than a float literal, so the assertion is about the rounding
// decision and not about decimal printing.
//
// The .005 vectors are the ones that broke: an implementation doing the
// rounding in exact decimal (a NUMERIC cast in SQL, or a re-rounding fudge in
// Go) disagrees with plain float64 on them, and a single disagreement makes
// pii_exact_geometry_audit report every coarsened row as still-exact forever.
func TestCoarsenOrdinateRoundsHalfAwayFromZero(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		in    float64
		index int // the multiple of coarsenGrid the input must land on
	}{
		{"positive half boundary rounds up", 30.265, 3027},
		{"negative half boundary rounds away from zero", -97.745, -9775},
		{"negative half boundary, other cell", -97.735, -9774},
		{"smallest positive half", 0.005, 1},
		{"smallest negative half", -0.005, -1},
		{"zero", 0, 0},
		// 0.145/0.01 is 14.499999999999998 in binary float64, NOT the exact
		// 14.5 that decimal arithmetic sees. It therefore rounds DOWN. This is
		// the vector that exposed the NUMERIC mismatch; pinning it here keeps
		// anyone from "fixing" the residue back into a mismatch.
		{"decimal-vs-binary disagreement case", 0.145, 14},
		{"ordinary point rounds to nearest", 30.2672123, 3027},
		{"ordinary negative point", -97.7431, -9774},
		{"already on the grid", 35 * coarsenGrid, 35},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			want := float64(tc.index) * coarsenGrid
			if got := coarsenOrdinate(tc.in); got != want {
				t.Errorf("coarsenOrdinate(%v) = %.17g, want %.17g (grid index %d)",
					tc.in, got, want, tc.index)
			}
		})
	}
}

// TestCoarsenOrdinateOddSymmetry: half-away-from-zero is symmetric about zero,
// which banker's rounding is not. Checked on every exact .005 boundary across
// the full latitude range.
func TestCoarsenOrdinateOddSymmetry(t *testing.T) {
	t.Parallel()
	for k := -9000; k < 9000; k++ {
		v := (float64(k) + 0.5) * coarsenGrid
		if got, want := coarsenOrdinate(-v), -coarsenOrdinate(v); got != want {
			t.Fatalf("coarsenOrdinate(%.17g) = %.17g but -coarsenOrdinate(%.17g) = %.17g",
				-v, got, v, want)
		}
	}
}

// TestCoarsenIsIdempotent is the property pii_exact_geometry_audit depends on:
// a coarsened point is its own image, so "is this point unchanged by the grid"
// is a decisive test for "has this row been processed".
func TestCoarsenIsIdempotent(t *testing.T) {
	t.Parallel()

	check := func(t *testing.T, lat, lng float64) {
		t.Helper()
		lat1, lng1 := coarsenPoint(lat, lng)
		lat2, lng2 := coarsenPoint(lat1, lng1)
		if lat1 != lat2 || lng1 != lng2 {
			t.Fatalf("coarsening is not idempotent: (%.17g,%.17g) -> (%.17g,%.17g) -> (%.17g,%.17g)",
				lat, lng, lat1, lng1, lat2, lng2)
		}
	}

	t.Run("half-grid boundaries", func(t *testing.T) {
		t.Parallel()
		for k := -9000; k < 9000; k++ {
			v := (float64(k) + 0.5) * coarsenGrid
			check(t, v, -v)
		}
	})
	t.Run("random continental-US coordinates", func(t *testing.T) {
		t.Parallel()
		rng := rand.New(rand.NewSource(1))
		for i := 0; i < 20000; i++ {
			lat := 24 + rng.Float64()*25   // 24N .. 49N
			lng := -125 + rng.Float64()*59 // 125W .. 66W
			check(t, lat, lng)
		}
	})
}

// TestCoarsenDisplacementIsBoundedByHalfACell backs the "worst case ~0.79 km"
// claim in migrations 104/105: no ordinate may move by more than half a grid
// cell, or the coarsening would be moving points further than it is documented
// to.
func TestCoarsenDisplacementIsBoundedByHalfACell(t *testing.T) {
	t.Parallel()
	rng := rand.New(rand.NewSource(7))
	const tol = 1e-9 // float slack, far below the 0.005 bound itself
	for i := 0; i < 20000; i++ {
		v := -180 + rng.Float64()*360
		if d := math.Abs(coarsenOrdinate(v) - v); d > coarsenGrid/2+tol {
			t.Fatalf("coarsenOrdinate(%.17g) moved the ordinate by %.17g, more than half a cell", v, d)
		}
	}
}

func TestCoarsenOrdinatePassesThroughNonFinite(t *testing.T) {
	t.Parallel()
	if got := coarsenOrdinate(math.NaN()); !math.IsNaN(got) {
		t.Errorf("NaN = %v, want NaN", got)
	}
	for _, v := range []float64{math.Inf(1), math.Inf(-1)} {
		if got := coarsenOrdinate(v); got != v {
			t.Errorf("coarsenOrdinate(%v) = %v, want %v", v, got, v)
		}
	}
}

// ── the wire encoding ────────────────────────────────────────────────────

func TestFormatExactPointRoundTrips(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		lat, lng float64
		want     string
	}{
		{"austin", 30.2672123, -97.7431456, "30.2672123,-97.7431456"},
		{"zero", 0, 0, "0.0000000,0.0000000"},
		{"fewer decimals are padded", 30.5, -97.25, "30.5000000,-97.2500000"},
		{"extremes", -89.9999999, 179.9999999, "-89.9999999,179.9999999"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := formatExactPoint(tc.lat, tc.lng)
			if got != tc.want {
				t.Fatalf("formatExactPoint = %q, want %q", got, tc.want)
			}
			lat, lng, err := parseExactPoint(got)
			if err != nil {
				t.Fatalf("parseExactPoint(%q): %v", got, err)
			}
			if lat != tc.lat || lng != tc.lng {
				t.Fatalf("round trip = (%v,%v), want (%v,%v)", lat, lng, tc.lat, tc.lng)
			}
		})
	}
}

// TestFormatExactPointIsDeterministic pins the property the encoding actually
// needs. The fixed 7 decimals are NOT about constant width — the integer part
// still varies, so the string is 19-22 bytes wide — they are about determinism:
// strconv's shortest round-trip form would emit "30.2672" for one row and
// "30.26720000000001" for another depending on binary residue, so the same
// coordinate could serialise two ways and a re-encryption would look like a
// change.
//
// So: same input always yields the same string, both fields always carry
// exactly 7 decimals, and the value survives the round trip to within half of
// the last retained digit (5e-8).
func TestFormatExactPointIsDeterministic(t *testing.T) {
	t.Parallel()
	rng := rand.New(rand.NewSource(11))
	const tol = 5e-8

	points := [][2]float64{
		{30.2672123, -97.7431456}, {30.5, -97.25}, {30, -97}, {0, 0},
		{30.26721234567, -97.74314567891}, {-89.9999999, 179.9999999},
	}
	for i := 0; i < 500; i++ {
		points = append(points, [2]float64{
			-90 + rng.Float64()*180,
			-180 + rng.Float64()*360,
		})
	}

	for _, p := range points {
		s := formatExactPoint(p[0], p[1])
		if again := formatExactPoint(p[0], p[1]); again != s {
			t.Fatalf("formatExactPoint%v is not deterministic: %q then %q", p, s, again)
		}
		for _, part := range strings.Split(s, ",") {
			_, frac, ok := strings.Cut(part, ".")
			if !ok {
				t.Fatalf("formatExactPoint%v = %q: %q has no decimal point", p, s, part)
			}
			if len(frac) != 7 {
				t.Fatalf("formatExactPoint%v = %q: %q has %d decimals, want 7", p, s, part, len(frac))
			}
		}
		lat, lng, err := parseExactPoint(s)
		if err != nil {
			t.Fatalf("parseExactPoint(%q): %v", s, err)
		}
		if math.Abs(lat-p[0]) > tol || math.Abs(lng-p[1]) > tol {
			t.Fatalf("round trip of %v via %q gave (%v,%v), beyond the %g tolerance", p, s, lat, lng, tol)
		}
		// Re-formatting the parsed value must reproduce the string exactly, or a
		// decrypt/re-encrypt cycle would register as a change.
		if again := formatExactPoint(lat, lng); again != s {
			t.Fatalf("re-formatting the parsed point changed it: %q -> %q", s, again)
		}
	}
}

func TestParseExactPointRejectsGarbage(t *testing.T) {
	t.Parallel()
	for _, s := range []string{
		"", "30.2672123", "not,a,point", "abc,def", "30.26,", ",97.74",
		"91.0000000,0.0000000", "-91.0000000,0.0000000",
		"0.0000000,181.0000000", "0.0000000,-181.0000000",
		"456 Service Rd, Austin, TX 78702",
		// strconv.ParseFloat accepts these, and every ordering comparison
		// against NaN is false, so the range checks alone would wave them
		// through into ST_MakePoint.
		"NaN,0.0000000", "0.0000000,NaN", "Inf,0.0000000", "0.0000000,-Inf",
	} {
		if _, _, err := parseExactPoint(s); err == nil {
			t.Errorf("parseExactPoint(%q) succeeded; it must be strict", s)
		}
	}
}

// ── the row decision ─────────────────────────────────────────────────────

var testGeoSpec = geoSpec{
	name:     "jobs",
	encCol:   "service_location_encrypted",
	geomCols: []string{"service_location", "approximate_location"},
}

const (
	testLat = 30.2672123
	testLng = -97.7431456
)

// exactRow builds a row whose geometry is still the exact point.
func exactRow(enc *string) geoRow {
	return geoRow{id: "row-1", enc: enc, lat: f64p(testLat), lng: f64p(testLng), coarse: bools(false, false)}
}

// coarseRow builds a row whose geometry has already been snapped to the grid.
func coarseRow(enc *string) geoRow {
	lat, lng := coarsenPoint(testLat, testLng)
	return geoRow{id: "row-1", enc: enc, lat: f64p(lat), lng: f64p(lng), coarse: bools(true, true)}
}

func TestReconcileGeoRow(t *testing.T) {
	t.Parallel()
	primary, previous := mustKey(t), mustKey(t)
	kr := keyring{primary: primary, previous: previous}
	exactPoint := formatExactPoint(testLat, testLng)

	tests := []struct {
		name       string
		row        geoRow
		wantAction geoAction
		wantWrite  bool
		wantCoarse bool
		// wantPlain, when non-empty, is what the resulting ciphertext must
		// decrypt to under PRIMARY.
		wantPlain string
	}{
		{
			name:       "first backfill: exact geometry, no ciphertext",
			row:        exactRow(nil),
			wantAction: geoEncrypt, wantWrite: true, wantCoarse: true,
			wantPlain: exactPoint,
		},
		{
			name:       "second run: coarse geometry, current ciphertext",
			row:        coarseRow(strp(mustEncrypt(t, primary, exactPoint))),
			wantAction: geoCoarsenOnly, wantWrite: false, wantCoarse: false,
			wantPlain: exactPoint,
		},
		{
			name:       "partially applied: current ciphertext but geometry still exact",
			row:        exactRow(strp(mustEncrypt(t, primary, exactPoint))),
			wantAction: geoCoarsenOnly, wantWrite: true, wantCoarse: true,
			wantPlain: exactPoint,
		},
		{
			name:       "rotation: stale ciphertext, geometry already coarse",
			row:        coarseRow(strp(mustEncrypt(t, previous, exactPoint))),
			wantAction: geoRekey, wantWrite: true, wantCoarse: false,
			wantPlain: exactPoint,
		},
		{
			name:       "rotation on a row the backfill never reached",
			row:        exactRow(strp(mustEncrypt(t, previous, exactPoint))),
			wantAction: geoRekey, wantWrite: true, wantCoarse: true,
			wantPlain: exactPoint,
		},
		{
			name:       "unsealed point literal is sealed in place",
			row:        exactRow(strp(exactPoint)),
			wantAction: geoEncrypt, wantWrite: true, wantCoarse: true,
			wantPlain: exactPoint,
		},
		{
			name:       "erasure sentinel is left alone",
			row:        geoRow{id: "row-1", lat: f64p(0), lng: f64p(0), coarse: bools(true, true)},
			wantAction: geoSentinel, wantWrite: false, wantCoarse: false,
		},
		{
			name:       "NULL geometry is left alone",
			row:        geoRow{id: "row-1", coarse: bools(true, true)},
			wantAction: geoNothing, wantWrite: false, wantCoarse: false,
		},
		{
			// Precision already lost before this tool ever ran. Sealing the
			// coarse point would record a grid intersection under a column that
			// promises an exact one.
			name:       "coarse geometry with no ciphertext is NOT back-filled from the grid",
			row:        coarseRow(nil),
			wantAction: geoNothing, wantWrite: false, wantCoarse: false,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			d, err := reconcileGeoRow(kr, testGeoSpec, tc.row)
			if err != nil {
				t.Fatalf("reconcileGeoRow: %v", err)
			}
			if d.action != tc.wantAction {
				t.Errorf("action = %v, want %v", d.action, tc.wantAction)
			}
			if d.write != tc.wantWrite {
				t.Errorf("write = %v, want %v", d.write, tc.wantWrite)
			}
			if d.coarsens != tc.wantCoarse {
				t.Errorf("coarsens = %v, want %v", d.coarsens, tc.wantCoarse)
			}
			if tc.wantPlain == "" {
				return
			}
			if d.enc == nil {
				t.Fatal("enc is nil; expected a ciphertext")
			}
			if got := mustOpen(t, primary, *d.enc); got != tc.wantPlain {
				t.Fatalf("one unseal yields %q, want %q", got, tc.wantPlain)
			}
		})
	}
}

// TestReconcileGeoRowNeverOverwritesCurrentCiphertext is the single most
// dangerous failure mode in this work, isolated.
//
// After the first run the geometry holds the COARSE point and the encrypted
// column holds the EXACT one. If a later run re-derived the ciphertext from the
// geometry it would replace the exact coordinate with the grid intersection it
// was rounded to — and the damage would be invisible, because the value still
// decrypts and still looks like a plausible location.
//
// Both branches are checked: the fully-processed row (no write at all) and the
// partially-applied row (the geometry is finished, the ciphertext is kept
// byte-for-byte).
func TestReconcileGeoRowNeverOverwritesCurrentCiphertext(t *testing.T) {
	t.Parallel()
	primary := mustKey(t)
	kr := keyring{primary: primary}
	exactPoint := formatExactPoint(testLat, testLng)
	stored := mustEncrypt(t, primary, exactPoint)

	for _, tc := range []struct {
		name string
		row  geoRow
	}{
		{"geometry already coarse", coarseRow(strp(stored))},
		{"geometry still exact", exactRow(strp(stored))},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			d, err := reconcileGeoRow(kr, testGeoSpec, tc.row)
			if err != nil {
				t.Fatalf("reconcileGeoRow: %v", err)
			}
			if d.enc == nil || *d.enc != stored {
				t.Fatalf("the current ciphertext was rewritten; the preserved EXACT point would be downgraded to the coarse grid")
			}
			if got := mustOpen(t, primary, *d.enc); got != exactPoint {
				t.Fatalf("stored point is now %q, want the exact %q", got, exactPoint)
			}
		})
	}
}

// TestReconcileGeoRowRefusesUnknownKey: a point sealed under a key we were not
// given must abort. Coarsening beside it would destroy the only readable copy.
func TestReconcileGeoRowRefusesUnknownKey(t *testing.T) {
	t.Parallel()
	primary, foreign := mustKey(t), mustKey(t)
	kr := keyring{primary: primary}
	orphan := mustEncrypt(t, foreign, formatExactPoint(testLat, testLng))

	for _, r := range []geoRow{exactRow(strp(orphan)), coarseRow(strp(orphan))} {
		if _, err := reconcileGeoRow(kr, testGeoSpec, r); !errors.Is(err, errUnknownKey) {
			t.Fatalf("err = %v, want errUnknownKey", err)
		}
	}
}

// TestReconcileGeoRowRefusesToCoarsenBehindANonPoint: the coarsening is only
// safe because something else holds the exact coordinate. If that something is
// not a point, the trade is not safe and the run must stop.
func TestReconcileGeoRowRefusesToCoarsenBehindANonPoint(t *testing.T) {
	t.Parallel()
	primary, previous := mustKey(t), mustKey(t)
	kr := keyring{primary: primary, previous: previous}

	tests := []struct {
		name string
		row  geoRow
	}{
		{"current ciphertext is not a point", exactRow(strp(mustEncrypt(t, primary, "456 Service Rd")))},
		{"stale ciphertext is not a point", exactRow(strp(mustEncrypt(t, previous, "456 Service Rd")))},
		{"unsealed value is not a point", exactRow(strp("456 Service Rd"))},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if _, err := reconcileGeoRow(kr, testGeoSpec, tc.row); err == nil {
				t.Fatal("expected a refusal: the geometry would be coarsened with no valid exact copy")
			}
		})
	}
}

// A non-point ciphertext beside an ALREADY coarse geometry destroys nothing —
// the precision is long gone — so it warns instead of blocking every future run.
func TestReconcileGeoRowWarnsOnNonPointBehindCoarseGeometry(t *testing.T) {
	t.Parallel()
	primary := mustKey(t)
	kr := keyring{primary: primary}

	d, err := reconcileGeoRow(kr, testGeoSpec, coarseRow(strp(mustEncrypt(t, primary, "456 Service Rd"))))
	if err != nil {
		t.Fatalf("reconcileGeoRow: %v", err)
	}
	if d.write {
		t.Error("nothing should be written")
	}
	if d.warn == "" {
		t.Error("expected a WARN describing the unrecoverable state")
	}
}

// TestReconcileGeoRowIsIdempotent drives the decision function the way a repeat
// run would, and asserts the exact point survives byte-for-byte.
func TestReconcileGeoRowIsIdempotent(t *testing.T) {
	t.Parallel()
	primary := mustKey(t)
	kr := keyring{primary: primary}
	exactPoint := formatExactPoint(testLat, testLng)

	// Pass 1: exact geometry, nothing stored.
	d, err := reconcileGeoRow(kr, testGeoSpec, exactRow(nil))
	if err != nil {
		t.Fatalf("pass 1: %v", err)
	}
	if !d.write {
		t.Fatal("pass 1 must write")
	}
	stored := *d.enc

	// Passes 2..5 see what the database would now hold: coarse geometry plus
	// the ciphertext from pass 1.
	for i := 2; i <= 5; i++ {
		d, err = reconcileGeoRow(kr, testGeoSpec, coarseRow(strp(stored)))
		if err != nil {
			t.Fatalf("pass %d: %v", i, err)
		}
		if d.write {
			t.Fatalf("pass %d issued a write; repeat runs must be free", i)
		}
		if *d.enc != stored {
			t.Fatalf("pass %d mutated the ciphertext", i)
		}
		if got := mustOpen(t, primary, *d.enc); got != exactPoint {
			t.Fatalf("pass %d: stored point is now %q, want the ORIGINAL exact %q", i, got, exactPoint)
		}
	}
}

// ── spec hygiene ─────────────────────────────────────────────────────────

// TestGeoSpecsAreWellFormed keeps the literal SQL in sync with the metadata it
// is scanned against, and enforces the ordering rule structurally: every
// geometry column must be coarsened in the SAME statement that writes the
// ciphertext.
func TestGeoSpecsAreWellFormed(t *testing.T) {
	t.Parallel()
	for _, s := range geoSpecs {
		s := s
		t.Run(s.name, func(t *testing.T) {
			t.Parallel()
			if s.encCol == "" || len(s.geomCols) == 0 {
				t.Fatal("spec must name an encrypted column and at least one geometry column")
			}
			if !strings.Contains(s.selectSQL, s.encCol) {
				t.Errorf("selectSQL does not project %q", s.encCol)
			}
			if !strings.Contains(s.updateSQL, s.encCol+" = $2") {
				t.Errorf("updateSQL must bind %q to $2", s.encCol)
			}
			for _, g := range s.geomCols {
				if !strings.Contains(s.selectSQL, "pii_coarsen_point("+g+")") {
					t.Errorf("selectSQL must report whether %q is already coarse", g)
				}
				// THE ordering guarantee: ciphertext and coarsening in one
				// statement, so the exact point can never be rounded away
				// without its encrypted copy landing at the same instant.
				if !strings.Contains(s.updateSQL, g+" = pii_coarsen_point("+g+")") {
					t.Errorf("updateSQL must coarsen %q in the same statement that writes the ciphertext", g)
				}
			}
			if !strings.Contains(s.selectSQL, "$1") || !strings.Contains(s.selectSQL, "ORDER BY id::text") {
				t.Error("selectSQL must paginate on the id cursor and order by id::text")
			}
			if !strings.Contains(s.updateSQL, "WHERE id::text = $1") {
				t.Error("updateSQL must be scoped to one id")
			}
			// The Go coarsening must never be the thing that writes the value.
			if strings.Contains(s.updateSQL, "ST_MakePoint") {
				t.Error("updateSQL must apply pii_coarsen_point, not construct a point itself")
			}
		})
	}
}
