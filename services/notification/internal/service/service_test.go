package service

import (
	"context"
	"testing"

	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockNotifRepo implements domain.NotificationRepository for testing.
type mockNotifRepo struct {
	notifications []*domain.Notification
	prefs         *domain.NotificationPreferences
	err           error
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

// mockDeviceRepo implements domain.DeviceTokenRepository for testing.
type mockDeviceRepo struct {
	tokens []domain.DeviceToken
	err    error
}

func (m *mockDeviceRepo) SaveDeviceToken(_ context.Context, _ string, _ string, _ string, _ string) error {
	return m.err
}

func (m *mockDeviceRepo) DeleteDeviceToken(_ context.Context, _ string, _ string) error {
	return m.err
}

func (m *mockDeviceRepo) GetDeviceTokens(_ context.Context, _ string) ([]domain.DeviceToken, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.tokens, nil
}

func newTestService(repo *mockNotifRepo, deviceRepo *mockDeviceRepo) *Service {
	return New(repo, deviceRepo, NewEmailDispatcher("", "", ""), NewPushDispatcher("", ""), NewSMSDispatcher("", "", ""))
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
