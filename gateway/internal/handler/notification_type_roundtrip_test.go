package handler

import (
	"testing"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
)

func TestPaymentAuthenticationRequiredNotificationTypeRoundTrip(t *testing.T) {
	t.Parallel()

	const wire = "payment_authentication_required"
	got := stringToNotificationType(wire)
	if got == notificationv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED {
		t.Fatalf("stringToNotificationType(%q) = UNSPECIFIED", wire)
	}
	if got != notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_AUTHENTICATION_REQUIRED {
		t.Fatalf("stringToNotificationType(%q) = %v, want PAYMENT_AUTHENTICATION_REQUIRED", wire, got)
	}

	back := notificationTypeToString(got)
	if back == "unspecified" {
		t.Fatal("notificationTypeToString(PAYMENT_AUTHENTICATION_REQUIRED) = unspecified")
	}
	if back != wire {
		t.Fatalf("notificationTypeToString(PAYMENT_AUTHENTICATION_REQUIRED) = %q, want %q", back, wire)
	}
}
