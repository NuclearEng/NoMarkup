package domain

import (
	"math"
	"strings"
	"testing"
)

// TestCoarsenPointSnapsToGrid asserts which GRID CELL a coordinate lands in —
// including the exact .005 half-boundaries, where half-away-from-zero and
// banker's rounding part company.
//
// The comparison is to 1e-9 (~0.1 mm), not bit-exact, and that is deliberate:
// math.Round(v/0.01)*0.01 carries a binary residue (CoarsenPoint(-97.74) is
// -97.74000000000001, because 0.01 is not representable in base 2). The
// residue must NOT be normalised away — it is reproduced exactly by the SQL
// mirror, and an earlier version of this function that rounded it off
// disagreed with PostgreSQL on 4871 of 20162 measured vectors. Bit-exactness
// is pinned by TestCoarsenPointKeepsTheBinaryResidue below, and the
// cross-language parity by the ST_Equals assertion in the repository dbtest.
// A grid cell is 0.01 degrees wide, ten million times the tolerance used here,
// so no residue can disguise a wrong cell.
func TestCoarsenPointSnapsToGrid(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name             string
		lat, lng         float64
		wantLat, wantLng float64
	}{
		{"austin downtown", 30.2672, -97.7431, 30.27, -97.74},
		{"already on the grid", 30.27, -97.74, 30.27, -97.74},
		{"rounds down", 30.2649, -97.7449, 30.26, -97.74},
		{"rounds up", 30.2651, -97.7451, 30.27, -97.75},
		// math.Round is half-AWAY-from-zero, and the SQL mirror reproduces it
		// with sign()*floor(abs()+0.5) in DOUBLE PRECISION. PostgreSQL's own
		// round(double precision) delegates to rint(), which is banker's
		// rounding and would send these to the nearest EVEN cell — 30.26 here.
		{"positive half boundary", 30.265, 12.005, 30.27, 12.01},
		{"negative half boundary", -30.265, -97.745, -30.27, -97.75},
		// ...but "half" is decided in BINARY, not decimal. 0.145/0.01 is
		// 14.499999999999998 in float64, so it rounds DOWN, where exact
		// decimal arithmetic would see 14.5 and round up. This case is the one
		// that broke when the SQL mirror was written with a NUMERIC cast, and
		// it belongs in the table precisely because it looks like a bug.
		{"binary half falls below the boundary", 0.145, -0.145, 0.14, -0.14},
		// The neighbouring halves that DO land exactly on .5 in binary.
		{"exact binary half rounds away from zero", 0.135, 0.155, 0.14, 0.16},
		{"southern hemisphere", -33.8688, 151.2093, -33.87, 151.21},
		{"near the antimeridian", 0.0, -179.9962, 0.0, -180.0},
		{"origin", 0, 0, 0, 0},
		{"tiny positive collapses to zero", 0.0049, -0.0049, 0, 0},
		{"poles survive", 90, 180, 90, 180},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			gotLat, gotLng := CoarsenPoint(tt.lat, tt.lng)
			if math.Abs(gotLat-tt.wantLat) > 1e-9 {
				t.Errorf("lat: CoarsenPoint(%v) = %.17g, want %v", tt.lat, gotLat, tt.wantLat)
			}
			if math.Abs(gotLng-tt.wantLng) > 1e-9 {
				t.Errorf("lng: CoarsenPoint(%v) = %.17g, want %v", tt.lng, gotLng, tt.wantLng)
			}
		})
	}
}

// TestCoarsenPointKeepsTheBinaryResidue pins the arithmetic itself, not a
// tidied-up version of it.
//
// 0.01 is not representable in binary, so math.Round(v/0.01)*0.01 lands a few
// ULPs off the decimal value a human would write: 35*0.01 is
// 0.35000000000000003, not 0.35. That residue is NOT a defect. It is the
// shared, deterministic output of the same IEEE-754 operations the SQL mirror
// performs, and "cleaning it up" here (an earlier version re-rounded to 8
// decimals) disagreed with PostgreSQL on 4871 of 20162 measured vectors —
// which would make pii_exact_geometry_audit report every coarsened row as
// still-exact, forever.
//
// This test therefore asserts the residue SURVIVES. It fails the moment
// someone adds a normalisation step back.
func TestCoarsenPointKeepsTheBinaryResidue(t *testing.T) {
	t.Parallel()

	for _, v := range []float64{30.2672, -97.7431, 41.8781, -87.6298, 47.6062, -122.3321, 0.351, 30.265} {
		got, _ := CoarsenPoint(v, 0)
		want := math.Round(v/CoarsenGrid) * CoarsenGrid
		// Bit-for-bit, not "close to".
		if math.Float64bits(got) != math.Float64bits(want) {
			t.Errorf("CoarsenPoint(%v) = %.17g, want exactly math.Round(v/0.01)*0.01 = %.17g", v, got, want)
		}
	}
}

