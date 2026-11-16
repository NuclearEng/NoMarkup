package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"

	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

type mockCustomFeesClient struct {
	paymentv1.PaymentServiceClient
	listFn       func(ctx context.Context, req *paymentv1.AdminListCustomFeesRequest) (*paymentv1.AdminListCustomFeesResponse, error)
	createFn     func(ctx context.Context, req *paymentv1.AdminCreateCustomFeeRequest) (*paymentv1.AdminCreateCustomFeeResponse, error)
	updateFn     func(ctx context.Context, req *paymentv1.AdminUpdateCustomFeeRequest) (*paymentv1.AdminUpdateCustomFeeResponse, error)
	deactivateFn func(ctx context.Context, req *paymentv1.AdminDeactivateCustomFeeRequest) (*paymentv1.AdminDeactivateCustomFeeResponse, error)
}

func (m *mockCustomFeesClient) AdminListCustomFees(ctx context.Context, req *paymentv1.AdminListCustomFeesRequest, _ ...grpc.CallOption) (*paymentv1.AdminListCustomFeesResponse, error) {
	if m.listFn != nil {
		return m.listFn(ctx, req)
	}
	return &paymentv1.AdminListCustomFeesResponse{Fees: []*paymentv1.CustomFee{}}, nil
}

func (m *mockCustomFeesClient) AdminCreateCustomFee(ctx context.Context, req *paymentv1.AdminCreateCustomFeeRequest, _ ...grpc.CallOption) (*paymentv1.AdminCreateCustomFeeResponse, error) {
	if m.createFn != nil {
		return m.createFn(ctx, req)
	}
	return &paymentv1.AdminCreateCustomFeeResponse{Fee: sampleCustomFee(req.GetName(), req.GetRateBps())}, nil
}

func (m *mockCustomFeesClient) AdminUpdateCustomFee(ctx context.Context, req *paymentv1.AdminUpdateCustomFeeRequest, _ ...grpc.CallOption) (*paymentv1.AdminUpdateCustomFeeResponse, error) {
	if m.updateFn != nil {
		return m.updateFn(ctx, req)
	}
	name := "Featured"
	if req.Name != nil {
		name = req.GetName()
	}
	rate := int32(500)
	if req.RateBps != nil {
		rate = req.GetRateBps()
	}
	return &paymentv1.AdminUpdateCustomFeeResponse{Fee: sampleCustomFee(name, rate)}, nil
}

func (m *mockCustomFeesClient) AdminDeactivateCustomFee(ctx context.Context, req *paymentv1.AdminDeactivateCustomFeeRequest, _ ...grpc.CallOption) (*paymentv1.AdminDeactivateCustomFeeResponse, error) {
	if m.deactivateFn != nil {
		return m.deactivateFn(ctx, req)
	}
	return &paymentv1.AdminDeactivateCustomFeeResponse{Deactivated: true}, nil
}

