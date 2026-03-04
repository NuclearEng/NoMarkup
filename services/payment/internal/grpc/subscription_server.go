package grpc

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	subscriptionv1 "github.com/nomarkup/nomarkup/proto/subscription/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// SubscriptionServer implements the SubscriptionService gRPC server.
type SubscriptionServer struct {
	subscriptionv1.UnimplementedSubscriptionServiceServer
	svc *service.SubscriptionService
}

// NewSubscriptionServer creates a new gRPC server for the subscription service.
func NewSubscriptionServer(svc *service.SubscriptionService) *SubscriptionServer {
	return &SubscriptionServer{svc: svc}
}

// RegisterSubscription registers the subscription service with a gRPC server.
func RegisterSubscription(s *grpclib.Server, srv *SubscriptionServer) {
	subscriptionv1.RegisterSubscriptionServiceServer(s, srv)
}

// --- Tier RPCs ---

func (s *SubscriptionServer) ListTiers(ctx context.Context, req *subscriptionv1.ListTiersRequest) (*subscriptionv1.ListTiersResponse, error) {
	tiers, err := s.svc.ListTiers(ctx)
	if err != nil {
		return nil, mapSubDomainError(err)
	}

	protoTiers := make([]*subscriptionv1.SubscriptionTier, 0, len(tiers))
	for _, t := range tiers {
		protoTiers = append(protoTiers, domainTierToProto(t))
	}

	return &subscriptionv1.ListTiersResponse{Tiers: protoTiers}, nil
}

func (s *SubscriptionServer) GetTier(ctx context.Context, req *subscriptionv1.GetTierRequest) (*subscriptionv1.GetTierResponse, error) {
	tier, err := s.svc.GetTier(ctx, req.GetTierId())
	if err != nil {
		return nil, mapSubDomainError(err)
	}
	return &subscriptionv1.GetTierResponse{Tier: domainTierToProto(tier)}, nil
}

// --- Subscription RPCs ---

func (s *SubscriptionServer) CreateSubscription(ctx context.Context, req *subscriptionv1.CreateSubscriptionRequest) (*subscriptionv1.CreateSubscriptionResponse, error) {
	interval := billingIntervalToString(req.GetBillingInterval())

	sub, clientSecret, err := s.svc.CreateSubscription(ctx, req.GetUserId(), req.GetTierId(), interval, req.GetPaymentMethodId())
	if err != nil {
		return nil, mapSubDomainError(err)
	}

	return &subscriptionv1.CreateSubscriptionResponse{
		Subscription: domainSubscriptionToProto(sub),
		ClientSecret: clientSecret,
	}, nil
}

func (s *SubscriptionServer) GetSubscription(ctx context.Context, req *subscriptionv1.GetSubscriptionRequest) (*subscriptionv1.GetSubscriptionResponse, error) {
	sub, err := s.svc.GetSubscription(ctx, req.GetUserId())
	if err != nil {
		// No active subscription is not an error; return nil subscription.
		if errors.Is(err, domain.ErrSubscriptionNotFound) {
			return &subscriptionv1.GetSubscriptionResponse{Subscription: nil}, nil
		}
		return nil, mapSubDomainError(err)
	}

	return &subscriptionv1.GetSubscriptionResponse{
		Subscription: domainSubscriptionToProto(sub),
	}, nil
}

func (s *SubscriptionServer) CancelSubscription(ctx context.Context, req *subscriptionv1.CancelSubscriptionRequest) (*subscriptionv1.CancelSubscriptionResponse, error) {
	sub, err := s.svc.CancelSubscription(ctx, req.GetUserId(), req.GetReason(), req.GetCancelImmediately())
	if err != nil {
		return nil, mapSubDomainError(err)
	}

	return &subscriptionv1.CancelSubscriptionResponse{
		Subscription: domainSubscriptionToProto(sub),
	}, nil
}

func (s *SubscriptionServer) ChangeSubscriptionTier(ctx context.Context, req *subscriptionv1.ChangeSubscriptionTierRequest) (*subscriptionv1.ChangeSubscriptionTierResponse, error) {
	interval := billingIntervalToString(req.GetBillingInterval())

	sub, prorationAmount, err := s.svc.ChangeSubscriptionTier(ctx, req.GetUserId(), req.GetNewTierId(), interval)
	if err != nil {
		return nil, mapSubDomainError(err)
	}

	return &subscriptionv1.ChangeSubscriptionTierResponse{
		Subscription:         domainSubscriptionToProto(sub),
		ProrationAmountCents: prorationAmount,
	}, nil
}

