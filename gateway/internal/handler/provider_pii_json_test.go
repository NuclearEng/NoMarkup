package handler

import (
	"testing"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

// C2: owner surfaces include EIN/TIN + insurance policy number; public surfaces
// must not. Regression for the onboarding write-path that used to silently drop
// these fields client-side while the repo encrypted them on write.
func TestProtoProviderToJSON_ownerIncludesPII(t *testing.T) {
	t.Parallel()
	p := &userv1.ProviderProfile{
		Id:                     "pp-1",
		UserId:                 "u-1",
		BusinessName:           "Acme Plumbing",
		EinTin:                 "12-3456789",
		InsurancePolicyNumber:  "POL-999",
		InsuranceProvider:      "State Farm",
		InsuranceExpiry:        "2027-01-15",
		InsuranceCoverageCents: 1_000_000_00,
	}
	got := protoProviderToJSON(p, true)
	if got == nil {
		t.Fatal("expected non-nil map")
	}
	if got["ein_tin"] != "12-3456789" {
		t.Fatalf("ein_tin = %v, want 12-3456789", got["ein_tin"])
	}
	if got["insurance_policy_number"] != "POL-999" {
		t.Fatalf("insurance_policy_number = %v, want POL-999", got["insurance_policy_number"])
	}
	if got["insurance_provider"] != "State Farm" {
		t.Fatalf("insurance_provider = %v", got["insurance_provider"])
	}
	if got["insurance_expiry"] != "2027-01-15" {
		t.Fatalf("insurance_expiry = %v", got["insurance_expiry"])
	}
	if got["insurance_coverage_cents"] != int64(1_000_000_00) {
		t.Fatalf("insurance_coverage_cents = %v", got["insurance_coverage_cents"])
	}
}

func TestProtoProviderToJSON_publicStripsPII(t *testing.T) {
	t.Parallel()
	p := &userv1.ProviderProfile{
		Id:                    "pp-1",
		UserId:                "u-1",
		BusinessName:          "Acme Plumbing",
		EinTin:                "12-3456789",
		InsurancePolicyNumber: "POL-999",
	}
	got := protoProviderToJSON(p, false)
	if got == nil {
		t.Fatal("expected non-nil map")
	}
	if _, ok := got["ein_tin"]; ok {
		t.Fatalf("public JSON must not include ein_tin, got %v", got["ein_tin"])
	}
	if _, ok := got["insurance_policy_number"]; ok {
		t.Fatalf("public JSON must not include insurance_policy_number, got %v", got["insurance_policy_number"])
	}
	if _, ok := got["insurance_provider"]; ok {
		t.Fatalf("public JSON must not include insurance_provider")
	}
	if _, ok := got["insurance_expiry"]; ok {
		t.Fatalf("public JSON must not include insurance_expiry")
	}
	if _, ok := got["insurance_coverage_cents"]; ok {
		t.Fatalf("public JSON must not include insurance_coverage_cents")
	}
	if got["business_name"] != "Acme Plumbing" {
		t.Fatalf("business_name stripped unexpectedly: %v", got["business_name"])
	}
}

func TestProtoProviderToJSON_nilProfile(t *testing.T) {
	t.Parallel()
	if got := protoProviderToJSON(nil, true); got != nil {
		t.Fatalf("nil profile → nil map, got %#v", got)
	}
}
