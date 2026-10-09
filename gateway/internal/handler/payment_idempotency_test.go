package handler

import "testing"

func TestPreferIdempotencyKeyHeaderWins(t *testing.T) {
	t.Parallel()
	if got := preferIdempotencyKey("  header-key  ", "body-key"); got != "header-key" {
		t.Fatalf("header should win, got %q", got)
	}
	if got := preferIdempotencyKey("", "  body-key "); got != "body-key" {
		t.Fatalf("body fallback, got %q", got)
	}
	if got := preferIdempotencyKey("   ", ""); got != "" {
		t.Fatalf("empty, got %q", got)
	}
}
