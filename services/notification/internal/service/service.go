package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
)

// Service implements notification business logic.
type Service struct {
	repo       domain.NotificationRepository
	deviceRepo domain.DeviceTokenRepository
	email      *EmailDispatcher
	push       *PushDispatcher
	webPush    *WebPushDispatcher
	sms        *SMSDispatcher
}

// New creates a new notification service. webPush may be nil — in that
// case browser-side W3C Web Push delivery is skipped and only the FCM/APNs
// path runs (matches pre-PWA behavior). Both dispatchers run on the same
// notification — they target different subscriber sets.
func New(repo domain.NotificationRepository, deviceRepo domain.DeviceTokenRepository, email *EmailDispatcher, push *PushDispatcher, webPush *WebPushDispatcher, sms *SMSDispatcher) *Service {
	return &Service{
		repo:       repo,
		deviceRepo: deviceRepo,
		email:      email,
		push:       push,
		webPush:    webPush,
		sms:        sms,
	}
}

// SendNotification checks user preferences for enabled channels (using defaults if the
// channels param is empty), creates the notification record, and dispatches to each
// enabled channel. Email/push/SMS dispatchers send real messages when API keys are
// configured, otherwise they log in dev mode. In-app always dispatches by creating the
// DB record.
func (s *Service) SendNotification(ctx context.Context, userID, notifType, title, body, actionURL string, data map[string]string, requestedChannels []string) (*domain.Notification, []ChannelDelivery, error) {
	if userID == "" {
		return nil, nil, fmt.Errorf("send notification: user_id is required")
	}
	if title == "" {
		return nil, nil, fmt.Errorf("send notification: title is required")
	}

	// Determine which channels to use.
	channels := requestedChannels
	if len(channels) == 0 {
		channels = s.resolveChannels(ctx, userID, notifType)
	} else {
		// A caller passed explicit channels (e.g. the welcome / re-engagement
		// / NPS schedulers, or the transactional password-reset / verification
		// emails). Explicit channels are an intent ("this notification wants
		// email"), NOT a license to ignore the user's preferences. Filter the
		// requested set against any preference the user has EXPLICITLY stored
		// for this type so a user who turned off the email channel for a
		// retention notification stops getting emailed — matching how the
		// nil-channel (resolveChannels) path already behaves.
		//
		// We only drop a channel the user has explicitly disabled for this
		// type. Channels with no stored preference (transactional emails sent
		// as `unspecified`, or a retention type the user never touched) pass
		// through unchanged, so this neither breaks password-reset email nor
		// silently disables a default-on retention send.
		channels = s.filterByExplicitPrefs(ctx, userID, notifType, channels)
	}

	// Ensure in_app is always included.
	hasInApp := false
	for _, ch := range channels {
		if ch == "in_app" {
			hasInApp = true
			break
		}
	}
	if !hasInApp {
		channels = append(channels, "in_app")
	}

	// Determine entity type and id from data map.
	entityType := ""
	entityID := ""
	if data != nil {
		if v, ok := data["entity_type"]; ok {
			entityType = v
		}
		if v, ok := data["entity_id"]; ok {
			entityID = v
		}
	}

	// Create the notification record (in-app delivery).
	notif := &domain.Notification{
		UserID:           userID,
		NotificationType: notifType,
		Title:            title,
		Body:             body,
		ActionURL:        actionURL,
		EntityType:       entityType,
		EntityID:         entityID,
		Channels:         channels,
	}

	// Dispatch to each channel.
	var deliveries []ChannelDelivery

	for _, ch := range channels {
		switch ch {
		case "in_app":
			// In-app is always delivered via the DB insert below.
			deliveries = append(deliveries, ChannelDelivery{Channel: "in_app", Delivered: true})
		case "email":
			delivery := s.dispatchEmail(ctx, userID, notifType, title, body, actionURL, data)
			if delivery.Delivered {
				notif.EmailSent = true
			}
			deliveries = append(deliveries, delivery)
		case "push":
			delivery := s.dispatchPush(ctx, userID, title, body, actionURL)
			if delivery.Delivered {
				notif.PushSent = true
			}
			deliveries = append(deliveries, delivery)
		case "sms":
			delivery := s.dispatchSMS(ctx, userID, title, body, data)
			deliveries = append(deliveries, delivery)
		default:
			deliveries = append(deliveries, ChannelDelivery{Channel: ch, Delivered: false, FailureReason: "unknown channel"})
		}
	}

	created, err := s.repo.CreateNotification(ctx, notif)
	if err != nil {
		return nil, nil, err
	}

	return created, deliveries, nil
}

