package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockNotifRepo implements domain.NotificationRepository for testing.
type mockNotifRepo struct {
	notifications []*domain.Notification
	prefs         *domain.NotificationPreferences
	err           error
	issueErr      error
	issuedTokens  []string
}

func (m *mockNotifRepo) CreateNotification(_ context.Context, n *domain.Notification) (*domain.Notification, error) {
	if m.err != nil {
		return nil, m.err
	}
	n.ID = "notif-1"
	m.notifications = append(m.notifications, n)
	return n, nil
}

func (m *mockNotifRepo) ListNotifications(_ context.Context, _ string, _ bool, _ int, _ int) ([]*domain.Notification, int, error) {
	if m.err != nil {
		return nil, 0, m.err
	}
	return m.notifications, len(m.notifications), nil
}

func (m *mockNotifRepo) MarkAsRead(_ context.Context, _ string, _ string) error {
	return m.err
}

func (m *mockNotifRepo) MarkAllAsRead(_ context.Context, _ string) (int, error) {
	if m.err != nil {
		return 0, m.err
	}
	return len(m.notifications), nil
}

func (m *mockNotifRepo) GetUnreadCount(_ context.Context, _ string) (int, error) {
	if m.err != nil {
		return 0, m.err
	}
	count := 0
	for _, n := range m.notifications {
		if !n.Read {
			count++
		}
	}
	return count, nil
}

func (m *mockNotifRepo) GetPreferences(_ context.Context, _ string) (*domain.NotificationPreferences, error) {
	if m.prefs != nil {
		return m.prefs, nil
	}
	return nil, domain.ErrPreferencesNotFound
}

func (m *mockNotifRepo) UpsertPreferences(_ context.Context, prefs *domain.NotificationPreferences) (*domain.NotificationPreferences, error) {
	if m.err != nil {
		return nil, m.err
	}
	m.prefs = prefs
	return prefs, nil
}

func (m *mockNotifRepo) DisableEmailByToken(_ context.Context, token string) (string, error) {
	if token == "valid-token" {
		return "user@example.com", nil
	}
	return "", domain.ErrInvalidUnsubscribeToken
}

func (m *mockNotifRepo) IssueUnsubscribeToken(_ context.Context, userID string) (string, error) {
	if m.issueErr != nil {
		return "", m.issueErr
	}
	token := "unsub-" + userID
	m.issuedTokens = append(m.issuedTokens, token)
	return token, nil
}

// mockDeviceRepo implements domain.DeviceTokenRepository for testing.
// deleted records every DeleteDeviceToken identifier so 410-prune tests can
// assert against it.
type mockDeviceRepo struct {
	tokens  []domain.DeviceToken
	err     error
	deleted []string
}

func (m *mockDeviceRepo) SaveDeviceToken(_ context.Context, _ string, _ string, _ string, _ string) error {
	return m.err
}

func (m *mockDeviceRepo) DeleteDeviceToken(_ context.Context, _ string, deviceID string) error {
	if m.err != nil {
		return m.err
	}
	m.deleted = append(m.deleted, deviceID)
	return nil
}

func (m *mockDeviceRepo) GetDeviceTokens(_ context.Context, _ string) ([]domain.DeviceToken, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.tokens, nil
}

// mockSendLedger implements domain.SendLedgerRepository in memory.
// RecordSend stamps time.Now(); tests age entries by rewriting `at`.
type ledgerEntry struct {
	userID    string
	notifType string
	channel   string
	at        time.Time
}

type mockSendLedger struct {
	entries   []ledgerEntry
	recordErr error
	countErr  error
}

func (m *mockSendLedger) RecordSend(_ context.Context, userID, notificationType, channel string) error {
	if m.recordErr != nil {
		return m.recordErr
	}
	m.entries = append(m.entries, ledgerEntry{userID: userID, notifType: notificationType, channel: channel, at: time.Now()})
	return nil
}

