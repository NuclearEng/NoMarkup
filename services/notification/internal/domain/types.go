package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for the notification domain.
var (
	ErrNotificationNotFound = errors.New("notification not found")
	ErrPreferencesNotFound  = errors.New("preferences not found")
	ErrDeviceTokenNotFound  = errors.New("device token not found")
)

// Notification represents an in-app notification record.
type Notification struct {
	ID               string
	UserID           string
	NotificationType string
	Title            string
	Body             string
	ActionURL        string
	EntityType       string
	EntityID         string
	Channels         []string
	EmailSent        bool
	PushSent         bool
	Read             bool
	ReadAt           *time.Time
	CreatedAt        time.Time
}

// NotificationPreferences holds a user's notification delivery preferences.
type NotificationPreferences struct {
	UserID      string
	Preferences map[string]ChannelPrefs // notification_type -> channel prefs
	EmailDigest string                  // "immediate", "daily", "weekly", "off"
}

// ChannelPrefs defines per-channel enable/disable settings for a notification type.
type ChannelPrefs struct {
	InApp bool `json:"in_app"`
	Email bool `json:"email"`
	Push  bool `json:"push"`
	SMS   bool `json:"sms"`
}

// DeviceToken represents a registered push notification device.
type DeviceToken struct {
	ID         string
	UserID     string
	Token      string
	Platform   string // "ios", "android", "web"
	DeviceID   string // unique device identifier
	CreatedAt  time.Time
}

// NotificationRepository defines persistence operations for notifications and preferences.
type NotificationRepository interface {
	CreateNotification(ctx context.Context, n *Notification) (*Notification, error)
	ListNotifications(ctx context.Context, userID string, unreadOnly bool, page, pageSize int) ([]*Notification, int, error)
	MarkAsRead(ctx context.Context, notificationID, userID string) error
	MarkAllAsRead(ctx context.Context, userID string) (int, error)
	GetUnreadCount(ctx context.Context, userID string) (int, error)
	GetPreferences(ctx context.Context, userID string) (*NotificationPreferences, error)
	UpsertPreferences(ctx context.Context, prefs *NotificationPreferences) (*NotificationPreferences, error)
}

// DeviceTokenRepository defines persistence operations for device tokens.
type DeviceTokenRepository interface {
	SaveDeviceToken(ctx context.Context, userID, token, platform, deviceID string) error
	DeleteDeviceToken(ctx context.Context, userID, deviceID string) error
	GetDeviceTokens(ctx context.Context, userID string) ([]DeviceToken, error)
}