// dispatchEmail sends an email notification for the given user.
func (s *Service) dispatchEmail(ctx context.Context, userID, notifType, title, body, actionURL string, data map[string]string) ChannelDelivery {
	// Extract email from data map. Callers should populate data["user_email"] when
	// requesting email delivery, since the notification service does not own the user
	// table and cannot query it directly without a cross-service call.
	email := ""
	if data != nil {
		email = data["user_email"]
	}
	if email == "" {
		slog.Warn("email dispatch skipped: no user_email in data",
			"user_id", userID,
			"type", notifType,
		)
		return ChannelDelivery{Channel: "email", Delivered: false, FailureReason: "no email address available"}
	}

	htmlBody, textBody := renderEmailHTML(notifType, title, body, actionURL)

	subject := title
	if err := s.email.Send(ctx, email, subject, htmlBody, textBody); err != nil {
		slog.Warn("email dispatch failed",
			"user_id", userID,
			"type", notifType,
			"error", err,
		)
		return ChannelDelivery{Channel: "email", Delivered: false, FailureReason: err.Error()}
	}

	return ChannelDelivery{Channel: "email", Delivered: true}
}

// dispatchPush sends push notifications to all of the user's registered
// FCM/APNs devices AND every W3C Web Push subscription. The two paths
// target disjoint subscriber sets (native app installs vs. installed
// PWA / browser push), so we fan out to both and report success if
// either one delivers. Audit Section J flagged FCM-only push as MISSING;
// the WebPushDispatcher closes that gap.
func (s *Service) dispatchPush(ctx context.Context, userID, title, body, actionURL string) ChannelDelivery {
	totalSent := 0
	totalErrs := 0
	noTokens := false

	// FCM/APNs path (existing, unchanged behavior).
	tokens, err := s.deviceRepo.GetDeviceTokens(ctx, userID)
	if err != nil {
		slog.Warn("push dispatch: failed to get device tokens",
			"user_id", userID,
			"error", err,
		)
		totalErrs++
	} else if len(tokens) == 0 {
		noTokens = true
	} else {
		deviceTokenStrings := make([]string, 0, len(tokens))
		for _, dt := range tokens {
			deviceTokenStrings = append(deviceTokenStrings, dt.Token)
		}
		sent, errs := s.push.SendMultiple(ctx, deviceTokenStrings, title, body, actionURL)
		totalSent += sent
		totalErrs += len(errs)
	}

	// W3C Web Push path. Skipped silently when the dispatcher is nil
	// (boot-time decision when VAPID keys are unset).
	if s.webPush != nil {
		webSent, webErrs := s.webPush.SendToUser(ctx, userID, title, body, actionURL, "")
		totalSent += webSent
		totalErrs += len(webErrs)
		if webSent > 0 {
			noTokens = false
		}
	}

	if totalSent == 0 && totalErrs > 0 {
		return ChannelDelivery{Channel: "push", Delivered: false, FailureReason: fmt.Sprintf("all %d sends failed", totalErrs)}
	}
	if totalSent == 0 && noTokens {
		slog.Info("push dispatch skipped: no device tokens or web subscriptions registered",
			"user_id", userID,
		)
		return ChannelDelivery{Channel: "push", Delivered: false, FailureReason: "no device tokens registered"}
	}

	if totalErrs > 0 {
		slog.Warn("push dispatch: partial failure",
			"user_id", userID,
			"sent", totalSent,
			"failed", totalErrs,
		)
	}

	return ChannelDelivery{Channel: "push", Delivered: true}
}

// dispatchSMS sends an SMS notification for the given user.
func (s *Service) dispatchSMS(ctx context.Context, userID, title, body string, data map[string]string) ChannelDelivery {
	// Extract phone from data map, similar to email.
	phone := ""
	if data != nil {
		phone = data["user_phone"]
	}
	if phone == "" {
		slog.Warn("sms dispatch skipped: no user_phone in data",
			"user_id", userID,
		)
		return ChannelDelivery{Channel: "sms", Delivered: false, FailureReason: "no phone number available"}
	}

	// SMS body: combine title and body, keep it concise for SMS limits.
	smsBody := fmt.Sprintf("NoMarkup: %s - %s", title, body)
	if len(smsBody) > 160 {
		smsBody = smsBody[:157] + "..."
	}

	if err := s.sms.Send(ctx, phone, smsBody); err != nil {
		slog.Warn("sms dispatch failed",
			"user_id", userID,
			"error", err,
		)
		return ChannelDelivery{Channel: "sms", Delivered: false, FailureReason: err.Error()}
	}

	return ChannelDelivery{Channel: "sms", Delivered: true}
}

