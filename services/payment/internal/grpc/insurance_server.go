package grpc

import (
	"context"
	"errors"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Insurance RPCs. Methods live on *Server so the proto's single
// PaymentService surface stays intact; the insurance domain service is
// injected via Server.SetInsuranceService.

func (s *Server) ListInsuranceProducts(ctx context.Context, _ *paymentv1.ListInsuranceProductsRequest) (*paymentv1.ListInsuranceProductsResponse, error) {
	if s.insuranceSvc == nil {
		return nil, status.Error(codes.Unimplemented, "insurance service not configured")
	}
	products, err := s.insuranceSvc.ListProducts(ctx)
	if err != nil {
		return nil, mapInsuranceError(err)
	}

	protoProducts := make([]*paymentv1.InsuranceProduct, 0, len(products))
	for _, p := range products {
		protoProducts = append(protoProducts, domainProductToProto(p))
	}

	return &paymentv1.ListInsuranceProductsResponse{Products: protoProducts}, nil
}

func (s *Server) GetInsuranceQuote(ctx context.Context, req *paymentv1.GetInsuranceQuoteRequest) (*paymentv1.GetInsuranceQuoteResponse, error) {
	if s.insuranceSvc == nil {
		return nil, status.Error(codes.Unimplemented, "insurance service not configured")
	}
	if req.GetProductId() == "" {
		return nil, status.Error(codes.InvalidArgument, "product_id is required")
	}
	if req.GetContractId() == "" {
		return nil, status.Error(codes.InvalidArgument, "contract_id is required")
	}

	// SECURITY: the premium is derived from the server-side contract amount, not
	// from any client-supplied value.
	quote, err := s.insuranceSvc.GetQuoteForContract(ctx, req.GetProductId(), req.GetContractId())
	if err != nil {
		return nil, mapInsuranceError(err)
	}

	return &paymentv1.GetInsuranceQuoteResponse{
		Quote: domainQuoteToProto(quote),
	}, nil
}

func (s *Server) PurchaseInsurance(ctx context.Context, req *paymentv1.PurchaseInsuranceRequest) (*paymentv1.PurchaseInsuranceResponse, error) {
	if s.insuranceSvc == nil {
		return nil, status.Error(codes.Unimplemented, "insurance service not configured")
	}
	if req.GetProductId() == "" {
		return nil, status.Error(codes.InvalidArgument, "product_id is required")
	}
	if req.GetContractId() == "" {
		return nil, status.Error(codes.InvalidArgument, "contract_id is required")
	}
	if req.GetCustomerId() == "" {
		return nil, status.Error(codes.InvalidArgument, "customer_id is required")
	}
	// NOTE: provider_id and contract_amount_cents from the request are IGNORED.
	// They are derived server-side from the contract (payment-integrity guard);
	// trusting the client here is the original IDOR/amount-tampering hole.

	input := domain.PurchaseInsuranceInput{
		ContractID: req.GetContractId(),
		ProductID:  req.GetProductId(),
		CustomerID: req.GetCustomerId(),
	}

	policy, clientSecret, err := s.insuranceSvc.PurchaseInsurance(ctx, input)
	if err != nil {
		return nil, mapInsuranceError(err)
	}

	return &paymentv1.PurchaseInsuranceResponse{
		Policy:       domainPolicyToProto(policy),
		ClientSecret: clientSecret,
	}, nil
}

func (s *Server) GetInsurancePolicy(ctx context.Context, req *paymentv1.GetInsurancePolicyRequest) (*paymentv1.GetInsurancePolicyResponse, error) {
	if s.insuranceSvc == nil {
		return nil, status.Error(codes.Unimplemented, "insurance service not configured")
	}
	if req.GetPolicyId() == "" {
		return nil, status.Error(codes.InvalidArgument, "policy_id is required")
	}

	policy, err := s.insuranceSvc.GetPolicy(ctx, req.GetPolicyId())
	if err != nil {
		return nil, mapInsuranceError(err)
	}

	return &paymentv1.GetInsurancePolicyResponse{
		Policy: domainPolicyToProto(policy),
	}, nil
}

func (s *Server) ListInsurancePolicies(ctx context.Context, req *paymentv1.ListInsurancePoliciesRequest) (*paymentv1.ListInsurancePoliciesResponse, error) {
	if s.insuranceSvc == nil {
		return nil, status.Error(codes.Unimplemented, "insurance service not configured")
	}
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	page := int32(1)
	pageSize := int32(20)
	if pg := req.GetPagination(); pg != nil {
		if pg.GetPage() > 0 {
			page = pg.GetPage()
		}
		if pg.GetPageSize() > 0 {
			pageSize = pg.GetPageSize()
		}
	}

	policies, totalCount, err := s.insuranceSvc.ListPolicies(ctx, req.GetUserId(), int(page), int(pageSize))
	if err != nil {
		return nil, mapInsuranceError(err)
	}

	protoPolicies := make([]*paymentv1.InsurancePolicy, 0, len(policies))
	for _, p := range policies {
		protoPolicies = append(protoPolicies, domainPolicyToProto(p))
	}

	totalPages := int32(0)
	if totalCount > 0 {
		totalPages = (int32(totalCount) + pageSize - 1) / pageSize
	}

	return &paymentv1.ListInsurancePoliciesResponse{
		Policies: protoPolicies,
		Pagination: &commonv1.PaginationResponse{
			TotalCount: int32(totalCount),
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
			HasNext:    page < totalPages,
		},
	}, nil
}

func (s *Server) FileInsuranceClaim(ctx context.Context, req *paymentv1.FileInsuranceClaimRequest) (*paymentv1.FileInsuranceClaimResponse, error) {
	if s.insuranceSvc == nil {
		return nil, status.Error(codes.Unimplemented, "insurance service not configured")
	}
	if req.GetPolicyId() == "" {
		return nil, status.Error(codes.InvalidArgument, "policy_id is required")
	}
	if req.GetClaimantId() == "" {
		return nil, status.Error(codes.InvalidArgument, "claimant_id is required")
	}
	if req.GetClaimType() == "" {
		return nil, status.Error(codes.InvalidArgument, "claim_type is required")
	}
	if req.GetClaimedAmountCents() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "claimed_amount_cents must be positive")
	}

	input := domain.FileInsuranceClaimInput{
		PolicyID:           req.GetPolicyId(),
		ClaimantID:         req.GetClaimantId(),
		ClaimType:          req.GetClaimType(),
		Description:        req.GetDescription(),
		EvidenceURLs:       req.GetEvidenceUrls(),
		ClaimedAmountCents: req.GetClaimedAmountCents(),
	}

	claim, err := s.insuranceSvc.FileInsuranceClaim(ctx, input)
	if err != nil {
		return nil, mapInsuranceError(err)
	}

	return &paymentv1.FileInsuranceClaimResponse{
		Claim: domainClaimToProto(claim),
	}, nil
}

