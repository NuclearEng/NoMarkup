package handler

import "testing"

func TestDefaultWSOriginPatternsUseOwnedZone(t *testing.T) {
	t.Parallel()
	got := defaultWSOriginPatterns()
	want := []string{"no-markup.com", "www.no-markup.com", "app.no-markup.com"}
	if len(got) != len(want) {
		t.Fatalf("defaults = %#v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("defaults = %#v, want %#v", got, want)
		}
	}
	for _, host := range got {
		if host == "nomarkup.com" || host == "app.nomarkup.com" {
			t.Fatalf("unowned host %q in defaults", host)
		}
	}
}