// SendBulkNotification sends the same notification to multiple users.
func (s *Service) SendBulkNotification(ctx context.Context, userIDs []string, notifType, title, body, actionURL string, data map[string]string) (sent, failed int32) {
	for _, uid := range userIDs {
		_, _, err := s.SendNotification(ctx, uid, notifType, title, body, actionURL, data, nil)
		if err != nil {
			slog.Error("bulk notification failed for user", "user_id", uid, "error", err)
			failed++
		} else {
			sent++
		}
	}
	return sent, failed
}

// ListNotifications returns paginated notifications for a user.
func (s *Service) ListNotifications(ctx context.Context, userID string, unreadOnly bool, page, pageSize int) ([]*domain.Notification, int, error) {
	return s.repo.ListNotifications(ctx, userID, unreadOnly, page, pageSize)
}

// MarkAsRead marks a single notification as read.
func (s *Service) MarkAsRead(ctx context.Context, notificationID, userID string) error {
	return s.repo.MarkAsRead(ctx, notificationID, userID)
}

// MarkAllAsRead marks all unread notifications for a user as read.
func (s *Service) MarkAllAsRead(ctx context.Context, userID string) (int, error) {
	return s.repo.MarkAllAsRead(ctx, userID)
}

// GetUnreadCount returns the count of unread notifications for a user.
func (s *Service) GetUnreadCount(ctx context.Context, userID string) (int, error) {
	return s.repo.GetUnreadCount(ctx, userID)
}

// GetPreferences returns notification preferences for a user, with defaults for missing types.
func (s *Service) GetPreferences(ctx context.Context, userID string) (*domain.NotificationPreferences, error) {
	prefs, err := s.repo.GetPreferences(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrPreferencesNotFound) {
			// Return defaults.
			return defaultPreferences(userID), nil
		}
		return nil, err
	}
	return prefs, nil
}

// UpdatePreferences upserts notification preferences for a user.
func (s *Service) UpdatePreferences(ctx context.Context, prefs *domain.NotificationPreferences) (*domain.NotificationPreferences, error) {
	if prefs.EmailDigest == "" {
		prefs.EmailDigest = "daily"
	}
	return s.repo.UpsertPreferences(ctx, prefs)
}

// RegisterDevice saves a device token for push notifications.
func (s *Service) RegisterDevice(ctx context.Context, userID, token, platform, deviceID string) error {
	if userID == "" {
		return fmt.Errorf("register device: user_id is required")
	}
	if token == "" {
		return fmt.Errorf("register device: device_token is required")
	}
	if platform == "" {
		return fmt.Errorf("register device: platform is required")
	}
	return s.deviceRepo.SaveDeviceToken(ctx, userID, token, platform, deviceID)
}

// UnregisterDevice removes a device token for push notifications.
func (s *Service) UnregisterDevice(ctx context.Context, userID, deviceID string) error {
	if userID == "" {
		return fmt.Errorf("unregister device: user_id is required")
	}
	if deviceID == "" {
		return fmt.Errorf("unregister device: device_id is required")
	}
	return s.deviceRepo.DeleteDeviceToken(ctx, userID, deviceID)
}

// Unsubscribe processes an email unsubscribe token, disabling email notifications
// for the associated user and returning their email address.
func (s *Service) Unsubscribe(ctx context.Context, token string) (string, error) {
	if token == "" {
		return "", fmt.Errorf("unsubscribe: token is required")
	}

	userEmail, err := s.repo.DisableEmailByToken(ctx, token)
	if err != nil {
		return "", err
	}

	slog.Info("user unsubscribed from email notifications",
		"email", userEmail,
	)

	return userEmail, nil
}

// ChannelDelivery represents the delivery status for a single channel.
type ChannelDelivery struct {
	Channel       string
	Delivered     bool
	FailureReason string
}

// resolveChannels determines which channels to use based on user preferences.
func (s *Service) resolveChannels(ctx context.Context, userID, notifType string) []string {
	prefs, err := s.repo.GetPreferences(ctx, userID)
	if err != nil {
		// Default: in_app only.
		return []string{"in_app"}
	}

	cp, ok := prefs.Preferences[notifType]
	if !ok {
		// Use defaults for this notification type.
		cp = defaultChannelPrefs(notifType)
	}

	var channels []string
	if cp.InApp {
		channels = append(channels, "in_app")
	}
	if cp.Email {
		channels = append(channels, "email")
	}
	if cp.Push {
		channels = append(channels, "push")
	}
	if cp.SMS {
		channels = append(channels, "sms")
	}

	if len(channels) == 0 {
		channels = []string{"in_app"}
	}
	return channels
}

