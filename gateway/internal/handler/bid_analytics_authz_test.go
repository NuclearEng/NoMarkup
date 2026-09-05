package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// analyticsMock records the gRPC request so tests can assert customer_id
// is the JWT subject (PRD-AUTH-01).
type analyticsMock struct {
	bidv1.BidServiceClient
	resp      *bidv1.GetBidAnalyticsResponse
	err       error
	gotJobID  string
	gotCustID string
}

func (m *analyticsMock) GetBidAnalytics(_ context.Context, req *bidv1.GetBidAnalyticsRequest, _ ...grpc.CallOption) (*bidv1.GetBidAnalyticsResponse, error) {
	m.gotJobID = req.GetJobId()
	m.gotCustID = req.GetCustomerId()
	if m.err != nil {
		return nil, m.err
	}
	return m.resp, nil
}

func doAnalytics(t *testing.T, h *BidHandler, jobID, userID string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Get("/api/v1/bids/analytics", h.GetBidAnalytics)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bids/analytics?job_id="+jobID, nil)
	if userID != "" {
		req = addClaimsToRequest(req, userID, "c@example.com", []string{"customer"})
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestGetBidAnalytics_MissingClaimsUnauthorized(t *testing.T) {
	t.Parallel()
	h := NewBidHandler(&analyticsMock{}, nil, nil)
	rec := doAnalytics(t, h, testLadderJobID, "")
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestGetBidAnalytics_MissingJobIDBadRequest(t *testing.T) {
	t.Parallel()
	h := NewBidHandler(&analyticsMock{}, nil, nil)
	r := chi.NewRouter()
	r.Get("/api/v1/bids/analytics", h.GetBidAnalytics)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bids/analytics", nil)
	req = addClaimsToRequest(req, testLadderCustomerID, "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestGetBidAnalytics_ForwardsJWTSubjectAsCustomerID(t *testing.T) {
	t.Parallel()
	mock := &analyticsMock{
		resp: &bidv1.GetBidAnalyticsResponse{
			TotalBids:          3,
			LowestBidCents:     4000,
			HighestBidCents:    9000,
			MedianBidCents:     6000,
			OfferAcceptedCount: 1,
		},
	}
	h := NewBidHandler(mock, nil, nil)
	rec := doAnalytics(t, h, testLadderJobID, testLadderCustomerID)
	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, testLadderJobID, mock.gotJobID)
	assert.Equal(t, testLadderCustomerID, mock.gotCustID)

	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, float64(3), body["total_bids"])
	assert.Equal(t, float64(4000), body["lowest_bid_cents"])
}

func TestGetBidAnalytics_NonOwnerPermissionDenied(t *testing.T) {
	t.Parallel()
	attackerID := "33333333-3333-3333-3333-333333333333"
	mock := &analyticsMock{
		err: status.Error(codes.PermissionDenied, "only the job owner can view bids"),
	}
	h := NewBidHandler(mock, nil, nil)
	rec := doAnalytics(t, h, testLadderJobID, attackerID)
	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Equal(t, testLadderJobID, mock.gotJobID)
	assert.Equal(t, attackerID, mock.gotCustID)
	assert.NotContains(t, rec.Body.String(), "4000")
	assert.NotContains(t, rec.Body.String(), "lowest_bid")
}
