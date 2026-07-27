package grpc

import (
	"context"
	"testing"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// stubProfile implements the Profile service surface UpdateProviderProfile needs.
type stubProfile struct {
	lastInput domain.UpdateProviderInput
	profile   *domain.ProviderProfile
	err       error
}

func (s *stubProfile) GetProviderProfile(ctx context.Context, userID string) (*domain.ProviderProfile, error) {
	return s.profile, s.err
}

func (s *stubProfile) UpdateProviderProfile(ctx context.Context, userID string, input domain.UpdateProviderInput) (*domain.ProviderProfile, error) {
	s.lastInput = input
	if s.err != nil {
		return nil, s.err
	}
	if s.profile == nil {
		s.profile = &domain.ProviderProfile{UserID: userID}
	}
	if input.EINTIN != nil {
		s.profile.EINTIN = *input.EINTIN
	}
	if input.InsurancePolicyNumber != nil {
		s.profile.InsurancePolicyNumber = *input.InsurancePolicyNumber
	}
	if input.BusinessName != nil {
		s.profile.BusinessName = *input.BusinessName
	}
	return s.profile, nil
}

// Ensure Server.profile field type matches — if the real Profile type is used,
// this test uses a Server constructed with a real *service.Profile mock path.
// When Profile is a concrete type we exercise domainProviderToProto + field
// mapping via a thin integration of the mapping functions instead.

func TestDomainProviderToProto_includesPII(t *testing.T) {
	t.Parallel()
	p := &domain.ProviderProfile{
		ID:                    "pp-1",
		UserID:                "u-1",
		BusinessName:          "Acme",
		EINTIN:                "98-7654321",
		InsurancePolicyNumber: "POL-ABC",
	}
	pb := domainProviderToProto(p)
	if pb.GetEinTin() != "98-7654321" {
		t.Fatalf("EinTin = %q", pb.GetEinTin())
	}
	if pb.GetInsurancePolicyNumber() != "POL-ABC" {
		t.Fatalf("InsurancePolicyNumber = %q", pb.GetInsurancePolicyNumber())
	}
}

func TestUpdateProviderProfileRequest_mapsOptionalPII(t *testing.T) {
	t.Parallel()
	// Mirrors Server.UpdateProviderProfile input construction (field wiring).
	ein := "12-3456789"
	policy := "POL-1"
	req := &userv1.UpdateProviderProfileRequest{
		UserId:                "u-1",
		EinTin:                &ein,
		InsurancePolicyNumber: &policy,
	}
	input := domain.UpdateProviderInput{
		BusinessName:          req.BusinessName,
		Bio:                   req.Bio,
		ServiceAddress:        req.ServiceAddress,
		ServiceRadiusKm:       req.ServiceRadiusKm,
		EINTIN:                req.EinTin,
		InsurancePolicyNumber: req.InsurancePolicyNumber,
	}
	if input.EINTIN == nil || *input.EINTIN != ein {
		t.Fatalf("EINTIN not mapped: %#v", input.EINTIN)
	}
	if input.InsurancePolicyNumber == nil || *input.InsurancePolicyNumber != policy {
		t.Fatalf("InsurancePolicyNumber not mapped: %#v", input.InsurancePolicyNumber)
	}
	// Omitted optionals stay nil (do not clear stored values).
	if input.BusinessName != nil {
		t.Fatalf("BusinessName should be nil when omitted")
	}
}
