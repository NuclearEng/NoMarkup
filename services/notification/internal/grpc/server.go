package grpc

import (
	"context"
	"errors"
	"strings"

	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
	"github.com/nomarkup/nomarkup/services/notification/internal/service"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Server implements the NotificationService gRPC server.
type Server struct {
	notificationv1.UnimplementedNotificationServiceServer
	svc *service.Service
}

// NewServer creates a new gRPC server for the notification service.
func NewServer(svc *service.Service) *Server {
	return &Server{svc: svc}
}

// Register registers the notification service with a gRPC server.
func Register(s *grpclib.Server, srv *Server) {
	notificationv1.RegisterNotificationServiceServer(s, srv)
}

func (s *Server) SendNotification(ctx context.Context, req *notificationv1.SendNotificationRequest) (*notificationv1.SendNotificationResponse, error) {
	notifType := protoNotificationTypeToString(req.GetNotificationType())

	var channels []string
	for _, ch := range req.GetChannels() {
		channels = append(channels, protoChannelToString(ch))
	}

	notif, deliveries, err := s.svc.SendNotification(
		ctx,
		req.GetUserId(),
		notifType,
		req.GetTitle(),
		req.GetBody(),
		req.GetActionUrl(),
		req.GetData(),
		channels,
	)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoDeliveries := make([]*notificationv1.ChannelDeliveryStatus, 0, len(deliveries))
	for _, d := range deliveries {
		protoDeliveries = append(protoDeliveries, &notificationv1.ChannelDeliveryStatus{
			Channel:       stringToProtoChannel(d.Channel),
			Delivered:     d.Delivered,
			FailureReason: d.FailureReason,
		})
	}

	return &notificationv1.SendNotificationResponse{
		Notification:   domainNotificationToProto(notif),
		DeliveryStatus: protoDeliveries,
	}, nil
}

func (s *Server) SendBulkNotification(ctx context.Context, req *notificationv1.SendBulkNotificationRequest) (*notificationv1.SendBulkNotificationResponse, error) {
	notifType := protoNotificationTypeToString(req.GetNotificationType())

	sent, failed := s.svc.SendBulkNotification(
		ctx,
		req.GetUserIds(),
		notifType,
		req.GetTitle(),
		req.GetBody(),
		req.GetActionUrl(),
		req.GetData(),
	)

	return &notificationv1.SendBulkNotificationResponse{
		Sent:   sent,
		Failed: failed,
	}, nil
}

func (s *Server) ListNotifications(ctx context.Context, req *notificationv1.ListNotificationsRequest) (*notificationv1.ListNotificationsResponse, error) {
	page := int32(1)
	pageSize := int32(20)
	if pg := req.GetPagination(); pg != nil {
		if pg.GetPage() > 0 {
			page = pg.GetPage()
		}
		if pg.GetPageSize() > 0 {
			pageSize = pg.GetPageSize()
		}
	}

	notifications, totalCount, err := s.svc.ListNotifications(
		ctx,
		req.GetUserId(),
		req.GetUnreadOnly(),
		int(page),
		int(pageSize),
	)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoNotifs := make([]*notificationv1.Notification, 0, len(notifications))
	for _, n := range notifications {
		protoNotifs = append(protoNotifs, domainNotificationToProto(n))
	}

	totalPages := int32(0)
	if totalCount > 0 {
		totalPages = (int32(totalCount) + pageSize - 1) / pageSize
	}

	return &notificationv1.ListNotificationsResponse{
		Notifications: protoNotifs,
		Pagination: &commonv1.PaginationResponse{
			TotalCount: int32(totalCount),
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
			HasNext:    page < totalPages,
		},
	}, nil
}

func (s *Server) MarkAsRead(ctx context.Context, req *notificationv1.MarkAsReadRequest) (*notificationv1.MarkAsReadResponse, error) {
	err := s.svc.MarkAsRead(ctx, req.GetNotificationId(), req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &notificationv1.MarkAsReadResponse{}, nil
}

func (s *Server) MarkAllAsRead(ctx context.Context, req *notificationv1.MarkAllAsReadRequest) (*notificationv1.MarkAllAsReadResponse, error) {
	count, err := s.svc.MarkAllAsRead(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &notificationv1.MarkAllAsReadResponse{
		MarkedCount: int32(count),
	}, nil
}

func (s *Server) GetUnreadCount(ctx context.Context, req *notificationv1.GetUnreadCountRequest) (*notificationv1.GetUnreadCountResponse, error) {
	count, err := s.svc.GetUnreadCount(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &notificationv1.GetUnreadCountResponse{
		Count: int32(count),
	}, nil
}

func (s *Server) RegisterDevice(_ context.Context, _ *notificationv1.RegisterDeviceRequest) (*notificationv1.RegisterDeviceResponse, error) {
	return nil, status.Error(codes.Unimplemented, "RegisterDevice not yet implemented")
}

func (s *Server) UnregisterDevice(_ context.Context, _ *notificationv1.UnregisterDeviceRequest) (*notificationv1.UnregisterDeviceResponse, error) {
	return nil, status.Error(codes.Unimplemented, "UnregisterDevice not yet implemented")
}

func (s *Server) GetPreferences(ctx context.Context, req *notificationv1.GetPreferencesRequest) (*notificationv1.GetPreferencesResponse, error) {
	prefs, err := s.svc.GetPreferences(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoPrefs := make([]*notificationv1.NotificationPreference, 0, len(prefs.Preferences))
	for typeStr, cp := range prefs.Preferences {
		protoPrefs = append(protoPrefs, &notificationv1.NotificationPreference{
			NotificationType: stringToProtoNotificationType(typeStr),
			PushEnabled:      cp.Push,
			EmailEnabled:     cp.Email,
			SmsEnabled:       cp.SMS,
			InAppEnabled:     cp.InApp,
		})
	}

	return &notificationv1.GetPreferencesResponse{
		Preferences:        protoPrefs,
		GlobalPushEnabled:  true,
		GlobalEmailEnabled: true,
		GlobalSmsEnabled:   false,
	}, nil
}

func (s *Server) UpdatePreferences(ctx context.Context, req *notificationv1.UpdatePreferencesRequest) (*notificationv1.UpdatePreferencesResponse, error) {
	// Convert proto preferences to domain.
	prefsMap := make(map[string]domain.ChannelPrefs)
	for _, p := range req.GetPreferences() {
		typeStr := protoNotificationTypeToString(p.GetNotificationType())
		prefsMap[typeStr] = domain.ChannelPrefs{
			InApp: p.GetInAppEnabled(),
			Email: p.GetEmailEnabled(),
			Push:  p.GetPushEnabled(),
			SMS:   p.GetSmsEnabled(),
		}
	}

	domainPrefs := &domain.NotificationPreferences{
		UserID:      req.GetUserId(),
		Preferences: prefsMap,
		EmailDigest: "daily",
	}

	updated, err := s.svc.UpdatePreferences(ctx, domainPrefs)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoPrefs := make([]*notificationv1.NotificationPreference, 0, len(updated.Preferences))
	for typeStr, cp := range updated.Preferences {
		protoPrefs = append(protoPrefs, &notificationv1.NotificationPreference{
			NotificationType: stringToProtoNotificationType(typeStr),
			PushEnabled:      cp.Push,
			EmailEnabled:     cp.Email,
			SmsEnabled:       cp.SMS,
			InAppEnabled:     cp.InApp,
		})
	}

	return &notificationv1.UpdatePreferencesResponse{
		Preferences: protoPrefs,
	}, nil
}

func (s *Server) Unsubscribe(_ context.Context, _ *notificationv1.UnsubscribeRequest) (*notificationv1.UnsubscribeResponse, error) {
	return nil, status.Error(codes.Unimplemented, "Unsubscribe not yet implemented")
}

// --- Proto-to-domain and domain-to-proto helpers ---

func domainNotificationToProto(n *domain.Notification) *notificationv1.Notification {
	pb := &notificationv1.Notification{
		Id:               n.ID,
		UserId:           n.UserID,
		NotificationType: stringToProtoNotificationType(n.NotificationType),
		Title:            n.Title,
		Body:             n.Body,
		ActionUrl:        n.ActionURL,
		IsRead:           n.Read,
		CreatedAt:        timestamppb.New(n.CreatedAt),
	}

	if n.ReadAt != nil {
		pb.ReadAt = timestamppb.New(*n.ReadAt)
	}

	var channelsSent []notificationv1.NotificationChannel
	for _, ch := range n.Channels {
		channelsSent = append(channelsSent, stringToProtoChannel(ch))
	}
	pb.ChannelsSent = channelsSent

	return pb
}

// --- Enum conversion helpers ---

func protoNotificationTypeToString(nt notificationv1.NotificationType) string {
	switch nt {
	case notificationv1.NotificationType_NOTIFICATION_TYPE_NEW_BID:
		return "new_bid"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_BID_AWARDED:
		return "bid_awarded"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_BID_NOT_SELECTED:
		return "bid_not_selected"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_AUCTION_CLOSING_SOON:
		return "auction_closing_soon"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_AUCTION_CLOSED:
		return "auction_closed"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_OFFER_ACCEPTED:
		return "offer_accepted"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_CONTRACT_CREATED:
		return "contract_created"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_CONTRACT_ACCEPTED:
		return "contract_accepted"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_WORK_STARTED:
		return "work_started"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_MILESTONE_SUBMITTED:
		return "milestone_submitted"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_MILESTONE_APPROVED:
		return "milestone_approved"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_REVISION_REQUESTED:
		return "revision_requested"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_WORK_COMPLETED:
		return "work_completed"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_COMPLETION_APPROVED:
		return "completion_approved"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RECEIVED:
		return "payment_received"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RELEASED:
		return "payment_released"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_FAILED:
		return "payment_failed"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_PAYOUT_SENT:
		return "payout_sent"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_NEW_MESSAGE:
		return "new_message"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_REVIEW_RECEIVED:
		return "review_received"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_REVIEW_REMINDER:
		return "review_reminder"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_DISPUTE_OPENED:
		return "dispute_opened"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_DISPUTE_RESOLVED:
		return "dispute_resolved"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_TIER_UPGRADE:
		return "tier_upgrade"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_TIER_DOWNGRADE:
		return "tier_downgrade"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_APPROVED:
		return "document_approved"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_REJECTED:
		return "document_rejected"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_EXPIRING:
		return "document_expiring"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_CHANGE_ORDER_PROPOSED:
		return "change_order_proposed"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_CHANGE_ORDER_RESPONDED:
		return "change_order_responded"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_RECURRING_UPCOMING:
		return "recurring_upcoming"
	case notificationv1.NotificationType_NOTIFICATION_TYPE_RECURRING_INSTANCE_READY:
		return "recurring_instance_ready"
	default:
		return "unspecified"
	}
}

func stringToProtoNotificationType(s string) notificationv1.NotificationType {
	switch s {
	case "new_bid":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_NEW_BID
	case "bid_awarded":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_BID_AWARDED
	case "bid_not_selected":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_BID_NOT_SELECTED
	case "auction_closing_soon":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_AUCTION_CLOSING_SOON
	case "auction_closed":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_AUCTION_CLOSED
	case "offer_accepted":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_OFFER_ACCEPTED
	case "contract_created":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_CONTRACT_CREATED
	case "contract_accepted":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_CONTRACT_ACCEPTED
	case "work_started":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_WORK_STARTED
	case "milestone_submitted":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_MILESTONE_SUBMITTED
	case "milestone_approved":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_MILESTONE_APPROVED
	case "revision_requested":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_REVISION_REQUESTED
	case "work_completed":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_WORK_COMPLETED
	case "completion_approved":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_COMPLETION_APPROVED
	case "payment_received":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RECEIVED
	case "payment_released":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_RELEASED
	case "payment_failed":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_FAILED
	case "payout_sent":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_PAYOUT_SENT
	case "new_message":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_NEW_MESSAGE
	case "review_received":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_REVIEW_RECEIVED
	case "review_reminder":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_REVIEW_REMINDER
	case "dispute_opened":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_DISPUTE_OPENED
	case "dispute_resolved":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_DISPUTE_RESOLVED
	case "tier_upgrade":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_TIER_UPGRADE
	case "tier_downgrade":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_TIER_DOWNGRADE
	case "document_approved":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_APPROVED
	case "document_rejected":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_REJECTED
	case "document_expiring":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_DOCUMENT_EXPIRING
	case "change_order_proposed":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_CHANGE_ORDER_PROPOSED
	case "change_order_responded":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_CHANGE_ORDER_RESPONDED
	case "recurring_upcoming":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_RECURRING_UPCOMING
	case "recurring_instance_ready":
		return notificationv1.NotificationType_NOTIFICATION_TYPE_RECURRING_INSTANCE_READY
	default:
		return notificationv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED
	}
}

func protoChannelToString(ch notificationv1.NotificationChannel) string {
	switch ch {
	case notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_PUSH:
		return "push"
	case notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_EMAIL:
		return "email"
	case notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_SMS:
		return "sms"
	case notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_IN_APP:
		return "in_app"
	default:
		return "in_app"
	}
}

func stringToProtoChannel(s string) notificationv1.NotificationChannel {
	switch s {
	case "push":
		return notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_PUSH
	case "email":
		return notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_EMAIL
	case "sms":
		return notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_SMS
	case "in_app":
		return notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_IN_APP
	default:
		return notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_UNSPECIFIED
	}
}

// mapDomainError maps domain errors to gRPC status errors.
func mapDomainError(err error) error {
	if err == nil {
		return nil
	}

	msg := err.Error()

	switch {
	case errors.Is(err, domain.ErrNotificationNotFound):
		return status.Error(codes.NotFound, "notification not found")
	case errors.Is(err, domain.ErrPreferencesNotFound):
		return status.Error(codes.NotFound, "preferences not found")
	case strings.Contains(msg, "is required"):
		return status.Error(codes.InvalidArgument, msg)
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
