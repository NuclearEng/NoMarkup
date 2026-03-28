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

// --- Conversion helpers ---

func domainAdvanceToProto(a *domain.Advance) *paymentv1.Advance {
	if a == nil {
		return nil
	}

	pb := &paymentv1.Advance{
		Id:                 a.ID,
		ProviderId:         a.ProviderID,
		ContractId:         a.ContractID,
		AdvanceAmountCents: a.AdvanceAmountCents,
		FeeCents:           a.FeeCents,
		RepaidCents:        a.RepaidCents,
		Status:             a.Status,
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
	case errors.Is(err, domain.ErrInvalidAmount):
		return status.Error(codes.InvalidArgument, "invalid amount")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
