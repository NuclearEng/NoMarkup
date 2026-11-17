package main

import (
	"errors"
	"strconv"
	"testing"
)

func f64(v float64) *float64 { return &v }
func str(s string) *string   { return &s }

func TestReconcileOrdinatePair(t *testing.T) {
	t.Parallel()
	primary := mustKey(t)
	previous := mustKey(t)
	stranger := mustKey(t)
	kr := keyring{primary: primary, previous: previous}
	const point = "30.2672000,-97.7431000"

	currentCT := mustEncrypt(t, primary, point)
	previousCT := mustEncrypt(t, previous, point)
	strangerCT := mustEncrypt(t, stranger, point)
	stalePoint := mustEncrypt(t, primary, "1.0000000,2.0000000")

	tests := []struct {
		name       string
		in         ordinatePair
		wantAction ordinateAction
		wantPoint  string // what the returned sibling must decrypt to; "" = unchanged
		wantSame   bool   // returned sibling must be the input pointer's value
		wantErr    error
		wantAnyErr bool
	}{
		{name: "empty pair is a no-op", in: ordinatePair{}, wantAction: ordinateNothing, wantSame: true},
		{name: "plaintext pair is sealed", in: ordinatePair{lat: f64(30.2672), lng: f64(-97.7431)}, wantAction: ordinateEncrypt, wantPoint: point},
		{
			name:       "plaintext beside a stale current sibling wins (old pod wrote it last)",
			in:         ordinatePair{enc: str(stalePoint), lat: f64(30.2672), lng: f64(-97.7431)},
			wantAction: ordinateEncrypt, wantPoint: point,
		},
		{name: "drained current sibling is left alone", in: ordinatePair{enc: str(currentCT)}, wantAction: ordinateNothing, wantSame: true},
		{name: "previous-key sibling is re-keyed", in: ordinatePair{enc: str(previousCT)}, wantAction: ordinateRekey, wantPoint: point},
		{name: "unknown-key sibling refuses", in: ordinatePair{enc: str(strangerCT)}, wantErr: errUnknownKey},
		{
			name:    "unknown-key sibling refuses even beside plaintext",
			in:      ordinatePair{enc: str(strangerCT), lat: f64(1), lng: f64(2)},
			wantErr: errUnknownKey,
		},
		{name: "half a pair refuses", in: ordinatePair{lat: f64(30.2672)}, wantAnyErr: true},
		{name: "unsealed point literal in sibling is sealed", in: ordinatePair{enc: str(point)}, wantAction: ordinateEncrypt, wantPoint: point},
		{name: "non-point junk in sibling refuses", in: ordinatePair{enc: str("hello")}, wantAnyErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, action, err := reconcileOrdinatePair(kr, "contract_work_sessions.x id=1", tc.in)
			if tc.wantErr != nil || tc.wantAnyErr {
				if err == nil {
					t.Fatalf("want error, got action %v", action)
				}
				if tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
					t.Fatalf("error = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if action != tc.wantAction {
				t.Fatalf("action = %v, want %v", action, tc.wantAction)
			}
			if tc.wantSame {
				if (got == nil) != (tc.in.enc == nil) || (got != nil && *got != *tc.in.enc) {
					t.Fatalf("sibling rewritten; want unchanged")
				}
				return
			}
			if got == nil {
				t.Fatal("sibling is NULL; want ciphertext")
			}
			plain, ok := open(primary, *got)
			if !ok || plain != tc.wantPoint {
				t.Fatalf("sibling opens under PRIMARY as (%q, %v), want %q", plain, ok, tc.wantPoint)
			}
		})
	}
}

// The UPDATE must bind the id, one new sibling per pair, and the full scanned
// (enc, lat, lng) guard per pair — a missing guard would let the drain clobber
// a check-in the live gateway wrote between scan and update.
func TestOrdinateSpecUpdateBindsEveryGuard(t *testing.T) {
	t.Parallel()
	for _, spec := range ordinateSpecs {
		want := 1 + 4*len(spec.pairs) // id, new enc per pair, (enc,lat,lng) guard per pair
		for i := 1; i <= want; i++ {
			if !containsPlaceholder(spec.updateSQL, i) {
				t.Errorf("%s: updateSQL does not bind $%d", spec.name, i)
			}
		}
		if containsPlaceholder(spec.updateSQL, want+1) {
			t.Errorf("%s: updateSQL binds more than %d parameters", spec.name, want)
		}
	}
}

func containsPlaceholder(sql string, n int) bool {
	ph := "$" + strconv.Itoa(n)
	for i := 0; i+len(ph) <= len(sql); i++ {
		if sql[i:i+len(ph)] != ph {
			continue
		}
		next := i + len(ph)
		if next == len(sql) || sql[next] < '0' || sql[next] > '9' {
			return true
		}
	}
	return false
}
