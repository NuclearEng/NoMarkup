package grpc

import (
	"testing"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
)

// TestNotificationTypeRoundTrip guards the string<->proto enum mapping that
// forms the rendering contract: a notification persisted with a given type
// string must convert to a real (non-UNSPECIFIED) proto enum so the frontend
// icon/label map resolves to a typed entry, not the default bell.
func TestNotificationTypeRoundTrip(t *testing.T) {
	t.Parallel()

	cases := []struct {
		typeString string
		want       notificationv1.NotificationType
	}{
		// Previously dropped to UNSPECIFIED despite being live emit paths.
		{"bid_outbid", notificationv1.NotificationType_NOTIFICATION_TYPE_BID_OUTBID},
		{"job_matched", notificationv1.NotificationType_NOTIFICATION_TYPE_JOB_MATCHED},
		// Sanity: an already-mapped type still round-trips.
		{"wishlist_match", notificationv1.NotificationType_NOTIFICATION_TYPE_WISHLIST_MATCH},
		{"new_bid", notificationv1.NotificationType_NOTIFICATION_TYPE_NEW_BID},
		// C4: SCA / 3DS is distinct from payment_failed.
		{"payment_authentication_required", notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_AUTHENTICATION_REQUIRED},
		{"payment_failed", notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_FAILED},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.typeString, func(t *testing.T) {
			t.Parallel()

			got := stringToProtoNotificationType(tc.typeString)
			if got != tc.want {
				t.Fatalf("stringToProtoNotificationType(%q) = %v, want %v", tc.typeString, got, tc.want)
			}
			if got == notificationv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED {
				t.Fatalf("type %q mapped to UNSPECIFIED — frontend would render the default bell icon", tc.typeString)
			}

			// And the inverse mapping must recover the original string.
			back := protoNotificationTypeToString(got)
			if back != tc.typeString {
				t.Fatalf("protoNotificationTypeToString(%v) = %q, want %q", got, back, tc.typeString)
			}
		})
	}
}
