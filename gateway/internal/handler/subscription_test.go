package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	subscriptionv1 "github.com/nomarkup/nomarkup/proto/subscription/v1"
)

// paidStripeUsage is a Pro-tier gRPC payload used to prove iOS + IAP-off
// overrides only the digital caps, not live usage counts.
func paidStripeUsage() *subscriptionv1.GetUsageResponse {
	return &subscriptionv1.GetUsageResponse{
		ActiveBids:           2,
		MaxActiveBids:        50,
		ServiceCategories:    4,
		MaxServiceCategories: 10,
		PortfolioImages:      8,
		MaxPortfolioImages:   100,
		CurrentFeePercentage: 0.05,
	}
}

func paidStripeSubscription() *subscriptionv1.Subscription {
	return &subscriptionv1.Subscription{
		Id:                   "sub-stripe-1",
		UserId:               "user-1",
		TierId:               "tier-pro",
		Status:               subscriptionv1.SubscriptionStatus_SUBSCRIPTION_STATUS_ACTIVE,
		StripeSubscriptionId: "sub_stripe_abc",
		CurrentPriceCents:    2999,
		Tier: &subscriptionv1.SubscriptionTier{
			Id:                "tier-pro",
			Name:              "Pro",
			Slug:              "pro",
			MaxActiveBids:     50,
			AnalyticsAccess:   true,
			FeaturedPlacement: true,
			InstantEnabled:    true,
		},
	}
}

type subscriptionClientStub struct {
	subscriptionv1.SubscriptionServiceClient
	usage            *subscriptionv1.GetUsageResponse
	usageErr         error
	subscription     *subscriptionv1.Subscription
	subscriptionErr  error
	featureAccess    *subscriptionv1.CheckFeatureAccessResponse
	featureAccessErr error
}

func (s *subscriptionClientStub) GetUsage(_ context.Context, _ *subscriptionv1.GetUsageRequest, _ ...grpc.CallOption) (*subscriptionv1.GetUsageResponse, error) {
	if s.usageErr != nil {
		return nil, s.usageErr
	}
	return s.usage, nil
}

func (s *subscriptionClientStub) GetSubscription(_ context.Context, _ *subscriptionv1.GetSubscriptionRequest, _ ...grpc.CallOption) (*subscriptionv1.GetSubscriptionResponse, error) {
	if s.subscriptionErr != nil {
		return nil, s.subscriptionErr
	}
	return &subscriptionv1.GetSubscriptionResponse{Subscription: s.subscription}, nil
}

func (s *subscriptionClientStub) CheckFeatureAccess(_ context.Context, _ *subscriptionv1.CheckFeatureAccessRequest, _ ...grpc.CallOption) (*subscriptionv1.CheckFeatureAccessResponse, error) {
	if s.featureAccessErr != nil {
		return nil, s.featureAccessErr
	}
	return s.featureAccess, nil
}

type iosUnlockCase struct {
	name         string
	clientHeader string
	iapVerify    string
	wantFree     bool
}

func iosUnlockCases() []iosUnlockCase {
	return []iosUnlockCase{
		{name: "ios_header_iap_verify_off_free_caps", clientHeader: "ios", iapVerify: "", wantFree: true},
		{name: "ios_header_mixed_case_iap_verify_off", clientHeader: "iOS", iapVerify: "false", wantFree: true},
		{name: "ios_header_iap_verify_on_passthrough", clientHeader: "ios", iapVerify: "true", wantFree: false},
		{name: "no_header_passthrough", clientHeader: "", iapVerify: "", wantFree: false},
		{name: "web_header_passthrough", clientHeader: "web", iapVerify: "", wantFree: false},
	}
}

func TestSubscriptionHandler_GetUsage_iOSClientStripeUnlocks(t *testing.T) {
	for _, tt := range iosUnlockCases() {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("APP_STORE_IAP_VERIFY", tt.iapVerify)

			h := NewSubscriptionHandler(&subscriptionClientStub{usage: paidStripeUsage()})
			req := httptest.NewRequest(http.MethodGet, "/api/v1/subscriptions/usage", nil)
			req = addClaimsToRequest(req, "user-1", "test@example.com", []string{"provider"})
			if tt.clientHeader != "" {
				req.Header.Set(noMarkupClientHeader, tt.clientHeader)
			}
			rec := httptest.NewRecorder()

			h.GetUsage(rec, req)

			require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
			var got struct {
				ActiveBids           int32   `json:"active_bids"`
				MaxActiveBids        int32   `json:"max_active_bids"`
				ServiceCategories    int32   `json:"service_categories"`
				MaxServiceCategories int32   `json:"max_service_categories"`
				PortfolioImages      int32   `json:"portfolio_images"`
				MaxPortfolioImages   int32   `json:"max_portfolio_images"`
				CurrentFeePercentage float64 `json:"current_fee_percentage"`
			}
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))

			assert.Equal(t, int32(2), got.ActiveBids)
			assert.Equal(t, int32(4), got.ServiceCategories)
			assert.Equal(t, int32(8), got.PortfolioImages)
			if tt.wantFree {
				assert.Equal(t, iosFreeMaxActiveBids, got.MaxActiveBids)
				assert.Equal(t, iosFreeMaxServiceCategories, got.MaxServiceCategories)
				assert.Equal(t, iosFreeMaxPortfolioImages, got.MaxPortfolioImages)
				assert.InDelta(t, iosFreeFeePercentage, got.CurrentFeePercentage, 1e-9)
			} else {
				assert.Equal(t, int32(50), got.MaxActiveBids)
				assert.Equal(t, int32(10), got.MaxServiceCategories)
				assert.Equal(t, int32(100), got.MaxPortfolioImages)
				assert.InDelta(t, 0.05, got.CurrentFeePercentage, 1e-9)
			}
		})
	}
}