func (s *Server) GetInsuranceClaim(ctx context.Context, req *paymentv1.GetInsuranceClaimRequest) (*paymentv1.GetInsuranceClaimResponse, error) {
	if s.insuranceSvc == nil {
		return nil, status.Error(codes.Unimplemented, "insurance service not configured")
	}
	if req.GetClaimId() == "" {
		return nil, status.Error(codes.InvalidArgument, "claim_id is required")
	}

	claim, err := s.insuranceSvc.GetClaim(ctx, req.GetClaimId())
	if err != nil {
		return nil, mapInsuranceError(err)
	}

	return &paymentv1.GetInsuranceClaimResponse{
		Claim: domainClaimToProto(claim),
	}, nil
}

func (s *Server) ReviewInsuranceClaim(ctx context.Context, req *paymentv1.ReviewInsuranceClaimRequest) (*paymentv1.ReviewInsuranceClaimResponse, error) {
	if s.insuranceSvc == nil {
		return nil, status.Error(codes.Unimplemented, "insurance service not configured")
	}
	if req.GetClaimId() == "" {
		return nil, status.Error(codes.InvalidArgument, "claim_id is required")
	}
	if req.GetReviewerId() == "" {
		return nil, status.Error(codes.InvalidArgument, "reviewer_id is required")
	}

	input := domain.ReviewInsuranceClaimInput{
		ClaimID:             req.GetClaimId(),
		ReviewerID:          req.GetReviewerId(),
		Approved:            req.GetApproved(),
		ApprovedAmountCents: req.GetApprovedAmountCents(),
		AssessorNotes:       req.GetAssessorNotes(),
		DenialReason:        req.GetDenialReason(),
	}

	claim, err := s.insuranceSvc.ReviewInsuranceClaim(ctx, input)
	if err != nil {
		return nil, mapInsuranceError(err)
	}

	return &paymentv1.ReviewInsuranceClaimResponse{
		Claim: domainClaimToProto(claim),
	}, nil
}

