package grpc

import (
	"context"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// SetStripeDeleter wires the GDPR Stripe-deleter adapter onto the aggregate
// gRPC server. May be called once at startup; subsequent calls overwrite
// the previously-set deleter (used in tests).
func (s *Server) SetStripeDeleter(d *service.StripeDeleter) {
	s.stripeDeleter = d
}

// DeleteStripeAccounts is the GDPR-erasure RPC: it deletes the user's
// Stripe Customer and Connect Express account and returns coarse outcome
// strings ("deleted", "skipped_open_invoices", etc.) for the user
// service's audit log. Either ID may be empty; the response field will be
// "skipped_no_id" in that case.
//
// Per docs/operations/gdpr-delete.md, an empty body is also valid (e.g.
// the cron found a user with no Stripe identifiers) — the response is
// ("skipped_no_id", "skipped_no_id") with no Stripe calls made.
//
// On a transient Stripe error (network, 5xx, unrecognized error code) we
// return codes.Internal so the user-service caller surfaces "error: ..."
// in the audit log and the GDPR cron may retry on the next tick.
func (s *Server) DeleteStripeAccounts(ctx context.Context, req *paymentv1.DeleteStripeAccountsRequest) (*paymentv1.DeleteStripeAccountsResponse, error) {
	if s.stripeDeleter == nil {
		return nil, status.Error(codes.FailedPrecondition, "stripe deleter not configured")
	}

	resp := &paymentv1.DeleteStripeAccountsResponse{}

	customerOutcome, err := s.stripeDeleter.DeleteCustomer(ctx, req.GetStripeCustomerId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete stripe customer: %v", err)
	}
	resp.CustomerOutcome = customerOutcome

	accountOutcome, err := s.stripeDeleter.DeleteConnectAccount(ctx, req.GetStripeAccountId())
	if err != nil {
		// Customer was already deleted at this point — surface the partial
		// result via metadata is overkill; the audit log will record the
		// customer outcome via a follow-up call by the user service. For
		// now, return Internal and let the operator retry.
		return nil, status.Errorf(codes.Internal, "delete stripe connect account: %v (customer outcome: %s)", err, customerOutcome)
	}
	resp.AccountOutcome = accountOutcome

	return resp, nil
}
