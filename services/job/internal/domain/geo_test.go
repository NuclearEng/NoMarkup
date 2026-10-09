// Unit tests for the at-rest coordinate privacy helpers (migrations 104/105).
//
// These are pure functions with no database, but they are load-bearing for two
// separate contracts:
//
//   - CoarsenPoint must agree BIT FOR BIT with pii_coarsen_ordinate() in
//     migration 104, because the audit view decides "has this row been
//     coarsened" by comparing a stored point against its own image under the
//     SQL function. The DB-side half of that agreement is proved in
//     internal/repository/jobs_pii_db_test.go; this file pins the Go side.
//
//     Expectations below are written as `n * CoarsenGrid`, never as a decimal
//     literal, because the raw IEEE-754 multiply is the contract: -9774*0.01
//     is -97.74000000000001, not -97.74, and normalising that residue away is
//     one of the two changes measured to break parity with SQL. A test written
//     against the literal would pressure the implementation back toward the
//     broken form.
//
//   - ParseExactPoint must REJECT anything that is not a point rather than
//     yield a zero coordinate, because 0,0 is a real location in the Gulf of
//     Guinea and a match radius centred there silently returns nothing.
package domain

import (
	"math"
	"testing"
)

func TestCoarsenPoint(t *testing.T) {
	t.Parallel()

	// wantLatN / wantLngN are the expected grid MULTIPLES. The assertion
	// multiplies them by CoarsenGrid in float64, which is exactly what the
	// implementation does — see the package comment above for why the
	// expectation is not spelled as a decimal literal.
	tests := []struct {
		name               string
		lat, lng           float64
		wantLatN, wantLngN float64
	}{
		{
			name: "austin downtown snaps to the grid",
			lat:  30.2672, lng: -97.7431,
			wantLatN: 3027, wantLngN: -9774,
		},
		{
			name: "a point already on the grid maps to itself",
			lat:  30.27, lng: 151.21,
			wantLatN: 3027, wantLngN: 15121,
		},
		{
			name: "zero stays zero",
			lat:  0, lng: 0,
			wantLatN: 0, wantLngN: 0,
		},
		{
			// 0.005 and 0.01 differ by exactly one binary exponent, so the
			// ratio is exactly 0.5 with no floating-point ambiguity: this is
			// the unambiguous half-away-from-zero case, and PostgreSQL's own
			// round(double precision) would send it the other way (banker's
			// rounding), which is why migration 104 spells the mirror out as
			// sign * floor(abs + 0.5) instead.
			name: "positive half-grid rounds away from zero",
			lat:  0.005, lng: 0.005,
			wantLatN: 1, wantLngN: 1,
		},
		{
			name: "negative half-grid rounds away from zero",
			lat:  -0.005, lng: -0.005,
			wantLatN: -1, wantLngN: -1,
		},
		{
			// The .005 boundary at realistic magnitudes — the case that was
			// measured to disagree when the two sides used different
			// arithmetic. 30.265/0.01 is 3026.5 in float64 (rounds up) and
			// -97.745/0.01 is -9774.5 (rounds away from zero).
			name: "half-grid boundary at service-address magnitudes",
			lat:  30.265, lng: -97.745,
			wantLatN: 3027, wantLngN: -9775,
		},
		{
			// The counterpart the exact-decimal implementation got wrong in
			// the other direction: decimal sees 0.145/0.01 as exactly 14.5 and
			// rounds up, binary float64 yields 14.499999999999998 and rounds
			// DOWN. Binary is the contract, so 0.14 is correct here.
			name: "binary division decides an apparent midpoint downward",
			lat:  0.145, lng: 0.145,
			wantLatN: 14, wantLngN: 14,
		},
		{
			name: "negative ordinates coarsen toward the nearest cell",
			lat:  -33.8688, lng: -151.2093,
			wantLatN: -3387, wantLngN: -15121,
		},
		{
			name: "southern and eastern hemispheres",
			lat:  -33.8612, lng: 151.2100,
			wantLatN: -3386, wantLngN: 15121,
		},
		{
			name: "extremes stay in range",
			lat:  90, lng: -180,
			wantLatN: 9000, wantLngN: -18000,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			wantLat := tt.wantLatN * CoarsenGrid
			wantLng := tt.wantLngN * CoarsenGrid
			gotLat, gotLng := CoarsenPoint(tt.lat, tt.lng)
			if gotLat != wantLat {
				t.Errorf("lat: CoarsenPoint(%v) = %v, want %v (= %v * %v)", tt.lat, gotLat, wantLat, tt.wantLatN, CoarsenGrid)
			}
			if gotLng != wantLng {
				t.Errorf("lng: CoarsenPoint(%v) = %v, want %v (= %v * %v)", tt.lng, gotLng, wantLng, tt.wantLngN, CoarsenGrid)
			}
		})
	}
}

