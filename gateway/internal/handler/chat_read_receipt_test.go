package handler

import (
	"testing"
	"time"

	chatv1 "github.com/nomarkup/nomarkup/proto/chat/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// TestProtoChannelToJSON_LastReadAt ensures GET channel / list channels JSON
// projects customer_last_read_at / provider_last_read_at for iOS read receipts.
func TestProtoChannelToJSON_LastReadAt(t *testing.T) {
	t.Parallel()

	customerRead := time.Date(2024, 6, 15, 10, 0, 0, 0, time.UTC)
	providerRead := time.Date(2024, 6, 15, 11, 30, 0, 0, time.UTC)
	created := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)

	t.Run("both watermarks present", func(t *testing.T) {
		t.Parallel()
		ch := &chatv1.Channel{
			Id:                 "ch-1",
			JobId:              "job-1",
			CustomerId:         "cust-1",
			ProviderId:         "prov-1",
			ChannelType:        chatv1.ChannelType_CHANNEL_TYPE_CONTRACT,
			UnreadCount:        0,
			CreatedAt:          timestamppb.New(created),
			UpdatedAt:          timestamppb.New(created),
			CustomerLastReadAt: timestamppb.New(customerRead),
			ProviderLastReadAt: timestamppb.New(providerRead),
		}
		got := protoChannelToJSON(ch, nil)
		assert.Equal(t, "2024-06-15T10:00:00Z", got["customer_last_read_at"])
		assert.Equal(t, "2024-06-15T11:30:00Z", got["provider_last_read_at"])
		assert.Equal(t, "ch-1", got["id"])
	})

	t.Run("nil watermarks omitted", func(t *testing.T) {
		t.Parallel()
		ch := &chatv1.Channel{
			Id:          "ch-2",
			CustomerId:  "cust-1",
			ProviderId:  "prov-1",
			ChannelType: chatv1.ChannelType_CHANNEL_TYPE_PRE_AWARD,
			CreatedAt:   timestamppb.New(created),
			UpdatedAt:   timestamppb.New(created),
		}
		got := protoChannelToJSON(ch, nil)
		_, hasCustomer := got["customer_last_read_at"]
		_, hasProvider := got["provider_last_read_at"]
		assert.False(t, hasCustomer, "customer_last_read_at must be omitted when unset")
		assert.False(t, hasProvider, "provider_last_read_at must be omitted when unset")
		require.Equal(t, "ch-2", got["id"])
	})
}
