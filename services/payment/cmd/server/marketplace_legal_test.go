package main

import (
	"errors"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/service"
)

func TestResolveMarketplaceLegalGates(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		env           string
		charge        bool
		expiry        bool
		tos           string
		wantCharge    bool
		wantExpiry    bool
		wantForcedOff bool
		wantTOS       string
		wantErr       bool
	}{
		{
			name: "defaults_stay_off_without_tos",
			env:  "development",
		},
		{
			name: "production_defaults_stay_off_without_tos",
			env:  "production",
		},
		{
			name:          "charge_without_tos_nonprod_forces_off",
			env:           "development",
			charge:        true,
			wantForcedOff: true,
		},
		{
			name:          "expiry_without_tos_nonprod_forces_off",
			env:           "staging",
			expiry:        true,
			wantForcedOff: true,
		},
		{
			name:          "both_without_tos_nonprod_forces_off",
			env:           "development",
			charge:        true,
			expiry:        true,
			wantForcedOff: true,
		},
		{
			name:    "charge_without_tos_production_fatal",
			env:     "production",
			charge:  true,
			wantErr: true,
		},
		{
			name:    "expiry_without_tos_production_fatal",
			env:     "production",
			expiry:  true,
			wantErr: true,
		},
		{
			name:    "whitespace_tos_is_empty_production_fatal",
			env:     "production",
			charge:  true,
			tos:     "   \t",
			wantErr: true,
		},
		{
			name:          "whitespace_tos_is_empty_nonprod_forces_off",
			env:           "development",
			charge:        true,
			tos:           "  ",
			wantForcedOff: true,
		},
		{
			name:       "tos_set_honors_charge_only",
			env:        "production",
			charge:     true,
			tos:        "tos-2026-08-12",
			wantCharge: true,
			wantTOS:    "tos-2026-08-12",
		},
		{
			name:       "tos_set_honors_expiry_only",
			env:        "production",
			expiry:     true,
			tos:        "2026-08-12",
			wantExpiry: true,
			wantTOS:    "2026-08-12",
		},
		{
			name:       "tos_set_honors_both",
			env:        "development",
			charge:     true,
			expiry:     true,
			tos:        "tos-v3",
			wantCharge: true,
			wantExpiry: true,
			wantTOS:    "tos-v3",
		},
		{
			name:       "tos_trimmed",
			env:        "production",
			charge:     true,
			tos:        "  tos-v3  ",
			wantCharge: true,
			wantTOS:    "tos-v3",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := resolveMarketplaceLegalGates(tc.env, tc.charge, tc.expiry, tc.tos)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				if !errors.Is(err, errOffsessionTOSRequired) {
					t.Fatalf("error = %v, want %v", err, errOffsessionTOSRequired)
				}
				if got.OffSessionCharge || got.ExpireUnfunded {
					t.Fatalf("fatal path must not return armed flags: %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.OffSessionCharge != tc.wantCharge {
				t.Fatalf("OffSessionCharge = %v, want %v", got.OffSessionCharge, tc.wantCharge)
			}
			if got.ExpireUnfunded != tc.wantExpiry {
				t.Fatalf("ExpireUnfunded = %v, want %v", got.ExpireUnfunded, tc.wantExpiry)
			}
			if got.ForcedOff != tc.wantForcedOff {
				t.Fatalf("ForcedOff = %v, want %v", got.ForcedOff, tc.wantForcedOff)
			}
			if got.TOSVersion != tc.wantTOS {
				t.Fatalf("TOSVersion = %q, want %q", got.TOSVersion, tc.wantTOS)
			}
		})
	}
}

// TestChargeWithoutTOSDoesNotLeaveOffSessionChargeTrue is the enablement
// contract: operator set MARKETPLACE_OFFSESSION_CHARGE=true with an empty
// ToS version must not leave MarketplaceService.offSessionCharge true.
// The constructor defaults the field ON for collect-path unit tests, so this
// also proves process startup overwrites that default.
func TestChargeWithoutTOSDoesNotLeaveOffSessionChargeTrue(t *testing.T) {
	t.Parallel()

	svc := service.NewMarketplaceService(nil, nil)
	if !svc.OffSessionChargeEnabled() {
		t.Fatal("precondition: constructor still defaults offSessionCharge on for unit tests")
	}

	gates, err := resolveMarketplaceLegalGates("development", true, true, "")
	if err != nil {
		t.Fatalf("non-production must not fatal: %v", err)
	}
	svc.SetOffSessionCharge(gates.OffSessionCharge)
	svc.SetExpireUnfunded(gates.ExpireUnfunded)

	if svc.OffSessionChargeEnabled() {
		t.Fatal("enabling charge without TOS must not leave offSessionCharge true")
	}
	if svc.ExpireUnfundedEnabled() {
		t.Fatal("enabling expiry without TOS must not leave expireUnfunded true")
	}
	if !gates.ForcedOff {
		t.Fatal("expected ForcedOff when flags were requested without TOS")
	}
}
