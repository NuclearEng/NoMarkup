package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	"github.com/nomarkup/nomarkup/services/user/internal/service"
)

// fakeNotifClient implements just enough of NotificationServiceClient for
// the GDPR mailer adapter. Unexpected RPCs panic so drift is loud.
type fakeNotifClient struct {
	notificationv1.NotificationServiceClient

	lastReq *notificationv1.SendNotificationRequest
	err     error
	calls   int
}

func (f *fakeNotifClient) SendNotification(_ context.Context, req *notificationv1.SendNotificationRequest, _ ...grpc.CallOption) (*notificationv1.SendNotificationResponse, error) {
	f.lastReq = req
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return &notificationv1.SendNotificationResponse{}, nil
}

func TestGDPRMailerClient_NilClient_ReturnsError(t *testing.T) {
	t.Parallel()
	var m *gdprMailerClient
	err := m.SendDeletionRequested(context.Background(), "u1", "a@b.com", time.Now())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not configured")

	err = m.SendDeletionCancelled(context.Background(), "u1", "a@b.com")
	require.Error(t, err)

	err = m.SendDeletionFinalized(context.Background(), "u1", "a@b.com")
	require.Error(t, err)
}

func TestGDPRMailerClient_SendDeletionRequested_PassThrough(t *testing.T) {
	t.Parallel()
	fake := &fakeNotifClient{}
	m := newGDPRMailerClient(fake, "https://app.example.com")
	deadline := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)

	err := m.SendDeletionRequested(context.Background(), "user-1", "user@example.com", deadline)
	require.NoError(t, err)
	require.NotNil(t, fake.lastReq)

	assert.Equal(t, "user-1", fake.lastReq.GetUserId())
	assert.Equal(t, "user@example.com", fake.lastReq.GetData()["user_email"])
	assert.Equal(t, "gdpr_deletion_requested", fake.lastReq.GetData()["type"])
	assert.Equal(t, "https://app.example.com/settings/account", fake.lastReq.GetActionUrl())
	assert.Contains(t, fake.lastReq.GetBody(), "August 26, 2026")
	assert.Equal(t, []notificationv1.NotificationChannel{
		notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_EMAIL,
	}, fake.lastReq.GetChannels())
	assert.Equal(t, notificationv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED, fake.lastReq.GetNotificationType())
	assert.Equal(t, 1, fake.calls)
}

func TestGDPRMailerClient_SendDeletionCancelled_PassThrough(t *testing.T) {
	t.Parallel()
	fake := &fakeNotifClient{}
	m := newGDPRMailerClient(fake, "https://app.example.com")

	err := m.SendDeletionCancelled(context.Background(), "user-1", "user@example.com")
	require.NoError(t, err)
	require.NotNil(t, fake.lastReq)
	assert.Equal(t, "gdpr_deletion_cancelled", fake.lastReq.GetData()["type"])
	assert.Contains(t, fake.lastReq.GetTitle(), "cancelled")
	assert.Equal(t, "https://app.example.com/settings/account", fake.lastReq.GetActionUrl())
}

func TestGDPRMailerClient_SendDeletionFinalized_PassThrough(t *testing.T) {
	t.Parallel()
	fake := &fakeNotifClient{}
	m := newGDPRMailerClient(fake, "https://app.example.com")

	err := m.SendDeletionFinalized(context.Background(), "user-1", "user@example.com")
	require.NoError(t, err)
	require.NotNil(t, fake.lastReq)
	assert.Equal(t, "gdpr_deletion_finalized", fake.lastReq.GetData()["type"])
	assert.Equal(t, "https://app.example.com/privacy", fake.lastReq.GetActionUrl())
	assert.Contains(t, fake.lastReq.GetTitle(), "deleted")
}

func TestGDPRMailerClient_PropagatesSendError(t *testing.T) {
	t.Parallel()
	fake := &fakeNotifClient{err: errors.New("sendgrid down")}
	m := newGDPRMailerClient(fake, "https://app.example.com")

	err := m.SendDeletionRequested(context.Background(), "u", "a@b.com", time.Now())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sendgrid down")
}

func TestGDPRMailerClient_SatisfiesErasureInterface(t *testing.T) {
	t.Parallel()
	var _ service.GDPRMailer = (*gdprMailerClient)(nil)
}
