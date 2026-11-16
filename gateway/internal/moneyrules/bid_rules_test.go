package moneyrules

import "testing"

func TestValidateLowerOnly(t *testing.T) {
	t.Parallel()
	if got := ValidateLowerOnly(10_000, 9_000); got != "" {
		t.Fatalf("expected ok, got %q", got)
	}
	if got := ValidateLowerOnly(10_000, 10_000); got == "" {
		t.Fatal("expected error for equal bid")
	}
	if got := ValidateLowerOnly(10_000, 11_000); got == "" {
		t.Fatal("expected error for raise")
	}
	if got := ValidateLowerOnly(10_000, 0); got == "" {
		t.Fatal("expected error for zero")
	}
}

func TestValidateOfferAccepted(t *testing.T) {
	t.Parallel()
	if got := ValidateOfferAccepted(50_000, 40_000); got != "" {
		t.Fatalf("expected ok, got %q", got)
	}
	if got := ValidateOfferAccepted(50_000, 50_001); got == "" {
		t.Fatal("expected error when offer above starting")
	}
}
