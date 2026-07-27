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

	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

const (
	testContractID = "11111111-1111-4111-8111-111111111111"
	testInstanceID = "22222222-2222-4222-8222-222222222222"
	testCustomerID = "33333333-3333-4333-8333-333333333333"
)

const testProviderID = "44444444-4444-4444-8444-444444444444"

// mockApproveContractClient is a narrow ContractServiceClient for
// ApproveRecurringInstance / CompleteRecurringInstance / GetContract.
type mockApproveContractClient struct {
	contractv1.ContractServiceClient
	approveFn  func(ctx context.Context, req *contractv1.ApproveRecurringInstanceRequest) (*contractv1.ApproveRecurringInstanceResponse, error)
	completeFn func(ctx context.Context, req *contractv1.CompleteRecurringInstanceRequest) (*contractv1.CompleteRecurringInstanceResponse, error)
	getFn      func(ctx context.Context, req *contractv1.GetContractRequest) (*contractv1.GetContractResponse, error)
	calls      int
	lastReq    *contractv1.ApproveRecurringInstanceRequest
	completeN  int
	getN       int
}

func (m *mockApproveContractClient) ApproveRecurringInstance(ctx context.Context, req *contractv1.ApproveRecurringInstanceRequest, _ ...grpc.CallOption) (*contractv1.ApproveRecurringInstanceResponse, error) {
	m.calls++
	m.lastReq = req
	if m.approveFn != nil {
		return m.approveFn(ctx, req)
	}
	return &contractv1.ApproveRecurringInstanceResponse{
		Instance: &contractv1.RecurringInstance{
			Id:          req.GetInstanceId(),
			Status:      "approved",
			AmountCents: 7500,
		},
	}, nil
}

func (m *mockApproveContractClient) CompleteRecurringInstance(ctx context.Context, req *contractv1.CompleteRecurringInstanceRequest, _ ...grpc.CallOption) (*contractv1.CompleteRecurringInstanceResponse, error) {
	m.completeN++
	if m.completeFn != nil {
		return m.completeFn(ctx, req)
	}
	return &contractv1.CompleteRecurringInstanceResponse{
		Instance: &contractv1.RecurringInstance{
			Id:           req.GetInstanceId(),
			Status:       "completed",
			AmountCents:  7500,
			AutoApproved: false,
		},
	}, nil
}

func (m *mockApproveContractClient) GetContract(ctx context.Context, req *contractv1.GetContractRequest, _ ...grpc.CallOption) (*contractv1.GetContractResponse, error) {
	m.getN++
	if m.getFn != nil {
		return m.getFn(ctx, req)
	}
	return &contractv1.GetContractResponse{
		Contract: &contractv1.Contract{
			Id:         req.GetContractId(),
			CustomerId: testCustomerID,
			ProviderId: testProviderID,
		},
	}, nil
}

// mockApprovePaymentClient is a narrow PaymentServiceClient for CreatePayment.
type mockApprovePaymentClient struct {
	paymentv1.PaymentServiceClient
	createFn func(ctx context.Context, req *paymentv1.CreatePaymentRequest) (*paymentv1.CreatePaymentResponse, error)
	calls    int
	lastReq  *paymentv1.CreatePaymentRequest
}

func (m *mockApprovePaymentClient) CreatePayment(ctx context.Context, req *paymentv1.CreatePaymentRequest, _ ...grpc.CallOption) (*paymentv1.CreatePaymentResponse, error) {
	m.calls++
	m.lastReq = req
	if m.createFn != nil {
		return m.createFn(ctx, req)
	}
	return &paymentv1.CreatePaymentResponse{
		Payment: &paymentv1.Payment{
			Id:                  "pay-real-1",
			ContractId:          req.GetContractId(),
			RecurringInstanceId: req.GetRecurringInstanceId(),
			CustomerId:          req.GetCustomerId(),
			AmountCents:         req.GetAmountCents(),
		},
		ClientSecret: "pi_secret_real",
	}, nil
}

func approveRecurringRouter(h *ContractHandler) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/recurring/instances/{instanceId}/approve", h.ApproveRecurringInstance)
	return r
}

func approveRecurringRequest(t *testing.T, customerID string) *http.Request {
	t.Helper()
	path := "/api/v1/contracts/" + testContractID + "/recurring/instances/" + testInstanceID + "/approve"
	req := httptest.NewRequest(http.MethodPost, path, nil)
	if customerID != "" {
		req = addClaimsToRequest(req, customerID, "cust@example.com", []string{"customer"})
	}
	return req
}

