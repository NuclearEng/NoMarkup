package service

import "testing"

func TestEmailDomain(t *testing.T) {
	for in, want := range map[string]string{"a@b.io": "b.io", "x": "", "": ""} {
		if got := emailDomain(in); got != want {
			t.Errorf("emailDomain(%q) = %q, want %q", in, got, want)
		}
	}
}