func TestSubscriptionHandler_CheckFeatureAccess_iOSClientStripeUnlocks(t *testing.T) {
	paidFeatures := []struct {
		feature      string
		requiredTier string
	}{
		{feature: "analytics", requiredTier: "pro"},
		{feature: "featured_placement", requiredTier: "business"},
		{feature: "instant", requiredTier: "business"},
	}

	for _, tt := range iosUnlockCases() {
		for _, feat := range paidFeatures {
			t.Run(tt.name+"/"+feat.feature, func(t *testing.T) {
				t.Setenv("APP_STORE_IAP_VERIFY", tt.iapVerify)

				h := NewSubscriptionHandler(&subscriptionClientStub{
					featureAccess: &subscriptionv1.CheckFeatureAccessResponse{
						HasAccess:    true,
						RequiredTier: "",
					},
				})
				req := httptest.NewRequest(http.MethodGet, "/api/v1/subscriptions/features/"+feat.feature, nil)
				req = addClaimsToRequest(req, "user-1", "test@example.com", []string{"provider"})
				req = withChiURLParam(req, "feature", feat.feature)
				if tt.clientHeader != "" {
					req.Header.Set(noMarkupClientHeader, tt.clientHeader)
				}
				rec := httptest.NewRecorder()

				h.CheckFeatureAccess(rec, req)

				require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
				var got struct {
					HasAccess    bool   `json:"has_access"`
					RequiredTier string `json:"required_tier"`
				}
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
				if tt.wantFree {
					assert.False(t, got.HasAccess)
					assert.Equal(t, feat.requiredTier, got.RequiredTier)
				} else {
					assert.True(t, got.HasAccess)
					assert.Equal(t, "", got.RequiredTier)
				}
			})
		}
	}
}

func TestSubscriptionHandler_CheckFeatureAccess_iOSClientUnknownFeatureAllowed(t *testing.T) {
	t.Setenv("APP_STORE_IAP_VERIFY", "")

	h := NewSubscriptionHandler(&subscriptionClientStub{
		featureAccess: &subscriptionv1.CheckFeatureAccessResponse{
			HasAccess:    true,
			RequiredTier: "",
		},
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/subscriptions/features/basic_search", nil)
	req = addClaimsToRequest(req, "user-1", "test@example.com", []string{"provider"})
	req = withChiURLParam(req, "feature", "basic_search")
	req.Header.Set(noMarkupClientHeader, "ios")
	rec := httptest.NewRecorder()

	h.CheckFeatureAccess(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
	var got struct {
		HasAccess    bool   `json:"has_access"`
		RequiredTier string `json:"required_tier"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	assert.True(t, got.HasAccess)
	assert.Equal(t, "", got.RequiredTier)
}

func TestSubscriptionHandler_GetSubscription_iOSClientStripeUnlocks(t *testing.T) {
	for _, tt := range iosUnlockCases() {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("APP_STORE_IAP_VERIFY", tt.iapVerify)

			h := NewSubscriptionHandler(&subscriptionClientStub{subscription: paidStripeSubscription()})
			req := httptest.NewRequest(http.MethodGet, "/api/v1/subscriptions/me", nil)
			req = addClaimsToRequest(req, "user-1", "test@example.com", []string{"provider"})
			if tt.clientHeader != "" {
				req.Header.Set(noMarkupClientHeader, tt.clientHeader)
			}
			rec := httptest.NewRecorder()

			h.GetSubscription(rec, req)

			require.Equal(t, http.StatusOK, rec.Code, "body=%s", rec.Body.String())
			var got map[string]interface{}
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
			if tt.wantFree {
				assert.Nil(t, got["subscription"])
			} else {
				sub, ok := got["subscription"].(map[string]interface{})
				require.True(t, ok)
				assert.Equal(t, "sub-stripe-1", sub["id"])
				assert.Equal(t, "sub_stripe_abc", sub["stripe_subscription_id"])
			}
		})
	}
}
