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
		Id:                    "pp-1",
		UserId:                "u-1",
		BusinessName:          "Acme Plumbing",
		EinTin:                "12-3456789",
		InsurancePolicyNumber: "POL-999",
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
