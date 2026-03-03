package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
	"github.com/redis/go-redis/v9"
)

// PubSub handles Redis-based pub/sub for real-time chat notifications.
type PubSub struct {
	rdb *redis.Client
}

// NewPubSub creates a new PubSub backed by a Redis client.
func NewPubSub(rdb *redis.Client) *PubSub {
	return &PubSub{rdb: rdb}
}

// Publish serializes a message to JSON and publishes it to the Redis channel
// for the given chat channel ID.
func (ps *PubSub) Publish(ctx context.Context, channelID string, msg domain.Message) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("pubsub marshal message: %w", err)
	}
	topic := fmt.Sprintf("chat:%s", channelID)
	return ps.rdb.Publish(ctx, topic, data).Err()
}

// Subscribe subscribes to the Redis channel for the given chat channel ID
// and returns the subscription handle.
func (ps *PubSub) Subscribe(ctx context.Context, channelID string) *redis.PubSub {
	topic := fmt.Sprintf("chat:%s", channelID)
	return ps.rdb.Subscribe(ctx, topic)
}

// PublishTyping publishes a typing indicator for a user in a channel.
func (ps *PubSub) PublishTyping(ctx context.Context, channelID string, userID string) error {
	payload, err := json.Marshal(map[string]string{
		"channel_id": channelID,
		"user_id":    userID,
		"type":       "typing",
	})
	if err != nil {
		return fmt.Errorf("pubsub marshal typing: %w", err)
	}
	topic := fmt.Sprintf("chat:%s:typing", channelID)
	return ps.rdb.Publish(ctx, topic, payload).Err()
}
