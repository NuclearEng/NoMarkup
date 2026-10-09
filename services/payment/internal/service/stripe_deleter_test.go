package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// fakeCustomerClient lets us script per-call return values without hitting
// the network. It also satisfies customerDeleterClient.
type fakeCustomerClient struct {
	calls []string
	err   error
	out   *stripe.Customer
}

func (f *fakeCustomerClient) Del(id string, _ *stripe.CustomerParams) (*stripe.Customer, error) {
	f.calls = append(f.calls, id)
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

type fakeAccountClient struct {
	calls []string
	err   error
	out   *stripe.Account
}

func (f *fakeAccountClient) Del(id string, _ *stripe.AccountParams) (*stripe.Account, error) {
	f.calls = append(f.calls, id)
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// --- DeleteCustomer ---

func TestStripeDeleter_Customer_Success(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	c := &fakeCustomerClient{out: &stripe.Customer{ID: "cus_abc"}}
	a := &fakeAccountClient{}
	d := newStripeDeleterWithClients(false, c, a)

	out, err := d.DeleteCustomer(ctx, "cus_abc")
	require.NoError(t, err)
	assert.Equal(t, "deleted", out)
	assert.Equal(t, []string{"cus_abc"}, c.calls)
}

func TestStripeDeleter_Customer_OpenInvoices(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	// Stripe surfaces this as invalid_request_error with a descriptive
	// message; the typed code is not stable across API versions, so the
	// classifier reads the message.
	stripeErr := &stripe.Error{
		HTTPStatusCode: 400,
		Type:           stripe.ErrorTypeInvalidRequest,
		Msg:            "Customer cus_abc has open invoices and cannot be deleted",
	}
	c := &fakeCustomerClient{err: stripeErr}
	d := newStripeDeleterWithClients(false, c, &fakeAccountClient{})

	out, err := d.DeleteCustomer(ctx, "cus_abc")
	require.NoError(t, err, "skipped outcomes must not bubble as errors — operator retries manually")
	assert.Equal(t, "skipped_open_invoices", out)
}

func TestStripeDeleter_Customer_NotFound(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	stripeErr := &stripe.Error{
		HTTPStatusCode: 404,
		Code:           stripe.ErrorCodeResourceMissing,
		Type:           stripe.ErrorTypeInvalidRequest,
		Msg:            "No such customer: 'cus_abc'",
	}
	c := &fakeCustomerClient{err: stripeErr}
	d := newStripeDeleterWithClients(false, c, &fakeAccountClient{})

	out, err := d.DeleteCustomer(ctx, "cus_abc")
	require.NoError(t, err)
	assert.Equal(t, "deleted_already_gone", out)
}

func TestStripeDeleter_Customer_Dispute(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	stripeErr := &stripe.Error{
		HTTPStatusCode: 400,
		Type:           stripe.ErrorTypeInvalidRequest,
		Msg:            "Cannot delete customer with active dispute",
	}
	c := &fakeCustomerClient{err: stripeErr}
	d := newStripeDeleterWithClients(false, c, &fakeAccountClient{})

	out, err := d.DeleteCustomer(ctx, "cus_abc")
	require.NoError(t, err)
	assert.Equal(t, "skipped_dispute", out)
}

func TestStripeDeleter_Customer_TransientError(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	c := &fakeCustomerClient{err: errors.New("connection reset by peer")}
	d := newStripeDeleterWithClients(false, c, &fakeAccountClient{})

	out, err := d.DeleteCustomer(ctx, "cus_abc")
	require.Error(t, err, "transient errors bubble up so the cron retries on the next tick")
	assert.Empty(t, out)
}

func TestStripeDeleter_Customer_EmptyID(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	c := &fakeCustomerClient{}
	d := newStripeDeleterWithClients(false, c, &fakeAccountClient{})

	out, err := d.DeleteCustomer(ctx, "")
	require.NoError(t, err)
	assert.Equal(t, "skipped_no_id", out)
	assert.Empty(t, c.calls, "no Stripe call must be made for empty ID")
}

func TestStripeDeleter_Customer_DevMode(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	c := &fakeCustomerClient{}
	d := newStripeDeleterWithClients(true, c, &fakeAccountClient{})

	out, err := d.DeleteCustomer(ctx, "cus_abc")
	require.NoError(t, err)
	assert.Equal(t, "skipped_no_client", out)
	assert.Empty(t, c.calls, "dev mode must not hit Stripe")
}

// --- DeleteConnectAccount ---

func TestStripeDeleter_Account_Success(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	a := &fakeAccountClient{out: &stripe.Account{ID: "acct_xyz"}}
	d := newStripeDeleterWithClients(false, &fakeCustomerClient{}, a)

	out, err := d.DeleteConnectAccount(ctx, "acct_xyz")
	require.NoError(t, err)
	assert.Equal(t, "deleted", out)
	assert.Equal(t, []string{"acct_xyz"}, a.calls)
}

func TestStripeDeleter_Account_Balance(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	stripeErr := &stripe.Error{
		HTTPStatusCode: 400,
		Type:           stripe.ErrorTypeInvalidRequest,
		Msg:            "Account has a positive balance; cannot delete",
	}
	a := &fakeAccountClient{err: stripeErr}
	d := newStripeDeleterWithClients(false, &fakeCustomerClient{}, a)

	out, err := d.DeleteConnectAccount(ctx, "acct_xyz")
	require.NoError(t, err)
	assert.Equal(t, "skipped_balance", out)
}

func TestStripeDeleter_Account_ActiveSubscription(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	stripeErr := &stripe.Error{
		HTTPStatusCode: 400,
		Type:           stripe.ErrorTypeInvalidRequest,
		Msg:            "Account has an active subscription; cannot delete",
	}
	a := &fakeAccountClient{err: stripeErr}
	d := newStripeDeleterWithClients(false, &fakeCustomerClient{}, a)

	out, err := d.DeleteConnectAccount(ctx, "acct_xyz")
	require.NoError(t, err)
	assert.Equal(t, "skipped_balance", out, "active subscription on a Connect account is treated as a balance issue — same retry semantics")
}

func TestStripeDeleter_Account_NotFound(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	stripeErr := &stripe.Error{
		HTTPStatusCode: 404,
		Code:           stripe.ErrorCodeResourceMissing,
		Type:           stripe.ErrorTypeInvalidRequest,
		Msg:            "No such account: 'acct_xyz'",
	}
	a := &fakeAccountClient{err: stripeErr}
	d := newStripeDeleterWithClients(false, &fakeCustomerClient{}, a)

	out, err := d.DeleteConnectAccount(ctx, "acct_xyz")
	require.NoError(t, err)
	assert.Equal(t, "deleted_already_gone", out)
}

func TestStripeDeleter_Account_TransientError(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	a := &fakeAccountClient{err: errors.New("internal server error")}
	d := newStripeDeleterWithClients(false, &fakeCustomerClient{}, a)

	out, err := d.DeleteConnectAccount(ctx, "acct_xyz")
	require.Error(t, err)
	assert.Empty(t, out)
}

func TestStripeDeleter_Account_EmptyID(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	a := &fakeAccountClient{}
	d := newStripeDeleterWithClients(false, &fakeCustomerClient{}, a)

	out, err := d.DeleteConnectAccount(ctx, "")
	require.NoError(t, err)
	assert.Equal(t, "skipped_no_id", out)
	assert.Empty(t, a.calls)
}

// --- classify edge cases ---

func TestClassifyStripeDeleteErr_PlainStringFallback(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		err         error
		kind        classifyKind
		wantOutcome string
		wantRetry   bool
	}{
		{
			name:        "plain-string-no-such-customer",
			err:         errors.New("Stripe API: No such customer cus_xxx"),
			kind:        classifyKindCustomer,
			wantOutcome: "deleted_already_gone",
			wantRetry:   false,
		},
		{
			name:        "plain-string-open-invoice",
			err:         errors.New("customer has 1 open invoice; please settle first"),
			kind:        classifyKindCustomer,
			wantOutcome: "skipped_open_invoices",
			wantRetry:   false,
		},
		{
			name:        "plain-string-balance",
			err:         errors.New("the account has a non-zero balance"),
			kind:        classifyKindAccount,
			wantOutcome: "skipped_balance",
			wantRetry:   false,
		},
		{
			name:        "plain-string-unknown",
			err:         errors.New("something else"),
			kind:        classifyKindCustomer,
			wantOutcome: "",
			wantRetry:   true,
		},
		{
			name:        "nil-err",
			err:         nil,
			kind:        classifyKindCustomer,
			wantOutcome: "deleted",
			wantRetry:   false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			out, retry := classifyStripeDeleteErr(tc.err, tc.kind)
			assert.Equal(t, tc.wantOutcome, out)
			assert.Equal(t, tc.wantRetry, retry)
		})
	}
}
