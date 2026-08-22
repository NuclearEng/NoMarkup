package client

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

type fakePaymentServiceClient struct {
	paymentv1.PaymentServiceClient
	listResp    *paymentv1.ListPaymentsResponse
	lastList    *paymentv1.ListPaymentsRequest
	lastRelease *paymentv1.ReleaseEscrowRequest
	releaseN    int
}

func (f *fakePaymentServiceClient) ListPayments(_ context.Context, req *paymentv1.ListPaymentsRequest, _ ...grpc.CallOption) (*paymentv1.ListPaymentsResponse, error) {
	f.lastList = req
	if f.listResp != nil {
		return f.listResp, nil
	}
	return &paymentv1.ListPaymentsResponse{}, nil
}

func (f *fakePaymentServiceClient) ReleaseEscrow(_ context.Context, req *paymentv1.ReleaseEscrowRequest, _ ...grpc.CallOption) (*paymentv1.ReleaseEscrowResponse, error) {
	f.releaseN++
	f.lastRelease = req
	return &paymentv1.ReleaseEscrowResponse{
		Payment: &paymentv1.Payment{
			Id:     req.GetPaymentId(),
			Status: paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED,
		},
	}, nil
}

func TestPaymentClient_ReleaseEscrow_systemInitiated(t *testing.T) {
	t.Parallel()
	fake := &fakePaymentServiceClient{}
	c := &PaymentClient{client: fake}

	err := c.ReleaseEscrow(context.Background(), "pay-1", "auto_release")
	require.NoError(t, err)
	require.NotNil(t, fake.lastRelease)
	assert.True(t, fake.lastRelease.GetSystemInitiated(), "auto-release must use System actor")
	assert.Empty(t, fake.lastRelease.GetActorUserId())
	assert.False(t, fake.lastRelease.GetActorIsAdmin())
	assert.Equal(t, "auto_release", fake.lastRelease.GetReason())
	assert.Equal(t, "pay-1", fake.lastRelease.GetPaymentId())
}

func TestPaymentClient_ListEscrowPaymentIDs_filtersByContract(t *testing.T) {
	t.Parallel()
	fake := &fakePaymentServiceClient{
		listResp: &paymentv1.ListPaymentsResponse{
			Payments: []*paymentv1.Payment{
				{Id: "pay-match", ContractId: "c1", Status: paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW},
				{Id: "pay-other", ContractId: "c2", Status: paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW},
				{Id: "pay-released", ContractId: "c1", Status: paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED},
			},
		},
	}
	c := &PaymentClient{client: fake}

	ids, err := c.ListEscrowPaymentIDs(context.Background(), "cust-1", "c1")
	require.NoError(t, err)
	assert.Equal(t, []string{"pay-match"}, ids)
	require.NotNil(t, fake.lastList)
	assert.Equal(t, "cust-1", fake.lastList.GetUserId())
	assert.Equal(t, "c1", fake.lastList.GetContractId())
	assert.Equal(t, paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW, fake.lastList.GetStatusFilter())
	assert.Equal(t, int32(1), fake.lastList.GetPagination().GetPage())
	assert.Equal(t, int32(100), fake.lastList.GetPagination().GetPageSize())
}
