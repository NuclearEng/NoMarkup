package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
)

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
	default:
		// android, web, or anything else → FCM (best-effort).
		return p.sendFCM(ctx, msg)
	}
}

// SendMultiple dispatches to every registered device token, routing each by platform.
// Partial failure does not stop delivery to remaining tokens.
func (p *PushDispatcher) SendMultiple(
	ctx context.Context,
	tokens []domain.DeviceToken,
	title, body, actionURL, notifType string,
	badge *int,
) (sent int, errs []error) {
	for _, dt := range tokens {
		msg := pushMessage{
			DeviceToken: dt.Token,
			Platform:    dt.Platform,
			Title:       title,
			Body:        body,
			ActionURL:   actionURL,
			NotifType:   notifType,
			Badge:       badge,
		}
		if err := p.Send(ctx, msg); err != nil {
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
	return sent, errs
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