func (m *mockSendLedger) CountSendsForType(_ context.Context, userID, notificationType, channel string, since time.Time) (int, error) {
	if m.countErr != nil {
		return 0, m.countErr
	}
	count := 0
	for _, e := range m.entries {
		if e.userID == userID && e.notifType == notificationType && e.channel == channel && !e.at.Before(since) {
			count++
		}
	}
	return count, nil
}

func (m *mockSendLedger) CountSendsMatching(_ context.Context, userID, channel string, class domain.SendTypeClass, matchClass bool, since time.Time) (int, error) {
	if m.countErr != nil {
		return 0, m.countErr
	}
	inClass := func(t string) bool {
		for _, exact := range class.ExactTypes {
			if t == exact {
				return true
			}
		}
		for _, prefix := range class.Prefixes {
			if strings.HasPrefix(t, prefix) {
				return true
			}
		}
		return false
	}
	count := 0
	for _, e := range m.entries {
		if e.userID == userID && e.channel == channel && !e.at.Before(since) && inClass(e.notifType) == matchClass {
			count++
		}
	}
	return count, nil
}

// ageAll rewrites every entry's timestamp to `age` ago — simulates the
// cooldown window elapsing without a clock injection.
func (m *mockSendLedger) ageAll(age time.Duration) {
	for i := range m.entries {
		m.entries[i].at = time.Now().Add(-age)
	}
}

// seed appends an entry `age` old.
func (m *mockSendLedger) seed(userID, notifType, channel string, age time.Duration) {
	m.entries = append(m.entries, ledgerEntry{userID: userID, notifType: notifType, channel: channel, at: time.Now().Add(-age)})
}

func newTestService(repo *mockNotifRepo, deviceRepo *mockDeviceRepo) *Service {
	return newTestServiceWithLedger(repo, deviceRepo, &mockSendLedger{})
}

func newTestServiceWithLedger(repo *mockNotifRepo, deviceRepo *mockDeviceRepo, ledger domain.SendLedgerRepository) *Service {
	// nil WebPushDispatcher → web-push fan-out is skipped (mirrors a deploy
	// without VAPID_PRIVATE_KEY). Tests still exercise the FCM path.
	return New(repo, deviceRepo, ledger, NewEmailDispatcher("", "", ""), NewPushDispatcher("", "", nil), nil, NewSMSDispatcher("", "", ""))
}

func TestSendNotification(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		userID      string
		title       string
		body        string
		wantErr     bool
		errContains string
	}{
		{
			name:    "valid notification",
			userID:  "user-1",
			title:   "New bid",
			body:    "You received a new bid on your job",
			wantErr: false,
		},
		{
			name:        "missing user_id",
			userID:      "",
			title:       "Test",
			body:        "Test body",
			wantErr:     true,
			errContains: "user_id is required",
		},
		{
			name:        "missing title",
			userID:      "user-1",
			title:       "",
			body:        "Test body",
			wantErr:     true,
			errContains: "title is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			repo := &mockNotifRepo{}
			svc := newTestService(repo, &mockDeviceRepo{})

			notif, deliveries, err := svc.SendNotification(
				context.Background(),
				tt.userID, "new_bid", tt.title, tt.body, "/jobs/1", nil, nil,
			)
			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
				assert.Nil(t, notif)
			} else {
				require.NoError(t, err)
				assert.NotNil(t, notif)
				assert.NotEmpty(t, deliveries)
				// in_app should always be included.
				hasInApp := false
				for _, d := range deliveries {
					if d.Channel == "in_app" {
						hasInApp = true
						assert.True(t, d.Delivered)
					}
				}
				assert.True(t, hasInApp, "in_app channel should always be included")
			}
		})
	}
}

