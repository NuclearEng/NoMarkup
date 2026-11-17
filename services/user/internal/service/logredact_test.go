package service

import "testing"

func TestRedactEmail(t *testing.T) {
	cases := map[string]string{
		"":                 "",
		"jane@example.com": "j***@example.com",
		" Ünï@x.io ":       "Ü***@x.io",
		"no-at-sign":       "***",
		"@example.com":     "***",
		"a@b@evil.example": "a***@evil.example",
	}
	for in, want := range cases {
		if got := RedactEmail(in); got != want {
			t.Errorf("RedactEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRedactPhone(t *testing.T) {
	for in, want := range map[string]string{"+1 (415) 555-0123": "***0123", "12": "***", "": "***"} {
		if got := RedactPhone(in); got != want {
			t.Errorf("RedactPhone(%q) = %q, want %q", in, got, want)
		}
	}
}
