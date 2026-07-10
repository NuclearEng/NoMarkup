package grpc

import (
	"context"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// SetMarketplaceService wires the goods-marketplace domain service (MON-05/07).
// Without this, ChargeListingWinner and related RPCs remain Unimplemented.
func (s *Server) SetMarketplaceService(svc *service.MarketplaceService) {
	s.marketplaceSvc = svc
}

func (s *Server) requireMarketplace() (*service.MarketplaceService, error) {
	if s.marketplaceSvc == nil {
		return nil, status.Error(codes.Unavailable, "marketplace service not configured")
	}
	return s.marketplaceSvc, nil
}

// ChargeListingWinner creates a PaymentIntent for a pending_payment listing order.
func (s *Server) ChargeListingWinner(ctx context.Context, req *paymentv1.ChargeListingWinnerRequest) (*paymentv1.ChargeListingWinnerResponse, error) {
	ms, err := s.requireMarketplace()
	if err != nil {
		return nil, err
	}
	if req.GetOrderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "order_id is required")
	}
	res, err := ms.ChargeListingWinner(ctx, req.GetOrderId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.ChargeListingWinnerResponse{
		PaymentIntentId: res.PaymentIntentID,
		ClientSecret:    res.ClientSecret,
		AmountCents:     res.AmountCents,
		FeeCents:        res.FeeCents,
		TaxCents:        res.TaxCents,
		TotalCents:      res.TotalCents,
	}, nil
}

// ConfirmListingPickup confirms pickup and releases escrow to the seller.
func (s *Server) ConfirmListingPickup(ctx context.Context, req *paymentv1.ConfirmListingPickupRequest) (*paymentv1.ConfirmListingPickupResponse, error) {
	ms, err := s.requireMarketplace()
	if err != nil {
		return nil, err
	}
	if req.GetOrderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "order_id is required")
	}
	order, err := ms.ConfirmPickup(ctx, req.GetOrderId(), req.GetActorUserId(), req.GetActorRole())
	if err != nil {
		return nil, mapDomainError(err)
	}
	resp := &paymentv1.ConfirmListingPickupResponse{
		Status:            order.EscrowStatus,
		SellerPayoutCents: order.SellerPayoutCents,
	}
	if order.PickupConfirmedAt != nil {
		resp.PickupConfirmedAt = timestamppb.New(*order.PickupConfirmedAt)
	}
	return resp, nil
}

// FileListingDispute freezes a held order for admin resolution.
func (s *Server) FileListingDispute(ctx context.Context, req *paymentv1.FileListingDisputeRequest) (*paymentv1.FileListingDisputeResponse, error) {
	ms, err := s.requireMarketplace()
	if err != nil {
		return nil, err
	}
	if req.GetOrderId() == "" || req.GetBuyerId() == "" {
		return nil, status.Error(codes.InvalidArgument, "order_id and buyer_id are required")
	}
	d, err := ms.FileListingDispute(ctx, req.GetOrderId(), req.GetBuyerId(), req.GetReason(), req.GetDescription())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.FileListingDisputeResponse{
		DisputeId: d.ID,
		Status:    d.Status,
	}, nil
}

// ResolveListingDispute applies an admin resolution (refund/release).
func (s *Server) ResolveListingDispute(ctx context.Context, req *paymentv1.ResolveListingDisputeRequest) (*paymentv1.ResolveListingDisputeResponse, error) {
	ms, err := s.requireMarketplace()
	if err != nil {
		return nil, err
	}
	if req.GetDisputeId() == "" || req.GetAdminId() == "" {
		return nil, status.Error(codes.InvalidArgument, "dispute_id and admin_id are required")
	}
	d, err := ms.ResolveListingDispute(ctx, req.GetDisputeId(), req.GetAdminId(), req.GetResolution(), req.GetNotes(), req.GetRefundToBuyerCents())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.ResolveListingDisputeResponse{
		Status:                d.Status,
		Resolution:            d.Resolution,
		RefundToBuyerCents:    d.RefundToBuyerCents,
		TransferToSellerCents: d.TransferToSellerCents,
	}, nil
}

// AutoReleaseListingOrders releases held orders past the auto-release window.
func (s *Server) AutoReleaseListingOrders(ctx context.Context, req *paymentv1.AutoReleaseListingOrdersRequest) (*paymentv1.AutoReleaseListingOrdersResponse, error) {
	ms, err := s.requireMarketplace()
	if err != nil {
		return nil, err
	}
	limit := int(req.GetBatchLimit())
	if limit <= 0 {
		limit = 100
	}
	n, err := ms.AutoReleaseListingOrders(ctx, limit)
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &paymentv1.AutoReleaseListingOrdersResponse{ReleasedCount: int32(n)}, nil
}
