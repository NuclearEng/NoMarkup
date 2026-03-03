package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// PushDispatcher sends push notifications via Firebase Cloud Messaging (FCM).
type PushDispatcher struct {
	projectID string
	serverKey string
	devMode   bool
	client    *http.Client
}

// NewPushDispatcher creates a new push notification dispatcher. If serverKey
// is empty, the dispatcher operates in dev mode and logs instead of sending.
func NewPushDispatcher(serverKey, projectID string) *PushDispatcher {
	devMode := serverKey == ""
	return &PushDispatcher{
		projectID: projectID,
		serverKey: serverKey,
		devMode:   devMode,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Send dispatches a push notification to a single device token via FCM.
// In dev mode it logs instead of sending.
func (p *PushDispatcher) Send(ctx context.Context, deviceToken, title, body, actionURL string) error {
	if p.devMode {
		slog.Info("push dispatcher (dev mode): would send push notification",
			"device_token", deviceToken,
			"title", title,
		)
		return nil
	}

	payload := fcmPayload{
		To: deviceToken,
		Notification: fcmNotification{
			Title:       title,
			Body:        body,
			ClickAction: actionURL,
		},
		Data: map[string]string{
			"action_url": actionURL,
			"title":      title,
			"body":       body,
		},
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
			"device_token", deviceToken,
		)
		return fmt.Errorf("push dispatcher: fcm reported %d failure(s)", fcmResp.Failure)
	}

	slog.Info("push notification sent successfully", "device_token", deviceToken, "title", title)
	return nil
}

// SendMultiple dispatches push notifications to multiple device tokens.
// It sends to each token individually and returns the count of successes and
// any errors encountered. A partial failure does not stop delivery to remaining tokens.
func (p *PushDispatcher) SendMultiple(ctx context.Context, deviceTokens []string, title, body, actionURL string) (sent int, errs []error) {
	for _, token := range deviceTokens {
		if err := p.Send(ctx, token, title, body, actionURL); err != nil {
			slog.Warn("push dispatcher: failed to send to device",
				"device_token", token,
				"error", err,
			)
			errs = append(errs, err)
		} else {
			sent++
		}
	}
	return sent, errs
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
