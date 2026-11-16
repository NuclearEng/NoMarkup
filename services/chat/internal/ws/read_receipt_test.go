package ws

import (
	"encoding/json"
	"testing"

	"github.com/redis/go-redis/v9"
)

func TestRedisTopicKind(t *testing.T) {
	t.Parallel()
	cases := []struct {
		channelID, redisChannel, want string
	}{
		{"ch-1", "chat:ch-1", "message"},
		{"ch-1", "chat:ch-1:typing", "typing"},
		{"ch-1", "chat:ch-1:read", "read"},
		{"ch-1", "chat:other:read", ""},
		{"ch-1", "chat:ch-1:unknown", ""},
	}
	for _, tc := range cases {
		if got := redisTopicKind(tc.channelID, tc.redisChannel); got != tc.want {
			t.Errorf("redisTopicKind(%q, %q)=%q want %q", tc.channelID, tc.redisChannel, got, tc.want)
		}
	}
}

func TestForwardRedisMessage_ReadReceipt(t *testing.T) {
	t.Parallel()
	c := &Connection{
		userID:  "viewer-id",
		sendCh:  make(chan []byte, 1),
		closeCh: make(chan struct{}),
	}
	payload := `{"type":"read_receipt","channel_id":"ch-1","user_id":"peer-id","last_read_at":"2026-07-27T12:00:00Z"}`
	c.forwardRedisMessage("ch-1", &redis.Message{
		Channel: "chat:ch-1:read",
		Payload: payload,
	})
	select {
	case data := <-c.sendCh:
		var msg ServerMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if msg.Type != "read_receipt" {
			t.Fatalf("type=%q want read_receipt", msg.Type)
		}
		if msg.ChannelID != "ch-1" || msg.UserID != "peer-id" {
			t.Fatalf("ids: channel=%q user=%q", msg.ChannelID, msg.UserID)
		}
		if msg.LastReadAt != "2026-07-27T12:00:00Z" {
			t.Fatalf("last_read_at=%q", msg.LastReadAt)
		}
	default:
		t.Fatal("expected read_receipt frame on sendCh")
	}
}

func TestForwardRedisMessage_ReadReceiptSelfEchoDropped(t *testing.T) {
	t.Parallel()
	c := &Connection{
		userID:  "peer-id",
		sendCh:  make(chan []byte, 1),
		closeCh: make(chan struct{}),
	}
	payload := `{"type":"read_receipt","channel_id":"ch-1","user_id":"peer-id","last_read_at":"2026-07-27T12:00:00Z"}`
	c.forwardRedisMessage("ch-1", &redis.Message{
		Channel: "chat:ch-1:read",
		Payload: payload,
	})
	select {
	case data := <-c.sendCh:
		t.Fatalf("expected self read_receipt drop, got %s", data)
	default:
		// ok
	}
}
