package domain

import (
	"context"
	"time"
)

// Channel represents a chat channel between two users.
type Channel struct {
	ID          string
	JobID       string
	ContractID  string
	CustomerID  string
	ProviderID  string
	ChannelType string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Message represents a chat message.
type Message struct {
	ID          string
	ChannelID   string
	SenderID    string
	MessageType string
	Content     string
	IsRead      bool
	CreatedAt   time.Time
}

// ChannelRepository defines persistence operations for channels and messages.
type ChannelRepository interface {
	FindChannelByID(ctx context.Context, id string) (*Channel, error)
	CreateChannel(ctx context.Context, channel *Channel) error
	ListChannels(ctx context.Context, userID string, page, pageSize int) ([]*Channel, int, error)
	CreateMessage(ctx context.Context, msg *Message) error
	ListMessages(ctx context.Context, channelID string, page, pageSize int) ([]*Message, int, error)
	MarkRead(ctx context.Context, channelID, userID, lastMessageID string) error
}
