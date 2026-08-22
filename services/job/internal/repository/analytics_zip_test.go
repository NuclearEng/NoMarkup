package repository

import "testing"

func TestNormalizeUSZip(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in, want string
	}{
		{"78701", "78701"},
		{" 78701 ", "78701"},
		{"78701-1234", "78701"},
		{"", ""},
		{"30.2672,-97.7431", "30.2672,-97.7431"},
	}
	for _, tt := range tests {
		if got := normalizeUSZip(tt.in); got != tt.want {
			t.Errorf("normalizeUSZip(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestMarketRangeRadiusMeters(t *testing.T) {
	t.Parallel()
	if got := marketRangeRadiusMeters(0); got != marketRangeMaxRadiusMeters {
		t.Errorf("unset radius = %v, want default %v", got, marketRangeMaxRadiusMeters)
	}
	if got := marketRangeRadiusMeters(25); got != 25_000 {
		t.Errorf("25km = %v, want 25000", got)
	}
	if got := marketRangeRadiusMeters(500); got != marketRangeMaxRadiusMeters {
		t.Errorf("oversize radius = %v, want cap %v", got, marketRangeMaxRadiusMeters)
	}
}