// TestSendNotification_ExplicitChannelsRespectPrefs proves that an explicit
// channel set (as the welcome / re-engagement / NPS schedulers pass) is still
// filtered against a user's explicitly-stored per-type preference, while
// transactional sends with no stored preference for the type pass through.
func TestSendNotification_ExplicitChannelsRespectPrefs(t *testing.T) {
	t.Parallel()

	emailEnabled := func(deliveries []ChannelDelivery) (present, delivered bool) {
		for _, d := range deliveries {
			if d.Channel == "email" {
				return true, d.Delivered
			}
		}
		return false, false
	}

	t.Run("explicit email dropped when user disabled email for type", func(t *testing.T) {
		t.Parallel()
		repo := &mockNotifRepo{
			prefs: &domain.NotificationPreferences{
				UserID: "user-1",
				Preferences: map[string]domain.ChannelPrefs{
					// User turned OFF email for the welcome cadence.
					"welcome_day_1": {InApp: true, Email: false, Push: false, SMS: false},
				},
			},
		}
		svc := newTestService(repo, &mockDeviceRepo{})

		_, deliveries, err := svc.SendNotification(
			context.Background(), "user-1", "welcome_day_1",
			"Welcome", "body", "/marketplace",
			map[string]string{"user_email": "user@example.com"},
			[]string{"in_app", "email"}, // scheduler's explicit intent
		)
		require.NoError(t, err)
		present, _ := emailEnabled(deliveries)
		assert.False(t, present, "email channel must be filtered out when user disabled it for this type")
	})

	t.Run("explicit email kept when no stored pref for type (transactional)", func(t *testing.T) {
		t.Parallel()
		repo := &mockNotifRepo{
			prefs: &domain.NotificationPreferences{
				UserID: "user-1",
				Preferences: map[string]domain.ChannelPrefs{
					// Pref exists for an UNRELATED type; none for "unspecified".
					"new_bid": {InApp: true, Email: false},
				},
			},
		}
		svc := newTestService(repo, &mockDeviceRepo{})

		_, deliveries, err := svc.SendNotification(
			context.Background(), "user-1", "unspecified",
			"Reset your password", "link", "/reset",
			map[string]string{"user_email": "user@example.com"},
			[]string{"email"}, // password-reset transactional intent
		)
		require.NoError(t, err)
		present, delivered := emailEnabled(deliveries)
		assert.True(t, present, "transactional email must pass through when user has no pref for this type")
		assert.True(t, delivered, "email should be delivered (dev-mode no-op succeeds)")
	})

	t.Run("explicit promotional email dropped when the user has not opted in", func(t *testing.T) {
		t.Parallel()
		svc := newTestService(&mockNotifRepo{}, &mockDeviceRepo{})

		_, deliveries, err := svc.SendNotification(
			context.Background(), "user-1", "welcome_day_1",
			"Welcome", "body", "/marketplace",
			map[string]string{"user_email": "user@example.com"},
			[]string{"in_app", "email"},
		)
		require.NoError(t, err)
		present, _ := emailEnabled(deliveries)
		assert.False(t, present, "welcome email must not send until the user stores email=true for this type")
	})

	t.Run("explicit email kept when user enabled email for type", func(t *testing.T) {
		t.Parallel()
		repo := &mockNotifRepo{
			prefs: &domain.NotificationPreferences{
				UserID: "user-1",
				Preferences: map[string]domain.ChannelPrefs{
					"welcome_day_1": {InApp: true, Email: true},
				},
			},
		}
		svc := newTestService(repo, &mockDeviceRepo{})

		_, deliveries, err := svc.SendNotification(
			context.Background(), "user-1", "welcome_day_1",
			"Welcome", "body", "/marketplace",
			map[string]string{"user_email": "user@example.com"},
			[]string{"in_app", "email"},
		)
		require.NoError(t, err)
		present, delivered := emailEnabled(deliveries)
		assert.True(t, present, "email must be kept when user enabled it for this type")
		assert.True(t, delivered)
	})
}

