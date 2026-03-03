package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// EmailDispatcher sends email notifications via the SendGrid API.
type EmailDispatcher struct {
	apiKey    string
	fromEmail string
	fromName  string
	devMode   bool
	client    *http.Client
}

// NewEmailDispatcher creates a new email dispatcher. If apiKey is empty, the
// dispatcher operates in dev mode and logs instead of sending.
func NewEmailDispatcher(apiKey, fromEmail, fromName string) *EmailDispatcher {
	devMode := apiKey == ""
	if fromEmail == "" {
		fromEmail = "notifications@nomarkup.com"
	}
	if fromName == "" {
		fromName = "NoMarkup"
	}
	return &EmailDispatcher{
		apiKey:    apiKey,
		fromEmail: fromEmail,
		fromName:  fromName,
		devMode:   devMode,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Send dispatches an email via SendGrid. In dev mode it logs instead.
func (e *EmailDispatcher) Send(ctx context.Context, to, subject, htmlBody, textBody string) error {
	if e.devMode {
		slog.Info("email dispatcher (dev mode): would send email",
			"to", to,
			"subject", subject,
		)
		return nil
	}

	payload := sendGridPayload{
		Personalizations: []sendGridPersonalization{
			{To: []sendGridEmail{{Email: to}}},
		},
		From:    sendGridEmail{Email: e.fromEmail, Name: e.fromName},
		Subject: subject,
		Content: []sendGridContent{
			{Type: "text/plain", Value: textBody},
			{Type: "text/html", Value: htmlBody},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("email dispatcher marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.sendgrid.com/v3/mail/send", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("email dispatcher create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+e.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := e.client.Do(req)
	if err != nil {
		return fmt.Errorf("email dispatcher send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("email dispatcher: sendgrid returned status %d", resp.StatusCode)
	}

	slog.Info("email sent successfully", "to", to, "subject", subject, "status", resp.StatusCode)
	return nil
}

// --- SendGrid request types ---

type sendGridPayload struct {
	Personalizations []sendGridPersonalization `json:"personalizations"`
	From             sendGridEmail             `json:"from"`
	Subject          string                    `json:"subject"`
	Content          []sendGridContent         `json:"content"`
}

type sendGridPersonalization struct {
	To []sendGridEmail `json:"to"`
}

type sendGridEmail struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type sendGridContent struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// --- Email template rendering ---

// emailTemplateData holds data passed to the email HTML template.
type emailTemplateData struct {
	Title     string
	Body      string
	ActionURL string
	NotifType string
	Year      int
}

var emailHTMLTmpl = template.Must(template.New("email").Parse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{.Title}}</title>
<style>
  body { margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
  .header { background-color: #18181b; padding: 24px 32px; }
  .header h1 { color: #ffffff; font-size: 20px; margin: 0; font-weight: 600; }
  .content { padding: 32px; }
  .content h2 { color: #18181b; font-size: 18px; margin: 0 0 12px 0; }
  .content p { color: #3f3f46; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0; }
  .btn { display: inline-block; background-color: #18181b; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 500; }
  .footer { padding: 24px 32px; border-top: 1px solid #e4e4e7; }
  .footer p { color: #a1a1aa; font-size: 12px; line-height: 1.5; margin: 0; }
  .footer a { color: #a1a1aa; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>NoMarkup</h1>
  </div>
  <div class="content">
    <h2>{{.Title}}</h2>
    <p>{{.Body}}</p>
    {{if .ActionURL}}<a href="{{.ActionURL}}" class="btn">View Details</a>{{end}}
  </div>
  <div class="footer">
    <p>&copy; {{.Year}} NoMarkup. All rights reserved.</p>
    <p>You received this email because of your notification preferences. <a href="{{.ActionURL}}">Unsubscribe</a></p>
  </div>
</div>
</body>
</html>`))

// renderEmailHTML returns HTML and plain-text versions of a notification email.
func renderEmailHTML(notifType, title, body, actionURL string) (string, string) {
	data := emailTemplateData{
		Title:     title,
		Body:      body,
		ActionURL: actionURL,
		NotifType: notifType,
		Year:      time.Now().Year(),
	}

	var htmlBuf bytes.Buffer
	if err := emailHTMLTmpl.Execute(&htmlBuf, data); err != nil {
		slog.Error("failed to render email template", "error", err)
		// Fall back to plain text.
		return "", buildPlainText(title, body, actionURL)
	}

	return htmlBuf.String(), buildPlainText(title, body, actionURL)
}

func buildPlainText(title, body, actionURL string) string {
	var sb strings.Builder
	sb.WriteString(title)
	sb.WriteString("\n\n")
	sb.WriteString(body)
	if actionURL != "" {
		sb.WriteString("\n\nView details: ")
		sb.WriteString(actionURL)
	}
	sb.WriteString("\n\n---\nNoMarkup - You received this email because of your notification preferences.\n")
	return sb.String()
}
