package handler

import (
	"context"
	"encoding/json"
	"errors"
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

const testApprovePaymentID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

type mockApproveCompletionContractClient struct {
	contractv1.ContractServiceClient
	n       int
	lastReq *contractv1.ApproveCompletionRequest
	err     error
}

func (m *mockApproveCompletionContractClient) ApproveCompletion(_ context.Context, req *contractv1.ApproveCompletionRequest, _ ...grpc.CallOption) (*contractv1.ApproveCompletionResponse, error) {
	m.n++
	m.lastReq = req
	if m.err != nil {
		return nil, m.err
	}
	return &contractv1.ApproveCompletionResponse{
		Contract: &contractv1.Contract{
			Id:         req.GetContractId(),
			CustomerId: req.GetCustomerId(),
			ProviderId: testProviderID,
			Status:     contractv1.ContractStatus_CONTRACT_STATUS_COMPLETED,
		},
	}, nil
}

type mockApproveCompletionPaymentClient struct {
	paymentv1.PaymentServiceClient
	listFn     func(ctx context.Context, req *paymentv1.ListPaymentsRequest) (*paymentv1.ListPaymentsResponse, error)
	releaseFn  func(ctx context.Context, req *paymentv1.ReleaseEscrowRequest) (*paymentv1.ReleaseEscrowResponse, error)
	listN      int
	releaseN   int
	lastList   *paymentv1.ListPaymentsRequest
	releases   []*paymentv1.ReleaseEscrowRequest
	listErr    error
	releaseErr error
	listPays   []*paymentv1.Payment
}

func (m *mockApproveCompletionPaymentClient) ListPayments(ctx context.Context, req *paymentv1.ListPaymentsRequest, _ ...grpc.CallOption) (*paymentv1.ListPaymentsResponse, error) {
	m.listN++
	m.lastList = req
	if m.listFn != nil {
		return m.listFn(ctx, req)
	}
	if m.listErr != nil {
		return nil, m.listErr
	}
	return &paymentv1.ListPaymentsResponse{Payments: m.listPays}, nil
}

func (m *mockApproveCompletionPaymentClient) ReleaseEscrow(ctx context.Context, req *paymentv1.ReleaseEscrowRequest, _ ...grpc.CallOption) (*paymentv1.ReleaseEscrowResponse, error) {
	m.releaseN++
	m.releases = append(m.releases, req)
	if m.releaseFn != nil {
		return m.releaseFn(ctx, req)
	}
	if m.releaseErr != nil {
		return nil, m.releaseErr
	}
	return &paymentv1.ReleaseEscrowResponse{
		Payment: &paymentv1.Payment{
			Id:                  req.GetPaymentId(),
			ContractId:          testContractID,
			CustomerId:          testCustomerID,
			ProviderId:          testProviderID,
			AmountCents:         10000,
			ProviderPayoutCents: 8500,
			Status:              paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED,
		},
	}, nil
}

func approveCompletionRouter(h *ContractHandler) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/v1/contracts/{id}/approve-completion", h.ApproveCompletion)
	return r
}

func approveCompletionRequest(t *testing.T, userID string, roles []string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/contracts/"+testContractID+"/approve-completion", nil)
	if userID != "" {
		req = addClaimsToRequest(req, userID, "actor@example.com", roles)
	}
	return req
}

func escrowPayment(id, contractID string) *paymentv1.Payment {
	return &paymentv1.Payment{
		Id:                  id,
		ContractId:          contractID,
		CustomerId:          testCustomerID,
		ProviderId:          testProviderID,
		AmountCents:         10000,
		ProviderPayoutCents: 8500,
		Status:              paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW,
	}
}