func TestSendNotification_MessageInAppKeepsBody(t *testing.T) {
	t.Parallel()
	repo := &mockNotifRepo{}
	svc := newTestService(repo, &mockDeviceRepo{})
	const body = "The oak table is on the porch at Pine Avenue"
	notif, _, err := svc.SendNotification(
		context.Background(), "user-1", "new_message",
		"New message from Jordan Lee", body, "/messages?channel=abc",
		map[string]string{"entity_type": "chat_channel", "entity_id": "abc"},
		[]string{"in_app", "push"},
	)
	require.NoError(t, err)
	assert.Equal(t, body, notif.Body, "in-app record keeps the message; only the push alert is generic")
}

func TestSendNotification_PromoWithoutPreferenceDoesNotPush(t *testing.T) {
	t.Parallel()

	hasPush := func(deliveries []ChannelDelivery) bool {
		for _, d := range deliveries {
			if d.Channel == "push" {
				return true
			}
		}
		return false
	}

	t.Run("no preference row drops explicit promo push", func(t *testing.T) {
		t.Parallel()
		svc := newTestService(&mockNotifRepo{}, &mockDeviceRepo{})
		_, deliveries, err := svc.SendNotification(
			context.Background(), "user-1", "price_drop",
			"Price drop", "body", "/marketplace/1", nil,
			[]string{"in_app", "push"},
		)
		require.NoError(t, err)
		assert.False(t, hasPush(deliveries), "promo push must not send without a preference row")
	})

	t.Run("nil channels and no preference row do not push promo", func(t *testing.T) {
		t.Parallel()
		svc := newTestService(&mockNotifRepo{}, &mockDeviceRepo{})
		_, deliveries, err := svc.SendNotification(
			context.Background(), "user-1", "nps_survey",
			"How was your experience?", "body", "/dashboard", nil, nil,
		)
		require.NoError(t, err)
		assert.False(t, hasPush(deliveries))
	})

	t.Run("preference row without this promo type does not push", func(t *testing.T) {
		t.Parallel()
		repo := &mockNotifRepo{
			prefs: &domain.NotificationPreferences{
				UserID: "user-1",
				Preferences: map[string]domain.ChannelPrefs{
					"new_bid": {InApp: true, Push: true},
				},
			},
		}
		svc := newTestService(repo, &mockDeviceRepo{})
		_, deliveries, err := svc.SendNotification(
			context.Background(), "user-1", "nps_survey",
			"How was your experience?", "body", "/dashboard", nil,
			[]string{"in_app", "push"},
		)
		require.NoError(t, err)
		assert.False(t, hasPush(deliveries))
	})

	t.Run("stored promo push opt-in still pushes", func(t *testing.T) {
		t.Parallel()
		repo := &mockNotifRepo{
			prefs: &domain.NotificationPreferences{
				UserID: "user-1",
				Preferences: map[string]domain.ChannelPrefs{
					"price_drop": {InApp: true, Push: true},
				},
			},
		}
		svc := newTestService(repo, &mockDeviceRepo{
			tokens: []domain.DeviceToken{{UserID: "user-1", Token: "tok", Platform: "ios"}},
		})
		_, deliveries, err := svc.SendNotification(
			context.Background(), "user-1", "price_drop",
			"Price drop", "body", "/marketplace/1", nil,
			[]string{"push"},
		)
		require.NoError(t, err)
		assert.True(t, hasPush(deliveries), "explicit stored push opt-in must still push")
	})

	t.Run("transactional explicit push stays without a preference row", func(t *testing.T) {
		t.Parallel()
		svc := newTestService(&mockNotifRepo{}, &mockDeviceRepo{})
		_, deliveries, err := svc.SendNotification(
			context.Background(), "user-1", "bid_outbid",
			"Outbid", "body", "/marketplace/1", nil,
			[]string{"push"},
		)
		require.NoError(t, err)
		assert.True(t, hasPush(deliveries), "transactional push must still pass through with no preference row")
	})
}

