package grpc

import (
	"context"
	"errors"
	"strings"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// InstantPayout withdraws cleared provider balance via Stripe Connect Instant
// Payouts. The payment service owns ledger claim-first (MON-10/11) and either
// creates a real Stripe payout or fails closed — never payout_dev_* with live keys.
func (s *Server) InstantPayout(ctx context.Context, req *paymentv1.InstantPayoutRequest) (*paymentv1.InstantPayoutResponse, error) {
	if s.svc == nil {
		return nil, status.Error(codes.Unavailable, "payment service unavailable")
	}
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}
	if req.GetAmountCents() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "amount_cents must be positive")
	}

	result, err := s.svc.InstantPayout(ctx, req.GetProviderId(), req.GetAmountCents(), req.GetIdempotencyKey())
	if err != nil {
		return nil, mapInstantPayoutError(err)
	}

	return &paymentv1.InstantPayoutResponse{
		PayoutId:       result.PayoutID,
		StripePayoutId: result.StripePayoutID,
		AmountCents:    result.AmountCents,
		FeeCents:       result.FeeCents,
		NetCents:       result.NetCents,
		Status:         result.Status,
		Replayed:       result.Replayed,
	}, nil
}

// mapInstantPayoutError maps domain/service errors for the InstantPayout RPC to
// stable gRPC codes + provider-facing messages (gateway writeGRPCError maps
// FailedPrecondition → 422, InvalidArgument → 400, etc.).
func mapInstantPayoutError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, domain.ErrInstantPayoutInsufficientBalance):
		return status.Error(codes.FailedPrecondition, "instant payout exceeds your available cleared balance")
	case errors.Is(err, domain.ErrInstantPayoutDailyCap):
		return status.Error(codes.FailedPrecondition, "amount exceeds the daily instant payout limit")
	case errors.Is(err, domain.ErrStripeAccountNotFound):
		return status.Error(codes.FailedPrecondition, "instant payout unavailable: complete payout verification first")
	case errors.Is(err, domain.ErrInvalidAmount):
		msg := err.Error()
		switch {
		case strings.Contains(msg, "exceeds per-transaction"):
			return status.Error(codes.FailedPrecondition, "amount exceeds the per-transaction instant payout limit")
		case strings.Contains(msg, "net after fee"):
			return status.Error(codes.FailedPrecondition, "amount too small for instant payout after fees")
		default:
			return status.Error(codes.InvalidArgument, "invalid amount")
		}
	default:
		return mapDomainError(err)
	}
}
