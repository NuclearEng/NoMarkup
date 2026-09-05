package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const testJobUUID = "11111111-1111-4111-8111-111111111111"
const testOwnerID = "22222222-2222-4222-8222-222222222222"
const testOtherID = "33333333-3333-4333-8333-333333333333"

func stubGetJobClient(customerID string) *mockJobClient {
	created := timestamppb.New(time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC))
	return &mockJobClient{
		getJobFn: func(_ context.Context, req *jobv1.GetJobRequest) (*jobv1.GetJobResponse, error) {
			return &jobv1.GetJobResponse{
				Job: &jobv1.JobDetail{
					Job: &jobv1.Job{
						Id:         req.GetJobId(),
						CustomerId: customerID,
						Title:      "Fix sink",
						CreatedAt:  created,
					},
				},
			}, nil
		},
	}
}

func TestGetJob_nonOwnerOmitsLiquidity(t *testing.T) {
	h := NewJobHandler(stubGetJobClient(testOwnerID), nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+testJobUUID, nil)
	req = withChiURLParam(req, "id", testJobUUID)
	req = addClaimsToRequest(req, testOtherID, "other@example.com", []string{"provider"})
	rec := httptest.NewRecorder()

	h.GetJob(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	body := decodeJSONResponse(t, rec)
	job, ok := body["job"].(map[string]interface{})
	require.True(t, ok)
	_, has := job["liquidity"]
	assert.False(t, has, "non-owner GET must omit liquidity")
}

func TestGetJob_anonymousOmitsLiquidity(t *testing.T) {
	h := NewJobHandler(stubGetJobClient(testOwnerID), nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+testJobUUID, nil)
	req = withChiURLParam(req, "id", testJobUUID)
	rec := httptest.NewRecorder()

	h.GetJob(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	body := decodeJSONResponse(t, rec)
	job, ok := body["job"].(map[string]interface{})
	require.True(t, ok)
	_, has := job["liquidity"]
	assert.False(t, has, "anonymous GET must omit liquidity")
}

func TestIsJobOwner(t *testing.T) {
	assert.True(t, isJobOwner(testOwnerID, testOwnerID))
	assert.False(t, isJobOwner(testOtherID, testOwnerID))
	assert.False(t, isJobOwner("", testOwnerID))
	assert.False(t, isJobOwner(testOwnerID, ""))
	assert.False(t, isJobOwner("", ""))
}

func TestGetJob_ownerWithNilDBOmitsLiquidity(t *testing.T) {
	// Without a pool we cannot read the ledger; omit rather than invent zeros.
	h := NewJobHandler(stubGetJobClient(testOwnerID), nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+testJobUUID, nil)
	req = withChiURLParam(req, "id", testJobUUID)
	req = addClaimsToRequest(req, testOwnerID, "owner@example.com", []string{"customer"})
	rec := httptest.NewRecorder()

	h.GetJob(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	body := decodeJSONResponse(t, rec)
	job, ok := body["job"].(map[string]interface{})
	require.True(t, ok)
	_, has := job["liquidity"]
	assert.False(t, has)
}

func TestGetJob_ownerIncludesLiquidityWhenDBAvailable(t *testing.T) {
	pool := heatmapTestPool(t)
	var exists bool
	err := pool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_name = 'job_match_notifications'
		)`).Scan(&exists)
	require.NoError(t, err)
	if !exists {
		t.Skip("job_match_notifications not migrated")
	}

	h := NewJobHandler(stubGetJobClient(testOwnerID), nil, nil, pool)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+testJobUUID, nil)
	req = withChiURLParam(req, "id", testJobUUID)
	req = addClaimsToRequest(req, testOwnerID, "owner@example.com", []string{"customer"})
	rec := httptest.NewRecorder()

	h.GetJob(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	body := decodeJSONResponse(t, rec)
	job, ok := body["job"].(map[string]interface{})
	require.True(t, ok)
	liq, has := job["liquidity"].(map[string]interface{})
	require.True(t, has, "owner GET must include liquidity when the ledger table is readable")
	assert.Contains(t, liq, "notified_count")
	assert.Contains(t, liq, "bid_count")
	assert.Contains(t, liq, "first_bid_at")
	_, hasMinutes := liq["minutes_to_first_bid"]
	assert.False(t, hasMinutes, "no bids on this job → minutes_to_first_bid omitted")
}
