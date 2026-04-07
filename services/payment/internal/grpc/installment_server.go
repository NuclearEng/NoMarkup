package grpc

import (
	"context"
	"errors"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// InstallmentServer implements the InstallmentPlanServiceServer gRPC interface.
type InstallmentServer struct {
	paymentv1.UnimplementedInstallmentPlanServiceServer
	svc *service.InstallmentService
}

// NewInstallmentServer creates a new gRPC server for the installment service.
func NewInstallmentServer(svc *service.InstallmentService) *InstallmentServer {
	return &InstallmentServer{svc: svc}
}

// RegisterInstallmentServer registers the installment service with a gRPC server.
func RegisterInstallmentServer(s *grpclib.Server, srv *InstallmentServer) {
	paymentv1.RegisterInstallmentPlanServiceServer(s, srv)
}

func (s *InstallmentServer) CreateInstallmentPlan(ctx context.Context, req *paymentv1.CreateInstallmentPlanRequest) (*paymentv1.CreateInstallmentPlanResponse, error) {
	if req.GetContractId() == "" {
		return nil, status.Error(codes.InvalidArgument, "contract_id is required")
	}
	if req.GetCustomerId() == "" {
		return nil, status.Error(codes.InvalidArgument, "customer_id is required")
	}
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}
	if req.GetTotalAmountCents() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "total_amount_cents must be positive")
	}
	if req.GetInstallmentCount() != 3 && req.GetInstallmentCount() != 6 {
		return nil, status.Error(codes.InvalidArgument, "installment_count must be 3 or 6")
	}

	input := domain.CreateInstallmentPlanInput{
		ContractID:       req.GetContractId(),
		CustomerID:       req.GetCustomerId(),
		ProviderID:       req.GetProviderId(),
		TotalAmountCents: req.GetTotalAmountCents(),
		InstallmentCount: int(req.GetInstallmentCount()),
		PaymentMethodID:  req.GetPaymentMethodId(),
		IdempotencyKey:   req.GetIdempotencyKey(),
	}

	plan, clientSecret, err := s.svc.CreateInstallmentPlan(ctx, input)
	if err != nil {
		return nil, mapInstallmentError(err)
	}

	return &paymentv1.CreateInstallmentPlanResponse{
		Plan:                         domainInstallmentPlanToProto(plan),
		FirstInstallmentClientSecret: clientSecret,
	}, nil
}

func (s *InstallmentServer) GetInstallmentPlan(ctx context.Context, req *paymentv1.GetInstallmentPlanRequest) (*paymentv1.GetInstallmentPlanResponse, error) {
	if req.GetPlanId() == "" {
		return nil, status.Error(codes.InvalidArgument, "plan_id is required")
	}

	plan, err := s.svc.GetInstallmentPlan(ctx, req.GetPlanId())
	if err != nil {
		return nil, mapInstallmentError(err)
	}

	return &paymentv1.GetInstallmentPlanResponse{
		Plan: domainInstallmentPlanToProto(plan),
	}, nil
}

func (s *InstallmentServer) ListInstallmentPlans(ctx context.Context, req *paymentv1.ListInstallmentPlansRequest) (*paymentv1.ListInstallmentPlansResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	statusFilter := ""
	if req.StatusFilter != nil {
		statusFilter = *req.StatusFilter
	}

	plans, _, err := s.svc.ListInstallmentPlans(ctx, req.GetUserId(), statusFilter, 1, 100)
	if err != nil {
		return nil, mapInstallmentError(err)
	}

	protoPlans := make([]*paymentv1.InstallmentPlan, 0, len(plans))
	for _, p := range plans {
		protoPlans = append(protoPlans, domainInstallmentPlanToProto(p))
	}

	return &paymentv1.ListInstallmentPlansResponse{
		Plans: protoPlans,
	}, nil
}

// --- Conversion helpers ---

func domainInstallmentPlanToProto(p *domain.InstallmentPlan) *paymentv1.InstallmentPlan {
	if p == nil {
		return nil
	}

	pb := &paymentv1.InstallmentPlan{
		Id:                       p.ID,
		ContractId:               p.ContractID,
		CustomerId:               p.CustomerID,
		ProviderId:               p.ProviderID,
		TotalAmountCents:         p.TotalAmountCents,
		BnplFeeCents:             p.BNPLFeeCents,
		TotalWithFeeCents:        p.TotalWithFeeCents,
		InstallmentCount:         int32(p.InstallmentCount),
		PerInstallmentCents:      p.PerInstallmentCents,
		FeeRate:                  p.FeeRate,
		Status:                   p.Status,
		StripeProviderTransferId: p.StripeProviderTransferID,
		CreatedAt:                timestamppb.New(p.CreatedAt),
		UpdatedAt:                timestamppb.New(p.UpdatedAt),
	}

	if p.ProviderPaidAt != nil {
		pb.ProviderPaidAt = timestamppb.New(*p.ProviderPaidAt)
	}

	for _, inst := range p.Installments {
		si := &paymentv1.ScheduledInstallment{
			Id:                inst.ID,
			InstallmentNumber: int32(inst.InstallmentNumber),
			AmountCents:       inst.AmountCents,
			DueDate:           inst.DueDate.Format("2006-01-02"),
			Status:            inst.Status,
		}
		if inst.PaymentID != nil {
			si.PaymentId = *inst.PaymentID
		}
		if inst.PaidAt != nil {
			si.PaidAt = timestamppb.New(*inst.PaidAt)
		}
		pb.Installments = append(pb.Installments, si)
	}

	return pb
}

func mapInstallmentError(err error) error {
	if err == nil {
		return nil
	}

	switch {
	case errors.Is(err, domain.ErrInstallmentPlanNotFound):
		return status.Error(codes.NotFound, "installment plan not found")
	case errors.Is(err, domain.ErrInvalidInstallmentCount):
		return status.Error(codes.InvalidArgument, "installment count must be 3 or 6")
	case errors.Is(err, domain.ErrInvalidAmount):
		return status.Error(codes.InvalidArgument, "invalid amount")
	case errors.Is(err, domain.ErrStripeAccountNotFound):
		return status.Error(codes.NotFound, "stripe account not found")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
