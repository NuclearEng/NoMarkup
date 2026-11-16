package handler

import (
	"bytes"
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

	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

const (
	testProcessPaymentID  = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	testProcessContractID = "11111111-1111-4111-8111-111111111111"
	testProcessInstanceID = "22222222-2222-4222-8222-222222222222"
	testProcessCustomerID = "33333333-3333-4333-8333-333333333333"
	testProcessRecurring  = "55555555-5555-4555-8555-555555555555"
)

// mockProcessPaymentClient is a narrow PaymentServiceClient for ProcessPayment.
type mockProcessPaymentClient struct {
	paymentv1.PaymentServiceClient
	processFn  func(ctx context.Context, req *paymentv1.ProcessPaymentRequest) (*paymentv1.ProcessPaymentResponse, error)
	processN   int
	lastProcReq *paymentv1.ProcessPaymentRequest
}

func (m *mockProcessPaymentClient) GetPayment(_ context.Context, req *paymentv1.GetPaymentRequest, _ ...grpc.CallOption) (*paymentv1.GetPaymentResponse, error) {
	return &paymentv1.GetPaymentResponse{
		Payment: &paymentv1.Payment{
			Id:         req.GetPaymentId(),
			CustomerId: testProcessCustomerID,
			Status:     paymentv1.PaymentStatus_PAYMENT_STATUS_PENDING,
		},
	}, nil
}

func (m *mockProcessPaymentClient) ProcessPayment(ctx context.Context, req *paymentv1.ProcessPaymentRequest, _ ...grpc.CallOption) (*paymentv1.ProcessPaymentResponse, error) {
	m.processN++
	m.lastProcReq = req
	if m.processFn != nil {
		return m.processFn(ctx, req)
	}
	return &paymentv1.ProcessPaymentResponse{
		Payment: &paymentv1.Payment{
			Id:                  req.GetPaymentId(),
			ContractId:          testProcessContractID,
			RecurringInstanceId: testProcessInstanceID,
			CustomerId:          testProcessCustomerID,
			AmountCents:         7500,
			Status:              paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW,
		},
	}, nil
}

// mockProcessContractClient is a narrow ContractServiceClient for GetRecurringConfig
// + ResumeRecurring (FR-18.8 resume-on-pay).
type mockProcessContractClient struct {
	contractv1.ContractServiceClient
	getRecurringFn   func(ctx context.Context, req *contractv1.GetRecurringConfigRequest) (*contractv1.GetRecurringConfigResponse, error)
	resumeRecurringFn func(ctx context.Context, req *contractv1.ResumeRecurringRequest) (*contractv1.ResumeRecurringResponse, error)
	getRecurringN    int
	resumeN          int
	lastGetRecurring *contractv1.GetRecurringConfigRequest
	lastResumeReq    *contractv1.ResumeRecurringRequest
}

func (m *mockProcessContractClient) GetRecurringConfig(ctx context.Context, req *contractv1.GetRecurringConfigRequest, _ ...grpc.CallOption) (*contractv1.GetRecurringConfigResponse, error) {
	m.getRecurringN++
	m.lastGetRecurring = req
	if m.getRecurringFn != nil {
		return m.getRecurringFn(ctx, req)
	}
	return &contractv1.GetRecurringConfigResponse{
		Config: &contractv1.RecurringConfig{
			Id:         testProcessRecurring,
			ContractId: req.GetContractId(),
			Status:     "paused",
			RateCents:  7500,
		},
	}, nil
}

func (m *mockProcessContractClient) ResumeRecurring(ctx context.Context, req *contractv1.ResumeRecurringRequest, _ ...grpc.CallOption) (*contractv1.ResumeRecurringResponse, error) {
	m.resumeN++
	m.lastResumeReq = req
	if m.resumeRecurringFn != nil {
		return m.resumeRecurringFn(ctx, req)
	}
	return &contractv1.ResumeRecurringResponse{
		Config: &contractv1.RecurringConfig{
			Id:         req.GetRecurringId(),
			ContractId: testProcessContractID,
			Status:     "active",
			RateCents:  7500,
		},
	}, nil
}

func processPaymentRouter(h *PaymentHandler) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/v1/payments/{id}/process", h.ProcessPayment)
	return r
}

