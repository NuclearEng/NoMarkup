package grpc

import (
	"testing"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
)

// TestProtoPlatformToStringLiveActivity is the IOS-SYS.LA.3 registration half:
// DEVICE_PLATFORM_IOS_LIVE_ACTIVITY must persist as "ios_live_activity", not
// "unknown", so alert fan-out can exclude LA tokens.
func TestProtoPlatformToStringLiveActivity(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in   notificationv1.DevicePlatform
		want string
	}{
		{notificationv1.DevicePlatform_DEVICE_PLATFORM_IOS, "ios"},
		{notificationv1.DevicePlatform_DEVICE_PLATFORM_ANDROID, "android"},
		{notificationv1.DevicePlatform_DEVICE_PLATFORM_WEB, "web"},
		{notificationv1.DevicePlatform_DEVICE_PLATFORM_IOS_LIVE_ACTIVITY, "ios_live_activity"},
		{notificationv1.DevicePlatform_DEVICE_PLATFORM_UNSPECIFIED, "unknown"},
	}
	for _, tc := range cases {
		if got := protoPlatformToString(tc.in); got != tc.want {
			t.Errorf("protoPlatformToString(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
