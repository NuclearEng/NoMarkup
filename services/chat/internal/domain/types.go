package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for the chat domain.
var (
	ErrChannelNotFound  = errors.New("channel not found")
	ErrNotChannelMember = errors.New("user is not a member of this channel")
	ErrChannelClosed    = errors.New("channel is closed")
	ErrMessageNotFound  = errors.New("message not found")
	ErrEmptyMessage     = errors.New("message content is empty")
)

// Channel represents a chat channel between two users for a job.
type Channel struct {
	ID                 string
	JobID              string
	CustomerID         string
	ProviderID         string
	Status             string // pending_approval, active, read_only, closed
	ChannelType        string // pre_award, contract, support
	CustomerLastReadAt *time.Time
	ProviderLastReadAt *time.Time
	LastMessageAt      *time.Time
	MessageCount       int
	CreatedAt          time.Time
	UpdatedAt          time.Time

	// Computed fields (not persisted directly).
	UnreadCount int
	LastMessage *Message
}

// Message represents a single chat message.
type Message struct {
	ID                 string
	ChannelID          string
	SenderID           string
	MessageType        string // text, image, file, system, contact_share
	Content            string
	MetadataJSON       []byte
	AttachmentURL      string
	AttachmentName     string
	AttachmentType     string
	AttachmentSize     int
	FlaggedContactInfo bool
	IsDeleted          bool
	DeletedAt          *time.Time
	CreatedAt          time.Time
}

// SharedContact represents a user's shared contact information within a channel.
type SharedContact struct {
	UserID   string
	Phone    string
	Email    string
	SharedAt time.Time
}

// ChannelUnread holds per-channel unread counts for a user.
type ChannelUnread struct {
	ChannelID   string
	UnreadCount int
}

// ChannelRepository defines persistence operations for channels and messages.
type ChannelRepository interface {
	CreateChannel(ctx context.Context, channel *Channel) (*Channel, error)
	GetChannel(ctx context.Context, channelID string, userID string) (*Channel, error)
	ListChannels(ctx context.Context, userID string, page, pageSize int) ([]*Channel, int, error)
	SendMessage(ctx context.Context, msg *Message) (*Message, error)
	ListMessages(ctx context.Context, channelID string, before *time.Time, pageSize int) ([]*Message, error)
	MarkRead(ctx context.Context, channelID string, userID string) error
	GetUnreadCounts(ctx context.Context, userID string) ([]ChannelUnread, error)
}
