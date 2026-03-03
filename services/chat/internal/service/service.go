package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
)

// Service implements chat business logic.
type Service struct {
	repo   domain.ChannelRepository
	pubsub *PubSub
}

// New creates a new chat service.
func New(repo domain.ChannelRepository, pubsub *PubSub) *Service {
	return &Service{repo: repo, pubsub: pubsub}
}

// CreateChannel validates inputs and creates a new channel.
func (s *Service) CreateChannel(ctx context.Context, jobID, customerID, providerID, channelType string) (*domain.Channel, error) {
	if jobID == "" {
		return nil, fmt.Errorf("create channel: job_id is required")
	}
	if customerID == "" {
		return nil, fmt.Errorf("create channel: customer_id is required")
	}
	if providerID == "" {
		return nil, fmt.Errorf("create channel: provider_id is required")
	}
	if channelType == "" {
		channelType = "pre_award"
	}

	ch := &domain.Channel{
		JobID:       jobID,
		CustomerID:  customerID,
		ProviderID:  providerID,
		ChannelType: channelType,
		Status:      "active",
	}

	return s.repo.CreateChannel(ctx, ch)
}

// GetChannel validates user membership and returns a channel.
func (s *Service) GetChannel(ctx context.Context, channelID string, userID string) (*domain.Channel, error) {
	ch, err := s.repo.GetChannel(ctx, channelID, userID)
	if err != nil {
		return nil, err
	}

	if ch.CustomerID != userID && ch.ProviderID != userID {
		return nil, fmt.Errorf("get channel: %w", domain.ErrNotChannelMember)
	}

	return ch, nil
}

// ListChannels returns paginated channels for a user.
func (s *Service) ListChannels(ctx context.Context, userID string, page, pageSize int) ([]*domain.Channel, int, error) {
	return s.repo.ListChannels(ctx, userID, page, pageSize)
}

// SendMessage validates the sender is a channel member, detects contact info,
// persists the message, publishes to Redis pub/sub, and returns the message.
func (s *Service) SendMessage(ctx context.Context, channelID, senderID, messageType, content string) (*domain.Message, error) {
	// Validate channel access and status.
	ch, err := s.repo.GetChannel(ctx, channelID, senderID)
	if err != nil {
		return nil, err
	}

	if ch.CustomerID != senderID && ch.ProviderID != senderID {
		return nil, fmt.Errorf("send message: %w", domain.ErrNotChannelMember)
	}

	if ch.Status == "closed" || ch.Status == "read_only" {
		return nil, fmt.Errorf("send message: %w", domain.ErrChannelClosed)
	}

	if strings.TrimSpace(content) == "" && messageType == "text" {
		return nil, fmt.Errorf("send message: %w", domain.ErrEmptyMessage)
	}

	if messageType == "" {
		messageType = "text"
	}

	flagged := DetectContactInfo(content)

	msg := &domain.Message{
		ChannelID:          channelID,
		SenderID:           senderID,
		MessageType:        messageType,
		Content:            content,
		FlaggedContactInfo: flagged,
	}

	result, err := s.repo.SendMessage(ctx, msg)
	if err != nil {
		return nil, err
	}

	// Publish to Redis for real-time delivery (best effort).
	if s.pubsub != nil {
		_ = s.pubsub.Publish(ctx, channelID, *result)
	}

	return result, nil
}

// ListMessages validates user membership and returns paginated messages.
func (s *Service) ListMessages(ctx context.Context, channelID, userID string, before *time.Time, pageSize int) ([]*domain.Message, error) {
	ch, err := s.repo.GetChannel(ctx, channelID, userID)
	if err != nil {
		return nil, err
	}

	if ch.CustomerID != userID && ch.ProviderID != userID {
		return nil, fmt.Errorf("list messages: %w", domain.ErrNotChannelMember)
	}

	return s.repo.ListMessages(ctx, channelID, before, pageSize)
}

// MarkRead validates user membership and marks messages as read.
func (s *Service) MarkRead(ctx context.Context, channelID, userID string) error {
	return s.repo.MarkRead(ctx, channelID, userID)
}

// GetUnreadCounts returns unread message counts per channel for a user.
func (s *Service) GetUnreadCounts(ctx context.Context, userID string) ([]domain.ChannelUnread, error) {
	return s.repo.GetUnreadCounts(ctx, userID)
}

// SendTypingIndicator publishes a typing indicator via Redis pub/sub.
func (s *Service) SendTypingIndicator(ctx context.Context, channelID, userID string) error {
	if s.pubsub == nil {
		return nil
	}
	return s.pubsub.PublishTyping(ctx, channelID, userID)
}

// Contact info detection patterns.
var (
	phoneRegex = regexp.MustCompile(
		`(?:(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})`,
	)
	emailRegex = regexp.MustCompile(
		`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`,
	)
)

// DetectContactInfo checks if the content contains phone numbers or email addresses.
func DetectContactInfo(content string) bool {
	if phoneRegex.MatchString(content) {
		return true
	}
	if emailRegex.MatchString(content) {
		return true
	}
	return false
}
