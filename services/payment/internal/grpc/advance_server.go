package grpc

import (
	"context"
	"errors"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Server) RequestAdvance(ctx context.Context, req *paymentv1.RequestAdvanceRequest) (*paymentv1.RequestAdvanceResponse, error) {
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}
	if req.GetContractId() == "" {
		return nil, status.Error(codes.InvalidArgument, "contract_id is required")
	}
	if req.GetAmountCents() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "amount_cents must be positive")
	}

	advance, err := s.svc.RequestAdvance(ctx, req.GetProviderId(), req.GetContractId(), req.GetAmountCents())
	if err != nil {
		return nil, mapAdvanceError(err)
	}

	return &paymentv1.RequestAdvanceResponse{
		Advance: domainAdvanceToProto(advance),
	}, nil
}

func (s *Server) ListAdvances(ctx context.Context, req *paymentv1.ListAdvancesRequest) (*paymentv1.ListAdvancesResponse, error) {
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

	statusFilter := ""
	if req.StatusFilter != nil {
		statusFilter = *req.StatusFilter
	}

	advances, totalCount, err := s.svc.ListAdvances(ctx, req.GetProviderId(), statusFilter, int(page), int(pageSize))
	if err != nil {
		return nil, mapAdvanceError(err)
	}

	protoAdvances := make([]*paymentv1.Advance, 0, len(advances))
	for _, a := range advances {
		protoAdvances = append(protoAdvances, domainAdvanceToProto(a))
	}

	totalPages := int32(0)
	if totalCount > 0 {
		totalPages = (int32(totalCount) + pageSize - 1) / pageSize
	}

	return &paymentv1.ListAdvancesResponse{
		Advances: protoAdvances,
		Pagination: &commonv1.PaginationResponse{
			TotalCount: int32(totalCount),
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
			HasNext:    page < totalPages,
		},
	}, nil
}

func (s *Server) GetAdvance(ctx context.Context, req *paymentv1.GetAdvanceRequest) (*paymentv1.GetAdvanceResponse, error) {
	if req.GetAdvanceId() == "" {
		return nil, status.Error(codes.InvalidArgument, "advance_id is required")
	}

	advance, err := s.svc.GetAdvance(ctx, req.GetAdvanceId())
	if err != nil {
		return nil, mapAdvanceError(err)
	}

	return &paymentv1.GetAdvanceResponse{
		Advance: domainAdvanceToProto(advance),
	}, nil
}

func (s *Server) ReviewAdvance(ctx context.Context, req *paymentv1.ReviewAdvanceRequest) (*paymentv1.ReviewAdvanceResponse, error) {
	if req.GetAdvanceId() == "" {
		return nil, status.Error(codes.InvalidArgument, "advance_id is required")
	}
	if req.GetReviewerId() == "" {
		return nil, status.Error(codes.InvalidArgument, "reviewer_id is required")
	}
	if req.GetAction() != "approve" && req.GetAction() != "reject" {
		return nil, status.Error(codes.InvalidArgument, "action must be 'approve' or 'reject'")
	}

	advance, err := s.svc.ReviewAdvance(ctx, req.GetAdvanceId(), req.GetReviewerId(), req.GetAction(), req.GetReason())
	if err != nil {
		return nil, mapAdvanceError(err)
	}

	return &paymentv1.ReviewAdvanceResponse{
		Advance: domainAdvanceToProto(advance),
	}, nil
}

func (s *Server) DisburseAdvance(ctx context.Context, req *paymentv1.DisburseAdvanceRequest) (*paymentv1.DisburseAdvanceResponse, error) {
	if req.GetAdvanceId() == "" {
		return nil, status.Error(codes.InvalidArgument, "advance_id is required")
	}
	if req.GetAdminId() == "" {
		return nil, status.Error(codes.InvalidArgument, "admin_id is required")
	}

	advance, transferID, err := s.svc.DisburseAdvance(ctx, req.GetAdvanceId(), req.GetAdminId())
	if err != nil {
		return nil, mapAdvanceError(err)
	}

	return &paymentv1.DisburseAdvanceResponse{
		Advance:          domainAdvanceToProto(advance),
		StripeTransferId: transferID,
	}, nil
}

