package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// instantMatchTestCache connects to local Redis for offer fan-out tests.
// Skips when Redis is unreachable (matches middleware/idempotency_test.go).
func instantMatchTestCache(t *testing.T) *cache.Client {
	t.Helper()
	c := cache.New("redis://localhost:6379")
	if c == nil {
		t.Skip("Redis unavailable, skipping instant-match eligibility integration test")
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// seedPendingInstantOffer writes a pending instant_match record so ListProviderOffers
// has something to return when the caller is eligible.
func seedPendingInstantOffer(t *testing.T, c *cache.Client, jobID string) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	rec := instantMatchRecord{
		Status:      "pending",
		OfferSentAt: now.Format(time.RFC3339),
		ExpiresAt:   now.Add(15 * time.Minute).Format(time.RFC3339),
		JobTitle:    "Test instant job",
		AmountCents: 12_500,
	}
	key := jobOfferKey(jobID)
	c.SetJSON(ctx, key, rec, 5*time.Minute)
	t.Cleanup(func() {
		c.Delete(ctx, key)
		// Claim keys are only set on accept; delete defensively.
		c.Delete(ctx, key+":claim")
	})
}

func providerProfile(userID string, enabled, availableNow bool) *userv1.ProviderProfile {
	return &userv1.ProviderProfile{
		Id:               "profile-" + userID,
		UserId:           userID,
		BusinessName:     "Test Plumbing",
		InstantEnabled:   enabled,
		InstantAvailable: availableNow,
		MemberSince:      timestamppb.Now(),
	}
}

// TestListProviderOffers_filtersProvidersOutsideSchedule verifies that a
// provider who is instant-enabled but NOT available_now (and has no in-window
// schedule — nil DB fail-soft to empty schedule) receives an empty offer list
// even when Redis holds a pending broadcast.
//
// Empty schedule fail-soft is the same eligibility outcome as a non-empty
// schedule evaluated outside its windows (see isProviderInstantEligible /
// instant_schedule_test.go).
func TestListProviderOffers_filtersProvidersOutsideSchedule(t *testing.T) {
	c := instantMatchTestCache(t)
	ctx := context.Background()

	providerID := "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
	jobID := "11111111-2222-3333-4444-555555555555"
	seedPendingInstantOffer(t, c, jobID)

	// Sanity: the offer is actually in Redis.
	var seeded instantMatchRecord
	require.True(t, c.GetJSON(ctx, jobOfferKey(jobID), &seeded))
	require.Equal(t, "pending", seeded.Status)

	userClient := &mockProviderProfileClient{
		profile: providerProfile(providerID, true /* enabled */, false /* available_now */),
	}
	// nil db → empty schedule → outside-window path when available_now is false.
	h := NewInstantMatchHandler(nil, nil, nil, c, userClient, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/provider/offers", nil)
	req = addClaimsToRequest(req, providerID, "provider@example.com", []string{"provider"})
	rec := httptest.NewRecorder()

	h.ListProviderOffers(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	offers, ok := body["offers"].([]interface{})
	require.True(t, ok, "offers should be a JSON array, got %T", body["offers"])
	assert.Empty(t, offers,
		"provider outside schedule and not available_now must not see redis-broadcast offers")
}

// TestListProviderOffers_includesOffersWhenAvailableNow is the positive
// contrast for the filter test: available_now bypasses the schedule window,
// so the same pending Redis offer is returned.
func TestListProviderOffers_includesOffersWhenAvailableNow(t *testing.T) {
	c := instantMatchTestCache(t)

	providerID := "cccccccc-dddd-eeee-ffff-000000000001"
	jobID := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	seedPendingInstantOffer(t, c, jobID)

	userClient := &mockProviderProfileClient{
		profile: providerProfile(providerID, true /* enabled */, true /* available_now */),
	}
	h := NewInstantMatchHandler(nil, nil, nil, c, userClient, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/provider/offers", nil)
	req = addClaimsToRequest(req, providerID, "provider@example.com", []string{"provider"})
	rec := httptest.NewRecorder()

	h.ListProviderOffers(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	offers, ok := body["offers"].([]interface{})
	require.True(t, ok, "offers should be a JSON array")
	require.NotEmpty(t, offers, "available_now provider should see pending offers")

	// Find our seeded job (SCAN may pick up leftover keys from parallel runs).
	found := false
	for _, raw := range offers {
		m, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		if m["job_id"] == jobID {
			found = true
			assert.Equal(t, "Test instant job", m["job_title"])
			assert.EqualValues(t, 12_500, m["amount_cents"])
			break
		}
	}
	assert.True(t, found, "seeded job_id %s missing from offers: %v", jobID, offers)
}

// TestAcceptOffer_deniedWhenOutsideScheduleAndNotAvailableNow verifies Accept
// cannot bypass the schedule filter: enabled + not available_now + empty
// schedule (nil DB) → 403 before any Redis claim / bid RPC.
func TestAcceptOffer_deniedWhenOutsideScheduleAndNotAvailableNow(t *testing.T) {
	// No cache / bid client required — eligibility fails first.
	providerID := "dddddddd-eeee-ffff-0000-111111111111"
	jobID := "22222222-3333-4444-5555-666666666666"

	userClient := &mockProviderProfileClient{
		profile: providerProfile(providerID, true /* enabled */, false /* available_now */),
	}
	h := NewInstantMatchHandler(nil, nil, nil, nil, userClient, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/provider/offers/"+jobID+"/accept", nil)
	req = addClaimsToRequest(req, providerID, "provider@example.com", []string{"provider"})
	req = withChiURLParam(req, "jobId", jobID)
	rec := httptest.NewRecorder()

	h.AcceptOffer(rec, req)

	require.Equal(t, http.StatusForbidden, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "you are not currently available for instant match", body["error"])
}

// TestAcceptOffer_deniedWhenInstantDisabled covers the other ineligible branch
// (instant_enabled=false) so Accept remains gated even if available_now is true.
func TestAcceptOffer_deniedWhenInstantDisabled(t *testing.T) {
	providerID := "eeeeeeee-ffff-0000-1111-222222222222"
	jobID := "33333333-4444-5555-6666-777777777777"

	userClient := &mockProviderProfileClient{
		profile: providerProfile(providerID, false /* enabled */, true /* available_now */),
	}
	h := NewInstantMatchHandler(nil, nil, nil, nil, userClient, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/provider/offers/"+jobID+"/accept", nil)
	req = addClaimsToRequest(req, providerID, "provider@example.com", []string{"provider"})
	req = withChiURLParam(req, "jobId", jobID)
	rec := httptest.NewRecorder()

	h.AcceptOffer(rec, req)

	require.Equal(t, http.StatusForbidden, rec.Code, "body=%s", rec.Body.String())
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "you are not currently available for instant match", body["error"])
}