// --- Usage RPCs ---

func (s *SubscriptionServer) GetUsage(ctx context.Context, req *subscriptionv1.GetUsageRequest) (*subscriptionv1.GetUsageResponse, error) {
	usage, err := s.svc.GetUsage(ctx, req.GetUserId())
	if err != nil {
		return nil, mapSubDomainError(err)
	}

	return &subscriptionv1.GetUsageResponse{
		ActiveBids:           usage.ActiveBids,
		MaxActiveBids:        usage.MaxActiveBids,
		ServiceCategories:    usage.ServiceCategories,
		MaxServiceCategories: usage.MaxServiceCategories,
		PortfolioImages:      usage.PortfolioImages,
		MaxPortfolioImages:   usage.MaxPortfolioImages,
		CurrentFeePercentage: usage.CurrentFeePercentage,
	}, nil
}

func (s *SubscriptionServer) CheckFeatureAccess(ctx context.Context, req *subscriptionv1.CheckFeatureAccessRequest) (*subscriptionv1.CheckFeatureAccessResponse, error) {
	hasAccess, requiredTier := s.svc.CheckFeatureAccess(ctx, req.GetUserId(), req.GetFeature())

	return &subscriptionv1.CheckFeatureAccessResponse{
		HasAccess:    hasAccess,
		RequiredTier: requiredTier,
	}, nil
}

// --- Billing RPCs ---

func (s *SubscriptionServer) ListInvoices(ctx context.Context, req *subscriptionv1.ListInvoicesRequest) (*subscriptionv1.ListInvoicesResponse, error) {
	invoices, err := s.svc.ListInvoices(ctx, req.GetUserId())
	if err != nil {
		return nil, mapSubDomainError(err)
	}

	protoInvoices := make([]*subscriptionv1.Invoice, 0, len(invoices))
	for _, inv := range invoices {
		protoInvoices = append(protoInvoices, domainInvoiceToProto(inv))
	}

	return &subscriptionv1.ListInvoicesResponse{Invoices: protoInvoices}, nil
}

// --- Webhook RPC ---

func (s *SubscriptionServer) HandleSubscriptionWebhook(ctx context.Context, req *subscriptionv1.HandleSubscriptionWebhookRequest) (*subscriptionv1.HandleSubscriptionWebhookResponse, error) {
	// Parse the raw webhook payload to extract event type and subscription data.
	var event struct {
		Type string `json:"type"`
		Data struct {
			Object struct {
				ID                 string `json:"id"`
				CurrentPeriodStart int64  `json:"current_period_start"`
				CurrentPeriodEnd   int64  `json:"current_period_end"`
				Subscription       string `json:"subscription"`
			} `json:"object"`
		} `json:"data"`
	}

	if err := json.Unmarshal([]byte(req.GetPayload()), &event); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid webhook payload: %v", err)
	}

	// Determine the subscription ID: use object.id for subscription events,
	// object.subscription for invoice events.
	stripeSubID := event.Data.Object.ID
	if event.Data.Object.Subscription != "" {
		stripeSubID = event.Data.Object.Subscription
	}

	var periodStart, periodEnd *time.Time
	if event.Data.Object.CurrentPeriodStart > 0 {
		t := time.Unix(event.Data.Object.CurrentPeriodStart, 0)
		periodStart = &t
	}
	if event.Data.Object.CurrentPeriodEnd > 0 {
		t := time.Unix(event.Data.Object.CurrentPeriodEnd, 0)
		periodEnd = &t
	}

	err := s.svc.HandleSubscriptionWebhook(ctx, event.Type, stripeSubID, periodStart, periodEnd)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "webhook processing failed: %v", err)
	}

	return &subscriptionv1.HandleSubscriptionWebhookResponse{Processed: true}, nil
}

// --- Admin RPCs ---

