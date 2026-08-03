package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

// mockInstantPayoutClient is a narrow PaymentServiceClient for InstantPayout
// + GetStripeAccountStatus (verified-provider gate).
type mockInstantPayoutClient struct {
	paymentv1.PaymentServiceClient
	payoutsEnabled bool
	statusErr      error
	instantFn      func(ctx context.Context, req *paymentv1.InstantPayoutRequest) (*paymentv1.InstantPayoutResponse, error)
	instantCalls   int
	lastReq        *paymentv1.InstantPayoutRequest
}

func (m *mockInstantPayoutClient) GetStripeAccountStatus(
	_ context.Context, _ *paymentv1.GetStripeAccountStatusRequest, _ ...grpc.CallOption,
) (*paymentv1.GetStripeAccountStatusResponse, error) {
	if m.statusErr != nil {
		return nil, m.statusErr
	}
	return &paymentv1.GetStripeAccountStatusResponse{PayoutsEnabled: m.payoutsEnabled}, nil
}

func (m *mockInstantPayoutClient) InstantPayout(
	ctx context.Context, req *paymentv1.InstantPayoutRequest, _ ...grpc.CallOption,
) (*paymentv1.InstantPayoutResponse, error) {
	m.instantCalls++
	m.lastReq = req
	if m.instantFn != nil {
		return m.instantFn(ctx, req)
	}
	return &paymentv1.InstantPayoutResponse{
		PayoutId:       "ip-ledger-1",
		StripePayoutId: "po_live_abc",
		AmountCents:    req.GetAmountCents(),
		FeeCents:       750,
		NetCents:       req.GetAmountCents() - 750,
		Status:         "completed",
	}, nil
}

func TestInstantPayout_callsPaymentService(t *testing.T) {
	t.Parallel()

	mock := &mockInstantPayoutClient{payoutsEnabled: true}
	h := NewPaymentHandler(mock, nil)

	body := bytes.NewBufferString(`{"amount_cents":50000}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/instant-payout", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-test-1")
	req = addClaimsToRequest(req, "prov-1111-1111-1111-111111111111", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()

	h.InstantPayout(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, 1, mock.instantCalls)
	require.NotNil(t, mock.lastReq)
	assert.Equal(t, "prov-1111-1111-1111-111111111111", mock.lastReq.GetProviderId())
	assert.Equal(t, int64(50000), mock.lastReq.GetAmountCents())
	assert.Equal(t, "idem-test-1", mock.lastReq.GetIdempotencyKey())

	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, "ip-ledger-1", resp["payout_id"])
	assert.Equal(t, float64(50000), resp["amount_cents"])
	assert.Equal(t, "completed", resp["status"])
	assert.Equal(t, "Within minutes", resp["estimated_arrival"])
}

func TestInstantPayout_nilClientIs503(t *testing.T) {
	t.Parallel()

	h := NewPaymentHandler(nil, nil)
	body := bytes.NewBufferString(`{"amount_cents":10000}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/instant-payout", body)
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "prov-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()

	h.InstantPayout(rec, req)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, "body=%s", rec.Body.String())
}

func TestInstantPayout_payoutsDisabledIs403(t *testing.T) {
	t.Parallel()

	mock := &mockInstantPayoutClient{payoutsEnabled: false}
	h := NewPaymentHandler(mock, nil)

	body := bytes.NewBufferString(`{"amount_cents":10000}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/instant-payout", body)
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "prov-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()

	h.InstantPayout(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, 0, mock.instantCalls, "must not call InstantPayout when payouts disabled")
}

func TestInstantPayout_serviceFailedPreconditionIs422(t *testing.T) {
	t.Parallel()

	mock := &mockInstantPayoutClient{
		payoutsEnabled: true,
		instantFn: func(_ context.Context, _ *paymentv1.InstantPayoutRequest) (*paymentv1.InstantPayoutResponse, error) {
			return nil, status.Error(codes.FailedPrecondition, "instant payout exceeds your available cleared balance")
		},
	}
	h := NewPaymentHandler(mock, nil)

	body := bytes.NewBufferString(`{"amount_cents":50000}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/instant-payout", body)
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "prov-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()

	h.InstantPayout(rec, req)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, 1, mock.instantCalls)
}

func TestInstantPayout_serviceInternalIs500NotFakeSuccess(t *testing.T) {
	t.Parallel()

	// Simulates Stripe failure with live keys: payment service returns Internal,
	// gateway must never 200 with a synthetic payout id.
	mock := &mockInstantPayoutClient{
		payoutsEnabled: true,
		instantFn: func(_ context.Context, _ *paymentv1.InstantPayoutRequest) (*paymentv1.InstantPayoutResponse, error) {
			return nil, status.Error(codes.Internal, "internal error")
		},
	}
	h := NewPaymentHandler(mock, nil)

	body := bytes.NewBufferString(`{"amount_cents":10000}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/instant-payout", body)
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "prov-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()

	h.InstantPayout(rec, req)
	assert.Equal(t, http.StatusInternalServerError, rec.Code, "body=%s", rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "payout_dev_")
	assert.NotContains(t, rec.Body.String(), "payout_id")
}

func TestInstantPayout_rejectsNonPositiveAmount(t *testing.T) {
	t.Parallel()

	mock := &mockInstantPayoutClient{payoutsEnabled: true}
	h := NewPaymentHandler(mock, nil)

	body := bytes.NewBufferString(`{"amount_cents":0}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/instant-payout", body)
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "prov-1", "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()

	h.InstantPayout(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, 0, mock.instantCalls)
}
