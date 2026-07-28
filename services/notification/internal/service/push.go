package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
)

// platformIOSLiveActivity is the platform string the iOS client uses when it
// registers an ActivityKit Live Activity push token through the standard
// device-registration path (IOS-SYS.LA.3). Live Activity tokens are
// per-activity update tokens, NOT alert-push device tokens.
const platformIOSLiveActivity = "ios_live_activity"

// PushDispatcher sends mobile push notifications.
//
// Routing:
//   - platform "ios" → APNs HTTP/2 token auth (when configured), else log-only
//   - platform "android" / "web" / unknown → FCM legacy HTTP (when configured), else log-only
//
// iOS registers raw APNs device token hex (no Firebase SDK). Android may still
// use FCM registration tokens when the Android client ships with FCM.
type PushDispatcher struct {
	projectID   string
	serverKey   string
	fcmDevMode  bool
	apnsDevMode bool
	apns        *apnsProvider
	client      *http.Client
}

// NewPushDispatcher creates a dual-path push dispatcher.
// fcmServerKey empty → FCM deliveries are logged only.
// apnsCfg nil or invalid → APNs deliveries are logged only.
func NewPushDispatcher(fcmServerKey, projectID string, apnsCfg *APNsConfig) *PushDispatcher {
	p := &PushDispatcher{
		projectID:   projectID,
		serverKey:   fcmServerKey,
		fcmDevMode:  fcmServerKey == "",
		apnsDevMode: true,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
	if apnsCfg != nil {
		provider, err := newAPNsProvider(apnsCfg)
		if err != nil {
			slog.Warn("push dispatcher: APNs provider init failed; iOS pushes will log only",
				"error", err,
			)
		} else {
			p.apns = provider
			p.apnsDevMode = false
		}
	}
	return p
}

// Send dispatches a push to a single device, routing by platform.
func (p *PushDispatcher) Send(ctx context.Context, msg pushMessage) error {
	platform := strings.ToLower(strings.TrimSpace(msg.Platform))
	if platform == "" {
		platform = "unknown"
	}
	msg.Platform = platform

	switch platform {
	case "ios":
		return p.sendAPNs(ctx, msg)
	case platformIOSLiveActivity:
		// LA.3: never send an alert push to a Live Activity token (see the
		// fan-out exclusion in SendMultiple). Guarded here too so a direct
		// caller cannot fall through to the FCM branch with an APNs
		// ActivityKit token.
		slog.Info("push dispatcher: skipping alert push to live-activity token",
			"device_token", truncateToken(msg.DeviceToken),
			"type", msg.NotifType,
		)
		return nil
	default:
		// android, web, or anything else → FCM (best-effort).
		return p.sendFCM(ctx, msg)
	}
}

// SendMultiple dispatches the message to every registered device token,
// routing each by platform. Partial failure does not stop delivery to the
// remaining tokens. staleTokens returns the tokens APNs declared permanently
// gone (410 Unregistered / 400 BadDeviceToken) so the caller — who owns the
// token store — can prune them (IOS-SYS.NT.4).
func (p *PushDispatcher) SendMultiple(
	ctx context.Context,
	tokens []domain.DeviceToken,
	msg pushMessage,
) (sent int, staleTokens []string, errs []error) {
	for _, dt := range tokens {
		if strings.EqualFold(strings.TrimSpace(dt.Platform), platformIOSLiveActivity) {
			// LA.3 (safe half): Live Activity push tokens are ActivityKit
			// per-activity tokens — an `apns-push-type: alert` POST at one is
			// malformed, and the FCM default branch would be worse. They are
			// excluded from alert fan-out; the stored rows remain valid for
			// every existing query and for unregister-by-token.
			//
			// LA.3: the real `liveactivity` dispatch branch (apns-push-type:
			// liveactivity, apns-topic "<bundle-id>.push-type.liveactivity",
			// content-state payload) is NOT implementable on current
			// plumbing: (a) RegisterDeviceRequest.platform is a closed v1
			// proto enum with no live-activity value, so this platform string
			// cannot round-trip the RPC — the gateway maps unknown strings to
			// DEVICE_PLATFORM_UNSPECIFIED, which this service stores as
			// "unknown"; (b) device_tokens carries no auction_id ↔ token
			// association, so an auction event cannot be routed to the one
			// activity it belongs to; (c) the alert dispatch payload carries
			// no structured auction content-state. Shipping it needs a
			// v1-additive registration shape (activity token + auction id)
			// plus an auction-event source with bid state.
			continue
		}

		dm := msg
		dm.DeviceToken = dt.Token
		dm.Platform = dt.Platform
		if err := p.Send(ctx, dm); err != nil {
			var apnsErr *apnsSendError
			if errors.As(err, &apnsErr) && apnsErr.shouldPruneToken() {
				staleTokens = append(staleTokens, dt.Token)
			}
			slog.Warn("push dispatcher: failed to send to device",
				"device_token", truncateToken(dt.Token),
				"platform", dt.Platform,
				"error", err,
			)
			errs = append(errs, err)
		} else {
			sent++
		}
	}
	return sent, staleTokens, errs
}

func (p *PushDispatcher) sendAPNs(ctx context.Context, msg pushMessage) error {
	if p.apnsDevMode || p.apns == nil {
		slog.Info("push dispatcher (apns dev mode): would send iOS push",
			"device_token", truncateToken(msg.DeviceToken),
			"title", msg.Title,
			"type", msg.NotifType,
			"action_url", msg.ActionURL,
		)
		return nil
	}
	return p.apns.send(ctx, msg)
}

func (p *PushDispatcher) sendFCM(ctx context.Context, msg pushMessage) error {
	if p.fcmDevMode {
		slog.Info("push dispatcher (fcm dev mode): would send push notification",
			"device_token", truncateToken(msg.DeviceToken),
			"platform", msg.Platform,
			"title", msg.Title,
			"type", msg.NotifType,
		)
		return nil
	}

	data := map[string]string{
		"action_url": msg.ActionURL,
		"title":      msg.Title,
		"body":       msg.Body,
	}
	if msg.NotifType != "" {
		data["type"] = msg.NotifType
	}

	payload := fcmPayload{
		To: msg.DeviceToken,
		Notification: fcmNotification{
			Title:       msg.Title,
			Body:        msg.Body,
			ClickAction: msg.ActionURL,
		},
		Data: data,
	}

	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("push dispatcher marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://fcm.googleapis.com/fcm/send", bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("push dispatcher create request: %w", err)
	}
	req.Header.Set("Authorization", "key="+p.serverKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("push dispatcher send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("push dispatcher: fcm returned status %d", resp.StatusCode)
	}

	// Parse FCM response to check for individual message failures.
	var fcmResp fcmResponse
	if err := json.NewDecoder(resp.Body).Decode(&fcmResp); err != nil {
		// Non-fatal: the request itself succeeded.
		slog.Warn("push dispatcher: failed to decode fcm response", "error", err)
		return nil
	}

	if fcmResp.Failure > 0 {
		slog.Warn("push dispatcher: fcm reported failures",
			"success", fcmResp.Success,
			"failure", fcmResp.Failure,
			"device_token", truncateToken(msg.DeviceToken),
		)
		return fmt.Errorf("push dispatcher: fcm reported %d failure(s)", fcmResp.Failure)
	}

	slog.Info("push notification sent successfully",
		"device_token", truncateToken(msg.DeviceToken),
		"platform", msg.Platform,
		"title", msg.Title,
	)
	return nil
}

// --- FCM request/response types ---

type fcmPayload struct {
	To           string            `json:"to"`
	Notification fcmNotification   `json:"notification"`
	Data         map[string]string `json:"data,omitempty"`
}

type fcmNotification struct {
	Title       string `json:"title"`
	Body        string `json:"body"`
	ClickAction string `json:"click_action,omitempty"`
}

type fcmResponse struct {
	MulticastID int64 `json:"multicast_id"`
	Success     int   `json:"success"`
	Failure     int   `json:"failure"`
}
