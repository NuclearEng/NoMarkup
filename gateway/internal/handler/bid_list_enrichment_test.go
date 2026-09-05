package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	testLadderJobID      = "11111111-1111-1111-1111-111111111111"
	testLadderCustomerID = "22222222-2222-2222-2222-222222222222"
	testLadderProvA      = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	testLadderProvB      = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
)

type listBidsMock struct {
	bidv1.BidServiceClient
	bids []*bidv1.BidWithProvider
	err  error
}

func (m *listBidsMock) ListBidsForJob(_ context.Context, _ *bidv1.ListBidsForJobRequest, _ ...grpc.CallOption) (*bidv1.ListBidsForJobResponse, error) {
	if m.err != nil {
		return nil, m.err
	}
	return &bidv1.ListBidsForJobResponse{Bids: m.bids}, nil
}

type ladderUserMock struct {
	userv1.UserServiceClient
	profiles   map[string]*userv1.ProviderProfile
	profileErr error
	calls      atomic.Int32
}

func (m *ladderUserMock) GetProviderProfile(_ context.Context, req *userv1.GetProviderProfileRequest, _ ...grpc.CallOption) (*userv1.GetProviderProfileResponse, error) {
	m.calls.Add(1)
	if m.profileErr != nil {
		return nil, m.profileErr
	}
	p := m.profiles[req.GetUserId()]
	if p == nil {
		return nil, status.Error(codes.NotFound, "provider profile not found")
	}
	return &userv1.GetProviderProfileResponse{Profile: p}, nil
}

func (m *ladderUserMock) BatchGetUsers(_ context.Context, req *userv1.BatchGetUsersRequest, _ ...grpc.CallOption) (*userv1.BatchGetUsersResponse, error) {
	out := make([]*userv1.PublicUser, 0, len(req.GetUserIds()))
	for _, id := range req.GetUserIds() {
		if _, ok := m.profiles[id]; ok {
			out = append(out, &userv1.PublicUser{Id: id, DisplayName: "Provider " + id[:8]})
		}
	}
	return &userv1.BatchGetUsersResponse{Users: out}, nil
}

func (m *ladderUserMock) ListDocuments(_ context.Context, _ *userv1.ListDocumentsRequest, _ ...grpc.CallOption) (*userv1.ListDocumentsResponse, error) {
	return &userv1.ListDocumentsResponse{}, nil
}

func ladderBid(id, providerID string, amount int64) *bidv1.BidWithProvider {
	return &bidv1.BidWithProvider{
		Bid: &bidv1.Bid{
			Id:          id,
			JobId:       testLadderJobID,
			ProviderId:  providerID,
			AmountCents: amount,
			Status:      bidv1.BidStatus_BID_STATUS_ACTIVE,
		},
		JobsCompleted: 0,
	}
}

func doListBids(t *testing.T, h *BidHandler) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Get("/api/v1/jobs/{id}/bids", h.ListBidsForJob)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+testLadderJobID+"/bids", nil)
	req = addClaimsToRequest(req, testLadderCustomerID, "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func decodeLadderBids(t *testing.T, rec *httptest.ResponseRecorder) []map[string]interface{} {
	t.Helper()
	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	raw, ok := body["bids"].([]interface{})
	require.True(t, ok, "bids must be an array")
	out := make([]map[string]interface{}, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]interface{})
		require.True(t, ok)
		out = append(out, m)
	}
	return out
}

func TestReviewSummaryJSON_ZeroCountIsNilNeverFakesFive(t *testing.T) {
	t.Parallel()
	assert.Nil(t, reviewSummaryJSON(5.0, 0, nil))
	assert.Nil(t, reviewSummaryJSON(0, 0, nil))
	assert.Nil(t, reviewSummaryFromProto(nil))
	assert.Nil(t, reviewSummaryFromProto(&userv1.ReviewSummary{
		AverageRating: 5.0,
		ReviewCount:   0,
	}))

	got := reviewSummaryJSON(4.2, 3, nil)
	require.NotNil(t, got)
	assert.Equal(t, 4.2, got["average_rating"])
	assert.Equal(t, 3, got["review_count"])
	assert.Nil(t, got["on_time_rate"])
}

