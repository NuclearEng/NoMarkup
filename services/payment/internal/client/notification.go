package client

import (
	"context"
	"fmt"
	"time"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	"google.golang.org/grpc"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
)

// notifyCallTimeout bounds a single SendNotification round-trip.
//
// Deliberately short. Every caller in the payment service treats notification
// delivery as best-effort and logs-and-continues on failure, so a slow
// notification service must never become the reason an escrow release or a
// settlement sweep stalls. Two seconds matches the other engine clients here.
const notifyCallTimeout = 2 * time.Second

// NotificationClient wraps the notification service gRPC client and its
// underlying connection.
type NotificationClient struct {
	conn   *grpc.ClientConn
	client notificationv1.NotificationServiceClient
}

// NewNotificationClient dials the notification service at addr.
func NewNotificationClient(addr string) (*NotificationClient, error) {
	if addr == "" {
		return nil, fmt.Errorf("notification service address is empty")
	}
	dialOpt, err := meshDialOption()
	if err != nil {
		return nil, fmt.Errorf("dial notification service credentials: %w", err)
	}
	conn, err := grpc.NewClient(
		addr,
		dialOpt,
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
	)
	if err != nil {
		return nil, fmt.Errorf("dial notification service at %q: %w", addr, err)
	}
	return &NotificationClient{
		conn:   conn,
		client: notificationv1.NewNotificationServiceClient(conn),
	}, nil
}

// Send delivers one notification to a user.
//
// Channels is deliberately left empty so the notification service applies the
// user's own preferences. For the payment types used here those default to
// in-app AND email, which is what a "your card was declined" message needs —
// in-app alone would only be seen by a user who happens to return to the site,
// and these messages exist precisely because the user is not on the site.
func (c *NotificationClient) Send(
	ctx context.Context,
	userID string,
	notificationType notificationv1.NotificationType,
	title, body, actionURL string,
	data map[string]string,
) error {
	ctx, cancel := context.WithTimeout(ctx, notifyCallTimeout)
	defer cancel()

	_, err := c.client.SendNotification(ctx, &notificationv1.SendNotificationRequest{
		UserId:           userID,
		NotificationType: notificationType,
		Title:            title,
		Body:             body,
		ActionUrl:        actionURL,
		Data:             data,
	})
	if err != nil {
		return fmt.Errorf("send notification (%s) to %s: %w", notificationType, userID, err)
	}
	return nil
}

// Close releases the underlying gRPC connection.
func (c *NotificationClient) Close() error {
	if c.conn == nil {
		return nil
	}
	if err := c.conn.Close(); err != nil {
		return fmt.Errorf("close notification client conn: %w", err)
	}
	return nil
}
