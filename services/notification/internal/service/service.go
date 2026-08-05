package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
)

// Service implements notification business logic.
type Service struct {
	repo       domain.NotificationRepository
	deviceRepo domain.DeviceTokenRepository
	ledger     domain.SendLedgerRepository
	email      *EmailDispatcher
	push       *PushDispatcher
	webPush    *WebPushDispatcher
	sms        *SMSDispatcher
}

// New creates a new notification service. webPush may be nil — in that
// case browser-side W3C Web Push delivery is skipped and only the FCM/APNs
// path runs (matches pre-PWA behavior). Both dispatchers run on the same
// notification — they target different subscriber sets. ledger backs the
// push cooldowns (IOS-SYS.NT.1); a nil ledger disables them (fail open).
func New(repo domain.NotificationRepository, deviceRepo domain.DeviceTokenRepository, ledger domain.SendLedgerRepository, email *EmailDispatcher, push *PushDispatcher, webPush *WebPushDispatcher, sms *SMSDispatcher) *Service {
	return &Service{
		repo:       repo,
		deviceRepo: deviceRepo,
		ledger:     ledger,
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
			delivery := s.dispatchPush(ctx, userID, notifType, title, body, actionURL, entityType, entityID, data)
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
// either one delivers. iOS tokens route to APNs; android/web to FCM.
//
// Before any dispatch the send-ledger cooldown runs (IOS-SYS.NT.1):
// promotional types cap at 1 push / user / 24h per type and 3 promotional
// pushes / user / 24h total; everything else shares a generous 20 pushes /
// user / hour anti-storm cap. A blocked push is skipped — the in-app row
// still delivers — and counted on notification_push_cooldown_skips_total.
func (s *Service) dispatchPush(ctx context.Context, userID, notifType, title, body, actionURL, entityType, entityID string, data map[string]string) ChannelDelivery {
	if verdict := s.pushCooldownVerdict(ctx, userID, notifType); !verdict.allowed {
		pushCooldownSkipsTotal.WithLabelValues(verdict.class, verdict.limit).Inc()
		slog.InfoContext(ctx, "push dispatch skipped: cooldown",
			"user_id", userID,
			"type", notifType,
			"class", verdict.class,
			"limit", verdict.limit,
			"reason", verdict.reason,
		)
		return ChannelDelivery{Channel: "push", Delivered: false, FailureReason: "rate limited: " + verdict.reason}
	}

	totalSent := 0
	totalErrs := 0
	noTokens := false

	// Device token path: route each token by platform (ios → APNs, else FCM).
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
		var badge *int
		if unread, uerr := s.repo.GetUnreadCount(ctx, userID); uerr == nil {
			// Include the notification about to be persisted.
			b := unread + 1
			badge = &b
		}
		sent, stale, errs := s.push.SendMultiple(ctx, tokens, pushMessage{
			Title:      title,
			Body:       body,
			ActionURL:  actionURL,
			NotifType:  notifType,
			Badge:      badge,
			EntityType: entityType,
			EntityID:   entityID,
		})
		totalSent += sent
		totalErrs += len(errs)
		// IOS-SYS.NT.4: APNs declared these tokens permanently gone (410
		// Unregistered / 400 BadDeviceToken) — delete the rows so the next
		// notification stops pushing at dead devices.
		s.pruneStaleDeviceTokens(ctx, userID, stale)

		// IOS-SYS.LA.3: fan out ActivityKit content-state to matching LA tokens
		// (device_id = liveactivity:<auctionID>). Best-effort; does not affect
		// alert delivery accounting.
		laSent := s.dispatchLiveActivityForAuction(ctx, tokens, notifType, entityType, entityID, data, title, body)
		totalSent += laSent
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

	if totalSent > 0 {
		// Consume cooldown budget only for real deliveries: a fan-out where
		// nothing went out (no tokens / all sends failed) must not burn the
		// user's 1-per-24h promotional slot.
		s.recordPushSend(ctx, userID, notifType)
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

// auctionEntityTypes are entity_type values that can own a Live Activity.
var auctionEntityTypes = map[string]struct{}{
	"job": {}, "listing": {}, "auction": {},
}

// liveActivityNotifTypes trigger an LA content-state push when a matching
// ios_live_activity token is registered for the auction entity.
var liveActivityNotifTypes = map[string]struct{}{
	"new_bid":              {},
	"bid_outbid":           {},
	"auction_closing_soon": {},
	"auction_closed":       {},
	"bid_awarded":          {},
	"bid_not_selected":     {},
}

// dispatchLiveActivityForAuction sends ActivityKit liveactivity pushes to
// tokens whose device_id is liveactivity:<entityID> (IOS-SYS.LA.3 fan-out).
// Returns the number of successful LA sends (best-effort; errors only logged).
func (s *Service) dispatchLiveActivityForAuction(
	ctx context.Context,
	tokens []domain.DeviceToken,
	notifType, entityType, entityID string,
	data map[string]string,
	title, body string,
) int {
	if s.push == nil {
		return 0
	}
	if _, ok := liveActivityNotifTypes[notifType]; !ok {
		return 0
	}
	auctionID := strings.TrimSpace(entityID)
	if auctionID == "" && data != nil {
		if v := strings.TrimSpace(data["auction_id"]); v != "" {
			auctionID = v
		} else if v := strings.TrimSpace(data["entity_id"]); v != "" {
			auctionID = v
		}
	}
	if auctionID == "" {
		return 0
	}
	if et := strings.ToLower(strings.TrimSpace(entityType)); et != "" {
		if _, ok := auctionEntityTypes[et]; !ok {
			// Still allow when entity_type empty but auction_id present.
			if strings.TrimSpace(entityType) != "" {
				return 0
			}
		}
	}

	isEnd := notifType == "auction_closed" || notifType == "bid_awarded" || notifType == "bid_not_selected"
	contentState, ok := buildLiveActivityContentState(data, notifType, isEnd)
	if !ok {
		// Without leading/ends fields we can still end the activity.
		if !isEnd {
			return 0
		}
		contentState = map[string]any{}
		if outcome := liveActivityOutcome(notifType, data); outcome != "" {
			contentState["outcome"] = outcome
		}
	}

	event := "update"
	if isEnd {
		event = "end"
	}

	sent := 0
	for _, dt := range tokens {
		if !strings.EqualFold(strings.TrimSpace(dt.Platform), platformIOSLiveActivity) {
			continue
		}
		id, ok := ParseLiveActivityAuctionID(dt.DeviceID)
		if !ok || !strings.EqualFold(id, auctionID) {
			continue
		}
		upd := LiveActivityUpdate{
			DeviceToken:  dt.Token,
			Event:        event,
			ContentState: contentState,
			AlertTitle:   title,
			AlertBody:    body,
		}
		if isEnd {
			dismissal := time.Now().Add(15 * time.Minute).Unix()
			upd.DismissalDate = &dismissal
		}
		if err := s.push.SendLiveActivityUpdate(ctx, upd); err != nil {
			slog.WarnContext(ctx, "liveactivity dispatch failed",
				"auction_id", auctionID,
				"notif_type", notifType,
				"error", err,
			)
			continue
		}
		sent++
	}
	return sent
}

// buildLiveActivityContentState maps notification data into the iOS
// AuctionActivityAttributes.ContentState keys (leadingBidCents, endsAt, outcome).
// Returns ok=false when required fields for an update are missing.
func buildLiveActivityContentState(data map[string]string, notifType string, isEnd bool) (map[string]any, bool) {
	cs := map[string]any{}
	hasLead := false
	hasEnds := false
	if data != nil {
		for _, key := range []string{"leading_bid_cents", "leadingBidCents", "amount_cents", "bid_cents"} {
			if v := strings.TrimSpace(data[key]); v != "" {
				if n, err := strconv.ParseInt(v, 10, 64); err == nil {
					cs["leadingBidCents"] = n
					hasLead = true
					break
				}
			}
		}
		for _, key := range []string{"ends_at", "endsAt", "auction_ends_at"} {
			if v := strings.TrimSpace(data[key]); v != "" {
				if unix, ok := parseEndsAtUnix(v); ok {
					cs["endsAt"] = unix
					hasEnds = true
					break
				}
			}
		}
	}
	if outcome := liveActivityOutcome(notifType, data); outcome != "" {
		cs["outcome"] = outcome
	}
	if isEnd {
		return cs, true
	}
	return cs, hasLead && hasEnds
}

func liveActivityOutcome(notifType string, data map[string]string) string {
	if data != nil {
		if v := strings.TrimSpace(data["outcome"]); v != "" {
			return v
		}
	}
	switch notifType {
	case "bid_awarded":
		return "won"
	case "bid_not_selected":
		return "lost"
	case "auction_closed":
		return "ended"
	default:
		return ""
	}
}

func parseEndsAtUnix(v string) (int64, bool) {
	if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
		// Heuristic: values < year 2100 in seconds stay as-is; ms → seconds.
		if n > 1_000_000_000_000 {
			return n / 1000, true
		}
		return n, true
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t.Unix(), true
	}
	return 0, false
}

// cooldownVerdict is the outcome of a push cooldown check.
type cooldownVerdict struct {
	allowed bool
	class   string // "promotional" | "transactional"
	limit   string // cap that tripped: "per_type" | "class_total" | "hourly_storm"
	reason  string // human-readable, safe to surface in FailureReason
}

// pushCooldownVerdict enforces the IOS-SYS.NT.1 send-ledger cooldowns.
//
// Fail-open posture: this is an anti-spam/anti-storm limiter, not an authz
// gate — on a ledger read error (or a nil ledger) we allow the push and warn,
// matching how preference reads already fail toward delivery. The check and
// the later RecordSend are not transactional; a concurrent race can let one
// extra push through, which is acceptable for rate limiting.
func (s *Service) pushCooldownVerdict(ctx context.Context, userID, notifType string) cooldownVerdict {
	allow := cooldownVerdict{allowed: true}
	if s.ledger == nil {
		return allow
	}
	now := time.Now().UTC()

	if isPromotionalNotifType(notifType) {
		perType, err := s.ledger.CountSendsForType(ctx, userID, notifType, pushLedgerChannel, now.Add(-promoPerTypeWindow))
		if err != nil {
			slog.WarnContext(ctx, "push cooldown: per-type ledger read failed, allowing send",
				"user_id", userID, "type", notifType, "error", err)
			return allow
		}
		if perType >= promoPerTypeMax {
			return cooldownVerdict{
				class:  "promotional",
				limit:  "per_type",
				reason: fmt.Sprintf("promotional cooldown: max %d %q push per user per %s", promoPerTypeMax, notifType, promoPerTypeWindow),
			}
		}

		classTotal, err := s.ledger.CountSendsMatching(ctx, userID, pushLedgerChannel, promotionalSendClass(), true, now.Add(-promoClassWindow))
		if err != nil {
			slog.WarnContext(ctx, "push cooldown: promotional class ledger read failed, allowing send",
				"user_id", userID, "type", notifType, "error", err)
			return allow
		}
		if classTotal >= promoClassMax {
			return cooldownVerdict{
				class:  "promotional",
				limit:  "class_total",
				reason: fmt.Sprintf("promotional cooldown: max %d promotional pushes per user per %s", promoClassMax, promoClassWindow),
			}
		}
		return allow
	}

	// Transactional (everything non-promotional): generous anti-storm cap.
	recent, err := s.ledger.CountSendsMatching(ctx, userID, pushLedgerChannel, promotionalSendClass(), false, now.Add(-transactionalWindow))
	if err != nil {
		slog.WarnContext(ctx, "push cooldown: transactional ledger read failed, allowing send",
			"user_id", userID, "type", notifType, "error", err)
		return allow
	}
	if recent >= transactionalMax {
		return cooldownVerdict{
			class:  "transactional",
			limit:  "hourly_storm",
			reason: fmt.Sprintf("anti-storm cap: max %d transactional pushes per user per %s", transactionalMax, transactionalWindow),
		}
	}
	return allow
}

// recordPushSend stamps a successful push dispatch into the send ledger.
// Best-effort: the pushes are already out, so a ledger write failure must not
// fail the notification — it only weakens the next cooldown check.
func (s *Service) recordPushSend(ctx context.Context, userID, notifType string) {
	if s.ledger == nil {
		return
	}
	if err := s.ledger.RecordSend(ctx, userID, notifType, pushLedgerChannel); err != nil {
		slog.WarnContext(ctx, "push send ledger write failed",
			"user_id", userID,
			"type", notifType,
			"error", err,
		)
	}
}

// pruneStaleDeviceTokens deletes device-token rows APNs reported as
// permanently unregistered (IOS-SYS.NT.4). DeleteDeviceToken matches on
// token OR device_id, so passing the raw token value is sufficient.
func (s *Service) pruneStaleDeviceTokens(ctx context.Context, userID string, staleTokens []string) {
	for _, token := range staleTokens {
		err := s.deviceRepo.DeleteDeviceToken(ctx, userID, token)
		switch {
		case err == nil:
			staleDeviceTokensPrunedTotal.Inc()
			slog.InfoContext(ctx, "pruned unregistered device token",
				"user_id", userID,
				"device_token", truncateToken(token),
			)
		case errors.Is(err, domain.ErrDeviceTokenNotFound):
			// Already gone (concurrent unregister) — nothing to do.
		default:
			slog.WarnContext(ctx, "failed to prune unregistered device token",
				"user_id", userID,
				"device_token", truncateToken(token),
				"error", err,
			)
		}
	}
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