func (s *Server) AdminListInsuranceClaims(ctx context.Context, req *paymentv1.AdminListInsuranceClaimsRequest) (*paymentv1.AdminListInsuranceClaimsResponse, error) {
	if s.insuranceSvc == nil {
		return nil, status.Error(codes.Unimplemented, "insurance service not configured")
	}
	statusFilter := req.GetStatusFilter()

	page := int32(1)
	pageSize := int32(20)
	if pg := req.GetPagination(); pg != nil {
		if pg.GetPage() > 0 {
			page = pg.GetPage()
		}
		if pg.GetPageSize() > 0 {
			pageSize = pg.GetPageSize()
		}
	}

	claims, totalCount, err := s.insuranceSvc.AdminListClaims(ctx, statusFilter, int(page), int(pageSize))
	if err != nil {
		return nil, mapInsuranceError(err)
	}

	protoClaims := make([]*paymentv1.InsuranceClaim, 0, len(claims))
	for _, c := range claims {
		protoClaims = append(protoClaims, domainClaimToProto(c))
	}

	totalPages := int32(0)
	if totalCount > 0 {
		totalPages = (int32(totalCount) + pageSize - 1) / pageSize
	}

	return &paymentv1.AdminListInsuranceClaimsResponse{
		Claims: protoClaims,
		Pagination: &commonv1.PaginationResponse{
			TotalCount: int32(totalCount),
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
			HasNext:    page < totalPages,
		},
	}, nil
}

// --- Conversion helpers ---

func domainProductToProto(p *domain.InsuranceProduct) *paymentv1.InsuranceProduct {
	pb := &paymentv1.InsuranceProduct{
		Id:                   p.ID,
		Name:                 p.Name,
		Slug:                 p.Slug,
		Description:          p.Description,
		CoverageType:         p.CoverageType,
		BaseRateBps:          int32(p.BaseRateBPS),
		MinPremiumCents:      p.MinPremiumCents,
		CoverageDurationDays: int32(p.CoverageDurationDays),
		DeductibleCents:      p.DeductibleCents,
		TermsMarkdown:        p.TermsMarkdown,
		Active:               p.Active,
		CreatedAt:            timestamppb.New(p.CreatedAt),
		UpdatedAt:            timestamppb.New(p.UpdatedAt),
	}
	if p.MaxCoverageCents != nil {
		pb.MaxCoverageCents = *p.MaxCoverageCents
	}
	return pb
}

func domainPolicyToProto(p *domain.InsurancePolicy) *paymentv1.InsurancePolicy {
	pb := &paymentv1.InsurancePolicy{
		Id:                    p.ID,
		PolicyNumber:          p.PolicyNumber,
		ProductId:             p.ProductID,
		ContractId:            p.ContractID,
		CustomerId:            p.CustomerID,
		ProviderId:            p.ProviderID,
		CoverageAmountCents:   p.CoverageAmountCents,
		PremiumCents:          p.PremiumCents,
		DeductibleCents:       p.DeductibleCents,
		StripePaymentIntentId: p.StripePaymentIntentID,
		EffectiveDate:         p.EffectiveDate.Format("2006-01-02"),
		ExpirationDate:        p.ExpirationDate.Format("2006-01-02"),
		Status:                p.Status,
		CancellationReason:    p.CancellationReason,
		CreatedAt:             timestamppb.New(p.CreatedAt),
		UpdatedAt:             timestamppb.New(p.UpdatedAt),
	}
	if p.PaidAt != nil {
		pb.PaidAt = timestamppb.New(*p.PaidAt)
	}
	if p.CancelledAt != nil {
		pb.CancelledAt = timestamppb.New(*p.CancelledAt)
	}
	return pb
}

