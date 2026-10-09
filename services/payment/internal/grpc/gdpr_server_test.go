package grpc

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
)

// fakeCustomerClient mirrors the one in the service package — duplicated here
// because go test isolates test packages and we need the same fakes wired
// through the public NewStripeDeleter constructor surface (via
// NewStripeDeleterForTest, defined below).
type fakeCustomerClient struct {
	calls []string
	err   error
}

func (f *fakeCustomerClient) Del(id string, _ *stripe.CustomerParams) (*stripe.Customer, error) {
	f.calls = append(f.calls, id)
	if f.err != nil {
		return nil, f.err
	}
	return &stripe.Customer{ID: id}, nil
}

type fakeAccountClient struct {
	calls []string
	err   error
}

func (f *fakeAccountClient) Del(id string, _ *stripe.AccountParams) (*stripe.Account, error) {
	f.calls = append(f.calls, id)
	if f.err != nil {
		return nil, f.err
	}
	return &stripe.Account{ID: id}, nil
}

func TestServer_DeleteStripeAccounts_NoDeleter(t *testing.T) {
	t.Parallel()
	srv := NewServer(nil)
	_, err := srv.DeleteStripeAccounts(context.Background(), &paymentv1.DeleteStripeAccountsRequest{
		StripeCustomerId: "cus_abc",
	})
	require.Error(t, err)
	assert.Equal(t, codes.FailedPrecondition, status.Code(err))
}

func TestServer_DeleteStripeAccounts_EmptyIDs(t *testing.T) {
	t.Parallel()
	srv := NewServer(nil)
	d := service.NewStripeDeleterForTest(false, &fakeCustomerClient{}, &fakeAccountClient{})
	srv.SetStripeDeleter(d)

	resp, err := srv.DeleteStripeAccounts(context.Background(), &paymentv1.DeleteStripeAccountsRequest{})
	require.NoError(t, err)
	assert.Equal(t, "skipped_no_id", resp.GetCustomerOutcome())
	assert.Equal(t, "skipped_no_id", resp.GetAccountOutcome())
}

func TestServer_DeleteStripeAccounts_BothSucceed(t *testing.T) {
	t.Parallel()
	c := &fakeCustomerClient{}
	a := &fakeAccountClient{}
	srv := NewServer(nil)
	srv.SetStripeDeleter(service.NewStripeDeleterForTest(false, c, a))

	resp, err := srv.DeleteStripeAccounts(context.Background(), &paymentv1.DeleteStripeAccountsRequest{
		StripeCustomerId: "cus_abc",
		StripeAccountId:  "acct_xyz",
	})
	require.NoError(t, err)
	assert.Equal(t, "deleted", resp.GetCustomerOutcome())
	assert.Equal(t, "deleted", resp.GetAccountOutcome())
	assert.Equal(t, []string{"cus_abc"}, c.calls)
	assert.Equal(t, []string{"acct_xyz"}, a.calls)
}

func TestServer_DeleteStripeAccounts_TransientCustomerError(t *testing.T) {
	t.Parallel()
	srv := NewServer(nil)
	srv.SetStripeDeleter(service.NewStripeDeleterForTest(false,
		&fakeCustomerClient{err: errors.New("connection reset")},
		&fakeAccountClient{},
	))

	_, err := srv.DeleteStripeAccounts(context.Background(), &paymentv1.DeleteStripeAccountsRequest{
		StripeCustomerId: "cus_abc",
		StripeAccountId:  "acct_xyz",
	})
	require.Error(t, err)
	assert.Equal(t, codes.Internal, status.Code(err))
}

func TestServer_DeleteStripeAccounts_OpenInvoicesIsNotAnError(t *testing.T) {
	t.Parallel()
	c := &fakeCustomerClient{err: &stripe.Error{
		HTTPStatusCode: 400,
		Type:           stripe.ErrorTypeInvalidRequest,
		Msg:            "Customer has open invoices",
	}}
	a := &fakeAccountClient{}
	srv := NewServer(nil)
	srv.SetStripeDeleter(service.NewStripeDeleterForTest(false, c, a))

	resp, err := srv.DeleteStripeAccounts(context.Background(), &paymentv1.DeleteStripeAccountsRequest{
		StripeCustomerId: "cus_abc",
		StripeAccountId:  "acct_xyz",
	})
	require.NoError(t, err, "skipped outcomes are recorded — they are not gRPC errors")
	assert.Equal(t, "skipped_open_invoices", resp.GetCustomerOutcome())
	assert.Equal(t, "deleted", resp.GetAccountOutcome())
}