func sampleCustomFee(name string, rate int32) *paymentv1.CustomFee {
	now := timestamppb.New(time.Date(2026, 8, 21, 12, 0, 0, 0, time.UTC))
	return &paymentv1.CustomFee{
		Id:        "11111111-1111-1111-1111-111111111111",
		Name:      name,
		RateBps:   rate,
		Active:    true,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func TestAdminPaymentsHandler_ListCustomFees(t *testing.T) {
	t.Parallel()
	h := NewAdminPaymentsHandler(&mockCustomFeesClient{
		listFn: func(_ context.Context, _ *paymentv1.AdminListCustomFeesRequest) (*paymentv1.AdminListCustomFeesResponse, error) {
			return &paymentv1.AdminListCustomFeesResponse{
				Fees: []*paymentv1.CustomFee{sampleCustomFee("Featured listing", 500)},
			}, nil
		},
	}, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/custom-fees", nil)
	req = addClaimsToRequest(req, "admin-1", "a@example.com", []string{"admin"})
	rec := httptest.NewRecorder()
	h.ListCustomFees(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	body := decodeJSONResponse(t, rec)
	fees, ok := body["fees"].([]interface{})
	require.True(t, ok)
	require.Len(t, fees, 1)
	row, ok := fees[0].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "Featured listing", row["name"])
	assert.Equal(t, float64(500), row["rate_bps"])
}

func TestAdminPaymentsHandler_CreateCustomFee(t *testing.T) {
	t.Parallel()
	var gotName string
	var gotBPS int32
	h := NewAdminPaymentsHandler(&mockCustomFeesClient{
		createFn: func(_ context.Context, req *paymentv1.AdminCreateCustomFeeRequest) (*paymentv1.AdminCreateCustomFeeResponse, error) {
			gotName = req.GetName()
			gotBPS = req.GetRateBps()
			assert.Equal(t, "admin-1", req.GetAdminId())
			return &paymentv1.AdminCreateCustomFeeResponse{Fee: sampleCustomFee(req.GetName(), req.GetRateBps())}, nil
		},
	}, nil, nil)
	raw, err := json.Marshal(map[string]interface{}{"name": "Featured listing", "rate_bps": 500})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/custom-fees", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "admin-1", "a@example.com", []string{"admin"})
	rec := httptest.NewRecorder()
	h.CreateCustomFee(rec, req)
	require.Equal(t, http.StatusCreated, rec.Code)
	assert.Equal(t, "Featured listing", gotName)
	assert.Equal(t, int32(500), gotBPS)
}

func TestAdminPaymentsHandler_CreateCustomFee_unauthenticated(t *testing.T) {
	t.Parallel()
	h := NewAdminPaymentsHandler(&mockCustomFeesClient{}, nil, nil)
	raw, err := json.Marshal(map[string]interface{}{"name": "X", "rate_bps": 100})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/custom-fees", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.CreateCustomFee(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestAdminPaymentsHandler_UpdateCustomFee(t *testing.T) {
	t.Parallel()
	id := "11111111-1111-1111-1111-111111111111"
	var gotBPS int32
	h := NewAdminPaymentsHandler(&mockCustomFeesClient{
		updateFn: func(_ context.Context, req *paymentv1.AdminUpdateCustomFeeRequest) (*paymentv1.AdminUpdateCustomFeeResponse, error) {
			assert.Equal(t, id, req.GetId())
			require.NotNil(t, req.RateBps)
			gotBPS = req.GetRateBps()
			return &paymentv1.AdminUpdateCustomFeeResponse{Fee: sampleCustomFee("Featured listing", req.GetRateBps())}, nil
		},
	}, nil, nil)
	raw, err := json.Marshal(map[string]interface{}{"rate_bps": 250})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/custom-fees/"+id, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "admin-1", "a@example.com", []string{"admin"})
	req = withChiURLParam(req, "id", id)
	rec := httptest.NewRecorder()
	h.UpdateCustomFee(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, int32(250), gotBPS)
}

func TestAdminPaymentsHandler_UpdateCustomFee_invalidID(t *testing.T) {
	t.Parallel()
	h := NewAdminPaymentsHandler(&mockCustomFeesClient{}, nil, nil)
	raw, err := json.Marshal(map[string]interface{}{"rate_bps": 250})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/custom-fees/not-a-uuid", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "admin-1", "a@example.com", []string{"admin"})
	req = withChiURLParam(req, "id", "not-a-uuid")
	rec := httptest.NewRecorder()
	h.UpdateCustomFee(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestAdminPaymentsHandler_DeleteCustomFee(t *testing.T) {
	t.Parallel()
	id := "11111111-1111-1111-1111-111111111111"
	called := false
	h := NewAdminPaymentsHandler(&mockCustomFeesClient{
		deactivateFn: func(_ context.Context, req *paymentv1.AdminDeactivateCustomFeeRequest) (*paymentv1.AdminDeactivateCustomFeeResponse, error) {
			called = true
			assert.Equal(t, id, req.GetId())
			assert.Equal(t, "admin-1", req.GetAdminId())
			return &paymentv1.AdminDeactivateCustomFeeResponse{Deactivated: true}, nil
		},
	}, nil, nil)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/custom-fees/"+id, nil)
	req = addClaimsToRequest(req, "admin-1", "a@example.com", []string{"admin"})
	req = withChiURLParam(req, "id", id)
	rec := httptest.NewRecorder()
	h.DeleteCustomFee(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
	body := decodeJSONResponse(t, rec)
	assert.Equal(t, true, body["deactivated"])
}