func TestSendBulkNotification(t *testing.T) {
	t.Parallel()

	repo := &mockNotifRepo{}
	svc := newTestService(repo, &mockDeviceRepo{})

	sent, failed := svc.SendBulkNotification(
		context.Background(),
		[]string{"user-1", "user-2", "user-3"},
		"new_bid", "New bid", "A new bid was placed", "/jobs/1", nil,
	)
	assert.Equal(t, int32(3), sent)
	assert.Equal(t, int32(0), failed)
}

func TestGetPreferences_Defaults(t *testing.T) {
	t.Parallel()

	repo := &mockNotifRepo{} // no prefs stored
	svc := newTestService(repo, &mockDeviceRepo{})

	prefs, err := svc.GetPreferences(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Equal(t, "user-1", prefs.UserID)
	assert.Equal(t, "daily", prefs.EmailDigest)
	assert.NotEmpty(t, prefs.Preferences)

	// Critical types should have email enabled by default.
	bidAwarded, ok := prefs.Preferences["bid_awarded"]
	assert.True(t, ok)
	assert.True(t, bidAwarded.InApp)
	assert.True(t, bidAwarded.Email)
}

func TestUpdatePreferences(t *testing.T) {
	t.Parallel()

	repo := &mockNotifRepo{}
	svc := newTestService(repo, &mockDeviceRepo{})

	prefs := &domain.NotificationPreferences{
		UserID:      "user-1",
		EmailDigest: "",
		Preferences: map[string]domain.ChannelPrefs{
			"new_bid": {InApp: true, Email: true, Push: false, SMS: false},
		},
	}

	result, err := svc.UpdatePreferences(context.Background(), prefs)
	require.NoError(t, err)
	assert.Equal(t, "daily", result.EmailDigest) // default applied
}

func TestUpdatePreferencesMergesOmittedKeys(t *testing.T) {
	t.Parallel()

	repo := &mockNotifRepo{
		prefs: &domain.NotificationPreferences{
			UserID:      "user-1",
			EmailDigest: "weekly",
			Preferences: map[string]domain.ChannelPrefs{
				"price_drop": {InApp: true, Push: false},
				"new_bid":    {InApp: true, Email: true, Push: true},
			},
		},
	}
	svc := newTestService(repo, &mockDeviceRepo{})

	result, err := svc.UpdatePreferences(context.Background(), &domain.NotificationPreferences{
		UserID: "user-1",
		Preferences: map[string]domain.ChannelPrefs{
			"new_bid":     {InApp: true, Email: false, Push: false},
			"unspecified": {Push: true},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "weekly", result.EmailDigest)
	assert.Equal(t, domain.ChannelPrefs{InApp: true, Push: false}, result.Preferences["price_drop"])
	assert.Equal(t, domain.ChannelPrefs{InApp: true, Email: false, Push: false}, result.Preferences["new_bid"])
	_, junk := result.Preferences["unspecified"]
	assert.False(t, junk)
}

func TestUpdatePreferencesStoresGlobalSwitch(t *testing.T) {
	t.Parallel()
	off := false
	repo := &mockNotifRepo{
		prefs: &domain.NotificationPreferences{
			UserID: "user-1",
			Preferences: map[string]domain.ChannelPrefs{
				"new_bid":        {InApp: true, Push: true},
				"payment_failed": {InApp: true, Push: true, Email: true},
			},
		},
	}
	svc := newTestService(repo, &mockDeviceRepo{})
	result, err := svc.UpdatePreferences(context.Background(), &domain.NotificationPreferences{
		UserID:     "user-1",
		GlobalPush: &off,
		Preferences: map[string]domain.ChannelPrefs{
			"new_bid": {InApp: true, Push: true},
		},
	})
	require.NoError(t, err)
	assert.False(t, result.Preferences["_global_push"].Push)

	channels := svc.resolveChannels(context.Background(), "user-1", "new_bid")
	assert.NotContains(t, channels, "push")
	critical := svc.resolveChannels(context.Background(), "user-1", "payment_failed")
	assert.Contains(t, critical, "push")
}

func TestRegisterDevice(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		userID      string
		token       string
		platform    string
		deviceID    string
		wantErr     bool
		errContains string
	}{
		{
			name:     "valid device",
			userID:   "user-1",
			token:    "abc123",
			platform: "ios",
			deviceID: "device-1",
			wantErr:  false,
		},
		{
			name:        "missing user_id",
			userID:      "",
			token:       "abc123",
			platform:    "ios",
			deviceID:    "device-1",
			wantErr:     true,
			errContains: "user_id is required",
		},
		{
			name:        "missing token",
			userID:      "user-1",
			token:       "",
			platform:    "ios",
			deviceID:    "device-1",
			wantErr:     true,
			errContains: "device_token is required",
		},
		{
			name:        "missing platform",
			userID:      "user-1",
			token:       "abc123",
			platform:    "",
			deviceID:    "device-1",
			wantErr:     true,
			errContains: "platform is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			svc := newTestService(&mockNotifRepo{}, &mockDeviceRepo{})

			err := svc.RegisterDevice(context.Background(), tt.userID, tt.token, tt.platform, tt.deviceID)
			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestRenderEmailHTML_MarketingOptOutIsNotTheActionLink(t *testing.T) {
	t.Parallel()

	html, text := renderEmailHTML("welcome_day_1", "Welcome", "Hello", "https://no-markup.com/marketplace", "")
	assert.NotContains(t, html, `href="https://no-markup.com/marketplace">Unsubscribe`)
	assert.Contains(t, html, `href="https://no-markup.com/settings/notifications"`)
	assert.Contains(t, html, "To stop marketing email")
	assert.Contains(t, text, "https://no-markup.com/settings/notifications")
	assert.NotContains(t, text, "Unsubscribe")

	const pageURL = "https://no-markup.com/unsubscribe?token=tok-test"
	htmlWithToken, textWithToken := renderEmailHTML("welcome_day_1", "Welcome", "Hello", "https://no-markup.com/marketplace", pageURL)
	assert.Contains(t, htmlWithToken, `href="`+pageURL+`"`)
	assert.Contains(t, htmlWithToken, ">Unsubscribe<")
	assert.Contains(t, htmlWithToken, `href="https://no-markup.com/marketplace"`)
	assert.NotContains(t, htmlWithToken, `href="https://no-markup.com/marketplace">Unsubscribe`)
	assert.NotContains(t, htmlWithToken, `href="`+pageURL+`" class="btn"`)
	assert.Contains(t, textWithToken, "Unsubscribe: "+pageURL)
	assert.NotContains(t, htmlWithToken, "nomarkup.com")
	assert.NotContains(t, textWithToken, "nomarkup.com")
}

func TestUnsubscribeTargetsOwnedDomain(t *testing.T) {
	t.Parallel()

	svc := newTestService(&mockNotifRepo{}, &mockDeviceRepo{})
	web, api := svc.emailPublicBases()
	assert.Equal(t, "https://no-markup.com", web)
	assert.Equal(t, "https://api.no-markup.com", api)

	svc.SetPublicBases("https://no-markup.com/", "")
	svc.SetPublicBases("", "https://api.no-markup.com/")
	assert.Equal(t, "https://no-markup.com", svc.publicWebBase)
	assert.Equal(t, "https://api.no-markup.com", svc.publicAPIBase)
	svc.SetPublicBases("", "")
	assert.Equal(t, "https://no-markup.com", svc.publicWebBase)
	assert.Equal(t, "https://api.no-markup.com", svc.publicAPIBase)

	page, oneClick := unsubscribeTargets(svc.publicWebBase, svc.publicAPIBase, "tok-test")
	assert.Contains(t, page, "/unsubscribe?token=")
	assert.Equal(t, "https://no-markup.com/unsubscribe?token=tok-test", page)
	assert.Equal(t, "https://api.no-markup.com/api/v1/notifications/unsubscribe?token=tok-test", oneClick)
	assert.NotContains(t, page, "nomarkup.com")
	assert.NotContains(t, oneClick, "nomarkup.com")
}

func TestListUnsubscribeHeaders(t *testing.T) {
	t.Parallel()

	assert.Nil(t, listUnsubscribeHeaders(""))
	oneClick := "https://api.no-markup.com/api/v1/notifications/unsubscribe?token=tok-test"
	headers := listUnsubscribeHeaders(oneClick)
	assert.Equal(t, "<"+oneClick+">", headers["List-Unsubscribe"])
	assert.Equal(t, "List-Unsubscribe=One-Click", headers["List-Unsubscribe-Post"])
	assert.NotContains(t, headers["List-Unsubscribe"], "nomarkup.com")
}

func TestDispatchEmail_IssuesTokenAndSkipsSendWhenTokenFails(t *testing.T) {
	t.Parallel()

	repo := &mockNotifRepo{
		prefs: &domain.NotificationPreferences{
			UserID: "user-1",
			Preferences: map[string]domain.ChannelPrefs{
				"welcome_day_1": {InApp: true, Email: true},
			},
		},
	}
	svc := newTestService(repo, &mockDeviceRepo{})

	_, deliveries, err := svc.SendNotification(
		context.Background(), "user-1", "welcome_day_1",
		"Welcome", "Hello", "https://no-markup.com/marketplace",
		map[string]string{"user_email": "user@example.com"},
		[]string{"in_app", "email"},
	)
	require.NoError(t, err)
	require.Equal(t, []string{"unsub-user-1"}, repo.issuedTokens)
	assert.True(t, emailDelivery(deliveries).Delivered)

	repo.issueErr = errors.New("token store unavailable")
	_, deliveries, err = svc.SendNotification(
		context.Background(), "user-1", "welcome_day_1",
		"Welcome", "Hello", "https://no-markup.com/marketplace",
		map[string]string{"user_email": "user@example.com"},
		[]string{"in_app", "email"},
	)
	require.NoError(t, err)
	failed := emailDelivery(deliveries)
	assert.False(t, failed.Delivered)
	assert.Equal(t, "unsubscribe token unavailable", failed.FailureReason)
	assert.Equal(t, []string{"unsub-user-1"}, repo.issuedTokens)
}

func emailDelivery(deliveries []ChannelDelivery) ChannelDelivery {
	for _, d := range deliveries {
		if d.Channel == "email" {
			return d
		}
	}
	return ChannelDelivery{}
}

func TestDefaultChannelPrefs_WelcomeEmailIsOptIn(t *testing.T) {
	t.Parallel()

	for _, notifType := range []string{"welcome_day_1", "welcome_day_3", "welcome_day_7", "price_drop"} {
		prefs := defaultChannelPrefs(notifType)
		assert.False(t, prefs.Email, notifType)
		assert.False(t, prefs.Push, notifType)
		assert.True(t, prefs.InApp, notifType)
	}
}

func TestUnsubscribe(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		token     string
		wantEmail string
		wantErr   bool
	}{
		{
			name:      "valid token",
			token:     "valid-token",
			wantEmail: "user@example.com",
			wantErr:   false,
		},
		{
			name:    "empty token",
			token:   "",
			wantErr: true,
		},
		{
			name:    "invalid token",
			token:   "bad-token",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			svc := newTestService(&mockNotifRepo{}, &mockDeviceRepo{})

			email, err := svc.Unsubscribe(context.Background(), tt.token)
			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.wantEmail, email)
			}
		})
	}
}
