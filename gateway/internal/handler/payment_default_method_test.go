package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

type mockSetDefaultPMClient struct {
	paymentv1.PaymentServiceClient
	calls   int
	lastReq *paymentv1.SetDefaultPaymentMethodRequest
	fn      func(ctx context.Context, req *paymentv1.SetDefaultPaymentMethodRequest) (*paymentv1.SetDefaultPaymentMethodResponse, error)
}

func (m *mockSetDefaultPMClient) SetDefaultPaymentMethod(
	ctx context.Context, req *paymentv1.SetDefaultPaymentMethodRequest, _ ...grpc.CallOption,
) (*paymentv1.SetDefaultPaymentMethodResponse, error) {
	m.calls++
	m.lastReq = req
	if m.fn != nil {
		return m.fn(ctx, req)
	}
	return &paymentv1.SetDefaultPaymentMethodResponse{}, nil
}

func TestSetDefaultPaymentMethod_unauthorizedWithoutClaims(t *testing.T) {
	t.Parallel()

	mock := &mockSetDefaultPMClient{}
	h := NewPaymentHandler(mock, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/payments/methods/pm_1/default", nil)
	req = withChiURLParam(req, "id", "pm_1")
	rec := httptest.NewRecorder()

	h.SetDefaultPaymentMethod(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, 0, mock.calls)
}

func TestSetDefaultPaymentMethod_badRequestMissingID(t *testing.T) {
	t.Parallel()

	mock := &mockSetDefaultPMClient{}
	h := NewPaymentHandler(mock, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/payments/methods//default", nil)
	req = addClaimsToRequest(req, "user-1", "u@example.com", []string{"customer"})
	rec := httptest.NewRecorder()

	h.SetDefaultPaymentMethod(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, 0, mock.calls)
}

func TestSetDefaultPaymentMethod_usesJWTCustomerID(t *testing.T) {
	t.Parallel()

	mock := &mockSetDefaultPMClient{}
	h := NewPaymentHandler(mock, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/payments/methods/pm_owned/default", nil)
	req = withChiURLParam(req, "id", "pm_owned")
	req = addClaimsToRequest(req, "user-jwt", "u@example.com", []string{"customer"})
	rec := httptest.NewRecorder()

	h.SetDefaultPaymentMethod(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	require.Equal(t, 1, mock.calls)
	require.NotNil(t, mock.lastReq)
	assert.Equal(t, "user-jwt", mock.lastReq.GetCustomerId())
	assert.Equal(t, "pm_owned", mock.lastReq.GetPaymentMethodId())

	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, true, resp["is_default"])
}