// filterByExplicitPrefs removes any channel the user has EXPLICITLY disabled
// for this notification type from the requested set. It only consults
// preferences the user has actually stored (the repository returns exactly the
// types present in the JSONB column) — a type the user has never configured is
// left untouched so transactional sends (password reset / verification, sent as
// `unspecified`) and default-on retention notifications still deliver.
//
// in_app is never dropped here: SendNotification re-adds it unconditionally
// downstream, and the in-app record is the durable notification, so dropping it
// would lose the notification entirely. The dedicated in-app per-type toggle is
// already honored by the resolveChannels (nil-channel) path.
func (s *Service) filterByExplicitPrefs(ctx context.Context, userID, notifType string, requested []string) []string {
	prefs, err := s.repo.GetPreferences(ctx, userID)
	if err != nil {
		// No stored preferences (or a transient read error): respect the
		// caller's intent rather than guessing. Fail open toward delivery —
		// the same posture resolveChannels takes when GetPreferences errors.
		return requested
	}

	cp, ok := prefs.Preferences[notifType]
	if !ok {
		// User has never configured this type — nothing to enforce.
		return requested
	}

	filtered := make([]string, 0, len(requested))
	for _, ch := range requested {
		switch ch {
		case "email":
			if cp.Email {
				filtered = append(filtered, ch)
			}
		case "push":
			if cp.Push {
				filtered = append(filtered, ch)
			}
		case "sms":
			if cp.SMS {
				filtered = append(filtered, ch)
			}
		default:
			// in_app and any unknown channel pass through; in_app is always
			// re-added downstream regardless.
			filtered = append(filtered, ch)
		}
	}
	return filtered
}

// defaultPreferences returns default notification preferences for a new user.
func defaultPreferences(userID string) *domain.NotificationPreferences {
	prefs := &domain.NotificationPreferences{
		UserID:      userID,
		EmailDigest: "daily",
		Preferences: make(map[string]domain.ChannelPrefs),
	}

	// All notification types get default prefs.
	allTypes := []string{
		"new_bid", "bid_awarded", "bid_not_selected", "auction_closing_soon", "auction_closed",
		"offer_accepted", "contract_created", "contract_accepted", "work_started",
		"milestone_submitted", "milestone_approved", "revision_requested", "work_completed",
		"completion_approved", "payment_received", "payment_released", "payment_failed",
		"payout_sent", "new_message", "review_received", "review_reminder",
		"dispute_opened", "dispute_resolved", "tier_upgrade", "tier_downgrade",
		"document_approved", "document_rejected", "document_expiring",
		"change_order_proposed", "change_order_responded",
		"recurring_upcoming", "recurring_instance_ready",
		// Onboarding cadence + seller-follow retention loop.
		"welcome_day_1", "welcome_day_3", "welcome_day_7",
		"seller_new_listing",
		// Goods-marketplace retention: ≥10% drop vs. saved baseline on a
		// watched listing. Wired by price_drop_scheduler.go.
		"price_drop",
		// Goods auction outbid (notify:outbid:* → listing_scheduler.go) and
		// services pre-match (job.go notifyProviderOfMatch). Both are real
		// emit paths; list them so users can manage their channel prefs.
		"bid_outbid", "job_matched",
	}

	for _, t := range allTypes {
		prefs.Preferences[t] = defaultChannelPrefs(t)
	}

	return prefs
}

// defaultChannelPrefs returns default channel preferences for a notification type.
// In-app is always true. Email is true for critical types. Push and SMS are false by default.
func defaultChannelPrefs(notifType string) domain.ChannelPrefs {
	cp := domain.ChannelPrefs{
		InApp: true,
		Email: false,
		Push:  false,
		SMS:   false,
	}

	// Critical types also get email enabled by default.
	switch notifType {
	case "bid_awarded", "contract_created", "contract_accepted",
		"payment_received", "payment_released", "payment_failed",
		"dispute_opened", "dispute_resolved",
		"document_approved", "document_rejected", "document_expiring",
		"tier_upgrade", "tier_downgrade",
		"completion_approved", "work_completed",
		// Welcome cadence is email-led; we still gate on user prefs.
		"welcome_day_1", "welcome_day_3", "welcome_day_7":
		cp.Email = true
	}

	return cp
}