func TestApproveCompletion_releasesEscrowAsCustomer(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		userID        string
		roles         []string
		contractErr   error
		paymentClient bool
		listPays      []*paymentv1.Payment
		listErr       error
		releaseErr    error
		wantStatus    int
		wantApprove   int
		wantList      int
		wantRelease   int
		wantActor     string
	}{
		{
			name:          "customer approve releases escrow as customer actor",
			userID:        testCustomerID,
			roles:         []string{"customer"},
			paymentClient: true,
			listPays:      []*paymentv1.Payment{escrowPayment(testApprovePaymentID, testContractID)},
			wantStatus:    http.StatusOK,
			wantApprove:   1,
			wantList:      1,
			wantRelease:   1,
			wantActor:     testCustomerID,
		},
		{
			name:          "no escrow payment still succeeds",
			userID:        testCustomerID,
			roles:         []string{"customer"},
			paymentClient: true,
			listPays:      nil,
			wantStatus:    http.StatusOK,
			wantApprove:   1,
			wantList:      1,
			wantRelease:   0,
		},
		{
			name:          "escrow for a different contract is not released",
			userID:        testCustomerID,
			roles:         []string{"customer"},
			paymentClient: true,
			listPays:      []*paymentv1.Payment{escrowPayment(testApprovePaymentID, "99999999-9999-4999-8999-999999999999")},
			wantStatus:    http.StatusOK,
			wantApprove:   1,
			wantList:      1,
			wantRelease:   0,
		},
		{
			name:          "already released status is skipped",
			userID:        testCustomerID,
			roles:         []string{"customer"},
			paymentClient: true,
			listPays: []*paymentv1.Payment{{
				Id:         testApprovePaymentID,
				ContractId: testContractID,
				CustomerId: testCustomerID,
				ProviderId: testProviderID,
				Status:     paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED,
			}},
			wantStatus:  http.StatusOK,
			wantApprove: 1,
			wantList:    1,
			wantRelease: 0,
		},
		{
			name:          "refunded status is skipped",
			userID:        testCustomerID,
			roles:         []string{"customer"},
			paymentClient: true,
			listPays: []*paymentv1.Payment{{
				Id:         testApprovePaymentID,
				ContractId: testContractID,
				CustomerId: testCustomerID,
				ProviderId: testProviderID,
				Status:     paymentv1.PaymentStatus_PAYMENT_STATUS_REFUNDED,
			}},
			wantStatus:  http.StatusOK,
			wantApprove: 1,
			wantList:    1,
			wantRelease: 0,
		},
		{
			name:          "ReleaseEscrow FailedPrecondition still returns approved",
			userID:        testCustomerID,
			roles:         []string{"customer"},
			paymentClient: true,
			listPays:      []*paymentv1.Payment{escrowPayment(testApprovePaymentID, testContractID)},
			releaseErr:    status.Error(codes.FailedPrecondition, "invalid status for this operation"),
			wantStatus:    http.StatusOK,
			wantApprove:   1,
			wantList:      1,
			wantRelease:   1,
			wantActor:     testCustomerID,
		},
		{
			name:          "ListPayments error still returns approved",
			userID:        testCustomerID,
			roles:         []string{"customer"},
			paymentClient: true,
			listErr:       errors.New("payment mesh down"),
			wantStatus:    http.StatusOK,
			wantApprove:   1,
			wantList:      1,
			wantRelease:   0,
		},
		{
			name:          "nil payment client still returns approved",
			userID:        testCustomerID,
			roles:         []string{"customer"},
			paymentClient: false,
			wantStatus:    http.StatusOK,
			wantApprove:   1,
			wantList:      0,
			wantRelease:   0,
		},
		{
			name:          "contract RPC failure does not touch escrow",
			userID:        testCustomerID,
			roles:         []string{"customer"},
			contractErr:   status.Error(codes.FailedPrecondition, "contract is not active"),
			paymentClient: true,
			wantStatus:    http.StatusUnprocessableEntity,
			wantApprove:   1,
			wantList:      0,
			wantRelease:   0,
		},
		{
			name:        "unauthorized",
			userID:      "",
			wantStatus:  http.StatusUnauthorized,
			wantApprove: 0,
		},
		{
			name:          "two escrow payments both released",
			userID:        testCustomerID,
			roles:         []string{"customer"},
			paymentClient: true,
			listPays: []*paymentv1.Payment{
				escrowPayment("pay-1", testContractID),
				escrowPayment("pay-2", testContractID),
			},
			wantStatus:  http.StatusOK,
			wantApprove: 1,
			wantList:    1,
			wantRelease: 2,
			wantActor:   testCustomerID,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			cc := &mockApproveCompletionContractClient{err: tc.contractErr}
			h := NewContractHandler(cc, nil, nil)
			var pc *mockApproveCompletionPaymentClient
			if tc.paymentClient {
				pc = &mockApproveCompletionPaymentClient{
					listPays:   tc.listPays,
					listErr:    tc.listErr,
					releaseErr: tc.releaseErr,
				}
				h.SetPaymentClient(pc)
			}

			rec := httptest.NewRecorder()
			approveCompletionRouter(h).ServeHTTP(rec, approveCompletionRequest(t, tc.userID, tc.roles))

			require.Equal(t, tc.wantStatus, rec.Code, "body=%s", rec.Body.String())
			assert.Equal(t, tc.wantApprove, cc.n, "ApproveCompletion RPC calls")
			if pc != nil {
				assert.Equal(t, tc.wantList, pc.listN, "ListPayments calls")
				assert.Equal(t, tc.wantRelease, pc.releaseN, "ReleaseEscrow calls")
				for _, rel := range pc.releases {
					assert.Equal(t, tc.wantActor, rel.GetActorUserId())
					assert.NotEqual(t, testProviderID, rel.GetActorUserId(), "provider must never be the release actor")
					assert.False(t, rel.GetSystemInitiated(), "customer path must not set SystemInitiated")
					assert.False(t, rel.GetActorIsAdmin(), "customer path must not set ActorIsAdmin")
					assert.Equal(t, "completion_approved", rel.GetReason())
				}
				if tc.wantList > 0 && pc.lastList != nil {
					assert.Equal(t, testCustomerID, pc.lastList.GetUserId())
					assert.Equal(t, testContractID, pc.lastList.GetContractId())
					assert.Equal(t, paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW, pc.lastList.GetStatusFilter())
				}
			}
			if tc.wantStatus == http.StatusOK {
				var body map[string]interface{}
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
				assert.Equal(t, testContractID, body["id"])
			}
		})
	}
}

func TestApproveCompletion_secondCallDoesNotDoubleReleaseWhenContractInactive(t *testing.T) {
	t.Parallel()
	cc := &mockApproveCompletionContractClient{}
	pc := &mockApproveCompletionPaymentClient{
		listPays: []*paymentv1.Payment{escrowPayment(testApprovePaymentID, testContractID)},
	}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)
	router := approveCompletionRouter(h)

	rec1 := httptest.NewRecorder()
	router.ServeHTTP(rec1, approveCompletionRequest(t, testCustomerID, []string{"customer"}))
	require.Equal(t, http.StatusOK, rec1.Code)
	require.Equal(t, 1, pc.releaseN)

	cc.err = status.Error(codes.FailedPrecondition, "contract is not active")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, approveCompletionRequest(t, testCustomerID, []string{"customer"}))
	assert.Equal(t, http.StatusUnprocessableEntity, rec2.Code)
	assert.Equal(t, 1, pc.releaseN, "inactive second approve must not call ReleaseEscrow again")
}
