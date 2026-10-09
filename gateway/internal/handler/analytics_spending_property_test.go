package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

type stubAnalyticsSpendingClient struct {
	analyticsv1.AnalyticsServiceClient
	lastReq *analyticsv1.GetCustomerSpendingRequest
	called  bool
}

func (s *stubAnalyticsSpendingClient) GetCustomerSpending(
	_ context.Context,
	req *analyticsv1.GetCustomerSpendingRequest,
	_ ...grpc.CallOption,
) (*analyticsv1.GetCustomerSpendingResponse, error) {
	s.called = true
	s.lastReq = req
	return &analyticsv1.GetCustomerSpendingResponse{
		TotalSpentCents: 1000,
		TotalJobs:       1,
	}, nil
}

type stubUserListPropertiesClient struct {
	userv1.UserServiceClient
	ownedIDs []string
}

func (s *stubUserListPropertiesClient) ListProperties(
	_ context.Context,
	_ *userv1.ListPropertiesRequest,
	_ ...grpc.CallOption,
) (*userv1.ListPropertiesResponse, error) {
	props := make([]*userv1.Property, 0, len(s.ownedIDs))
	for _, id := range s.ownedIDs {
		props = append(props, &userv1.Property{Id: id})
	}
	return &userv1.ListPropertiesResponse{Properties: props}, nil
}

func TestGetCustomerSpending_InvalidPropertyID(t *testing.T) {
	t.Parallel()
	stub := &stubAnalyticsSpendingClient{}
	h := NewAnalyticsHandler(stub, nil, &stubUserListPropertiesClient{})
	r := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/customers/me/spending?property_id=not-a-uuid", nil)
	r = addClaimsToRequest(r, "cust-1", "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	h.GetCustomerSpending(rec, r)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.False(t, stub.called, "downstream must not be called on invalid property_id")
}

func TestGetCustomerSpending_PropertyNotOwned(t *testing.T) {
	t.Parallel()
	owned := "11111111-1111-1111-1111-111111111111"
	other := "22222222-2222-2222-2222-222222222222"
	stub := &stubAnalyticsSpendingClient{}
	h := NewAnalyticsHandler(
		stub,
		nil,
		&stubUserListPropertiesClient{ownedIDs: []string{owned}},
	)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/customers/me/spending?property_id="+other, nil)
	r = addClaimsToRequest(r, "cust-1", "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	h.GetCustomerSpending(rec, r)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.False(t, stub.called, "downstream must not be called for non-owned property")
}

func TestGetCustomerSpending_NilUserClient_FailClosed(t *testing.T) {
	t.Parallel()
	prop := "11111111-1111-1111-1111-111111111111"
	stub := &stubAnalyticsSpendingClient{}
	h := NewAnalyticsHandler(stub, nil, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/customers/me/spending?property_id="+prop, nil)
	r = addClaimsToRequest(r, "cust-1", "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	h.GetCustomerSpending(rec, r)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.False(t, stub.called)
}

func TestGetCustomerSpending_OwnedPropertyPassesThrough(t *testing.T) {
	t.Parallel()
	prop := "11111111-1111-1111-1111-111111111111"
	stub := &stubAnalyticsSpendingClient{}
	h := NewAnalyticsHandler(
		stub,
		nil,
		&stubUserListPropertiesClient{ownedIDs: []string{prop}},
	)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/customers/me/spending?property_id="+prop, nil)
	r = addClaimsToRequest(r, "cust-1", "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	h.GetCustomerSpending(rec, r)
	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, stub.lastReq)
	assert.Equal(t, prop, stub.lastReq.GetPropertyId())
	assert.Equal(t, "cust-1", stub.lastReq.GetCustomerId())

	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.EqualValues(t, 1000, body["total_spent_cents"])
}

func TestGetCustomerSpending_NoPropertyID_AccountWide(t *testing.T) {
	t.Parallel()
	stub := &stubAnalyticsSpendingClient{}
	h := NewAnalyticsHandler(stub, nil, nil) // no user client needed when unscoped
	r := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/customers/me/spending", nil)
	r = addClaimsToRequest(r, "cust-1", "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	h.GetCustomerSpending(rec, r)
	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, stub.lastReq)
	assert.Empty(t, stub.lastReq.GetPropertyId())
}
