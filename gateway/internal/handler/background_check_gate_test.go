package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
)

func TestBackgroundCheckAllowsBid(t *testing.T) {
	t.Parallel()
	cases := []struct {
		status string
		found  bool
		want   bool
	}{
		{"clear", true, true},
		{"CLEAR", true, true},
		{" consider ", true, true},
		{"pending", true, false},
		{"complete", true, false},
		{"suspended", true, false},
		{"canceled", true, false},
		{"dispute", true, false},
		{"failed", true, false},
		{"pass", true, false},
		{"passed", true, false},
		{"not_started", true, false},
		{"", true, false},
		{"clear", false, false},
		{"consider", false, false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(fmt.Sprintf("status=%q found=%t", tc.status, tc.found), func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.want, backgroundCheckAllowsBid(tc.status, tc.found))
		})
	}
}

func TestHydrateBackgroundCheckJSON_InvitationURL(t *testing.T) {
	t.Parallel()
	invite := "https://apply.checkr.com/invite/abc"
	row := hydrateBackgroundCheckJSON(backgroundCheckJSON{
		Status:    "pending",
		ReportURL: &invite,
	})
	require.NotNil(t, row.InvitationURL)
	assert.Equal(t, invite, *row.InvitationURL)

	existing := "https://apply.checkr.com/invite/keep"
	row = hydrateBackgroundCheckJSON(backgroundCheckJSON{
		Status:        "pending",
		ReportURL:     &invite,
		InvitationURL: &existing,
	})
	require.NotNil(t, row.InvitationURL)
	assert.Equal(t, existing, *row.InvitationURL)

	notURL := "rep_123"
	row = hydrateBackgroundCheckJSON(backgroundCheckJSON{
		Status:    "pending",
		ReportURL: &notURL,
	})
	assert.Nil(t, row.InvitationURL)

	row = hydrateBackgroundCheckJSON(backgroundCheckJSON{Status: "not_started"})
	assert.Nil(t, row.InvitationURL)
}

func TestCheckrCreateInvitation_ReturnsInvitationURL(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/invitations", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"inv_1","invitation_url":"https://apply.checkr.com/invite/xyz"}`))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	invURL, id, err := checkrCreateInvitation(
		t.Context(),
		srv.Client(),
		srv.URL+"/v1",
		"ck_test",
		"cand_1",
		"driver_pro",
		"CA",
	)
	require.NoError(t, err)
	assert.Equal(t, "https://apply.checkr.com/invite/xyz", invURL)
	assert.Equal(t, "inv_1", id)
}

func TestPlaceBid_BackgroundCheckRequired_FlagOnNoRow(t *testing.T) {
	mock := &mockBidClient{
		placeFn: func(_ context.Context, req *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error) {
			return &bidv1.PlaceBidResponse{Bid: &bidv1.Bid{Id: "bid-1"}}, nil
		},
	}
	h := NewBidHandler(mock, nil, nil)
	h.bgGate.disabled = func(context.Context) bool { return false }
	h.bgGate.latest = func(context.Context, string) (string, bool, error) {
		return "", false, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)
	req := placeBidRequestWithKey(t, "11111111-1111-1111-1111-111111111111", "k1", 5000)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusForbidden, rec.Code, "body=%s", rec.Body.String())
	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "background check required", body["error"])
	assert.Equal(t, int32(0), mock.placeCalls.Load(), "must not call Checkr or the bidding engine")
}

func TestPlaceBid_BackgroundCheckRequired_Pending(t *testing.T) {
	mock := &mockBidClient{
		placeFn: func(_ context.Context, _ *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error) {
			return &bidv1.PlaceBidResponse{Bid: &bidv1.Bid{Id: "bid-1"}}, nil
		},
	}
	h := NewBidHandler(mock, nil, nil)
	h.bgGate.disabled = func(context.Context) bool { return false }
	h.bgGate.latest = func(context.Context, string) (string, bool, error) {
		return "pending", true, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, placeBidRequestWithKey(t, "11111111-1111-1111-1111-111111111111", "k1", 5000))

	require.Equal(t, http.StatusForbidden, rec.Code, "body=%s", rec.Body.String())
	assert.Contains(t, rec.Body.String(), "background check required")
	assert.Equal(t, int32(0), mock.placeCalls.Load())
}

func TestPlaceBid_BackgroundCheckRequired_Suspended(t *testing.T) {
	mock := &mockBidClient{}
	h := NewBidHandler(mock, nil, nil)
	h.bgGate.disabled = func(context.Context) bool { return false }
	h.bgGate.latest = func(context.Context, string) (string, bool, error) {
		return "suspended", true, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, placeBidRequestWithKey(t, "11111111-1111-1111-1111-111111111111", "k1", 5000))
	require.Equal(t, http.StatusForbidden, rec.Code)
	assert.Equal(t, int32(0), mock.placeCalls.Load())
}

