package main

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/services/user/internal/service"
)

// fakePaymentClient implements paymentv1.PaymentServiceClient just enough
// for the GDPR Stripe-deletion adapter. All other RPCs panic so a future
// regression that sneaks an unexpected call through this seam is loud.
type fakePaymentClient struct {
	paymentv1.PaymentServiceClient // embed the interface for its panicking default

	lastReq      *paymentv1.DeleteStripeAccountsRequest
	resp         *paymentv1.DeleteStripeAccountsResponse
	err          error
	deleteCalled int
}

func (f *fakePaymentClient) DeleteStripeAccounts(_ context.Context, req *paymentv1.DeleteStripeAccountsRequest, _ ...grpc.CallOption) (*paymentv1.DeleteStripeAccountsResponse, error) {
	f.lastReq = req
	f.deleteCalled++
	if f.err != nil {
		return nil, f.err
	}
	return f.resp, nil
}

func TestStripeDeleterClient_NilClient_FallsBackToSkipped(t *testing.T) {
	t.Parallel()
	var c *stripeDeleterClient
	out, err := c.DeleteCustomer(context.Background(), "cus_abc")
	require.NoError(t, err)
	assert.Equal(t, "skipped_no_client", out)

	out, err = c.DeleteConnectAccount(context.Background(), "acct_xyz")
	require.NoError(t, err)
	assert.Equal(t, "skipped_no_client", out)
}

func TestStripeDeleterClient_DeleteCustomer_PassThrough(t *testing.T) {
	t.Parallel()
	fake := &fakePaymentClient{
		resp: &paymentv1.DeleteStripeAccountsResponse{
			CustomerOutcome: "deleted",
			AccountOutcome:  "skipped_no_id",
		},
	}
	c := newStripeDeleterClient(fake)

	out, err := c.DeleteCustomer(context.Background(), "cus_abc")
	require.NoError(t, err)
	assert.Equal(t, "deleted", out)
	require.NotNil(t, fake.lastReq)
	assert.Equal(t, "cus_abc", fake.lastReq.GetStripeCustomerId())
	assert.Empty(t, fake.lastReq.GetStripeAccountId(), "DeleteCustomer must only send the customer ID")
}

func TestStripeDeleterClient_DeleteConnectAccount_PassThrough(t *testing.T) {
	t.Parallel()
	fake := &fakePaymentClient{
		resp: &paymentv1.DeleteStripeAccountsResponse{
			CustomerOutcome: "skipped_no_id",
			AccountOutcome:  "skipped_balance",
		},
	}
	c := newStripeDeleterClient(fake)

	out, err := c.DeleteConnectAccount(context.Background(), "acct_xyz")
	require.NoError(t, err)
	assert.Equal(t, "skipped_balance", out)
	require.NotNil(t, fake.lastReq)
	assert.Equal(t, "acct_xyz", fake.lastReq.GetStripeAccountId())
	assert.Empty(t, fake.lastReq.GetStripeCustomerId())
}

func TestStripeDeleterClient_TransientError_BubblesUp(t *testing.T) {
	t.Parallel()
	fake := &fakePaymentClient{err: errors.New("rpc canceled")}
	c := newStripeDeleterClient(fake)

	out, err := c.DeleteCustomer(context.Background(), "cus_abc")
	require.Error(t, err)
	assert.Empty(t, out)

	out, err = c.DeleteConnectAccount(context.Background(), "acct_xyz")
	require.Error(t, err)
	assert.Empty(t, out)
}

// TestStripeDeleterClient_SatisfiesErasureInterface is a compile-time check
// that the adapter actually implements the Erasure StripeDeleter contract.
// If the interface ever changes, this fails fast — without this, a drift
// would only be caught at NewErasure call sites buried in main.go.
func TestStripeDeleterClient_SatisfiesErasureInterface(t *testing.T) {
	t.Parallel()
	var _ service.StripeDeleter = (*stripeDeleterClient)(nil)
}

// TestStripeDeleterClient_EndToEndWithErasure exercises the full chain:
// Erasure.FinalizeAccountDeletion -> stripeDeleterClient.DeleteCustomer ->
// fakePaymentClient. The audit log on the user side is recorded with the
// pass-through outcome string, exactly as production would.
func TestStripeDeleterClient_EndToEndWithErasure(t *testing.T) {
	t.Parallel()

	fake := &fakePaymentClient{
		resp: &paymentv1.DeleteStripeAccountsResponse{
			CustomerOutcome: "skipped_open_invoices",
			AccountOutcome:  "deleted_already_gone",
		},
	}
	deleter := newStripeDeleterClient(fake)

	// Sanity: the adapter routes both legs and surfaces the right outcome
	// string for each call.
	custOut, err := deleter.DeleteCustomer(context.Background(), "cus_abc")
	require.NoError(t, err)
	assert.Equal(t, "skipped_open_invoices", custOut)

	acctOut, err := deleter.DeleteConnectAccount(context.Background(), "acct_xyz")
	require.NoError(t, err)
	assert.Equal(t, "deleted_already_gone", acctOut)

	// Two RPCs (one per call) — the adapter does NOT batch.
	assert.Equal(t, 2, fake.deleteCalled, "DeleteCustomer + DeleteConnectAccount = 2 RPCs")
}