func TestListBidsForJob_EnrichesJobsCompletedAndReviewSummary(t *testing.T) {
	t.Parallel()

	onTime := 0.8
	users := &ladderUserMock{
		profiles: map[string]*userv1.ProviderProfile{
			testLadderProvA: {
				UserId:        testLadderProvA,
				JobsCompleted: 12,
				ReviewSummary: &userv1.ReviewSummary{
					AverageRating: 4.5,
					ReviewCount:   8,
					OnTimeRate:    onTime,
				},
			},
			testLadderProvB: {
				UserId:        testLadderProvB,
				JobsCompleted: 3,
				ReviewSummary: &userv1.ReviewSummary{
					AverageRating: 4.0,
					ReviewCount:   2,
				},
			},
		},
	}
	h := NewBidHandler(&listBidsMock{
		bids: []*bidv1.BidWithProvider{
			ladderBid("bid-a", testLadderProvA, 9000),
			ladderBid("bid-b", testLadderProvB, 8500),
		},
	}, nil, nil)
	h.SetUserClient(users)

	bids := decodeLadderBids(t, doListBids(t, h))
	require.Len(t, bids, 2)

	assert.Equal(t, float64(12), bids[0]["jobs_completed"])
	rsA, ok := bids[0]["review_summary"].(map[string]interface{})
	require.True(t, ok, "provider A must have a review_summary object, not null")
	assert.Equal(t, 4.5, rsA["average_rating"])
	assert.Equal(t, float64(8), rsA["review_count"])
	assert.Equal(t, 0.8, rsA["on_time_rate"])

	assert.Equal(t, float64(3), bids[1]["jobs_completed"])
	rsB, ok := bids[1]["review_summary"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, 4.0, rsB["average_rating"])
	assert.Equal(t, float64(2), rsB["review_count"])
	assert.Nil(t, rsB["on_time_rate"])
}

func TestListBidsForJob_DedupesProviderProfileLookups(t *testing.T) {
	t.Parallel()

	users := &ladderUserMock{
		profiles: map[string]*userv1.ProviderProfile{
			testLadderProvA: {UserId: testLadderProvA, JobsCompleted: 7},
		},
	}
	h := NewBidHandler(&listBidsMock{
		bids: []*bidv1.BidWithProvider{
			ladderBid("bid-1", testLadderProvA, 9000),
			ladderBid("bid-2", testLadderProvA, 8000),
		},
	}, nil, nil)
	h.SetUserClient(users)

	bids := decodeLadderBids(t, doListBids(t, h))
	require.Len(t, bids, 2)
	assert.Equal(t, float64(7), bids[0]["jobs_completed"])
	assert.Equal(t, float64(7), bids[1]["jobs_completed"])
	assert.Equal(t, int32(1), users.calls.Load(), "one GetProviderProfile per unique provider")
}

func TestListBidsForJob_ReviewSummaryNilWhenLookupFails(t *testing.T) {
	t.Parallel()

	users := &ladderUserMock{
		profileErr: status.Error(codes.Unavailable, "user service down"),
	}
	h := NewBidHandler(&listBidsMock{
		bids: []*bidv1.BidWithProvider{
			ladderBid("bid-a", testLadderProvA, 9000),
		},
	}, nil, nil)
	h.SetUserClient(users)

	bids := decodeLadderBids(t, doListBids(t, h))
	require.Len(t, bids, 1)
	assert.Equal(t, float64(0), bids[0]["jobs_completed"], "engine 0 when enrichment fails")
	assert.Nil(t, bids[0]["review_summary"], "must not fake a rating when lookup fails")
}

func TestListBidsForJob_NoReviewsStaysNilNotFiveStar(t *testing.T) {
	t.Parallel()

	users := &ladderUserMock{
		profiles: map[string]*userv1.ProviderProfile{
			testLadderProvA: {
				UserId:        testLadderProvA,
				JobsCompleted: 1,
				ReviewSummary: &userv1.ReviewSummary{
					AverageRating: 5.0,
					ReviewCount:   0,
				},
			},
		},
	}
	h := NewBidHandler(&listBidsMock{
		bids: []*bidv1.BidWithProvider{ladderBid("bid-a", testLadderProvA, 9000)},
	}, nil, nil)
	h.SetUserClient(users)

	bids := decodeLadderBids(t, doListBids(t, h))
	require.Len(t, bids, 1)
	assert.Equal(t, float64(1), bids[0]["jobs_completed"])
	assert.Nil(t, bids[0]["review_summary"], "count 0 must not emit a 5.0 summary")
}

func TestListBidsForJob_NilUserClientKeepsEngineJobsCompleted(t *testing.T) {
	t.Parallel()

	h := NewBidHandler(&listBidsMock{
		bids: []*bidv1.BidWithProvider{ladderBid("bid-a", testLadderProvA, 9000)},
	}, nil, nil)

	bids := decodeLadderBids(t, doListBids(t, h))
	require.Len(t, bids, 1)
	assert.Equal(t, float64(0), bids[0]["jobs_completed"])
	assert.Nil(t, bids[0]["review_summary"])
}

func TestListBidsForJob_MissingClaimsUnauthorized(t *testing.T) {
	t.Parallel()
	h := NewBidHandler(&listBidsMock{}, nil, nil)
	r := chi.NewRouter()
	r.Get("/api/v1/jobs/{id}/bids", h.ListBidsForJob)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+testLadderJobID+"/bids", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}