// TestCoarsenPointIsIdempotent is the property the audit view depends on:
// coarsening an already-coarse point must return it unchanged, or
// "is this point its own image" stops being a usable test for
// "has this row been processed".
func TestCoarsenPointIsIdempotent(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		lat, lng float64
	}{
		{"austin", 30.2672, -97.7431},
		{"negative both", -33.8688, -70.6693},
		{"boundary", 30.265, -97.745},
		{"origin", 0, 0},
		{"max", 90, 180},
		{"min", -90, -180},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			lat1, lng1 := CoarsenPoint(tt.lat, tt.lng)
			lat2, lng2 := CoarsenPoint(lat1, lng1)
			if lat1 != lat2 || lng1 != lng2 {
				t.Errorf("not idempotent: first pass (%v,%v), second pass (%v,%v)", lat1, lng1, lat2, lng2)
			}
		})
	}
}

// TestCoarsenPointDisplacementIsBounded pins the privacy/accuracy trade the
// migration headers quote: no coordinate moves by more than half a grid step
// per ordinate.
func TestCoarsenPointDisplacementIsBounded(t *testing.T) {
	t.Parallel()

	const half = CoarsenGrid/2 + 1e-9
	for i := -2000; i <= 2000; i++ {
		lat := float64(i) * 0.0007
		lng := float64(-i) * 0.0011
		gotLat, gotLng := CoarsenPoint(lat, lng)
		if math.Abs(gotLat-lat) > half {
			t.Fatalf("lat %v moved to %v, more than %v", lat, gotLat, half)
		}
		if math.Abs(gotLng-lng) > half {
			t.Fatalf("lng %v moved to %v, more than %v", lng, gotLng, half)
		}
	}
}

// TestCoarsenPointNonFinite: NaN and Inf pass through untouched rather than
// becoming 0. A zero would be a real coordinate in the Gulf of Guinea, and
// PostGIS would happily store it; leaving the value alone keeps a corrupt
// input recognisably corrupt.
func TestCoarsenPointNonFinite(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		lat, lng float64
	}{
		{"nan lat", math.NaN(), -97.7431},
		{"nan lng", 30.2672, math.NaN()},
		{"positive inf", math.Inf(1), math.Inf(1)},
		{"negative inf", math.Inf(-1), math.Inf(-1)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			gotLat, gotLng := CoarsenPoint(tt.lat, tt.lng)
			for _, c := range []struct {
				label   string
				in, out float64
			}{{"lat", tt.lat, gotLat}, {"lng", tt.lng, gotLng}} {
				switch {
				case math.IsNaN(c.in):
					if !math.IsNaN(c.out) {
						t.Errorf("%s: NaN became %v", c.label, c.out)
					}
				case math.IsInf(c.in, 0):
					if c.out != c.in {
						t.Errorf("%s: %v became %v", c.label, c.in, c.out)
					}
				default:
					if c.out != coarsenOrdinate(c.in) {
						t.Errorf("%s: %v became %v", c.label, c.in, c.out)
					}
				}
			}
		})
	}
}

// TestFormatParseRoundTrip proves the encrypted plaintext survives the trip
// through properties.location_encrypted at the precision the format promises.
func TestFormatParseRoundTrip(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		lat, lng float64
		want     string
	}{
		{"austin", 30.2672, -97.7431, "30.2672000,-97.7431000"},
		{"full precision", 30.2671999, -97.7430001, "30.2671999,-97.7430001"},
		{"origin", 0, 0, "0.0000000,0.0000000"},
		{"negative both", -33.8688, -70.6693, "-33.8688000,-70.6693000"},
		{"extremes", -90, 180, "-90.0000000,180.0000000"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := FormatExactPoint(tt.lat, tt.lng)
			if got != tt.want {
				t.Errorf("FormatExactPoint(%v,%v) = %q, want %q", tt.lat, tt.lng, got, tt.want)
			}
			lat, lng, err := ParseExactPoint(got)
			if err != nil {
				t.Fatalf("ParseExactPoint(%q): %v", got, err)
			}
			if lat != tt.lat || lng != tt.lng {
				t.Errorf("round trip gave (%v,%v), want (%v,%v)", lat, lng, tt.lat, tt.lng)
			}
		})
	}
}

