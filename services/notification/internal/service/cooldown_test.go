package service

// IOS-SYS.NT.1 — send-ledger push cooldown tests, plus the service-level half
// of the IOS-SYS.NT.4 410-prune path.

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// findChannelDelivery returns the delivery entry for the given channel,
// failing the test when it is absent.
func findChannelDelivery(t *testing.T, deliveries []ChannelDelivery, channel string) ChannelDelivery {
	t.Helper()
	for _, d := range deliveries {
		if d.Channel == channel {
			return d
		}
	}
	t.Fatalf("no %q delivery in %+v", channel, deliveries)
	return ChannelDelivery{}
}

func TestIsPromotionalNotifType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		notifType string
		want      bool
	}{
		{"price_drop", true},
		{"seller_new_listing", true},
		{"promotional", true},
		{"marketing", true},
		{"nps", true},
		{"nps_survey", true},
		{"welcome_day_1", true},
		{"welcome_day_3", true},
		{"welcome_day_7", true},
		{"reengagement_7d", true},
		{"reengagement_30d", true},
		{"  PRICE_DROP  ", true}, // defensive normalization
		{"bid_outbid", false},
		{"auction_closing_soon", false},
		{"auction_closed", false},
		{"new_message", false},
		{"contract_created", false},
		{"payment_received", false},
		{"welcome", false}, // prefix must fully match "welcome_day_"
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.notifType, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, isPromotionalNotifType(tt.notifType))
		})
	}
}

// TestPushCooldown_PromotionalPerType walks the full lifecycle: first send
// allowed → repeat inside 24h blocked (in-app still delivers) → allowed again
// once the window has elapsed.
func TestPushCooldown_PromotionalPerType(t *testing.T) {
	t.Parallel()

	repo := &mockNotifRepo{}
	device := &mockDeviceRepo{tokens: []domain.DeviceToken{{UserID: "user-1", Token: "tok-1", Platform: "ios"}}}
	ledger := &mockSendLedger{}
	svc := newTestServiceWithLedger(repo, device, ledger)
	ctx := context.Background()

	send := func() []ChannelDelivery {
		t.Helper()
		_, deliveries, err := svc.SendNotification(ctx, "user-1", "price_drop",
			"Price drop", "Watched listing dropped 15%", "/listings/1", nil, []string{"push"})
		require.NoError(t, err)
		return deliveries
	}

	// 1) First promotional push delivers (dev-mode dispatcher counts as sent).
	first := findChannelDelivery(t, send(), "push")
	assert.True(t, first.Delivered)
	require.Len(t, ledger.entries, 1, "successful push must be recorded in the ledger")
	assert.Equal(t, "push", ledger.entries[0].channel)

	// 2) Same type again inside the 24h window: push blocked, in-app intact.
	second := send()
	blocked := findChannelDelivery(t, second, "push")
	assert.False(t, blocked.Delivered)
	assert.Contains(t, blocked.FailureReason, "rate limited")
	inApp := findChannelDelivery(t, second, "in_app")
	assert.True(t, inApp.Delivered, "cooldown must only skip the push, not the in-app row")
	assert.Len(t, ledger.entries, 1, "a blocked push must not consume ledger budget")

	// 3) Window elapses → allowed again.
	ledger.ageAll(25 * time.Hour)
	third := findChannelDelivery(t, send(), "push")
	assert.True(t, third.Delivered)
	assert.Len(t, ledger.entries, 2)
}

// TestPushCooldown_PromotionalClassTotal proves the 3-per-24h cap across the
// whole promotional class blocks a type that has never been sent, while
// transactional types stay unaffected.
func TestPushCooldown_PromotionalClassTotal(t *testing.T) {
	t.Parallel()

	repo := &mockNotifRepo{}
	device := &mockDeviceRepo{tokens: []domain.DeviceToken{{UserID: "user-1", Token: "tok-1", Platform: "ios"}}}
	ledger := &mockSendLedger{}
	ledger.seed("user-1", "welcome_day_1", "push", time.Hour)
	ledger.seed("user-1", "welcome_day_3", "push", time.Hour)
	ledger.seed("user-1", "seller_new_listing", "push", time.Hour)
	svc := newTestServiceWithLedger(repo, device, ledger)
	ctx := context.Background()

	// price_drop was never sent (per-type count 0) but the class total is 3.
	_, deliveries, err := svc.SendNotification(ctx, "user-1", "price_drop",
		"Price drop", "b", "/listings/1", nil, []string{"push"})
	require.NoError(t, err)
	promo := findChannelDelivery(t, deliveries, "push")
	assert.False(t, promo.Delivered)
	assert.Contains(t, promo.FailureReason, "rate limited")

	// A transactional push is untouched by the promotional class cap.
	_, deliveries, err = svc.SendNotification(ctx, "user-1", "bid_outbid",
		"Outbid", "b", "/listings/1", nil, []string{"push"})
	require.NoError(t, err)
	transactional := findChannelDelivery(t, deliveries, "push")
	assert.True(t, transactional.Delivered)
}

