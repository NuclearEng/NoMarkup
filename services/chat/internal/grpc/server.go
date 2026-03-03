package grpc

import (
	"context"
	"errors"
	"strings"
	"time"

	chatv1 "github.com/nomarkup/nomarkup/proto/chat/v1"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
	"github.com/nomarkup/nomarkup/services/chat/internal/service"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Server implements the ChatService gRPC server.
type Server struct {
	chatv1.UnimplementedChatServiceServer
	svc *service.Service
}

// NewServer creates a new gRPC server for the chat service.
func NewServer(svc *service.Service) *Server {
	return &Server{svc: svc}
}

// Register registers the chat service with a gRPC server.
func Register(s *grpclib.Server, srv *Server) {
	chatv1.RegisterChatServiceServer(s, srv)
}

func (s *Server) CreateChannel(ctx context.Context, req *chatv1.CreateChannelRequest) (*chatv1.CreateChannelResponse, error) {
	channelType := protoChannelTypeToString(req.GetChannelType())

	ch, err := s.svc.CreateChannel(ctx, req.GetJobId(), req.GetCustomerId(), req.GetProviderId(), channelType)
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &chatv1.CreateChannelResponse{
		Channel: domainChannelToProto(ch),
	}, nil
}

func (s *Server) GetChannel(ctx context.Context, req *chatv1.GetChannelRequest) (*chatv1.GetChannelResponse, error) {
	ch, err := s.svc.GetChannel(ctx, req.GetChannelId(), req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &chatv1.GetChannelResponse{
		Channel: domainChannelToProto(ch),
	}, nil
}

func (s *Server) ListChannels(ctx context.Context, req *chatv1.ListChannelsRequest) (*chatv1.ListChannelsResponse, error) {
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

	channels, totalCount, err := s.svc.ListChannels(ctx, req.GetUserId(), int(page), int(pageSize))
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoChannels := make([]*chatv1.Channel, 0, len(channels))
	for _, ch := range channels {
		protoChannels = append(protoChannels, domainChannelToProto(ch))
	}

	totalPages := int32(0)
	if totalCount > 0 {
		totalPages = (int32(totalCount) + pageSize - 1) / pageSize
	}

	return &chatv1.ListChannelsResponse{
		Channels: protoChannels,
		Pagination: &commonv1.PaginationResponse{
			TotalCount: int32(totalCount),
			Page:       page,
			PageSize:   pageSize,
			TotalPages: totalPages,
			HasNext:    page < totalPages,
		},
	}, nil
}

func (s *Server) SendMessage(ctx context.Context, req *chatv1.SendMessageRequest) (*chatv1.SendMessageResponse, error) {
	messageType := protoMessageTypeToString(req.GetMessageType())

	msg, err := s.svc.SendMessage(ctx, req.GetChannelId(), req.GetSenderId(), messageType, req.GetContent())
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &chatv1.SendMessageResponse{
		Message: domainMessageToProto(msg),
	}, nil
}

func (s *Server) ListMessages(ctx context.Context, req *chatv1.ListMessagesRequest) (*chatv1.ListMessagesResponse, error) {
	pageSize := 50
	if pg := req.GetPagination(); pg != nil {
		if pg.GetPageSize() > 0 {
			pageSize = int(pg.GetPageSize())
		}
	}

	// Convert proto timestamp to *time.Time.
	var before *time.Time
	if req.Before != nil {
		t := req.GetBefore().AsTime()
		before = &t
	}

	messages, err := s.svc.ListMessages(ctx, req.GetChannelId(), req.GetUserId(), before, pageSize)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoMessages := make([]*chatv1.Message, 0, len(messages))
	for _, m := range messages {
		protoMessages = append(protoMessages, domainMessageToProto(m))
	}

	return &chatv1.ListMessagesResponse{
		Messages: protoMessages,
	}, nil
}

func (s *Server) MarkRead(ctx context.Context, req *chatv1.MarkReadRequest) (*chatv1.MarkReadResponse, error) {
	err := s.svc.MarkRead(ctx, req.GetChannelId(), req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &chatv1.MarkReadResponse{}, nil
}

func (s *Server) SendTypingIndicator(ctx context.Context, req *chatv1.SendTypingIndicatorRequest) (*chatv1.SendTypingIndicatorResponse, error) {
	err := s.svc.SendTypingIndicator(ctx, req.GetChannelId(), req.GetUserId())
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to send typing indicator")
	}
	return &chatv1.SendTypingIndicatorResponse{}, nil
}

func (s *Server) GetUnreadCount(ctx context.Context, req *chatv1.GetUnreadCountRequest) (*chatv1.GetUnreadCountResponse, error) {
	unreads, err := s.svc.GetUnreadCounts(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	var totalUnread int32
	protoUnreads := make([]*chatv1.ChannelUnreadCount, 0, len(unreads))
	for _, u := range unreads {
		totalUnread += int32(u.UnreadCount)
		protoUnreads = append(protoUnreads, &chatv1.ChannelUnreadCount{
			ChannelId:   u.ChannelID,
			UnreadCount: int32(u.UnreadCount),
		})
	}

	return &chatv1.GetUnreadCountResponse{
		TotalUnread: totalUnread,
		Channels:    protoUnreads,
	}, nil
}

// --- Proto-to-domain and domain-to-proto helpers ---

func domainChannelToProto(ch *domain.Channel) *chatv1.Channel {
	pb := &chatv1.Channel{
		Id:          ch.ID,
		JobId:       ch.JobID,
		CustomerId:  ch.CustomerID,
		ProviderId:  ch.ProviderID,
		ChannelType: stringToProtoChannelType(ch.ChannelType),
		UnreadCount: int32(ch.UnreadCount),
		CreatedAt:   timestamppb.New(ch.CreatedAt),
		UpdatedAt:   timestamppb.New(ch.UpdatedAt),
	}

	if ch.LastMessage != nil {
		pb.LastMessage = domainMessageToProto(ch.LastMessage)
	}

	return pb
}

func domainMessageToProto(m *domain.Message) *chatv1.Message {
	return &chatv1.Message{
		Id:          m.ID,
		ChannelId:   m.ChannelID,
		SenderId:    m.SenderID,
		MessageType: stringToProtoMessageType(m.MessageType),
		Content:     m.Content,
		CreatedAt:   timestamppb.New(m.CreatedAt),
	}
}

// --- Enum conversion helpers ---

func protoChannelTypeToString(ct chatv1.ChannelType) string {
	switch ct {
	case chatv1.ChannelType_CHANNEL_TYPE_PRE_AWARD:
		return "pre_award"
	case chatv1.ChannelType_CHANNEL_TYPE_CONTRACT:
		return "contract"
	case chatv1.ChannelType_CHANNEL_TYPE_SUPPORT:
		return "support"
	default:
		return "pre_award"
	}
}

func stringToProtoChannelType(s string) chatv1.ChannelType {
	switch s {
	case "pre_award":
		return chatv1.ChannelType_CHANNEL_TYPE_PRE_AWARD
	case "contract":
		return chatv1.ChannelType_CHANNEL_TYPE_CONTRACT
	case "support":
		return chatv1.ChannelType_CHANNEL_TYPE_SUPPORT
	default:
		return chatv1.ChannelType_CHANNEL_TYPE_UNSPECIFIED
	}
}

func protoMessageTypeToString(mt chatv1.MessageType) string {
	switch mt {
	case chatv1.MessageType_MESSAGE_TYPE_TEXT:
		return "text"
	case chatv1.MessageType_MESSAGE_TYPE_IMAGE:
		return "image"
	case chatv1.MessageType_MESSAGE_TYPE_FILE:
		return "file"
	case chatv1.MessageType_MESSAGE_TYPE_SYSTEM:
		return "system"
	case chatv1.MessageType_MESSAGE_TYPE_CONTACT_SHARE:
		return "contact_share"
	default:
		return "text"
	}
}

func stringToProtoMessageType(s string) chatv1.MessageType {
	switch s {
	case "text":
		return chatv1.MessageType_MESSAGE_TYPE_TEXT
	case "image":
		return chatv1.MessageType_MESSAGE_TYPE_IMAGE
	case "file":
		return chatv1.MessageType_MESSAGE_TYPE_FILE
	case "system":
		return chatv1.MessageType_MESSAGE_TYPE_SYSTEM
	case "contact_share":
		return chatv1.MessageType_MESSAGE_TYPE_CONTACT_SHARE
	default:
		return chatv1.MessageType_MESSAGE_TYPE_UNSPECIFIED
	}
}

// mapDomainError maps domain errors to gRPC status errors.
func mapDomainError(err error) error {
	if err == nil {
		return nil
	}

	msg := err.Error()

	switch {
	case errors.Is(err, domain.ErrChannelNotFound):
		return status.Error(codes.NotFound, "channel not found")
	case errors.Is(err, domain.ErrNotChannelMember):
		return status.Error(codes.PermissionDenied, "not a member of this channel")
	case errors.Is(err, domain.ErrChannelClosed):
		return status.Error(codes.FailedPrecondition, "channel is closed or read-only")
	case errors.Is(err, domain.ErrMessageNotFound):
		return status.Error(codes.NotFound, "message not found")
	case errors.Is(err, domain.ErrEmptyMessage):
		return status.Error(codes.InvalidArgument, "message content is empty")
	case strings.Contains(msg, "is required"):
		return status.Error(codes.InvalidArgument, msg)
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
