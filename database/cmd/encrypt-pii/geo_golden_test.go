package main

// Golden-vector guard for coordinate coarsening.
//
// `geo.go` is duplicated across three Go modules because Go cannot share an
// internal package across module boundaries, and every copy must agree
// BIT-EXACTLY with the SQL function pii_coarsen_ordinate (migration 104) —
// the same coordinate is coarsened in Go on write and in SQL on backfill.
//
// Drift does not fail loudly. It snaps a point into a neighbouring grid cell,
// and the symptom is a listing quietly missing from a radius search, or the
// exact-vs-coarsened privacy invariant breaking. Nobody gets an error.
//
// Textual comparison of the copies is NOT sufficient: this file's copy is an
// unexported CLI variant embedded in a larger tool, so identical behaviour and
// identical text are different claims. These vectors assert the behaviour.
//
// The expectations are raw IEEE-754 bits on purpose. math.Round(v/0.01)*0.01
// leaves a binary residue (-97.74 becomes -97.74000000000001) that looks like
// a bug and is not; "tidying" it breaks bit-equality with Postgres, and a
// decimal expectation could not tell the difference.

import (
	"bufio"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// goldenVectorPath walks up from the test's directory until it finds the
// shared vectors, so the test does not encode a fragile relative depth.
func goldenVectorPath(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for i := 0; i < 8; i++ {
		candidate := filepath.Join(dir, "testdata", "geo_coarsen_golden.csv")
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Skip("shared geo golden vectors not found from this working directory")
	return ""
}

func TestCoarsenMatchesSharedGoldenVectors(t *testing.T) {
	t.Parallel()

	f, err := os.Open(goldenVectorPath(t))
	if err != nil {
		t.Fatalf("open golden vectors: %v", err)
	}
	defer func() { _ = f.Close() }()

	var checked int
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) != 4 {
			t.Fatalf("malformed golden line %q", line)
		}
		inLat, err1 := strconv.ParseFloat(parts[0], 64)
		inLng, err2 := strconv.ParseFloat(parts[1], 64)
		wantLat, err3 := strconv.ParseUint(parts[2], 16, 64)
		wantLng, err4 := strconv.ParseUint(parts[3], 16, 64)
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
			t.Fatalf("malformed golden line %q", line)
		}

		gotLat, gotLng := coarsenPoint(inLat, inLng)
		if math.Float64bits(gotLat) != wantLat {
			t.Errorf("coarsenPoint(%v,%v) lat bits = %016X, want %016X — this copy has drifted from the shared vectors and from Postgres",
				inLat, inLng, math.Float64bits(gotLat), wantLat)
		}
		if math.Float64bits(gotLng) != wantLng {
			t.Errorf("coarsenPoint(%v,%v) lng bits = %016X, want %016X — this copy has drifted from the shared vectors and from Postgres",
				inLat, inLng, math.Float64bits(gotLng), wantLng)
		}
		checked++
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("read golden vectors: %v", err)
	}
	if checked == 0 {
		t.Fatal("no golden vectors were checked — the file is empty or unparseable, which would make this guard vacuous")
	}
	t.Logf("verified %d shared coarsening vectors", checked)
}