// TestPushCooldown_TransactionalAntiStorm covers the 20-per-hour cap on
// non-promotional pushes: promotional history and out-of-window sends must
// not count against it.
func TestPushCooldown_TransactionalAntiStorm(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		seedCount     int
		seedType      string
		seedAge       time.Duration
		wantDelivered bool
	}{
		{"under cap", 19, "new_message", 10 * time.Minute, true},
		{"at cap", 20, "new_message", 10 * time.Minute, false},
		{"sends outside the hour window do not count", 20, "new_message", 2 * time.Hour, true},
		{"promotional history does not count", 20, "price_drop", 10 * time.Minute, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockNotifRepo{}
			device := &mockDeviceRepo{tokens: []domain.DeviceToken{{UserID: "user-1", Token: "tok-1", Platform: "ios"}}}
			ledger := &mockSendLedger{}
			for i := 0; i < tt.seedCount; i++ {
				ledger.seed("user-1", tt.seedType, "push", tt.seedAge)
			}
			svc := newTestServiceWithLedger(repo, device, ledger)

			_, deliveries, err := svc.SendNotification(context.Background(), "user-1", "bid_outbid",
				"Outbid", "b", "/listings/1", nil, []string{"push"})
			require.NoError(t, err)
			push := findChannelDelivery(t, deliveries, "push")
			assert.Equal(t, tt.wantDelivered, push.Delivered)
			if !tt.wantDelivered {
				assert.Contains(t, push.FailureReason, "rate limited")
			}
		})
	}
}

// TestPushCooldown_FailsOpen: the cooldown is an anti-spam limiter, not an
// authz gate — ledger read/write failures and a nil ledger must never block
// delivery.
func TestPushCooldown_FailsOpen(t *testing.T) {
	t.Parallel()

	// Every parallel subtest builds its own mocks — the mocks are not
	// goroutine-safe and must never be shared across t.Parallel goroutines.
	oneToken := func() *mockDeviceRepo {
		return &mockDeviceRepo{tokens: []domain.DeviceToken{{UserID: "user-1", Token: "tok-1", Platform: "ios"}}}
	}

	t.Run("count error allows send", func(t *testing.T) {
		t.Parallel()
		ledger := &mockSendLedger{countErr: errors.New("db down")}
		svc := newTestServiceWithLedger(&mockNotifRepo{}, oneToken(), ledger)
		_, deliveries, err := svc.SendNotification(context.Background(), "user-1", "price_drop",
			"t", "b", "/l/1", nil, []string{"push"})
		require.NoError(t, err)
		assert.True(t, findChannelDelivery(t, deliveries, "push").Delivered)
	})

	t.Run("record error does not fail delivery", func(t *testing.T) {
		t.Parallel()
		ledger := &mockSendLedger{recordErr: errors.New("db down")}
		svc := newTestServiceWithLedger(&mockNotifRepo{}, oneToken(), ledger)
		_, deliveries, err := svc.SendNotification(context.Background(), "user-1", "bid_outbid",
			"t", "b", "/l/1", nil, []string{"push"})
		require.NoError(t, err)
		assert.True(t, findChannelDelivery(t, deliveries, "push").Delivered)
	})

	t.Run("nil ledger disables cooldowns", func(t *testing.T) {
		t.Parallel()
		svc := newTestServiceWithLedger(&mockNotifRepo{}, oneToken(), nil)
		_, deliveries, err := svc.SendNotification(context.Background(), "user-1", "price_drop",
			"t", "b", "/l/1", nil, []string{"push"})
		require.NoError(t, err)
		assert.True(t, findChannelDelivery(t, deliveries, "push").Delivered)
	})
}

// TestPushCooldown_NoDeliveryNoBudget: a fan-out that delivers nothing (no
// registered tokens) must not consume the promotional budget.
func TestPushCooldown_NoDeliveryNoBudget(t *testing.T) {
	t.Parallel()

	repo := &mockNotifRepo{}
	ledger := &mockSendLedger{}
	svc := newTestServiceWithLedger(repo, &mockDeviceRepo{}, ledger) // zero tokens

	_, deliveries, err := svc.SendNotification(context.Background(), "user-1", "price_drop",
		"t", "b", "/l/1", nil, []string{"push"})
	require.NoError(t, err)
	assert.False(t, findChannelDelivery(t, deliveries, "push").Delivered)
	assert.Empty(t, ledger.entries, "no delivery → no ledger entry")
}

// TestDispatchPushPrunesUnregisteredTokens is the service half of
// IOS-SYS.NT.4: an APNs 410 Unregistered response must delete the dead
// device-token row via the repository.
func TestDispatchPushPrunesUnregisteredTokens(t *testing.T) {
	t.Parallel()

	dispatcher := newAPNsTestDispatcher(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusGone)
		_, _ = w.Write([]byte(`{"reason":"Unregistered"}`))
	}))

	repo := &mockNotifRepo{}
	device := &mockDeviceRepo{tokens: []domain.DeviceToken{{UserID: "user-1", Token: "dead-token", Platform: "ios"}}}
	ledger := &mockSendLedger{}
	svc := New(repo, device, ledger, NewEmailDispatcher("", "", ""), dispatcher, nil, NewSMSDispatcher("", "", ""))

	_, deliveries, err := svc.SendNotification(context.Background(), "user-1", "bid_outbid",
		"Outbid", "b", "/listings/1", nil, []string{"push"})
	require.NoError(t, err)

	push := findChannelDelivery(t, deliveries, "push")
	assert.False(t, push.Delivered, "the only token was dead")
	assert.Equal(t, []string{"dead-token"}, device.deleted, "410 token must be pruned from the store")
	assert.Empty(t, ledger.entries, "failed dispatch must not consume ledger budget")
}