// TestFormatExactPointHasConstantShape: fixed 7 decimals means the ciphertext
// length cannot leak the magnitude or the precision of the coordinate.
func TestFormatExactPointHasConstantShape(t *testing.T) {
	t.Parallel()

	for _, c := range []struct{ lat, lng float64 }{
		{30.2672, -97.7431},
		{0, 0},
		{-9.9, 8.8},
		{89.9999999, 179.9999999},
	} {
		s := FormatExactPoint(c.lat, c.lng)
		latPart, lngPart, ok := strings.Cut(s, ",")
		if !ok {
			t.Fatalf("FormatExactPoint(%v,%v) = %q has no separator", c.lat, c.lng, s)
		}
		for _, part := range []string{latPart, lngPart} {
			dot := strings.IndexByte(part, '.')
			if dot < 0 {
				t.Errorf("%q has no decimal point", part)
				continue
			}
			if got := len(part) - dot - 1; got != 7 {
				t.Errorf("%q has %d decimal places, want 7", part, got)
			}
		}
	}
}

// TestParseExactPointRejects covers the inputs a decrypt can legitimately hand
// back when something is wrong. Every one of these must be an error, because
// the caller's fallback (the coarse geometry) is correct and a silently parsed
// 0,0 is not.
func TestParseExactPointRejects(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
	}{
		{"empty", ""},
		{"no separator", "30.2672"},
		{"empty latitude", ",-97.7431"},
		{"empty longitude", "30.2672,"},
		{"not a number", "north,west"},
		{"latitude above range", "90.5,-97.7431"},
		{"latitude below range", "-90.5,-97.7431"},
		{"longitude above range", "30.2672,180.5"},
		{"longitude below range", "30.2672,-180.5"},
		{"three fields", "30.2672,-97.7431,12"},
		{"inf latitude", "Inf,-97.7431"},
		{"inf longitude", "30.2672,Inf"},
		{"negative inf longitude", "30.2672,-Inf"},
		{"a whole address", "123 Main St, Austin, TX"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			lat, lng, err := ParseExactPoint(tt.input)
			if err == nil {
				t.Fatalf("ParseExactPoint(%q) = (%v,%v), want an error", tt.input, lat, lng)
			}
			if lat != 0 || lng != 0 {
				t.Errorf("ParseExactPoint(%q) returned (%v,%v) alongside its error; callers must not see a usable coordinate", tt.input, lat, lng)
			}
		})
	}
}

// TestParseExactPointAcceptsNaN documents a KNOWN GAP rather than asserting a
// desired behaviour.
//
// strconv.ParseFloat accepts "NaN", and the range guard is written as
// `lat < -90 || lat > 90` — every comparison against NaN is false, so a NaN
// ordinate passes both bounds checks and is returned as a valid coordinate.
// Infinities are caught, because Inf DOES compare out of range.
//
// This test exists so the hole is visible and a fix cannot land silently. It
// is NOT fixed here: this file is a deliberate copy of
// services/job/internal/domain/geo.go and the two must not diverge, so the
// guard has to be added to both copies in one change. Reachability is remote —
// it needs a decrypted location_encrypted whose plaintext literally reads
// "NaN,<lng>" — but the consequence is a NaN latitude on a domain object,
// which encoding/json refuses to marshal and PostGIS would happily store.
func TestParseExactPointAcceptsNaN(t *testing.T) {
	t.Parallel()

	lat, lng, err := ParseExactPoint("NaN,-97.7431")
	if err != nil {
		t.Skip("NaN is now rejected — delete this test and its note in geo.go")
	}
	if !math.IsNaN(lat) {
		t.Fatalf("expected the documented gap to yield a NaN latitude, got %v", lat)
	}
	if lng != -97.7431 {
		t.Errorf("longitude = %v, want -97.7431", lng)
	}
}

// TestParseExactPointAcceptsSurroundingSpace: whitespace tolerance is
// deliberate, so a hand-repaired value does not fail the strict path.
func TestParseExactPointAcceptsSurroundingSpace(t *testing.T) {
	t.Parallel()

	lat, lng, err := ParseExactPoint(" 30.2672 , -97.7431 ")
	if err != nil {
		t.Fatalf("ParseExactPoint: %v", err)
	}
	if lat != 30.2672 || lng != -97.7431 {
		t.Errorf("got (%v,%v), want (30.2672,-97.7431)", lat, lng)
	}
}