// TestCoarsenPointKeepsTheMultiplyResidue is the regression guard against the
// "tidy up the floating point" refactor. 35*0.01 is 0.35000000000000003, not
// 0.35, and re-rounding it to look like the latter was measured to disagree
// with the SQL mirror on 4871 of 20162 vectors. Since
// pii_exact_geometry_audit tests ST_Equals(g, pii_coarsen_point(g)), that
// disagreement would make every row this service writes report as still-exact
// forever. The residue is the contract.
func TestCoarsenPointKeepsTheMultiplyResidue(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		value float64
		wantN float64
	}{
		{"0.35 is 35 grid cells, residue and all", 0.35, 35},
		{"-97.74 is -9774 grid cells", -97.74, -9774},
		{"-97.7431 lands on the same cell", -97.7431, -9774},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			want := tt.wantN * CoarsenGrid
			gotLat, _ := CoarsenPoint(tt.value, 0)
			if gotLat != want {
				t.Errorf("CoarsenPoint(%v) = %v, want the raw product %v", tt.value, gotLat, want)
			}
		})
	}

	// And the residue is real: if these were equal the test above would be
	// vacuous and a normalising implementation would pass it.
	if 35*CoarsenGrid == 0.35 {
		t.Skip("float64 no longer exhibits the multiply residue; the parity hazard this test guards has changed shape")
	}
}

// TestCoarsenPointIsIdempotent is the property the audit view depends on:
// "point equals its own coarsening" must mean "already processed", which is
// only true if a second application is a no-op.
func TestCoarsenPointIsIdempotent(t *testing.T) {
	t.Parallel()

	points := []struct {
		name     string
		lat, lng float64
	}{
		{"austin", 30.2672, -97.7431},
		{"already coarse", 30.27, -97.74},
		{"half grid", 0.005, -0.005},
		{"half grid at address magnitudes", 30.265, -97.745},
		{"apparent midpoint", 0.145, -0.145},
		{"far south west", -33.8688, -151.2093},
		{"origin", 0, 0},
		{"long tail precision", 41.87811234567, -87.62981234567},
		{"pole", -90, 180},
	}

	for _, p := range points {
		t.Run(p.name, func(t *testing.T) {
			t.Parallel()
			lat1, lng1 := CoarsenPoint(p.lat, p.lng)
			lat2, lng2 := CoarsenPoint(lat1, lng1)
			if lat1 != lat2 || lng1 != lng2 {
				t.Errorf("not idempotent: first pass (%v,%v), second pass (%v,%v)", lat1, lng1, lat2, lng2)
			}
		})
	}
}

// TestCoarsenPointDisplacementIsBounded pins the privacy/accuracy trade-off
// documented on CoarsenGrid: a coarsened point never moves more than half a
// cell on either axis, so the worst case against the 50 km match radius stays
// the ~0.79 km half-diagonal the design assumed.
func TestCoarsenPointDisplacementIsBounded(t *testing.T) {
	t.Parallel()

	const halfCell = CoarsenGrid / 2
	// A deliberately awkward sweep: values that are not multiples of the grid
	// and not representable in binary.
	for _, v := range []float64{0.0001, 0.3333, 1.2345, 12.987654, -0.0001, -7.7777, 89.9999, -179.9999} {
		lat, lng := CoarsenPoint(v, v)
		if math.Abs(lat-v) > halfCell+1e-9 {
			t.Errorf("lat displacement for %v is %v, want <= %v", v, math.Abs(lat-v), halfCell)
		}
		if math.Abs(lng-v) > halfCell+1e-9 {
			t.Errorf("lng displacement for %v is %v, want <= %v", v, math.Abs(lng-v), halfCell)
		}
	}
}

