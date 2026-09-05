package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

func planLimitBidHandler(snap usageSnapshot, usageErr error) (*BidHandler, *mockBidClient) {
	mock := &mockBidClient{
		placeFn: func(_ context.Context, req *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error) {
			return &bidv1.PlaceBidResponse{
				Bid: &bidv1.Bid{
					Id:          "bid-1",
					JobId:       req.GetJobId(),
					ProviderId:  req.GetProviderId(),
					AmountCents: req.GetAmountCents(),
					Status:      bidv1.BidStatus_BID_STATUS_ACTIVE,
				},
			}, nil
		},
	}
	h := NewBidHandler(mock, nil, nil)
	h.planLimits.usageFn = func(context.Context, string) (usageSnapshot, error) {
		return snap, usageErr
	}
	return h, mock
}

func TestPlanLimit_PlaceBid(t *testing.T) {
	t.Parallel()
	jobID := "11111111-1111-1111-1111-111111111111"

	cases := []struct {
		name      string
		snap      usageSnapshot
		usageErr  error
		wantCode  int
		wantErr   string
		wantPlace int32
	}{
		{
			name:      "at cap",
			snap:      usageSnapshot{ActiveBids: 3, MaxActiveBids: 3},
			wantCode:  http.StatusForbidden,
			wantErr:   planLimitMaxActiveBidsMsg,
			wantPlace: 0,
		},
		{
			name:      "under cap",
			snap:      usageSnapshot{ActiveBids: 2, MaxActiveBids: 3},
			wantCode:  http.StatusCreated,
			wantPlace: 1,
		},
		{
			name:      "max 0 unlimited",
			snap:      usageSnapshot{ActiveBids: 100, MaxActiveBids: 0},
			wantCode:  http.StatusCreated,
			wantPlace: 1,
		},
		{
			name:      "query error fail closed",
			usageErr:  errors.New("db down"),
			wantCode:  http.StatusServiceUnavailable,
			wantErr:   planLimitUnavailableMsg,
			wantPlace: 0,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			h, mock := planLimitBidHandler(tc.snap, tc.usageErr)

			r := chi.NewRouter()
			r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)

			req := placeBidRequestWithKey(t, jobID, "plan-limit-key", 5000)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			require.Equal(t, tc.wantCode, rec.Code, "body=%s", rec.Body.String())
			assert.Equal(t, tc.wantPlace, mock.placeCalls.Load())
			if tc.wantErr != "" {
				var body map[string]string
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
				assert.Equal(t, tc.wantErr, body["error"])
			}
		})
	}
}

func TestPlanLimit_PlaceBid_iOSHeaderForcesFreeCap(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "")

	h, mock := planLimitBidHandler(usageSnapshot{ActiveBids: 3, MaxActiveBids: 50}, nil)

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)

	req := placeBidRequestWithKey(t, "11111111-1111-1111-1111-111111111111", "ios-key", 5000)
	req.Header.Set(noMarkupClientHeader, "ios")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusForbidden, rec.Code, "body=%s", rec.Body.String())
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, planLimitMaxActiveBidsMsg, body["error"])
	assert.Equal(t, int32(0), mock.placeCalls.Load())
}

func TestPlanLimit_PlaceBid_NilUsageFnSkips(t *testing.T) {
	t.Parallel()
	mock := &mockBidClient{
		placeFn: func(_ context.Context, req *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error) {
			return &bidv1.PlaceBidResponse{
				Bid: &bidv1.Bid{Id: "bid-1", JobId: req.GetJobId(), Status: bidv1.BidStatus_BID_STATUS_ACTIVE},
			}, nil
		},
	}
	h := NewBidHandler(mock, nil, nil)

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)
	req := placeBidRequestWithKey(t, "11111111-1111-1111-1111-111111111111", "skip-key", 5000)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, int32(1), mock.placeCalls.Load())
}

type planLimitUserClient struct {
	userv1.UserServiceClient
	categoriesCalls atomic.Int32
	portfolioCalls  atomic.Int32
}

func (m *planLimitUserClient) UpdateServiceCategories(
	_ context.Context,
	_ *userv1.UpdateServiceCategoriesRequest,
	_ ...grpc.CallOption,
) (*userv1.UpdateServiceCategoriesResponse, error) {
	m.categoriesCalls.Add(1)
	return &userv1.UpdateServiceCategoriesResponse{}, nil
}

