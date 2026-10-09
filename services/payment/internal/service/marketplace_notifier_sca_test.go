package service

import (
	"context"
	"testing"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
)

type recordSender struct {
	typ notificationv1.NotificationType
}

func (r *recordSender) Send(_ context.Context, _ string, notificationType notificationv1.NotificationType,
	_, _, _ string, _ map[string]string) error {
	r.typ = notificationType
	return nil
}

func TestNotifyListingPaymentProblem_SCAUsesAuthType(t *testing.T) {
	t.Parallel()
	rec := &recordSender{}
	n := NewMarketplaceNotifier(rec)
	if n == nil {
		t.Fatal("expected notifier")
	}
	if err := n.NotifyListingPaymentProblem(context.Background(), "buyer-1", "ord-1",
		ChargeOutcomeAuthenticationRequired, "Confirm with your bank"); err != nil {
		t.Fatal(err)
	}
	if rec.typ != notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_AUTHENTICATION_REQUIRED {
		t.Fatalf("SCA type = %v, want PAYMENT_AUTHENTICATION_REQUIRED", rec.typ)
	}
}

func TestNotifyListingPaymentProblem_HardDeclineStaysFailed(t *testing.T) {
	t.Parallel()
	rec := &recordSender{}
	n := NewMarketplaceNotifier(rec)
	if err := n.NotifyListingPaymentProblem(context.Background(), "buyer-1", "ord-1",
		ChargeOutcomeCardDeclined, "Card was declined"); err != nil {
		t.Fatal(err)
	}
	if rec.typ != notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_FAILED {
		t.Fatalf("decline type = %v, want PAYMENT_FAILED", rec.typ)
	}
}