// TestApproveRecurringInstance_paymentServiceUnwiredResidual: approval stands
// with honest payment_residual; never invents payment_id / client_secret.
func TestApproveRecurringInstance_paymentServiceUnwiredResidual(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{}
	h := NewContractHandler(cc, nil, nil)
	// paymentClient intentionally nil

	rec := httptest.NewRecorder()
	approveRecurringRouter(h).ServeHTTP(rec, approveRecurringRequest(t, testCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "payment_service_unwired", body["payment_residual"])
	_, hasPayID := body["payment_id"]
	assert.False(t, hasPayID, "must not invent payment_id when payment mesh is unwired")
	_, hasSecret := body["client_secret"]
	assert.False(t, hasSecret, "must not invent client_secret")
	require.Equal(t, 1, cc.calls)
	assert.Equal(t, testCustomerID, cc.lastReq.GetCustomerId())
	assert.Equal(t, testInstanceID, cc.lastReq.GetInstanceId())
}

// TestApproveRecurringInstance_instanceAmountMissingResidual: wired payment
// client but zero amount → residual, no CreatePayment call, no fake money.
func TestApproveRecurringInstance_instanceAmountMissingResidual(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{
		approveFn: func(_ context.Context, req *contractv1.ApproveRecurringInstanceRequest) (*contractv1.ApproveRecurringInstanceResponse, error) {
			return &contractv1.ApproveRecurringInstanceResponse{
				Instance: &contractv1.RecurringInstance{
					Id:          req.GetInstanceId(),
					Status:      "approved",
					AmountCents: 0,
				},
			}, nil
		},
	}
	pc := &mockApprovePaymentClient{}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)

	rec := httptest.NewRecorder()
	approveRecurringRouter(h).ServeHTTP(rec, approveRecurringRequest(t, testCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "instance_amount_missing", body["payment_residual"])
	assert.Equal(t, 0, pc.calls, "must not call CreatePayment without a positive amount")
	_, hasPayID := body["payment_id"]
	assert.False(t, hasPayID)
}

// TestApproveRecurringInstance_createPaymentFailedResidual: CreatePayment
// failure must not roll back approval and must not invent payment_id.
func TestApproveRecurringInstance_createPaymentFailedResidual(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{}
	pc := &mockApprovePaymentClient{
		createFn: func(_ context.Context, _ *paymentv1.CreatePaymentRequest) (*paymentv1.CreatePaymentResponse, error) {
			return nil, status.Error(codes.FailedPrecondition, "amount exceeds contract total")
		},
	}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)

	rec := httptest.NewRecorder()
	approveRecurringRouter(h).ServeHTTP(rec, approveRecurringRequest(t, testCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "approval kept; body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "create_payment_failed", body["payment_residual"])
	assert.NotEmpty(t, body["payment_error"])
	_, hasPayID := body["payment_id"]
	assert.False(t, hasPayID, "must not invent payment_id after CreatePayment failure")
	_, hasSecret := body["client_secret"]
	assert.False(t, hasSecret)
	require.Equal(t, 1, pc.calls)
	assert.Equal(t, "recurring-instance-pay:"+testInstanceID, pc.lastReq.GetIdempotencyKey())
	assert.Equal(t, testContractID, pc.lastReq.GetContractId())
	assert.Equal(t, testInstanceID, pc.lastReq.GetRecurringInstanceId())
	assert.Equal(t, testCustomerID, pc.lastReq.GetCustomerId())
	assert.Equal(t, int64(7500), pc.lastReq.GetAmountCents())
}

// TestApproveRecurringInstance_clientSecretMissingResidual: PI exists without
// confirmable secret → honest residual, real payment_id still returned.
func TestApproveRecurringInstance_clientSecretMissingResidual(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{}
	pc := &mockApprovePaymentClient{
		createFn: func(_ context.Context, req *paymentv1.CreatePaymentRequest) (*paymentv1.CreatePaymentResponse, error) {
			return &paymentv1.CreatePaymentResponse{
				Payment: &paymentv1.Payment{
					Id:                  "pay-no-secret",
					ContractId:          req.GetContractId(),
					RecurringInstanceId: req.GetRecurringInstanceId(),
					AmountCents:         req.GetAmountCents(),
				},
				ClientSecret: "",
			}, nil
		},
	}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)

	rec := httptest.NewRecorder()
	approveRecurringRouter(h).ServeHTTP(rec, approveRecurringRequest(t, testCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "client_secret_missing", body["payment_residual"])
	assert.Equal(t, "pay-no-secret", body["payment_id"])
	_, hasSecret := body["client_secret"]
	assert.False(t, hasSecret, "empty secret must not be emitted as a key clients treat as ready")
}

// TestApproveRecurringInstance_successReturnsRealPayment pins the happy path:
// real payment_id + client_secret, no payment_residual.
func TestApproveRecurringInstance_successReturnsRealPayment(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{}
	pc := &mockApprovePaymentClient{}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)

	rec := httptest.NewRecorder()
	approveRecurringRouter(h).ServeHTTP(rec, approveRecurringRequest(t, testCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "pay-real-1", body["payment_id"])
	assert.Equal(t, "pi_secret_real", body["client_secret"])
	_, hasResidual := body["payment_residual"]
	assert.False(t, hasResidual, "successful PI must not surface a residual")
	inst, ok := body["instance"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, float64(7500), inst["amount_cents"])
}

// TestApproveRecurringInstance_prefersContractPaymentID: if job service already
// returned a payment_id, surface it; CreatePayment still runs when amount known
// and may also attach payment + client_secret from the payment mesh.
func TestApproveRecurringInstance_prefersContractPaymentID(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{
		approveFn: func(_ context.Context, req *contractv1.ApproveRecurringInstanceRequest) (*contractv1.ApproveRecurringInstanceResponse, error) {
			return &contractv1.ApproveRecurringInstanceResponse{
				Instance: &contractv1.RecurringInstance{
					Id:          req.GetInstanceId(),
					Status:      "approved",
					AmountCents: 5000,
				},
				PaymentId: "pay-from-job",
			}, nil
		},
	}
	// No payment client — residual path but payment_id from contract still shown.
	h := NewContractHandler(cc, nil, nil)

	rec := httptest.NewRecorder()
	approveRecurringRouter(h).ServeHTTP(rec, approveRecurringRequest(t, testCustomerID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "pay-from-job", body["payment_id"])
	assert.Equal(t, "payment_service_unwired", body["payment_residual"])
}

func TestApproveRecurringInstance_requiresAuth(t *testing.T) {
	t.Parallel()
	h := NewContractHandler(&mockApproveContractClient{}, nil, nil)
	rec := httptest.NewRecorder()
	approveRecurringRouter(h).ServeHTTP(rec, approveRecurringRequest(t, ""))
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestApproveRecurringInstance_rejectsInvalidContractUUID(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{}
	h := NewContractHandler(cc, nil, nil)
	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/recurring/instances/{instanceId}/approve", h.ApproveRecurringInstance)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/contracts/not-a-uuid/recurring/instances/"+testInstanceID+"/approve", nil)
	req = addClaimsToRequest(req, testCustomerID, "cust@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, 0, cc.calls)
}

func TestApproveRecurringInstance_rejectsInvalidInstanceUUID(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{}
	h := NewContractHandler(cc, nil, nil)
	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/recurring/instances/{instanceId}/approve", h.ApproveRecurringInstance)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/contracts/"+testContractID+"/recurring/instances/bad/approve", nil)
	req = addClaimsToRequest(req, testCustomerID, "cust@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, 0, cc.calls)
}

func completeRecurringRouter(h *ContractHandler) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/recurring/instances/{instanceId}/complete", h.CompleteRecurringInstance)
	return r
}

func completeRecurringRequest(t *testing.T, providerID string) *http.Request {
	t.Helper()
	path := "/api/v1/contracts/" + testContractID + "/recurring/instances/" + testInstanceID + "/complete"
	req := httptest.NewRequest(http.MethodPost, path, nil)
	if providerID != "" {
		req = addClaimsToRequest(req, providerID, "prov@example.com", []string{"provider"})
	}
	return req
}

// TestCompleteRecurringInstance_noAutoApproveSkipsPayment: provider complete
// without auto_approve must not CreatePayment.
func TestCompleteRecurringInstance_noAutoApproveSkipsPayment(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{}
	pc := &mockApprovePaymentClient{}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)

	rec := httptest.NewRecorder()
	completeRecurringRouter(h).ServeHTTP(rec, completeRecurringRequest(t, testProviderID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, 0, pc.calls, "must not CreatePayment without auto_approve")
	assert.Equal(t, 0, cc.getN, "must not GetContract when payment is not needed")
	_, hasPayID := body["payment_id"]
	assert.False(t, hasPayID)
	_, hasSecret := body["client_secret"]
	assert.False(t, hasSecret)
	_, hasResidual := body["payment_residual"]
	assert.False(t, hasResidual)
	require.Equal(t, 1, cc.completeN)
}

// TestCompleteRecurringInstance_autoApproveCreatesPaymentAsCustomer: FR-18
// auto-approve path CreatePayment with contract customer_id (not provider).
func TestCompleteRecurringInstance_autoApproveCreatesPaymentAsCustomer(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{
		completeFn: func(_ context.Context, req *contractv1.CompleteRecurringInstanceRequest) (*contractv1.CompleteRecurringInstanceResponse, error) {
			return &contractv1.CompleteRecurringInstanceResponse{
				Instance: &contractv1.RecurringInstance{
					Id:           req.GetInstanceId(),
					Status:       "completed",
					AmountCents:  7500,
					AutoApproved: true,
				},
			}, nil
		},
	}
	pc := &mockApprovePaymentClient{}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)

	rec := httptest.NewRecorder()
	completeRecurringRouter(h).ServeHTTP(rec, completeRecurringRequest(t, testProviderID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "pay-real-1", body["payment_id"])
	assert.Equal(t, "pi_secret_real", body["client_secret"])
	_, hasResidual := body["payment_residual"]
	assert.False(t, hasResidual)
	require.Equal(t, 1, pc.calls)
	assert.Equal(t, testCustomerID, pc.lastReq.GetCustomerId(), "CreatePayment must use contract customer, not provider actor")
	assert.NotEqual(t, testProviderID, pc.lastReq.GetCustomerId())
	assert.Equal(t, "recurring-instance-pay:"+testInstanceID, pc.lastReq.GetIdempotencyKey())
	assert.Equal(t, testContractID, pc.lastReq.GetContractId())
	assert.Equal(t, testInstanceID, pc.lastReq.GetRecurringInstanceId())
	assert.Equal(t, int64(7500), pc.lastReq.GetAmountCents())
	require.Equal(t, 1, cc.getN)
	inst, ok := body["instance"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, true, inst["auto_approved"])
}

// TestCompleteRecurringInstance_autoApprovePaymentFailKeepsComplete: CreatePayment
// failure must not invent payment_id and must keep 200 + completed instance.
func TestCompleteRecurringInstance_autoApprovePaymentFailKeepsComplete(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{
		completeFn: func(_ context.Context, req *contractv1.CompleteRecurringInstanceRequest) (*contractv1.CompleteRecurringInstanceResponse, error) {
			return &contractv1.CompleteRecurringInstanceResponse{
				Instance: &contractv1.RecurringInstance{
					Id:           req.GetInstanceId(),
					Status:       "completed",
					AmountCents:  7500,
					AutoApproved: true,
				},
			}, nil
		},
	}
	pc := &mockApprovePaymentClient{
		createFn: func(_ context.Context, _ *paymentv1.CreatePaymentRequest) (*paymentv1.CreatePaymentResponse, error) {
			return nil, status.Error(codes.Unavailable, "stripe down")
		},
	}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)

	rec := httptest.NewRecorder()
	completeRecurringRouter(h).ServeHTTP(rec, completeRecurringRequest(t, testProviderID))

	require.Equal(t, http.StatusOK, rec.Code, "completion kept; body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "create_payment_failed", body["payment_residual"])
	assert.NotEmpty(t, body["payment_error"])
	_, hasPayID := body["payment_id"]
	assert.False(t, hasPayID, "must not invent payment_id after CreatePayment failure")
	_, hasSecret := body["client_secret"]
	assert.False(t, hasSecret)
	inst, ok := body["instance"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, true, inst["auto_approved"])
}

// TestCompleteRecurringInstance_autoApproveCustomerUnresolved: GetContract
// failure → residual, completion still 200, no fake money.
func TestCompleteRecurringInstance_autoApproveCustomerUnresolved(t *testing.T) {
	t.Parallel()
	cc := &mockApproveContractClient{
		completeFn: func(_ context.Context, req *contractv1.CompleteRecurringInstanceRequest) (*contractv1.CompleteRecurringInstanceResponse, error) {
			return &contractv1.CompleteRecurringInstanceResponse{
				Instance: &contractv1.RecurringInstance{
					Id:           req.GetInstanceId(),
					Status:       "completed",
					AmountCents:  7500,
					AutoApproved: true,
				},
			}, nil
		},
		getFn: func(_ context.Context, _ *contractv1.GetContractRequest) (*contractv1.GetContractResponse, error) {
			return nil, status.Error(codes.NotFound, "contract not found")
		},
	}
	pc := &mockApprovePaymentClient{}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)

	rec := httptest.NewRecorder()
	completeRecurringRouter(h).ServeHTTP(rec, completeRecurringRequest(t, testProviderID))

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "customer_unresolved", body["payment_residual"])
	assert.Equal(t, 0, pc.calls)
	_, hasPayID := body["payment_id"]
	assert.False(t, hasPayID)
}