func (s *SubscriptionServer) AdminListSubscriptions(ctx context.Context, req *subscriptionv1.AdminListSubscriptionsRequest) (*subscriptionv1.AdminListSubscriptionsResponse, error) {
	statusFilter := ""
	if req.StatusFilter != nil {
		statusFilter = subscriptionStatusToString(*req.StatusFilter)
	}

	tierID := ""
	if req.TierId != nil {
		tierID = *req.TierId
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

	subs, totalCount, totalMRR, err := s.svc.AdminListSubscriptions(ctx, statusFilter, tierID, int(page), int(pageSize))
	if err != nil {
		return nil, mapSubDomainError(err)
	}

	protoSubs := make([]*subscriptionv1.Subscription, 0, len(subs))
	for _, sub := range subs {
		protoSubs = append(protoSubs, domainSubscriptionToProto(sub))
	}

	totalPages := int32(0)
	if totalCount > 0 {
		totalPages = (int32(totalCount) + pageSize - 1) / pageSize
	}

	return &subscriptionv1.AdminListSubscriptionsResponse{
		Subscriptions: protoSubs,
		Pagination: &commonv1.PaginationResponse{
			TotalCount: int32(totalCount),
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
			HasNext:    page < totalPages,
		},
		TotalMrrCents: totalMRR,
	}, nil
}

func (s *SubscriptionServer) AdminUpdateTier(ctx context.Context, req *subscriptionv1.AdminUpdateTierRequest) (*subscriptionv1.AdminUpdateTierResponse, error) {
	if req.GetTierId() == "" {
		return nil, status.Error(codes.InvalidArgument, "tier_id is required")
	}

	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.MonthlyPriceCents != nil {
		updates["monthly_price_cents"] = *req.MonthlyPriceCents
	}
	if req.AnnualPriceCents != nil {
		updates["annual_price_cents"] = *req.AnnualPriceCents
	}
	if req.FeeDiscountPercentage != nil {
		updates["fee_discount_percentage"] = *req.FeeDiscountPercentage
	}
	if req.MaxActiveBids != nil {
		updates["max_active_bids"] = *req.MaxActiveBids
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}

	tier, err := s.svc.AdminUpdateTier(ctx, req.GetTierId(), updates)
	if err != nil {
		return nil, mapSubDomainError(err)
	}

	return &subscriptionv1.AdminUpdateTierResponse{
		Tier: domainTierToProto(tier),
	}, nil
}

func (s *SubscriptionServer) AdminGrantSubscription(ctx context.Context, req *subscriptionv1.AdminGrantSubscriptionRequest) (*subscriptionv1.AdminGrantSubscriptionResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if req.GetTierId() == "" {
		return nil, status.Error(codes.InvalidArgument, "tier_id is required")
	}
	if req.GetDurationDays() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "duration_days must be positive")
	}

	sub, err := s.svc.AdminGrantSubscription(ctx, req.GetUserId(), req.GetTierId(), req.GetDurationDays(), req.GetReason())
	if err != nil {
		return nil, mapSubDomainError(err)
	}

	return &subscriptionv1.AdminGrantSubscriptionResponse{
		Subscription: domainSubscriptionToProto(sub),
	}, nil
}

// --- Conversion helpers ---

func domainTierToProto(t *domain.SubscriptionTier) *subscriptionv1.SubscriptionTier {
	if t == nil {
		return nil
	}
	return &subscriptionv1.SubscriptionTier{
		Id:                    t.ID,
		Name:                  t.Name,
		Slug:                  t.Slug,
		MonthlyPriceCents:     t.MonthlyPriceCents,
		AnnualPriceCents:      t.AnnualPriceCents,
		FeeDiscountPercentage: t.FeeDiscountPercentage,
		MaxActiveBids:         t.MaxActiveBids,
		MaxServiceCategories:  t.MaxServiceCategories,
		FeaturedPlacement:     t.FeaturedPlacement,
		AnalyticsAccess:       t.AnalyticsAccess,
		PrioritySupport:       t.PrioritySupport,
		VerifiedBadgeBoost:    t.VerifiedBadgeBoost,
		PortfolioImageLimit:   t.PortfolioImageLimit,
		InstantEnabled:        t.InstantEnabled,
		SortOrder:             t.SortOrder,
		IsActive:              t.IsActive,
		CreatedAt:             timestamppb.New(t.CreatedAt),
	}
}

