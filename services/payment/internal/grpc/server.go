package grpc

import (
	"context"
	"errors"
	"strings"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Server implements the PaymentService gRPC server.
type Server struct {
	paymentv1.UnimplementedPaymentServiceServer
	svc *service.PaymentService
}

// NewServer creates a new gRPC server for the payment service.
func NewServer(svc *service.PaymentService) *Server {
	return &Server{svc: svc}
}

// Register registers the payment service with a gRPC server.
func Register(s *grpclib.Server, srv *Server) {
	paymentv1.RegisterPaymentServiceServer(s, srv)
}

// --- Stripe Onboarding ---

func (s *Server) CreateStripeAccount(ctx context.Context, req *paymentv1.CreateStripeAccountRequest) (*paymentv1.CreateStripeAccountResponse, error) {
	accountID, err := s.svc.CreateStripeAccount(ctx, req.GetUserId(), req.GetEmail(), req.GetBusinessName())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.CreateStripeAccountResponse{StripeAccountId: accountID}, nil
}

func (s *Server) GetStripeOnboardingLink(ctx context.Context, req *paymentv1.GetStripeOnboardingLinkRequest) (*paymentv1.GetStripeOnboardingLinkResponse, error) {
	url, err := s.svc.GetStripeOnboardingLink(ctx, req.GetUserId(), req.GetReturnUrl(), req.GetRefreshUrl())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.GetStripeOnboardingLinkResponse{OnboardingUrl: url}, nil
}

func (s *Server) GetStripeAccountStatus(ctx context.Context, req *paymentv1.GetStripeAccountStatusRequest) (*paymentv1.GetStripeAccountStatusResponse, error) {
	acctStatus, err := s.svc.GetStripeAccountStatus(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.GetStripeAccountStatusResponse{
		ChargesEnabled:   acctStatus.ChargesEnabled,
		PayoutsEnabled:   acctStatus.PayoutsEnabled,
		DetailsSubmitted: acctStatus.DetailsSubmitted,
		Requirements:     acctStatus.Requirements,
	}, nil
}

func (s *Server) GetStripeDashboardLink(ctx context.Context, req *paymentv1.GetStripeDashboardLinkRequest) (*paymentv1.GetStripeDashboardLinkResponse, error) {
	url, err := s.svc.GetStripeDashboardLink(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.GetStripeDashboardLinkResponse{DashboardUrl: url}, nil
}

// --- Customer Payment Methods ---

func (s *Server) CreateSetupIntent(ctx context.Context, req *paymentv1.CreateSetupIntentRequest) (*paymentv1.CreateSetupIntentResponse, error) {
	clientSecret, err := s.svc.CreateSetupIntent(ctx, req.GetCustomerId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.CreateSetupIntentResponse{ClientSecret: clientSecret}, nil
}

func (s *Server) ListPaymentMethods(ctx context.Context, req *paymentv1.ListPaymentMethodsRequest) (*paymentv1.ListPaymentMethodsResponse, error) {
	methods, err := s.svc.ListPaymentMethods(ctx, req.GetCustomerId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoMethods := make([]*paymentv1.PaymentMethod, 0, len(methods))
	for _, m := range methods {
		protoMethods = append(protoMethods, &paymentv1.PaymentMethod{
			Id:        m.ID,
			Type:      m.Type,
			LastFour:  m.LastFour,
			Brand:     m.Brand,
			ExpMonth:  m.ExpMonth,
			ExpYear:   m.ExpYear,
			IsDefault: m.IsDefault,
		})
	}

	return &paymentv1.ListPaymentMethodsResponse{Methods: protoMethods}, nil
}

func (s *Server) DeletePaymentMethod(ctx context.Context, req *paymentv1.DeletePaymentMethodRequest) (*paymentv1.DeletePaymentMethodResponse, error) {
	if err := s.svc.DeletePaymentMethod(ctx, req.GetPaymentMethodId()); err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.DeletePaymentMethodResponse{}, nil
}

// --- Payments ---

func (s *Server) CreatePayment(ctx context.Context, req *paymentv1.CreatePaymentRequest) (*paymentv1.CreatePaymentResponse, error) {
	input := domain.CreatePaymentInput{
		ContractID:     req.GetContractId(),
		CustomerID:     req.GetCustomerId(),
		ProviderID:     req.GetProviderId(),
		AmountCents:    req.GetAmountCents(),
		IdempotencyKey: req.GetIdempotencyKey(),
	}

	if req.GetMilestoneId() != "" {
		mid := req.GetMilestoneId()
		input.MilestoneID = &mid
	}
	if req.GetRecurringInstanceId() != "" {
		rid := req.GetRecurringInstanceId()
		input.RecurringInstanceID = &rid
	}
	if req.GetInstallmentNumber() > 0 {
		in := int(req.GetInstallmentNumber())
		input.InstallmentNumber = &in
	}
	if req.GetTotalInstallments() > 0 {
		ti := int(req.GetTotalInstallments())
		input.TotalInstallments = &ti
	}

	payment, clientSecret, err := s.svc.CreatePayment(ctx, input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &paymentv1.CreatePaymentResponse{
		Payment:      domainPaymentToProto(payment),
		ClientSecret: clientSecret,
	}, nil
}

func (s *Server) ProcessPayment(ctx context.Context, req *paymentv1.ProcessPaymentRequest) (*paymentv1.ProcessPaymentResponse, error) {
	payment, err := s.svc.ProcessPayment(ctx, req.GetPaymentId(), req.GetPaymentMethodId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.ProcessPaymentResponse{Payment: domainPaymentToProto(payment)}, nil
}

func (s *Server) ReleaseEscrow(ctx context.Context, req *paymentv1.ReleaseEscrowRequest) (*paymentv1.ReleaseEscrowResponse, error) {
	payment, err := s.svc.ReleaseEscrow(ctx, req.GetPaymentId(), req.GetReason())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.ReleaseEscrowResponse{Payment: domainPaymentToProto(payment)}, nil
}

func (s *Server) GetPayment(ctx context.Context, req *paymentv1.GetPaymentRequest) (*paymentv1.GetPaymentResponse, error) {
	payment, err := s.svc.GetPayment(ctx, req.GetPaymentId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	breakdown := &paymentv1.PaymentBreakdown{
		SubtotalCents:       payment.AmountCents,
		PlatformFeeCents:    payment.PlatformFeeCents,
		GuaranteeFeeCents:   payment.GuaranteeFeeCents,
		TotalCents:          payment.AmountCents,
		ProviderPayoutCents: payment.ProviderPayoutCents,
	}

	return &paymentv1.GetPaymentResponse{
		Payment:   domainPaymentToProto(payment),
		Breakdown: breakdown,
	}, nil
}

func (s *Server) ListPayments(ctx context.Context, req *paymentv1.ListPaymentsRequest) (*paymentv1.ListPaymentsResponse, error) {
	statusFilter := ""
	if req.StatusFilter != nil {
		statusFilter = paymentStatusToString(*req.StatusFilter)
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

	payments, totalCount, err := s.svc.ListPayments(ctx, req.GetUserId(), statusFilter, int(page), int(pageSize))
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoPayments := make([]*paymentv1.Payment, 0, len(payments))
	for _, p := range payments {
		protoPayments = append(protoPayments, domainPaymentToProto(p))
	}

	totalPages := int32(0)
	if totalCount > 0 {
		totalPages = (int32(totalCount) + pageSize - 1) / pageSize
	}

	return &paymentv1.ListPaymentsResponse{
		Payments: protoPayments,
		Pagination: &commonv1.PaginationResponse{
			TotalCount: int32(totalCount),
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
			HasNext:    page < totalPages,
		},
	}, nil
}

// --- Refunds ---

func (s *Server) CreateRefund(ctx context.Context, req *paymentv1.CreateRefundRequest) (*paymentv1.CreateRefundResponse, error) {
	payment, err := s.svc.CreateRefund(ctx, req.GetPaymentId(), req.GetAmountCents(), req.GetReason())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.CreateRefundResponse{Payment: domainPaymentToProto(payment)}, nil
}

// --- Webhooks ---

func (s *Server) HandleStripeWebhook(ctx context.Context, req *paymentv1.HandleStripeWebhookRequest) (*paymentv1.HandleStripeWebhookResponse, error) {
	err := s.svc.HandleWebhook(ctx, []byte(req.GetPayload()), req.GetSignature())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "webhook processing failed: %v", err)
	}
	return &paymentv1.HandleStripeWebhookResponse{Processed: true}, nil
}

// --- Platform Fees ---

func (s *Server) CalculateFees(ctx context.Context, req *paymentv1.CalculateFeesRequest) (*paymentv1.CalculateFeesResponse, error) {
	var categoryID *string
	if req.GetCategoryId() != "" {
		cid := req.GetCategoryId()
		categoryID = &cid
	}

	breakdown, err := s.svc.CalculateFees(ctx, req.GetAmountCents(), categoryID)
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &paymentv1.CalculateFeesResponse{
		Breakdown: &paymentv1.PaymentBreakdown{
			SubtotalCents:       breakdown.SubtotalCents,
			PlatformFeeCents:    breakdown.PlatformFeeCents,
			GuaranteeFeeCents:   breakdown.GuaranteeFeeCents,
			TotalCents:          breakdown.TotalCents,
			ProviderPayoutCents: breakdown.ProviderPayoutCents,
			FeePercentage:       breakdown.FeePercentage,
			GuaranteePercentage: breakdown.GuaranteePercentage,
		},
	}, nil
}

func (s *Server) GetFeeConfig(ctx context.Context, req *paymentv1.GetFeeConfigRequest) (*paymentv1.GetFeeConfigResponse, error) {
	var categoryID *string
	if req.CategoryId != nil {
		categoryID = req.CategoryId
	}

	fc, err := s.svc.GetFeeConfig(ctx, categoryID)
	if err != nil {
		return nil, mapDomainError(err)
	}

	resp := &paymentv1.GetFeeConfigResponse{
		FeePercentage:       fc.FeePercentage,
		GuaranteePercentage: fc.GuaranteePercentage,
		MinFeeCents:         fc.MinFeeCents,
	}
	if fc.MaxFeeCents != nil {
		resp.MaxFeeCents = *fc.MaxFeeCents
	}

	return resp, nil
}

// --- Conversion helpers ---

func domainPaymentToProto(p *domain.Payment) *paymentv1.Payment {
	pb := &paymentv1.Payment{
		Id:                  p.ID,
		ContractId:          p.ContractID,
		CustomerId:          p.CustomerID,
		ProviderId:          p.ProviderID,
		AmountCents:         p.AmountCents,
		PlatformFeeCents:    p.PlatformFeeCents,
		GuaranteeFeeCents:   p.GuaranteeFeeCents,
		ProviderPayoutCents: p.ProviderPayoutCents,
		Status:              stringToPaymentStatus(p.Status),
		FailureReason:       p.FailureReason,
		RefundAmountCents:   p.RefundAmountCents,
		RefundReason:        p.RefundReason,
		RetryCount:          int32(p.RetryCount),
		CreatedAt:           timestamppb.New(p.CreatedAt),
	}

	if p.MilestoneID != nil {
		pb.MilestoneId = *p.MilestoneID
	}
	if p.RecurringInstanceID != nil {
		pb.RecurringInstanceId = *p.RecurringInstanceID
	}
	if p.InstallmentNumber != nil {
		pb.InstallmentNumber = int32(*p.InstallmentNumber)
	}
	if p.TotalInstallments != nil {
		pb.TotalInstallments = int32(*p.TotalInstallments)
	}
	if p.EscrowAt != nil {
		pb.EscrowAt = timestamppb.New(*p.EscrowAt)
	}
	if p.ReleasedAt != nil {
		pb.ReleasedAt = timestamppb.New(*p.ReleasedAt)
	}
	if p.CompletedAt != nil {
		pb.CompletedAt = timestamppb.New(*p.CompletedAt)
	}

	return pb
}

func stringToPaymentStatus(s string) paymentv1.PaymentStatus {
	switch s {
	case "pending":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_PENDING
	case "processing":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_PROCESSING
	case "escrow":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW
	case "released":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED
	case "completed":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_COMPLETED
	case "failed":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_FAILED
	case "refunded":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_REFUNDED
	case "partially_refunded":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_PARTIALLY_REFUNDED
	case "disputed":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_DISPUTED
	case "chargeback":
		return paymentv1.PaymentStatus_PAYMENT_STATUS_CHARGEBACK
	default:
		return paymentv1.PaymentStatus_PAYMENT_STATUS_UNSPECIFIED
	}
}

func paymentStatusToString(s paymentv1.PaymentStatus) string {
	name := s.String()
	name = strings.TrimPrefix(name, "PAYMENT_STATUS_")
	return strings.ToLower(name)
}

// mapDomainError maps domain errors to gRPC status errors.
func mapDomainError(err error) error {
	switch {
	case errors.Is(err, domain.ErrPaymentNotFound):
		return status.Error(codes.NotFound, "payment not found")
	case errors.Is(err, domain.ErrIdempotencyConflict):
		return status.Error(codes.AlreadyExists, "duplicate idempotency key")
	case errors.Is(err, domain.ErrInvalidAmount):
		return status.Error(codes.InvalidArgument, "invalid amount")
	case errors.Is(err, domain.ErrInvalidStatus):
		return status.Error(codes.FailedPrecondition, "invalid status for this operation")
	case errors.Is(err, domain.ErrPaymentAlreadyProcessed):
		return status.Error(codes.FailedPrecondition, "payment already processed")
	case errors.Is(err, domain.ErrFeeConfigNotFound):
		return status.Error(codes.NotFound, "fee configuration not found")
	case errors.Is(err, domain.ErrStripeAccountNotFound):
		return status.Error(codes.NotFound, "stripe account not found")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