func TestPlaceBid_BackgroundCheckAllowsClear(t *testing.T) {
	mock := &mockBidClient{
		placeFn: func(_ context.Context, req *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error) {
			return &bidv1.PlaceBidResponse{
				Bid: &bidv1.Bid{
					Id:          "bid-clear",
					JobId:       req.GetJobId(),
					ProviderId:  req.GetProviderId(),
					AmountCents: req.GetAmountCents(),
					Status:      bidv1.BidStatus_BID_STATUS_ACTIVE,
				},
			}, nil
		},
	}
	h := NewBidHandler(mock, nil, nil)
	h.bgGate.disabled = func(context.Context) bool { return false }
	h.bgGate.latest = func(context.Context, string) (string, bool, error) {
		return "clear", true, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, placeBidRequestWithKey(t, "11111111-1111-1111-1111-111111111111", "k1", 5000))
	require.Equal(t, http.StatusCreated, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, int32(1), mock.placeCalls.Load())
	assert.NotContains(t, strings.ToLower(rec.Body.String()), `"status":"pass"`)
}

func TestPlaceBid_BackgroundCheckAllowsConsider(t *testing.T) {
	mock := &mockBidClient{
		placeFn: func(_ context.Context, req *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error) {
			return &bidv1.PlaceBidResponse{
				Bid: &bidv1.Bid{Id: "bid-consider", AmountCents: req.GetAmountCents()},
			}, nil
		},
	}
	h := NewBidHandler(mock, nil, nil)
	h.bgGate.disabled = func(context.Context) bool { return false }
	h.bgGate.latest = func(context.Context, string) (string, bool, error) {
		return "consider", true, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, placeBidRequestWithKey(t, "11111111-1111-1111-1111-111111111111", "k1", 5000))
	require.Equal(t, http.StatusCreated, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, int32(1), mock.placeCalls.Load())
}

func TestPlaceBid_BackgroundCheckFlagOff_NoGate(t *testing.T) {
	mock := &mockBidClient{
		placeFn: func(_ context.Context, req *bidv1.PlaceBidRequest) (*bidv1.PlaceBidResponse, error) {
			return &bidv1.PlaceBidResponse{
				Bid: &bidv1.Bid{Id: "bid-ungated", AmountCents: req.GetAmountCents()},
			}, nil
		},
	}
	h := NewBidHandler(mock, nil, nil)
	h.bgGate.disabled = func(context.Context) bool { return true }
	h.bgGate.latest = func(context.Context, string) (string, bool, error) {
		t.Fatal("must not read background check status when flag is off")
		return "", false, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/jobs/{id}/bids", h.PlaceBid)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, placeBidRequestWithKey(t, "11111111-1111-1111-1111-111111111111", "k1", 5000))
	require.Equal(t, http.StatusCreated, rec.Code, "body=%s", rec.Body.String())
	assert.Equal(t, int32(1), mock.placeCalls.Load())
}

func TestPlaceListingBid_BackgroundCheckRequired(t *testing.T) {
	h := NewListingsHandler(nil, nil)
	h.bgGate.disabled = func(context.Context) bool { return false }
	h.bgGate.latest = func(context.Context, string) (string, bool, error) {
		return "pending", true, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/listings/{id}/bids", h.PlaceListingBid)

	listingID := "11111111-1111-1111-1111-111111111111"
	body := bytes.NewReader([]byte(`{"amount_cents":5000}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/listings/"+listingID+"/bids", body)
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, testBackgroundCheckUserID, "p@example.com", []string{"provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusForbidden, rec.Code, "body=%s", rec.Body.String())
	var payload map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Equal(t, "background check required", payload["error"])
}

func TestPlaceListingBid_CustomerNotGated(t *testing.T) {
	h := NewListingsHandler(nil, nil)
	h.bgGate.disabled = func(context.Context) bool { return false }
	h.bgGate.latest = func(context.Context, string) (string, bool, error) {
		t.Fatal("customer listing bid must not query provider_background_checks")
		return "", false, nil
	}

	r := chi.NewRouter()
	r.Post("/api/v1/listings/{id}/bids", h.PlaceListingBid)

	listingID := "11111111-1111-1111-1111-111111111111"
	body := bytes.NewReader([]byte(`{"amount_cents":5000}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/listings/"+listingID+"/bids", body)
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, testBackgroundCheckUserID, "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// Gate skipped; nil DB is the next guard.
	require.Equal(t, http.StatusServiceUnavailable, rec.Code, "body=%s", rec.Body.String())
	assert.Contains(t, rec.Body.String(), "database unavailable")
}