func (m *planLimitUserClient) UpdatePortfolio(
	_ context.Context,
	_ *userv1.UpdatePortfolioRequest,
	_ ...grpc.CallOption,
) (*userv1.UpdatePortfolioResponse, error) {
	m.portfolioCalls.Add(1)
	return &userv1.UpdatePortfolioResponse{}, nil
}

func TestPlanLimit_UpdateCategories(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		snap     usageSnapshot
		ids      []string
		wantCode int
		wantErr  string
		wantCall int32
	}{
		{
			name:     "category count 2 with max 1",
			snap:     usageSnapshot{MaxServiceCategories: 1},
			ids:      []string{"cat-1", "cat-2"},
			wantCode: http.StatusForbidden,
			wantErr:  planLimitMaxServiceCategoriesMsg,
			wantCall: 0,
		},
		{
			name:     "at max allowed",
			snap:     usageSnapshot{MaxServiceCategories: 1},
			ids:      []string{"cat-1"},
			wantCode: http.StatusOK,
			wantCall: 1,
		},
		{
			name:     "max 0 unlimited",
			snap:     usageSnapshot{MaxServiceCategories: 0},
			ids:      []string{"c1", "c2", "c3"},
			wantCode: http.StatusOK,
			wantCall: 1,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			client := &planLimitUserClient{}
			h := NewProviderHandler(client, nil, nil)
			h.planLimits.usageFn = func(context.Context, string) (usageSnapshot, error) {
				return tc.snap, nil
			}

			body, err := json.Marshal(map[string][]string{"category_ids": tc.ids})
			require.NoError(t, err)
			req := httptest.NewRequest(http.MethodPut, "/api/v1/providers/me/categories", bytes.NewReader(body))
			req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "p@example.com", []string{"provider"})
			rec := httptest.NewRecorder()
			h.UpdateCategories(rec, req)

			require.Equal(t, tc.wantCode, rec.Code, "body=%s", rec.Body.String())
			assert.Equal(t, tc.wantCall, client.categoriesCalls.Load())
			if tc.wantErr != "" {
				var got map[string]string
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
				assert.Equal(t, tc.wantErr, got["error"])
			}
		})
	}
}

func TestPlanLimit_UpdatePortfolio(t *testing.T) {
	t.Parallel()

	images := func(n int) []map[string]interface{} {
		out := make([]map[string]interface{}, n)
		for i := 0; i < n; i++ {
			out[i] = map[string]interface{}{
				"image_url":  fmt.Sprintf("https://cdn.example/%d.jpg", i),
				"caption":    "shot",
				"sort_order": i,
			}
		}
		return out
	}

	cases := []struct {
		name     string
		snap     usageSnapshot
		count    int
		wantCode int
		wantErr  string
		wantCall int32
	}{
		{
			name:     "portfolio 6 images with max 5",
			snap:     usageSnapshot{MaxPortfolioImages: 5},
			count:    6,
			wantCode: http.StatusForbidden,
			wantErr:  planLimitMaxPortfolioImagesMsg,
			wantCall: 0,
		},
		{
			name:     "at max allowed",
			snap:     usageSnapshot{MaxPortfolioImages: 5},
			count:    5,
			wantCode: http.StatusOK,
			wantCall: 1,
		},
		{
			name:     "max 0 unlimited",
			snap:     usageSnapshot{MaxPortfolioImages: 0},
			count:    20,
			wantCode: http.StatusOK,
			wantCall: 1,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			client := &planLimitUserClient{}
			h := NewProviderHandler(client, nil, nil)
			h.planLimits.usageFn = func(context.Context, string) (usageSnapshot, error) {
				return tc.snap, nil
			}

			body, err := json.Marshal(map[string]interface{}{"images": images(tc.count)})
			require.NoError(t, err)
			req := httptest.NewRequest(http.MethodPut, "/api/v1/providers/me/portfolio", bytes.NewReader(body))
			req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "p@example.com", []string{"provider"})
			rec := httptest.NewRecorder()
			h.UpdatePortfolio(rec, req)

			require.Equal(t, tc.wantCode, rec.Code, "body=%s", rec.Body.String())
			assert.Equal(t, tc.wantCall, client.portfolioCalls.Load())
			if tc.wantErr != "" {
				var got map[string]string
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
				assert.Equal(t, tc.wantErr, got["error"])
			}
		})
	}
}