func (s *Server) GetCreditLimit(ctx context.Context, req *paymentv1.GetCreditLimitRequest) (*paymentv1.GetCreditLimitResponse, error) {
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}

	limit, err := s.svc.ComputeCreditLimit(ctx, req.GetProviderId())
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to compute credit limit")
	}

	available := limit.MaxAdvanceCents - limit.TotalOutstandingCents
	if available < 0 {
		available = 0
	}

	resp := &paymentv1.GetCreditLimitResponse{
		ProviderId:            limit.ProviderID,
		MaxAdvanceCents:       limit.MaxAdvanceCents,
		TotalOutstandingCents: limit.TotalOutstandingCents,
		AvailableAdvanceCents: available,
		RiskScore:             limit.RiskScore,
		JobsCompleted:         int32(limit.JobsCompleted),
		TotalEarningsCents:    limit.TotalEarningsCents,
		AvgJobValueCents:      limit.AvgJobValueCents,
	}
	if limit.OnTimeRate != nil {
		resp.OnTimeRate = *limit.OnTimeRate
	}
	if !limit.LastComputedAt.IsZero() {
		resp.LastComputedAt = timestamppb.New(limit.LastComputedAt)
	}

	return resp, nil
}

// --- Conversion helpers ---

func domainAdvanceToProto(a *domain.Advance) *paymentv1.Advance {
	if a == nil {
		return nil
	}

	// Itemized for transparency: the flat origination/service portion of the
	// STORED FeeCents (the remainder is APR interest). The invariant the gateway
	// relies on is service_fee + interest == fee_cents, so the breakdown must be
	// derived FROM the stored total — never by recomputing 3% of principal fresh.
	// Recomputing diverges on legacy rows whose stored fee predates the current
	// 3% origination model (e.g. stored fee 986 vs recomputed 3000), which would
	// push the breakdown over the total and clamp interest to a fake 0. Cap the
	// service portion at the stored fee so the two line items always sum to it.
	serviceFeeCents := domain.AdvanceServiceFeeCents(a.AdvanceAmountCents)
	if serviceFeeCents > a.FeeCents {
		serviceFeeCents = a.FeeCents
	}

	pb := &paymentv1.Advance{
		Id:                 a.ID,
		ProviderId:         a.ProviderID,
		ContractId:         a.ContractID,
		AdvanceAmountCents: a.AdvanceAmountCents,
		FeeCents:           a.FeeCents,
		ServiceFeeCents:    serviceFeeCents,
		RepaidCents:        a.RepaidCents,
		Status:             a.Status,
		StripeTransferId:   a.StripeTransferID,
		CreatedAt:          timestamppb.New(a.CreatedAt),
		UpdatedAt:          timestamppb.New(a.UpdatedAt),
	}
	if a.ReviewedBy != nil {
		pb.ReviewedBy = *a.ReviewedBy
	}
	if a.ReviewedAt != nil {
		pb.ReviewedAt = timestamppb.New(*a.ReviewedAt)
	}
	if a.RejectionReason != nil {
		pb.RejectionReason = *a.RejectionReason
	}
	if a.DisbursedAt != nil {
		pb.DisbursedAt = timestamppb.New(*a.DisbursedAt)
	}
	if a.RepaidAt != nil {
		pb.RepaidAt = timestamppb.New(*a.RepaidAt)
	}
	return pb
}

func mapAdvanceError(err error) error {
	switch {
	case errors.Is(err, domain.ErrAdvanceNotFound):
		return status.Error(codes.NotFound, "advance not found")
	case errors.Is(err, domain.ErrAdvanceNotApproved):
		// Concurrent or repeated disbursement of an advance another request already
		// claimed. Predictable state-machine conflict → 422 (FailedPrecondition),
		// never a 500. No second payout fired (the transfer is idempotency-keyed).
		return status.Error(codes.FailedPrecondition, "advance is no longer in approved status (it may already be disbursed)")
	case errors.Is(err, service.ErrInsufficientCredit):
		// Over-lending guard: the request is well-formed but exceeds available
		// credit. FailedPrecondition → gateway 422 with an actionable message.
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, domain.ErrInvalidAmount):
		return status.Error(codes.InvalidArgument, "invalid amount")
	case errors.Is(err, domain.ErrAdvanceDeclined):
		// Predictable underwriting decline (credit score too low) — 422, not 500.
		return status.Error(codes.FailedPrecondition, "your business credit score is below the minimum to qualify for an advance")
	case errors.Is(err, domain.ErrStripeAccountNotFound):
		// Provider hasn't completed payout (Stripe Connect) onboarding — a
		// precondition for disbursement, not a server fault. 422, not 500.
		return status.Error(codes.FailedPrecondition, "provider has not completed Stripe payout onboarding")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
