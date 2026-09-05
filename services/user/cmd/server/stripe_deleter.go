package main

import (
	"context"
	"fmt"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

// stripeDeleterClient is a thin adapter that satisfies
// service.StripeDeleter (in services/user/internal/service/deletion.go) by
// delegating to the payment service's PaymentService/DeleteStripeAccounts
// gRPC method.
//
// Why a wrapper instead of importing payment-service code directly:
//   - The user and payment services are independent Go modules. Pulling
//     payment-service internals into the user binary would invert our
//     service-boundary discipline.
//   - The payment service owns Stripe credentials and dev-mode rules. The
//     user service should never touch stripe-go directly.
//
// The adapter is intentionally small: each call to DeleteCustomer or
// DeleteConnectAccount maps to a single RPC. We pass only the relevant ID
// and discard the other half of the response, which keeps the call
// idempotent under retry. The other side stays agnostic of which kind of
// delete the caller cares about (it always tries both fields it was given,
// but if one is empty it returns "skipped_no_id").
type stripeDeleterClient struct {
	cli paymentv1.PaymentServiceClient
}

func newStripeDeleterClient(cli paymentv1.PaymentServiceClient) *stripeDeleterClient {
	return &stripeDeleterClient{cli: cli}
}

// DeleteCustomer satisfies service.StripeDeleter.
func (c *stripeDeleterClient) DeleteCustomer(ctx context.Context, customerID string) (string, error) {
	if c == nil || c.cli == nil {
		return "skipped_no_client", nil
	}
	resp, err := c.cli.DeleteStripeAccounts(ctx, &paymentv1.DeleteStripeAccountsRequest{
		StripeCustomerId: customerID,
	})
	if err != nil {
		return "", fmt.Errorf("payment service DeleteStripeAccounts (customer): %w", err)
	}
	return resp.GetCustomerOutcome(), nil
}

// DeleteConnectAccount satisfies service.StripeDeleter.
func (c *stripeDeleterClient) DeleteConnectAccount(ctx context.Context, accountID string) (string, error) {
	if c == nil || c.cli == nil {
		return "skipped_no_client", nil
	}
	resp, err := c.cli.DeleteStripeAccounts(ctx, &paymentv1.DeleteStripeAccountsRequest{
		StripeAccountId: accountID,
	})
	if err != nil {
		return "", fmt.Errorf("payment service DeleteStripeAccounts (account): %w", err)
	}
	return resp.GetAccountOutcome(), nil
}
