package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	analyticsv1 "github.com/nomarkup/nomarkup/proto/analytics/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type stubMarketRangeClient struct {
	analyticsv1.AnalyticsServiceClient
	lastReq *analyticsv1.GetMarketRangeRequest
	resp    *analyticsv1.GetMarketRangeResponse
	err     error
}

func (s *stubMarketRangeClient) GetMarketRange(
	_ context.Context,
	req *analyticsv1.GetMarketRangeRequest,
	_ ...grpc.CallOption,
) (*analyticsv1.GetMarketRangeResponse, error) {
	s.lastReq = req
	if s.err != nil {
		return nil, s.err
	}
	if s.resp != nil {
		return s.resp, nil
	}
	return &analyticsv1.GetMarketRangeResponse{
		Range: &analyticsv1.MarketRange{
			CategoryId:  req.GetCategoryId(),
			Region:      "Austin, TX",
			MedianCents: 30000,
		},
	}, nil
}

func TestGetMarketRange_ForwardsLatLng(t *testing.T) {
	stub := &stubMarketRangeClient{}
	h := NewAnalyticsHandler(stub, nil, nil)

	r := httptest.NewRequest(http.MethodGet,
		"/api/v1/analytics/market/range?category_id=00000000-0000-0000-0000-000000000001&lat=30.2672&lng=-97.7431",
		nil)
	w := httptest.NewRecorder()
	h.GetMarketRange(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, stub.lastReq)
	require.NotNil(t, stub.lastReq.GetLocation())
	assert.InDelta(t, 30.2672, stub.lastReq.GetLocation().GetLatitude(), 1e-9)
	assert.InDelta(t, -97.7431, stub.lastReq.GetLocation().GetLongitude(), 1e-9)
}

func TestGetMarketRange_ForwardsZip(t *testing.T) {
	stub := &stubMarketRangeClient{}
	h := NewAnalyticsHandler(stub, nil, nil)

	r := httptest.NewRequest(http.MethodGet,
		"/api/v1/analytics/market/range?category_id=00000000-0000-0000-0000-000000000001&zip=78701",
		nil)
	w := httptest.NewRecorder()
	h.GetMarketRange(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "78701", stub.lastReq.GetZipCode())
}

func TestGetMarketRange_NotFoundIsNoData(t *testing.T) {
	stub := &stubMarketRangeClient{err: status.Error(codes.NotFound, "market range not found")}
	h := NewAnalyticsHandler(stub, nil, nil)

	r := httptest.NewRequest(http.MethodGet,
		"/api/v1/analytics/market/range?category_id=00000000-0000-0000-0000-000000000001&lat=0&lng=-40",
		nil)
	w := httptest.NewRecorder()
	h.GetMarketRange(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Equal(t, false, body["has_data"])
}
