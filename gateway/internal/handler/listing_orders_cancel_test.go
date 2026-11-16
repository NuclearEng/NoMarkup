package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

// mockCancelUnpaidPaymentClient implements only CancelUnpaidListingOrder.
// Embedding the generated client satisfies the rest of the interface.
type mockCancelUnpaidPaymentClient struct {
	paymentv1.PaymentServiceClient
	cancelFn func(ctx context.Context, req *paymentv1.CancelUnpaidListingOrderRequest) (*paymentv1.CancelUnpaidListingOrderResponse, error)
	calls    int
}

func (m *mockCancelUnpaidPaymentClient) CancelUnpaidListingOrder(ctx context.Context, req *paymentv1.CancelUnpaidListingOrderRequest, _ ...grpc.CallOption) (*paymentv1.CancelUnpaidListingOrderResponse, error) {
	m.calls++
	if m.cancelFn != nil {
		return m.cancelFn(ctx, req)
	}
	return &paymentv1.CancelUnpaidListingOrderResponse{
		OrderId:       req.GetOrderId(),
		ListingId:     "22222222-2222-2222-2222-222222222222",
		EscrowStatus:  "payment_failed",
		ListingStatus: "active",
	}, nil
}

func cancelUnpaidRouter(h *ListingOrdersHandler) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/v1/orders/{id}/cancel-unpaid", h.CancelUnpaidOrder)
	return r
}

func TestCancelUnpaid_requiresAuth(t *testing.T) {
	t.Parallel()
	mock := &mockCancelUnpaidPaymentClient{}
	h := NewListingOrdersHandler(nil)
	h.SetPaymentClient(mock)

	orderID := "11111111-1111-1111-1111-111111111111"
	req := httptest.NewRequest(http.MethodPost, "/api/v1/orders/"+orderID+"/cancel-unpaid", nil)
	rec := httptest.NewRecorder()
	cancelUnpaidRouter(h).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, 0, mock.calls)
}

func TestCancelUnpaid_rejectsNonUUID(t *testing.T) {
	t.Parallel()
	mock := &mockCancelUnpaidPaymentClient{}
	h := NewListingOrdersHandler(nil)
	h.SetPaymentClient(mock)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/orders/not-a-uuid/cancel-unpaid", nil)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "buyer@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	cancelUnpaidRouter(h).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, 0, mock.calls)
}

func TestCancelUnpaid_unwiredPaymentClientIs503(t *testing.T) {
	t.Parallel()
	h := NewListingOrdersHandler(nil)

	orderID := "11111111-1111-1111-1111-111111111111"
	req := httptest.NewRequest(http.MethodPost, "/api/v1/orders/"+orderID+"/cancel-unpaid", nil)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "buyer@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	cancelUnpaidRouter(h).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, "body=%s", rec.Body.String())
	assert.Contains(t, rec.Body.String(), "payments are temporarily unavailable")
}

func TestCancelUnpaid_nilDBWithClientIs503(t *testing.T) {
	t.Parallel()
	mock := &mockCancelUnpaidPaymentClient{}
	h := NewListingOrdersHandler(nil)
	h.SetPaymentClient(mock)

	orderID := "11111111-1111-1111-1111-111111111111"
	req := httptest.NewRequest(http.MethodPost, "/api/v1/orders/"+orderID+"/cancel-unpaid", nil)
	req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "buyer@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	cancelUnpaidRouter(h).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, 0, mock.calls, "must not call the payment service without a database")
}

func TestCancelUnpaid_escrowGateBeforeRPC(t *testing.T) {
	t.Parallel()
	assert.True(t, unpaidCancelAllowed("pending_payment"))
	assert.True(t, unpaidCancelAllowed("payment_failed"), "retry must be able to finish a relist")
	for _, blocked := range []string{"held", "released", "disputed", "pickup_confirmed", ""} {
		assert.False(t, unpaidCancelAllowed(blocked), blocked)
	}
}

func TestCancelUnpaid_grpcFailedPreconditionKeepsServiceMessage(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	msg := "payment can still be captured so the listing stays sold"
	handled := writeCancelUnpaidGRPCError(rec, status.Error(codes.FailedPrecondition, msg))
	require.True(t, handled)
	assert.Equal(t, http.StatusConflict, rec.Code)
	assert.Contains(t, rec.Body.String(), msg)
	assert.NotContains(t, rec.Body.String(), "this order is no longer awaiting payment")
}

func TestCancelUnpaid_grpcPermissionDeniedAndNotFound(t *testing.T) {
	t.Parallel()

	recDenied := httptest.NewRecorder()
	require.True(t, writeCancelUnpaidGRPCError(recDenied, status.Error(codes.PermissionDenied, "only the buyer on this order can cancel it")))
	assert.Equal(t, http.StatusForbidden, recDenied.Code)
	assert.Contains(t, recDenied.Body.String(), "only the buyer on this order can cancel it")

	recMissing := httptest.NewRecorder()
	require.True(t, writeCancelUnpaidGRPCError(recMissing, status.Error(codes.NotFound, "order not found")))
	assert.Equal(t, http.StatusNotFound, recMissing.Code)
	assert.Contains(t, recMissing.Body.String(), "order not found")
}

func TestCancelUnpaid_grpcOtherCodesAreNotMappedHere(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	handled := writeCancelUnpaidGRPCError(rec, status.Error(codes.Internal, "db down"))
	require.False(t, handled)
	assert.Empty(t, rec.Body.String())
}

func TestCancelUnpaidResponseJSONShape(t *testing.T) {
	t.Parallel()
	body, err := json.Marshal(cancelUnpaidOrderResponse{
		OrderID:       "11111111-1111-1111-1111-111111111111",
		ListingID:     "22222222-2222-2222-2222-222222222222",
		EscrowStatus:  "payment_failed",
		ListingStatus: "active",
	})
	require.NoError(t, err)
	var got map[string]interface{}
	require.NoError(t, json.Unmarshal(body, &got))
	assert.Equal(t, map[string]interface{}{
		"order_id":       "11111111-1111-1111-1111-111111111111",
		"listing_id":     "22222222-2222-2222-2222-222222222222",
		"escrow_status":  "payment_failed",
		"listing_status": "active",
	}, got)
}
