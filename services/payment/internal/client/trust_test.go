package client

import "testing"

func TestNormalizeTrustScore(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   float64
		want float64
	}{
		{"already_unit_scale", 0.78, 0.78},
		{"zero", 0, 0},
		{"one", 1.0, 1.0},
		{"legacy_0_100_scale", 75.74, 0.7574},
		{"legacy_high", 100, 1.0},
		{"negative_clamps_to_zero", -0.5, 0},
		{"absurd_over_100_clamps_to_one", 250, 1.0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := normalizeTrustScore(tt.in)
			if diff := got - tt.want; diff > 1e-9 || diff < -1e-9 {
				t.Errorf("normalizeTrustScore(%v) = %v, want %v", tt.in, got, tt.want)
			}
			if got < 0 || got > 1 {
				t.Errorf("normalizeTrustScore(%v) = %v, out of [0,1]", tt.in, got)
			}
		})
	}
}
