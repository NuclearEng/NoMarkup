package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// SMSDispatcher sends SMS notifications via the Twilio REST API.
type SMSDispatcher struct {
	accountSID string
	authToken  string
	fromNumber string
	devMode    bool
	client     *http.Client
}

// NewSMSDispatcher creates a new SMS dispatcher. If accountSID is empty, the
// dispatcher operates in dev mode and logs instead of sending.
func NewSMSDispatcher(accountSID, authToken, fromNumber string) *SMSDispatcher {
	devMode := accountSID == ""
	return &SMSDispatcher{
		accountSID: accountSID,
		authToken:  authToken,
		fromNumber: fromNumber,
		devMode:    devMode,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Send dispatches an SMS message via Twilio. In dev mode it logs instead.
func (s *SMSDispatcher) Send(ctx context.Context, toNumber, body string) error {
	if s.devMode {
		slog.Info("sms dispatcher (dev mode): would send SMS",
			"to", toNumber,
			"body_length", len(body),
		)
		return nil
	}

	apiURL := fmt.Sprintf("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json", s.accountSID)

	form := url.Values{}
	form.Set("To", toNumber)
	form.Set("From", s.fromNumber)
	form.Set("Body", body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("sms dispatcher create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(s.accountSID, s.authToken)

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("sms dispatcher send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var twilioErr twilioErrorResponse
		if err := json.NewDecoder(resp.Body).Decode(&twilioErr); err == nil && twilioErr.Message != "" {
			return fmt.Errorf("sms dispatcher: twilio error %d: %s", twilioErr.Code, twilioErr.Message)
		}
		return fmt.Errorf("sms dispatcher: twilio returned status %d", resp.StatusCode)
	}

	slog.Info("sms sent successfully", "to", toNumber)
	return nil
}

// --- Twilio response types ---

type twilioErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Status  int    `json:"status"`
}
