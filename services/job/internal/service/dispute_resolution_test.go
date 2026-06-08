package service

import (
	"errors"
	"testing"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// TestNormalizeResolutionType verifies the admin-UI outcome vocabulary is
// translated to the canonical DB vocabulary accepted by the
// disputes_resolution_type_check constraint, the canonical values pass through,
// and anything else is rejected as a clean domain error (mapped to 400) rather
// than reaching the DB and triggering SQLSTATE 23514 (a 500).
func TestNormalizeResolutionType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		// Admin-UI outcome vocabulary -> DB money-movement vocabulary.
		{"favor_customer maps to full_refund", "favor_customer", "full_refund", false},
		{"favor_provider maps to release_payment", "favor_provider", "release_payment", false},
		{"split maps to partial_refund", "split", "partial_refund", false},
		// Canonical DB values pass through unchanged.
		{"release_payment passthrough", "release_payment", "release_payment", false},
		{"partial_refund passthrough", "partial_refund", "partial_refund", false},
		{"full_refund passthrough", "full_refund", "full_refund", false},
		{"contract_terminated passthrough", "contract_terminated", "contract_terminated", false},
		{"dismissed passthrough", "dismissed", "dismissed", false},
		{"guarantee_invoked passthrough", "guarantee_invoked", "guarantee_invoked", false},
		// Invalid -> error (no DB write).
		{"unknown rejected", "totally_bogus", "", true},
		{"empty rejected", "", "", true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := normalizeResolutionType(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("normalizeResolutionType(%q) expected error, got nil", tt.input)
				}
				if !errors.Is(err, domain.ErrInvalidResolutionType) {
					t.Fatalf("normalizeResolutionType(%q) error = %v, want ErrInvalidResolutionType", tt.input, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeResolutionType(%q) unexpected error: %v", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("normalizeResolutionType(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// TestNormalizeGuaranteeOutcome verifies the guarantee outcome is validated
// against disputes_guarantee_outcome_check; empty is allowed (stored NULL).
func TestNormalizeGuaranteeOutcome(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{"empty allowed", "", "", false},
		{"replacement_provider", "replacement_provider", "replacement_provider", false},
		{"refund", "refund", "refund", false},
		{"denied", "denied", "denied", false},
		{"invalid rejected", "bogus", "", true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := normalizeGuaranteeOutcome(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("normalizeGuaranteeOutcome(%q) expected error, got nil", tt.input)
				}
				if !errors.Is(err, domain.ErrInvalidGuaranteeOutcome) {
					t.Fatalf("normalizeGuaranteeOutcome(%q) error = %v, want ErrInvalidGuaranteeOutcome", tt.input, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeGuaranteeOutcome(%q) unexpected error: %v", tt.input, err)
			}
			if got != tt.want {
				t.Fatalf("normalizeGuaranteeOutcome(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