func domainSubscriptionToProto(sub *domain.Subscription) *subscriptionv1.Subscription {
	if sub == nil {
		return nil
	}

	pb := &subscriptionv1.Subscription{
		Id:                   sub.ID,
		UserId:               sub.UserID,
		TierId:               sub.TierID,
		Status:               stringToSubscriptionStatus(sub.Status),
		BillingInterval:      stringToBillingInterval(sub.BillingInterval),
		CurrentPriceCents:    sub.CurrentPriceCents,
		StripeSubscriptionId: sub.StripeSubscriptionID,
		CreatedAt:            timestamppb.New(sub.CreatedAt),
	}

	if sub.Tier != nil {
		pb.Tier = domainTierToProto(sub.Tier)
	}
	if sub.CurrentPeriodStart != nil {
		pb.CurrentPeriodStart = timestamppb.New(*sub.CurrentPeriodStart)
	}
	if sub.CurrentPeriodEnd != nil {
		pb.CurrentPeriodEnd = timestamppb.New(*sub.CurrentPeriodEnd)
	}
	if sub.TrialEnd != nil {
		pb.TrialEnd = timestamppb.New(*sub.TrialEnd)
	}
	if sub.CancelledAt != nil {
		pb.CancelledAt = timestamppb.New(*sub.CancelledAt)
	}

	return pb
}

func domainInvoiceToProto(inv *domain.Invoice) *subscriptionv1.Invoice {
	if inv == nil {
		return nil
	}

	pb := &subscriptionv1.Invoice{
		Id:              inv.ID,
		SubscriptionId:  inv.SubscriptionID,
		StripeInvoiceId: inv.StripeInvoiceID,
		AmountCents:     inv.AmountCents,
		Status:          inv.Status,
		PdfUrl:          inv.PDFURL,
	}

	if inv.PeriodStart != nil {
		pb.PeriodStart = timestamppb.New(*inv.PeriodStart)
	}
	if inv.PeriodEnd != nil {
		pb.PeriodEnd = timestamppb.New(*inv.PeriodEnd)
	}
	if inv.PaidAt != nil {
		pb.PaidAt = timestamppb.New(*inv.PaidAt)
	}

	return pb
}

// --- Enum conversions ---

func stringToSubscriptionStatus(s string) subscriptionv1.SubscriptionStatus {
	switch s {
	case "active":
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE
	case "past_due":
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_PAST_DUE
	case "cancelled":
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_CANCELLED
	case "expired":
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_EXPIRED
	case "trialing":
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_TRIALING
	default:
		return subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_UNSPECIFIED
	}
}

func billingIntervalToString(bi subscriptionv1.BillingInterval) string {
	switch bi {
	case subscriptionv1.BillingInterval_BILLING_INTERVAL_MONTHLY:
		return "monthly"
	case subscriptionv1.BillingInterval_BILLING_INTERVAL_ANNUAL:
		return "annual"
	default:
		return "monthly"
	}
}

func stringToBillingInterval(s string) subscriptionv1.BillingInterval {
	switch s {
	case "monthly":
		return subscriptionv1.BillingInterval_BILLING_INTERVAL_MONTHLY
	case "annual":
		return subscriptionv1.BillingInterval_BILLING_INTERVAL_ANNUAL
	default:
		return subscriptionv1.BillingInterval_BILLING_INTERVAL_UNSPECIFIED
	}
}

func subscriptionStatusToString(s subscriptionv1.SubscriptionStatus) string {
	switch s {
	case subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE:
		return "active"
	case subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_PAST_DUE:
		return "past_due"
	case subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_CANCELLED:
		return "cancelled"
	case subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_EXPIRED:
		return "expired"
	case subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_TRIALING:
		return "trialing"
	default:
		return ""
	}
}

// mapSubDomainError maps subscription domain errors to gRPC status errors.
func mapSubDomainError(err error) error {
	switch {
	case errors.Is(err, domain.ErrSubscriptionNotFound):
		return status.Error(codes.NotFound, "subscription not found")
	case errors.Is(err, domain.ErrTierNotFound):
		return status.Error(codes.NotFound, "tier not found")
	case errors.Is(err, domain.ErrAlreadySubscribed):
		return status.Error(codes.AlreadyExists, "user already has an active subscription")
	case errors.Is(err, domain.ErrInvalidTierChange):
		return status.Error(codes.InvalidArgument, "invalid tier change")
	case errors.Is(err, domain.ErrNoActiveSubscription):
		return status.Error(codes.FailedPrecondition, "no active subscription")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
