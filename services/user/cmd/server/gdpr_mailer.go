package main

import (
	"context"
	"fmt"
	"time"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	"github.com/nomarkup/nomarkup/services/user/internal/service"
)

// gdprMailerClient satisfies service.GDPRMailer by delegating to the
// notification service's SendNotification RPC, which dispatches through
// SendGrid when SENDGRID_API_KEY is configured (dev mode logs otherwise).
//
// Mirrors the password-reset / verification email path already used by the
// user-service gRPC server: transactional, email-channel-only, type
// UNSPECIFIED so explicit channel intent is not preference-gated for types
// the user has never configured.
type gdprMailerClient struct {
	cli     notificationv1.NotificationServiceClient
	baseURL string
}

func newGDPRMailerClient(cli notificationv1.NotificationServiceClient, baseURL string) *gdprMailerClient {
	return &gdprMailerClient{cli: cli, baseURL: baseURL}
}

// Compile-time check that the adapter implements the Erasure mailer contract.
var _ service.GDPRMailer = (*gdprMailerClient)(nil)

func (m *gdprMailerClient) SendDeletionRequested(ctx context.Context, userID, email string, graceDeadline time.Time) error {
	if m == nil || m.cli == nil {
		return fmt.Errorf("gdpr mailer: notification client not configured")
	}
	actionURL := m.baseURL + "/settings/account"
	deadline := graceDeadline.UTC().Format("January 2, 2006")
	body := fmt.Sprintf(
		"We received your request to delete your NoMarkup account. Your account will be permanently deleted on %s unless you cancel before then.\n\nTo keep your account, sign in and open Account settings, then choose \"Restore my account\".\n\nIf you did not request this, restore your account immediately and change your password.",
		deadline,
	)
	return m.send(ctx, userID, email, "Your NoMarkup account deletion is scheduled", body, actionURL, "gdpr_deletion_requested")
}

func (m *gdprMailerClient) SendDeletionCancelled(ctx context.Context, userID, email string) error {
	if m == nil || m.cli == nil {
		return fmt.Errorf("gdpr mailer: notification client not configured")
	}
	actionURL := m.baseURL + "/settings/account"
	body := "Your NoMarkup account deletion request has been cancelled. Your account remains active and no data will be erased from this request.\n\nIf you did not cancel this request, sign in and review your account security settings."
	return m.send(ctx, userID, email, "Your NoMarkup account deletion was cancelled", body, actionURL, "gdpr_deletion_cancelled")
}

func (m *gdprMailerClient) SendDeletionFinalized(ctx context.Context, userID, email string) error {
	if m == nil || m.cli == nil {
		return fmt.Errorf("gdpr mailer: notification client not configured")
	}
	// No action URL — the account no longer exists; the privacy page is the
	// public residual contact surface for post-erasure questions.
	actionURL := m.baseURL + "/privacy"
	body := "Your NoMarkup account and personal data have been erased in accordance with your deletion request (GDPR Art. 17 / CCPA right to delete).\n\nSome non-personal records may be retained where legally required (e.g. tax, dispute, or fraud prevention). You can no longer sign in with this account.\n\nIf you did not request this deletion, contact support immediately."
	return m.send(ctx, userID, email, "Your NoMarkup account has been deleted", body, actionURL, "gdpr_deletion_finalized")
}

func (m *gdprMailerClient) send(ctx context.Context, userID, email, title, body, actionURL, notifKind string) error {
	_, err := m.cli.SendNotification(ctx, &notificationv1.SendNotificationRequest{
		UserId:           userID,
		NotificationType: notificationv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED,
		Title:            title,
		Body:             body,
		ActionUrl:        actionURL,
		Data: map[string]string{
			"user_email": email,
			"type":       notifKind,
		},
		Channels: []notificationv1.NotificationChannel{
			notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_EMAIL,
		},
	})
	if err != nil {
		return fmt.Errorf("gdpr mailer: send %s: %w", notifKind, err)
	}
	return nil
}
