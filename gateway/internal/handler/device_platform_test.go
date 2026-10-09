package handler

import (
	"testing"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
)

// TestStringToDevicePlatformLiveActivity is the IOS-SYS.LA.3 gateway half:
// platform "ios_live_activity" must map to the additive proto enum, not
// UNSPECIFIED (which the notification service would store as "unknown").
func TestStringToDevicePlatformLiveActivity(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in   string
		want notificationv1.DevicePlatform
	}{
		{"ios", notificationv1.DevicePlatform_DEVICE_PLATFORM_IOS},
		{"android", notificationv1.DevicePlatform_DEVICE_PLATFORM_ANDROID},
		{"web", notificationv1.DevicePlatform_DEVICE_PLATFORM_WEB},
		{"ios_live_activity", notificationv1.DevicePlatform_DEVICE_PLATFORM_IOS_LIVE_ACTIVITY},
		{"IOS_LIVE_ACTIVITY", notificationv1.DevicePlatform_DEVICE_PLATFORM_IOS_LIVE_ACTIVITY},
		{" ios_live_activity ", notificationv1.DevicePlatform_DEVICE_PLATFORM_IOS_LIVE_ACTIVITY},
		{"unknown_thing", notificationv1.DevicePlatform_DEVICE_PLATFORM_UNSPECIFIED},
		{"", notificationv1.DevicePlatform_DEVICE_PLATFORM_UNSPECIFIED},
	}
	for _, tc := range cases {
		if got := stringToDevicePlatform(tc.in); got != tc.want {
			t.Errorf("stringToDevicePlatform(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
