package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	bidv1 "github.com/nomarkup/nomarkup/proto/bid/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	"google.golang.org/grpc"
)

// liveAuctionBidMock extends mockBidClient for live-auction state/events gates.
type liveAuctionBidMock struct {
	bidv1.BidServiceClient
	stateCalled  bool
	eventsCalled bool
}

func (m *liveAuctionBidMock) GetLiveAuctionState(_ context.Context, _ *bidv1.GetLiveAuctionStateRequest, _ ...grpc.CallOption) (*bidv1.GetLiveAuctionStateResponse, error) {
	m.stateCalled = true
	return &bidv1.GetLiveAuctionStateResponse{}, nil
}

func (m *liveAuctionBidMock) GetAuctionEvents(_ context.Context, _ *bidv1.GetAuctionEventsRequest, _ ...grpc.CallOption) (*bidv1.GetAuctionEventsResponse, error) {
	m.eventsCalled = true
	return &bidv1.GetAuctionEventsResponse{}, nil
}

func withChiJobID(r *http.Request, jobID string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", jobID)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// TestGetLiveAuctionState_envKillSwitchOff returns 404 and never hits the engine
// when ENABLE_LIVE_AUCTION is not "true" (ops kill switch AND-ed with DB flag).
func TestGetLiveAuctionState_envKillSwitchOff(t *testing.T) {
	t.Setenv("ENABLE_LIVE_AUCTION", "false")

	mock := &liveAuctionBidMock{}
	h := NewBidHandler(mock, nil, nil)

	req := withChiJobID(httptest.NewRequest(http.MethodGet, "/api/v1/jobs/job-1/auction/state", nil), "job-1")
	rec := httptest.NewRecorder()
	h.GetLiveAuctionState(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "live auctions not enabled")
	assert.False(t, mock.stateCalled, "engine must not be called when env kill switch is off")
}

func TestGetAuctionEvents_envKillSwitchOff(t *testing.T) {
	t.Setenv("ENABLE_LIVE_AUCTION", "")

	mock := &liveAuctionBidMock{}
	h := NewBidHandler(mock, nil, nil)

	req := withChiJobID(httptest.NewRequest(http.MethodGet, "/api/v1/jobs/job-1/auction/events", nil), "job-1")
	rec := httptest.NewRecorder()
	h.GetAuctionEvents(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.False(t, mock.eventsCalled)
}

// TestSpectateAuction_envKillSwitchOff — services spectator AND-s ENABLE_LIVE_AUCTION
// after RequireFlag(spectator_mode) on the route.
func TestSpectateAuction_envKillSwitchOff(t *testing.T) {
	t.Setenv("ENABLE_LIVE_AUCTION", "false")

	h := NewSpectatorWSHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/ws/auction/job-1/spectate", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("jobId", "job-1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()

	h.SpectateAuction(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "live auctions not enabled")
}

// TestAuctionWS_envKillSwitchOff — authenticated arena WS kill switch.
func TestAuctionWS_envKillSwitchOff(t *testing.T) {
	t.Setenv("ENABLE_LIVE_AUCTION", "false")

	h := NewAuctionWSHandler(nil, "localhost:0", "secret")
	req := httptest.NewRequest(http.MethodGet, "/ws/auction/job-1", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("jobId", "job-1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()

	h.WebSocket(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "live auctions not enabled")
}

// TestJobCreate_liveAuctionType_flagOffInProduction — auction_type=live is
// field-gated via IsFeatureDisabled("live_auction") + env kill switch.
// Production + nil DB fails closed → 503 without calling CreateJob.
func TestJobCreate_liveAuctionType_flagOffInProduction(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("ENABLE_LIVE_AUCTION", "true") // env allows; DB flag still blocks

	called := false
	client := &mockJobClient{
		createJobFn: func(_ context.Context, _ *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error) {
			called = true
			return nil, nil
		},
	}
	h := NewJobHandler(client, nil, nil, nil) // nil DB → IsFeatureDisabled fail-closed in prod

	body := `{"title":"Live Job","description":"desc","category_id":"cat-1","auction_type":"live","auction_duration_hours":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "user-1", "test@example.com", []string{"customer"})
	rec := httptest.NewRecorder()

	h.Create(rec, req)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Contains(t, rec.Body.String(), "live auctions are currently unavailable")
	assert.False(t, called, "CreateJob must not run when live_auction flag is disabled")
}

// TestJobCreate_liveAuctionType_envKillSwitch — env off blocks even if we would
// otherwise fail-open on missing flag in non-prod.
func TestJobCreate_liveAuctionType_envKillSwitch(t *testing.T) {
	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("ENABLE_LIVE_AUCTION", "false")

	called := false
	client := &mockJobClient{
		createJobFn: func(_ context.Context, _ *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error) {
			called = true
			return nil, nil
		},
	}
	h := NewJobHandler(client, nil, nil, nil)

	body := `{"title":"Live Job","description":"desc","category_id":"cat-1","auction_type":"live"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "user-1", "test@example.com", []string{"customer"})
	rec := httptest.NewRecorder()

	h.Create(rec, req)

	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.False(t, called)
}

// TestJobCreate_sealedAuction_unaffected — sealed/default create path must not
// hit the live_auction gate (nil DB would otherwise 503 sealed posts in prod).
func TestJobCreate_sealedAuction_unaffected(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("ENABLE_LIVE_AUCTION", "false")

	client := &mockJobClient{
		createJobFn: func(_ context.Context, req *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error) {
			return &jobv1.CreateJobResponse{
				Job: &jobv1.Job{Id: "job-sealed", CustomerId: req.GetCustomerId(), Title: req.GetTitle()},
			}, nil
		},
	}
	h := NewJobHandler(client, nil, nil, nil)

	body := `{"title":"Sealed Job","description":"desc","category_id":"cat-1","auction_type":"sealed"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = addClaimsToRequest(req, "user-1", "test@example.com", []string{"customer"})
	rec := httptest.NewRecorder()

	h.Create(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	assert.Equal(t, "job-sealed", decodeJSONResponse(t, rec)["id"])
}

// Compile-time sanity: LiveAuctionEnvEnabled is the shared kill-switch helper.
func TestLiveAuctionEnvEnabled_helper(t *testing.T) {
	t.Setenv("ENABLE_LIVE_AUCTION", "true")
	assert.True(t, middleware.LiveAuctionEnvEnabled())
	t.Setenv("ENABLE_LIVE_AUCTION", "false")
	assert.False(t, middleware.LiveAuctionEnvEnabled())
	t.Setenv("ENABLE_LIVE_AUCTION", "")
	assert.False(t, middleware.LiveAuctionEnvEnabled())
}