func newProcessPaymentHTTPRequest(t *testing.T, paymentID, customerID string) *http.Request {
	t.Helper()
	body := bytes.NewBufferString(`{"payment_method_id":"pm_test"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/"+paymentID+"/process", body)
	req.Header.Set("Content-Type", "application/json")
	if customerID != "" {
		req = addClaimsToRequest(req, customerID, "cust@example.com", []string{"customer"})
	}
	return req
}

// TestProcessPayment_resumePausedRecurring: capture success with
// recurring_instance_id resumes paused config as the payment customer and
// clears FR-16.7 partial payment_retry_count.
func TestProcessPayment_resumePausedRecurring(t *testing.T) {
	t.Parallel()
	pc := &mockProcessPaymentClient{}
	cc := &mockProcessContractClient{}
	h := NewPaymentHandler(pc, nil)
	h.SetContractClient(cc)
	var resetN int
	h.resetPaymentRetryFn = func(_ context.Context, recurringID string) error {
		resetN++
		assert.Equal(t, testProcessRecurring, recurringID)
		return nil
	}

	rec := httptest.NewRecorder()
	processPaymentRouter(h).ServeHTTP(rec, newProcessPaymentHTTPRequest(t, testProcessPaymentID, testProcessCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, testProcessPaymentID, body["id"])
	assert.Equal(t, "escrow", body["status"])
	assert.Equal(t, testProcessInstanceID, body["recurring_instance_id"])
	assert.Equal(t, true, body["recurring_resumed"])
	assert.Equal(t, "active", body["recurring_status"])
	assert.Equal(t, testProcessRecurring, body["recurring_id"])
	assert.Equal(t, float64(0), body["payment_retry_count"])
	_, hasResumeResidual := body["recurring_resume_residual"]
	assert.False(t, hasResumeResidual)

	require.Equal(t, 1, pc.processN)
	require.Equal(t, 1, cc.getRecurringN)
	require.Equal(t, 1, cc.resumeN)
	assert.Equal(t, 1, resetN, "FR-16.7: visit pay must reset payment_retry_count")
	assert.Equal(t, testProcessContractID, cc.lastGetRecurring.GetContractId())
	assert.Equal(t, testProcessRecurring, cc.lastResumeReq.GetRecurringId())
	assert.Equal(t, testProcessCustomerID, cc.lastResumeReq.GetUserId(), "resume as payment customer, not claims actor")
}

// TestProcessPayment_noRecurringInstanceNoResume: one-shot / milestone payment
// must not call GetRecurringConfig / ResumeRecurring.
func TestProcessPayment_noRecurringInstanceNoResume(t *testing.T) {
	t.Parallel()
	pc := &mockProcessPaymentClient{
		processFn: func(_ context.Context, req *paymentv1.ProcessPaymentRequest) (*paymentv1.ProcessPaymentResponse, error) {
			return &paymentv1.ProcessPaymentResponse{
				Payment: &paymentv1.Payment{
					Id:          req.GetPaymentId(),
					ContractId:  testProcessContractID,
					CustomerId:  testProcessCustomerID,
					AmountCents: 10000,
					Status:      paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW,
					// RecurringInstanceId empty
				},
			}, nil
		},
	}
	cc := &mockProcessContractClient{}
	h := NewPaymentHandler(pc, nil)
	h.SetContractClient(cc)

	rec := httptest.NewRecorder()
	processPaymentRouter(h).ServeHTTP(rec, newProcessPaymentHTTPRequest(t, testProcessPaymentID, testProcessCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "escrow", body["status"])
	_, hasResumed := body["recurring_resumed"]
	assert.False(t, hasResumed)
	assert.Equal(t, 0, cc.getRecurringN)
	assert.Equal(t, 0, cc.resumeN)
}

// TestProcessPayment_alreadyActiveNoResumeRPC: config active → surface status,
// do not call ResumeRecurring.
func TestProcessPayment_alreadyActiveNoResumeRPC(t *testing.T) {
	t.Parallel()
	pc := &mockProcessPaymentClient{}
	cc := &mockProcessContractClient{
		getRecurringFn: func(_ context.Context, req *contractv1.GetRecurringConfigRequest) (*contractv1.GetRecurringConfigResponse, error) {
			return &contractv1.GetRecurringConfigResponse{
				Config: &contractv1.RecurringConfig{
					Id:         testProcessRecurring,
					ContractId: req.GetContractId(),
					Status:     "active",
					RateCents:  7500,
				},
			}, nil
		},
	}
	h := NewPaymentHandler(pc, nil)
	h.SetContractClient(cc)

	rec := httptest.NewRecorder()
	processPaymentRouter(h).ServeHTTP(rec, newProcessPaymentHTTPRequest(t, testProcessPaymentID, testProcessCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "active", body["recurring_status"])
	assert.Equal(t, false, body["recurring_resumed"])
	assert.Equal(t, 0, cc.resumeN)
}

// TestProcessPayment_resumeFailsSoft: ResumeRecurring error must not fail
// payment; surface recurring_resume_residual only.
func TestProcessPayment_resumeFailsSoft(t *testing.T) {
	t.Parallel()
	pc := &mockProcessPaymentClient{}
	cc := &mockProcessContractClient{
		resumeRecurringFn: func(_ context.Context, _ *contractv1.ResumeRecurringRequest) (*contractv1.ResumeRecurringResponse, error) {
			return nil, status.Error(codes.Internal, "resume db down")
		},
	}
	h := NewPaymentHandler(pc, nil)
	h.SetContractClient(cc)

	rec := httptest.NewRecorder()
	processPaymentRouter(h).ServeHTTP(rec, newProcessPaymentHTTPRequest(t, testProcessPaymentID, testProcessCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "payment must succeed; body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "escrow", body["status"])
	assert.Equal(t, testProcessPaymentID, body["id"])
	assert.Equal(t, "resume_failed", body["recurring_resume_residual"])
	assert.Equal(t, "paused", body["recurring_status"])
	assert.Equal(t, testProcessRecurring, body["recurring_id"])
	_, hasResumed := body["recurring_resumed"]
	assert.False(t, hasResumed)
	require.Equal(t, 1, cc.resumeN)
}

// TestProcessPayment_contractClientUnwired: visit payment still returns escrow;
// residual only — never invent money or fail process.
func TestProcessPayment_contractClientUnwired(t *testing.T) {
	t.Parallel()
	pc := &mockProcessPaymentClient{}
	h := NewPaymentHandler(pc, nil)
	// contractClient intentionally nil

	rec := httptest.NewRecorder()
	processPaymentRouter(h).ServeHTTP(rec, newProcessPaymentHTTPRequest(t, testProcessPaymentID, testProcessCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "escrow", body["status"])
	assert.Equal(t, "contract_service_unwired", body["recurring_resume_residual"])
	assert.Equal(t, testProcessInstanceID, body["recurring_instance_id"])
}

// TestProcessPayment_cancelledConfigNoResume: cancelled recurring is not
// force-resumed on visit pay.
func TestProcessPayment_cancelledConfigNoResume(t *testing.T) {
	t.Parallel()
	pc := &mockProcessPaymentClient{}
	cc := &mockProcessContractClient{
		getRecurringFn: func(_ context.Context, req *contractv1.GetRecurringConfigRequest) (*contractv1.GetRecurringConfigResponse, error) {
			return &contractv1.GetRecurringConfigResponse{
				Config: &contractv1.RecurringConfig{
					Id:         testProcessRecurring,
					ContractId: req.GetContractId(),
					Status:     "cancelled",
					RateCents:  7500,
				},
			}, nil
		},
	}
	h := NewPaymentHandler(pc, nil)
	h.SetContractClient(cc)

	rec := httptest.NewRecorder()
	processPaymentRouter(h).ServeHTTP(rec, newProcessPaymentHTTPRequest(t, testProcessPaymentID, testProcessCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "escrow", body["status"])
	assert.Equal(t, "cancelled", body["recurring_status"])
	assert.Equal(t, "not_paused", body["recurring_resume_residual"])
	assert.Equal(t, 0, cc.resumeN)
}

// TestProcessPayment_processRPCFailureDoesNotResume: capture failure must not
// attempt resume (no money).
func TestProcessPayment_processRPCFailureDoesNotResume(t *testing.T) {
	t.Parallel()
	pc := &mockProcessPaymentClient{
		processFn: func(_ context.Context, _ *paymentv1.ProcessPaymentRequest) (*paymentv1.ProcessPaymentResponse, error) {
			return nil, status.Error(codes.FailedPrecondition, "capture failed")
		},
	}
	cc := &mockProcessContractClient{}
	h := NewPaymentHandler(pc, nil)
	h.SetContractClient(cc)

	rec := httptest.NewRecorder()
	processPaymentRouter(h).ServeHTTP(rec, newProcessPaymentHTTPRequest(t, testProcessPaymentID, testProcessCustomerID))

	require.NotEqual(t, http.StatusOK, rec.Code)
	assert.Equal(t, 0, cc.getRecurringN)
	assert.Equal(t, 0, cc.resumeN)
}

// TestProcessPayment_configLookupFailsSoft: GetRecurringConfig error keeps payment.
func TestProcessPayment_configLookupFailsSoft(t *testing.T) {
	t.Parallel()
	pc := &mockProcessPaymentClient{}
	cc := &mockProcessContractClient{
		getRecurringFn: func(_ context.Context, _ *contractv1.GetRecurringConfigRequest) (*contractv1.GetRecurringConfigResponse, error) {
			return nil, status.Error(codes.Unavailable, "job mesh blip")
		},
	}
	h := NewPaymentHandler(pc, nil)
	h.SetContractClient(cc)

	rec := httptest.NewRecorder()
	processPaymentRouter(h).ServeHTTP(rec, newProcessPaymentHTTPRequest(t, testProcessPaymentID, testProcessCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "escrow", body["status"])
	assert.Equal(t, "config_lookup_failed", body["recurring_resume_residual"])
	assert.Equal(t, 0, cc.resumeN)
}

func TestProcessPayment_providerCannotCapture(t *testing.T) {
	t.Parallel()
	pc := &mockProcessPaymentClient{}
	h := NewPaymentHandler(pc, nil)

	rec := httptest.NewRecorder()
	processPaymentRouter(h).ServeHTTP(rec, newProcessPaymentHTTPRequest(t, testProcessPaymentID, "provider-not-the-customer"))

	require.Equal(t, http.StatusForbidden, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, 0, pc.processN)
}
