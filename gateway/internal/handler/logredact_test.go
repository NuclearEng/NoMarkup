package handler

import "testing"

func TestRedactEmail(t *testing.T) {
	cases := map[string]string{
		"":                 "",
		"jane@example.com": "j***@example.com",
		"no-at-sign":       "***",
		"@example.com":     "***",
	}
	for in, want := range cases {
		if got := redactEmail(in); got != want {
			t.Errorf("redactEmail(%q) = %q, want %q", in, got, want)
		}
	}
}