// TestCoarsenPointNonFinitePassthrough: NaN and ±Inf cannot be snapped to a
// grid, and turning them into 0 would fabricate a coordinate in the Gulf of
// Guinea. They pass through so the caller's own validation sees them.
func TestCoarsenPointNonFinitePassthrough(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		value float64
		isNaN bool
	}{
		{name: "NaN", value: math.NaN(), isNaN: true},
		{name: "positive infinity", value: math.Inf(1)},
		{name: "negative infinity", value: math.Inf(-1)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			lat, lng := CoarsenPoint(tt.value, tt.value)
			if tt.isNaN {
				if !math.IsNaN(lat) || !math.IsNaN(lng) {
					t.Errorf("CoarsenPoint(NaN) = (%v,%v), want NaN pair", lat, lng)
				}
				return
			}
			if lat != tt.value || lng != tt.value {
				t.Errorf("CoarsenPoint(%v) = (%v,%v), want passthrough", tt.value, lat, lng)
			}
		})
	}
}

func TestFormatParseExactPointRoundTrip(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		lat, lng float64
	}{
		{"austin", 30.2672, -97.7431},
		{"origin", 0, 0},
		{"seven decimals exactly", 30.1234567, -97.7654321},
		{"north east extreme", 90, 180},
		{"south west extreme", -90, -180},
		{"tiny negative", -0.0000001, 0.0000001},
		{"coarse point", 30.27, -97.74},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			s := FormatExactPoint(tt.lat, tt.lng)
			gotLat, gotLng, err := ParseExactPoint(s)
			if err != nil {
				t.Fatalf("ParseExactPoint(%q): %v", s, err)
			}
			// 7 decimal places is ~11 mm; anything inside half of the last
			// digit is an exact round trip for this format.
			const tol = 5e-8
			if math.Abs(gotLat-tt.lat) > tol {
				t.Errorf("lat round trip: %v -> %q -> %v", tt.lat, s, gotLat)
			}
			if math.Abs(gotLng-tt.lng) > tol {
				t.Errorf("lng round trip: %v -> %q -> %v", tt.lng, s, gotLng)
			}
		})
	}
}

// TestFormatExactPointHasFixedShape: the fixed 7-decimal form exists so the
// ciphertext length leaks nothing about the coordinate's magnitude or
// precision. A shortest-round-trip encoding would make "30.27" and
// "30.2672341" different lengths on disk.
func TestFormatExactPointHasFixedShape(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		lat, lng float64
		want     string
	}{
		{"whole numbers get padded", 30, -97, "30.0000000,-97.0000000"},
		{"short decimal gets padded", 30.27, -97.74, "30.2700000,-97.7400000"},
		{"full precision is kept", 30.1234567, -97.7654321, "30.1234567,-97.7654321"},
		{"zero", 0, 0, "0.0000000,0.0000000"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := FormatExactPoint(tt.lat, tt.lng); got != tt.want {
				t.Errorf("FormatExactPoint(%v,%v) = %q, want %q", tt.lat, tt.lng, got, tt.want)
			}
		})
	}
}

func TestParseExactPointRejects(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
	}{
		{"empty", ""},
		{"no comma", "30.2672 -97.7431"},
		{"single ordinate", "30.2672"},
		{"garbage", "not-a-point"},
		{"garbage with comma", "abc,def"},
		{"missing latitude", ",-97.7431"},
		{"missing longitude", "30.2672,"},
		{"latitude above range", "90.0001,-97.7431"},
		{"latitude below range", "-90.0001,-97.7431"},
		{"longitude above range", "30.2672,180.0001"},
		{"longitude below range", "30.2672,-180.0001"},
		{"latitude wildly out of range", "1000,0"},
		{"decrypted plaintext that is an address", "123 Main St, Austin, TX"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			lat, lng, err := ParseExactPoint(tt.input)
			if err == nil {
				t.Fatalf("ParseExactPoint(%q) = (%v,%v), nil; want an error", tt.input, lat, lng)
			}
			// A rejected value must not hand back a usable-looking coordinate.
			if lat != 0 || lng != 0 {
				t.Errorf("ParseExactPoint(%q) returned (%v,%v) alongside its error; want the zero pair", tt.input, lat, lng)
			}
		})
	}
}

// TestParseExactPointToleratesWhitespace documents the one leniency: the
// ordinates are trimmed, because a value hand-repaired by an operator during a
// key rotation should not fail on a stray space.
func TestParseExactPointToleratesWhitespace(t *testing.T) {
	t.Parallel()

	lat, lng, err := ParseExactPoint("  30.2672 , -97.7431  ")
	if err != nil {
		t.Fatalf("ParseExactPoint: %v", err)
	}
	if math.Abs(lat-30.2672) > 1e-9 || math.Abs(lng-(-97.7431)) > 1e-9 {
		t.Errorf("got (%v,%v), want (30.2672,-97.7431)", lat, lng)
	}
}