func domainClaimToProto(c *domain.InsuranceClaim) *paymentv1.InsuranceClaim {
	pb := &paymentv1.InsuranceClaim{
		Id:                 c.ID,
		ClaimNumber:        c.ClaimNumber,
		PolicyId:           c.PolicyID,
		ClaimantId:         c.ClaimantID,
		ClaimType:          c.ClaimType,
		Description:        c.Description,
		EvidenceUrls:       c.EvidenceURLs,
		ClaimedAmountCents: c.ClaimedAmountCents,
		AssessorNotes:      c.AssessorNotes,
		StripeTransferId:   c.StripeTransferID,
		Status:             c.Status,
		DenialReason:       c.DenialReason,
		CreatedAt:          timestamppb.New(c.CreatedAt),
		UpdatedAt:          timestamppb.New(c.UpdatedAt),
	}
	if c.AssessedAmountCents != nil {
		pb.AssessedAmountCents = *c.AssessedAmountCents
	}
	if c.ApprovedAmountCents != nil {
		pb.ApprovedAmountCents = *c.ApprovedAmountCents
	}
	if c.PayoutCents != nil {
		pb.PayoutCents = *c.PayoutCents
	}
	if c.ReviewedBy != nil {
		pb.ReviewedBy = *c.ReviewedBy
	}
	if c.ReviewedAt != nil {
		pb.ReviewedAt = timestamppb.New(*c.ReviewedAt)
	}
	if c.PaidAt != nil {
		pb.PaidAt = timestamppb.New(*c.PaidAt)
	}
	return pb
}

func domainQuoteToProto(q *domain.InsuranceQuote) *paymentv1.InsuranceQuote {
	return &paymentv1.InsuranceQuote{
		ProductId:            q.ProductID,
		ProductName:          q.ProductName,
		CoverageType:         q.CoverageType,
		PremiumCents:         q.PremiumCents,
		CoverageAmountCents:  q.CoverageAmountCents,
		DeductibleCents:      q.DeductibleCents,
		CoverageDurationDays: int32(q.CoverageDurationDays),
		EffectiveDate:        q.EffectiveDate.Format("2006-01-02"),
		ExpirationDate:       q.ExpirationDate.Format("2006-01-02"),
	}
}

// mapInsuranceError maps insurance domain errors to gRPC status errors.
func mapInsuranceError(err error) error {
	switch {
	case errors.Is(err, domain.ErrInsuranceProductNotFound):
		return status.Error(codes.NotFound, "insurance product not found")
	case errors.Is(err, domain.ErrInsurancePolicyNotFound):
		return status.Error(codes.NotFound, "insurance policy not found")
	case errors.Is(err, domain.ErrInsuranceClaimNotFound):
		return status.Error(codes.NotFound, "insurance claim not found")
	case errors.Is(err, domain.ErrPolicyNotActive):
		return status.Error(codes.FailedPrecondition, "insurance policy is not active")
	case errors.Is(err, domain.ErrPolicyExpired):
		return status.Error(codes.FailedPrecondition, "insurance policy has expired")
	case errors.Is(err, domain.ErrClaimExceedsCoverage):
		return status.Error(codes.InvalidArgument, "claim amount exceeds coverage")
	case errors.Is(err, domain.ErrClaimNotReviewable):
		return status.Error(codes.FailedPrecondition, "claim is not in reviewable state")
	case errors.Is(err, domain.ErrClaimantNotPolicyholder):
		return status.Error(codes.PermissionDenied, "only the policyholder may file a claim against this policy")
	case errors.Is(err, domain.ErrInsuranceContractNotFound):
		return status.Error(codes.NotFound, "contract not found")
	case errors.Is(err, domain.ErrContractNotOwned):
		return status.Error(codes.PermissionDenied, "contract is not owned by this customer")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
