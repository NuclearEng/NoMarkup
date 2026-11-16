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

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

const (
	testReleasePaymentID  = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	testReleaseContractID = "11111111-1111-4111-8111-111111111111"
	testReleaseCustomerID = "33333333-3333-4333-8333-333333333333"
	testReleaseProviderID = "44444444-4444-4444-8444-444444444444"
)

type mockReleasePaymentClient struct {
	paymentv1.PaymentServiceClient
	contractID string
	getN       int
	releaseN   int
	getErr     error
	releaseErr error
}

func (m *mockReleasePaymentClient) GetPayment(_ context.Context, req *paymentv1.GetPaymentRequest, _ ...grpc.CallOption) (*paymentv1.GetPaymentResponse, error) {
	m.getN++
	if m.getErr != nil {
		return nil, m.getErr
	}
	return &paymentv1.GetPaymentResponse{
		Payment: &paymentv1.Payment{
			Id:                  req.GetPaymentId(),
			ContractId:          m.contractID,
			CustomerId:          testReleaseCustomerID,
			ProviderId:          testReleaseProviderID,
			AmountCents:         10000,
			ProviderPayoutCents: 8500,
			Status:              paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW,
		},
	}, nil
}

func (m *mockReleasePaymentClient) ReleaseEscrow(_ context.Context, req *paymentv1.ReleaseEscrowRequest, _ ...grpc.CallOption) (*paymentv1.ReleaseEscrowResponse, error) {
	m.releaseN++
	if m.releaseErr != nil {
		return nil, m.releaseErr
	}
	return &paymentv1.ReleaseEscrowResponse{
		Payment: &paymentv1.Payment{
			Id:                  req.GetPaymentId(),
			ContractId:          m.contractID,
			CustomerId:          testReleaseCustomerID,
			ProviderId:          testReleaseProviderID,
			AmountCents:         10000,
			ProviderPayoutCents: 8500,
			Status:              paymentv1.PaymentStatus_PAYMENT_STATUS_RELEASED,
		},
	}, nil
}

func releasePaymentRouter(h *PaymentHandler) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/v1/payments/{id}/release", h.ReleasePayment)
	return r
}

func newReleasePaymentRequest(t *testing.T, userID string, roles []string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/"+testReleasePaymentID+"/release",
		bytes.NewBufferString(`{"reason":"completion_approved"}`))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, userID, "actor@example.com", roles)
	return req
}

func TestReleasePayment_proofOfWorkGate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		roles      []string
		contractID string
		evidence   *struct {
			ready   bool
			missing []string
		}
		wantStatus  int
		wantRelease int
		wantGet     int
		wantMissing []string
	}{
		{
			name:        "goods payment skips gate",
			roles:       []string{"customer"},
			contractID:  "",
			wantStatus:  http.StatusOK,
			wantRelease: 1,
			wantGet:     1,
		},
		{
			name:       "admin skips gate even when not ready",
			roles:      []string{"admin"},
			contractID: testReleaseContractID,
			evidence: &struct {
				ready   bool
				missing []string
			}{ready: false, missing: []string{proofMissingCheckIn, proofMissingAfterPhoto}},
			wantStatus:  http.StatusOK,
			wantRelease: 1,
			wantGet:     0,
		},
		{
			name:       "customer missing check-in and after-photo",
			roles:      []string{"customer"},
			contractID: testReleaseContractID,
			evidence: &struct {
				ready   bool
				missing []string
			}{ready: false, missing: []string{proofMissingCheckIn, proofMissingAfterPhoto}},
			wantStatus:  http.StatusConflict,
			wantRelease: 0,
			wantGet:     1,
			wantMissing: []string{proofMissingCheckIn, proofMissingAfterPhoto},
		},
		{
			name:       "customer missing after-photo only",
			roles:      []string{"customer"},
			contractID: testReleaseContractID,
			evidence: &struct {
				ready   bool
				missing []string
			}{ready: false, missing: []string{proofMissingAfterPhoto}},
			wantStatus:  http.StatusConflict,
			wantRelease: 0,
			wantGet:     1,
			wantMissing: []string{proofMissingAfterPhoto},
		},
		{
			name:       "customer ready releases",
			roles:      []string{"customer"},
			contractID: testReleaseContractID,
			evidence: &struct {
				ready   bool
				missing []string
			}{ready: true, missing: []string{}},
			wantStatus:  http.StatusOK,
			wantRelease: 1,
			wantGet:     1,
		},
		{
			name:        "nil db fail closed",
			roles:       []string{"customer"},
			contractID:  testReleaseContractID,
			wantStatus:  http.StatusConflict,
			wantRelease: 0,
			wantGet:     1,
			wantMissing: []string{proofMissingCheckIn, proofMissingAfterPhoto},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			pc := &mockReleasePaymentClient{contractID: tc.contractID}
			h := NewPaymentHandler(pc, nil)
			if tc.evidence != nil {
				ev := *tc.evidence
				h.workEvidenceFn = func(_ context.Context, contractID string) (bool, []string, error) {
					assert.Equal(t, testReleaseContractID, contractID)
					return ev.ready, ev.missing, nil
				}
			}

			rec := httptest.NewRecorder()
			releasePaymentRouter(h).ServeHTTP(rec, newReleasePaymentRequest(t, testReleaseCustomerID, tc.roles))

			require.Equal(t, tc.wantStatus, rec.Code, "body=%s", rec.Body.String())
			assert.Equal(t, tc.wantRelease, pc.releaseN, "ReleaseEscrow calls")
			assert.Equal(t, tc.wantGet, pc.getN, "GetPayment calls")

			if tc.wantStatus == http.StatusConflict {
				var body map[string]interface{}
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
				assert.Equal(t, "proof of work required", body["error"])
				got, ok := body["missing"].([]interface{})
				require.True(t, ok, "missing must be a JSON array")
				require.Len(t, got, len(tc.wantMissing))
				for i, want := range tc.wantMissing {
					assert.Equal(t, want, got[i])
				}
			}
		})
	}
}

func TestReleasePayment_unauthorized(t *testing.T) {
	t.Parallel()
	h := NewPaymentHandler(&mockReleasePaymentClient{}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/"+testReleasePaymentID+"/release",
		bytes.NewBufferString(`{"reason":"completion_approved"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	releasePaymentRouter(h).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}
