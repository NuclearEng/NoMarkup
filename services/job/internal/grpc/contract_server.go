package grpc

import (
	"context"
	"errors"
	"strings"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/service"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ContractServer implements the ContractService gRPC server.
type ContractServer struct {
	contractv1.UnimplementedContractServiceServer
	svc *service.ContractService
}

// NewContractServer creates a new gRPC server for the contract service.
func NewContractServer(svc *service.ContractService) *ContractServer {
	return &ContractServer{svc: svc}
}

// RegisterContract registers the contract service with a gRPC server.
func RegisterContract(s *grpclib.Server, srv *ContractServer) {
	contractv1.RegisterContractServiceServer(s, srv)
}

func (s *ContractServer) GetContract(ctx context.Context, req *contractv1.GetContractRequest) (*contractv1.GetContractResponse, error) {
	contract, err := s.svc.GetContract(ctx, req.GetContractId(), req.GetRequestingUserId())
	if err != nil {
		return nil, mapContractDomainError(err)
	}

	protoContract := domainContractToProto(contract)
	resp := &contractv1.GetContractResponse{
		Contract: protoContract,
	}

	if len(contract.ChangeOrders) > 0 {
		protoOrders := make([]*contractv1.ChangeOrder, 0, len(contract.ChangeOrders))
		for _, co := range contract.ChangeOrders {
			protoOrders = append(protoOrders, domainChangeOrderToProto(&co))
		}
		resp.ChangeOrders = protoOrders
	}

	return resp, nil
}

func (s *ContractServer) AcceptContract(ctx context.Context, req *contractv1.AcceptContractRequest) (*contractv1.AcceptContractResponse, error) {
	contract, err := s.svc.AcceptContract(ctx, req.GetContractId(), req.GetUserId())
	if err != nil {
		return nil, mapContractDomainError(err)
	}
	return &contractv1.AcceptContractResponse{
		Contract: domainContractToProto(contract),
	}, nil
}

func (s *ContractServer) StartWork(ctx context.Context, req *contractv1.StartWorkRequest) (*contractv1.StartWorkResponse, error) {
	contract, err := s.svc.StartWork(ctx, req.GetContractId(), req.GetProviderId())
	if err != nil {
		return nil, mapContractDomainError(err)
	}
	return &contractv1.StartWorkResponse{
		Contract: domainContractToProto(contract),
	}, nil
}

func (s *ContractServer) ListContracts(ctx context.Context, req *contractv1.ListContractsRequest) (*contractv1.ListContractsResponse, error) {
	var statusFilter *string
	if req.GetStatusFilter() != contractv1.ContractStatus_CONTRACT_STATUS_UNSPECIFIED {
		sf := protoContractStatusToString(req.GetStatusFilter())
		statusFilter = &sf
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

	contracts, pagination, err := s.svc.ListContracts(ctx, req.GetUserId(), statusFilter, int(page), int(pageSize))
	if err != nil {
		return nil, mapContractDomainError(err)
	}

	protoContracts := make([]*contractv1.Contract, 0, len(contracts))
	for _, c := range contracts {
		protoContracts = append(protoContracts, domainContractToProto(c))
	}

	return &contractv1.ListContractsResponse{
		Contracts:  protoContracts,
		Pagination: domainPaginationToProto(pagination),
	}, nil
}

func (s *ContractServer) SubmitMilestone(ctx context.Context, req *contractv1.SubmitMilestoneRequest) (*contractv1.SubmitMilestoneResponse, error) {
	milestone, err := s.svc.SubmitMilestone(ctx, req.GetMilestoneId(), req.GetProviderId())
	if err != nil {
		return nil, mapContractDomainError(err)
	}
	return &contractv1.SubmitMilestoneResponse{
		Milestone: domainMilestoneToProto(milestone),
	}, nil
}

func (s *ContractServer) ApproveMilestone(ctx context.Context, req *contractv1.ApproveMilestoneRequest) (*contractv1.ApproveMilestoneResponse, error) {
	milestone, err := s.svc.ApproveMilestone(ctx, req.GetMilestoneId(), req.GetCustomerId())
	if err != nil {
		return nil, mapContractDomainError(err)
	}
	return &contractv1.ApproveMilestoneResponse{
		Milestone: domainMilestoneToProto(milestone),
	}, nil
}

func (s *ContractServer) RequestRevision(ctx context.Context, req *contractv1.RequestRevisionRequest) (*contractv1.RequestRevisionResponse, error) {
	milestone, err := s.svc.RequestRevision(ctx, req.GetMilestoneId(), req.GetCustomerId(), req.GetRevisionNotes())
	if err != nil {
		return nil, mapContractDomainError(err)
	}
	return &contractv1.RequestRevisionResponse{
		Milestone: domainMilestoneToProto(milestone),
	}, nil
}

func (s *ContractServer) MarkComplete(ctx context.Context, req *contractv1.MarkCompleteRequest) (*contractv1.MarkCompleteResponse, error) {
	contract, err := s.svc.MarkComplete(ctx, req.GetContractId(), req.GetProviderId())
	if err != nil {
		return nil, mapContractDomainError(err)
	}
	return &contractv1.MarkCompleteResponse{
		Contract: domainContractToProto(contract),
	}, nil
}

func (s *ContractServer) ApproveCompletion(ctx context.Context, req *contractv1.ApproveCompletionRequest) (*contractv1.ApproveCompletionResponse, error) {
	contract, err := s.svc.ApproveCompletion(ctx, req.GetContractId(), req.GetCustomerId())
	if err != nil {
		return nil, mapContractDomainError(err)
	}
	return &contractv1.ApproveCompletionResponse{
		Contract: domainContractToProto(contract),
	}, nil
}

func (s *ContractServer) CancelContract(ctx context.Context, req *contractv1.CancelContractRequest) (*contractv1.CancelContractResponse, error) {
	contract, err := s.svc.CancelContract(ctx, req.GetContractId(), req.GetUserId(), req.GetReason())
	if err != nil {
		return nil, mapContractDomainError(err)
	}
	return &contractv1.CancelContractResponse{
		Contract: domainContractToProto(contract),
	}, nil
}

// --- Proto conversion helpers ---

func domainContractToProto(c *domain.Contract) *contractv1.Contract {
	pb := &contractv1.Contract{
		Id:                 c.ID,
		ContractNumber:     c.ContractNumber,
		JobId:              c.JobID,
		CustomerId:         c.CustomerID,
		ProviderId:         c.ProviderID,
		BidId:              c.BidID,
		AmountCents:        c.AmountCents,
		PaymentTiming:      stringToProtoPaymentTiming(c.PaymentTiming),
		Status:             stringToProtoContractStatus(c.Status),
		CustomerAccepted:   c.CustomerAccepted,
		ProviderAccepted:   c.ProviderAccepted,
		AcceptanceDeadline: timestamppb.New(c.AcceptanceDeadline),
		CreatedAt:          timestamppb.New(c.CreatedAt),
	}

	if c.AcceptedAt != nil {
		pb.AcceptedAt = timestamppb.New(*c.AcceptedAt)
	}
	if c.StartedAt != nil {
		pb.StartedAt = timestamppb.New(*c.StartedAt)
	}
	if c.CompletedAt != nil {
		pb.CompletedAt = timestamppb.New(*c.CompletedAt)
	}

	if len(c.Milestones) > 0 {
		protoMilestones := make([]*contractv1.Milestone, 0, len(c.Milestones))
		for _, m := range c.Milestones {
			protoMilestones = append(protoMilestones, domainMilestoneToProto(&m))
		}
		pb.Milestones = protoMilestones
	}

	return pb
}

func domainMilestoneToProto(m *domain.Milestone) *contractv1.Milestone {
	pb := &contractv1.Milestone{
		Id:            m.ID,
		ContractId:    m.ContractID,
		Description:   m.Description,
		AmountCents:   m.AmountCents,
		SortOrder:     int32(m.SortOrder),
		Status:        stringToProtoMilestoneStatus(m.Status),
		RevisionCount: int32(m.RevisionCount),
		RevisionNotes: m.RevisionNotes,
	}

	if m.SubmittedAt != nil {
		pb.SubmittedAt = timestamppb.New(*m.SubmittedAt)
	}
	if m.ApprovedAt != nil {
		pb.ApprovedAt = timestamppb.New(*m.ApprovedAt)
	}

	return pb
}

func domainChangeOrderToProto(co *domain.ChangeOrder) *contractv1.ChangeOrder {
	pb := &contractv1.ChangeOrder{
		Id:               co.ID,
		ContractId:       co.ContractID,
		ProposedBy:       co.ProposedBy,
		Description:      co.Description,
		AmountDeltaCents: co.AmountDeltaCents,
		Status:           co.Status,
		CreatedAt:        timestamppb.New(co.CreatedAt),
	}
	return pb
}

// --- Enum conversions ---

func protoContractStatusToString(s contractv1.ContractStatus) string {
	name := s.String()
	name = strings.TrimPrefix(name, "CONTRACT_STATUS_")
	return strings.ToLower(name)
}

func stringToProtoContractStatus(s string) contractv1.ContractStatus {
	switch s {
	case "pending_acceptance":
		return contractv1.ContractStatus_CONTRACT_STATUS_PENDING_ACCEPTANCE
	case "active":
		return contractv1.ContractStatus_CONTRACT_STATUS_ACTIVE
	case "completed":
		return contractv1.ContractStatus_CONTRACT_STATUS_COMPLETED
	case "cancelled":
		return contractv1.ContractStatus_CONTRACT_STATUS_CANCELLED
	case "voided":
		return contractv1.ContractStatus_CONTRACT_STATUS_VOIDED
	case "disputed":
		return contractv1.ContractStatus_CONTRACT_STATUS_DISPUTED
	case "abandoned":
		return contractv1.ContractStatus_CONTRACT_STATUS_ABANDONED
	case "suspended":
		return contractv1.ContractStatus_CONTRACT_STATUS_SUSPENDED
	default:
		return contractv1.ContractStatus_CONTRACT_STATUS_UNSPECIFIED
	}
}

func stringToProtoMilestoneStatus(s string) contractv1.MilestoneStatus {
	switch s {
	case "pending":
		return contractv1.MilestoneStatus_MILESTONE_STATUS_PENDING
	case "in_progress":
		return contractv1.MilestoneStatus_MILESTONE_STATUS_IN_PROGRESS
	case "submitted":
		return contractv1.MilestoneStatus_MILESTONE_STATUS_SUBMITTED
	case "approved":
		return contractv1.MilestoneStatus_MILESTONE_STATUS_APPROVED
	case "disputed":
		return contractv1.MilestoneStatus_MILESTONE_STATUS_DISPUTED
	case "revision_requested":
		return contractv1.MilestoneStatus_MILESTONE_STATUS_REVISION_REQUESTED
	default:
		return contractv1.MilestoneStatus_MILESTONE_STATUS_UNSPECIFIED
	}
}

func stringToProtoPaymentTiming(s string) commonv1.PaymentTiming {
	switch s {
	case "upfront":
		return commonv1.PaymentTiming_PAYMENT_TIMING_UPFRONT
	case "milestone":
		return commonv1.PaymentTiming_PAYMENT_TIMING_MILESTONE
	case "completion":
		return commonv1.PaymentTiming_PAYMENT_TIMING_COMPLETION
	case "payment_plan":
		return commonv1.PaymentTiming_PAYMENT_TIMING_PAYMENT_PLAN
	case "recurring":
		return commonv1.PaymentTiming_PAYMENT_TIMING_RECURRING
	default:
		return commonv1.PaymentTiming_PAYMENT_TIMING_UNSPECIFIED
	}
}

// mapContractDomainError maps contract domain errors to gRPC status errors.
func mapContractDomainError(err error) error {
	switch {
	case errors.Is(err, domain.ErrContractNotFound):
		return status.Error(codes.NotFound, "contract not found")
	case errors.Is(err, domain.ErrNotContractParty):
		return status.Error(codes.PermissionDenied, "not a party to this contract")
	case errors.Is(err, domain.ErrAlreadyAccepted):
		return status.Error(codes.AlreadyExists, "already accepted by this party")
	case errors.Is(err, domain.ErrDeadlineExpired):
		return status.Error(codes.FailedPrecondition, "acceptance deadline has expired")
	case errors.Is(err, domain.ErrContractNotActive):
		return status.Error(codes.FailedPrecondition, "contract is not active")
	case errors.Is(err, domain.ErrMilestoneNotFound):
		return status.Error(codes.NotFound, "milestone not found")
	case errors.Is(err, domain.ErrMaxRevisions):
		return status.Error(codes.FailedPrecondition, "maximum revision count reached")
	case errors.Is(err, domain.ErrInvalidStatusTransition):
		return status.Error(codes.FailedPrecondition, "invalid status transition")
	case errors.Is(err, domain.ErrJobNotFound):
		return status.Error(codes.NotFound, "job not found")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
