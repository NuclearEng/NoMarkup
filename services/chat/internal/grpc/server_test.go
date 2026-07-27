package grpc

import (
	"fmt"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestMapDomainError pins the chat domain-error → gRPC-code mapping. Every
// expected domain error must map to a 4xx-class code, never Internal (a 500 for
// a predictable condition violates the project's error-handling rule).
func TestMapDomainError(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		err  error
		want codes.Code
	}{
		{"no bid for chat", domain.ErrNoBidForChat, codes.FailedPrecondition},
		{"channel not found", domain.ErrChannelNotFound, codes.NotFound},
		{"not channel member", domain.ErrNotChannelMember, codes.PermissionDenied},
		{"only provider can propose", domain.ErrOnlyProviderCanPropose, codes.PermissionDenied},
		{"only customer can respond", domain.ErrOnlyCustomerCanRespond, codes.PermissionDenied},
		{"channel closed", domain.ErrChannelClosed, codes.FailedPrecondition},
		{"empty message", domain.ErrEmptyMessage, codes.InvalidArgument},
		{"terms already pending", domain.ErrTermsAlreadyPending, codes.FailedPrecondition},
		{"nil error", nil, codes.OK},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := status.Code(mapDomainError(tt.err)); got != tt.want {
				t.Fatalf("mapDomainError(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

// TestMapDomainError_WrappedNoBid_NotInternal is the regression for the chat
// create-channel 500. CreateChannel returns the error wrapped ("create channel:
// %w") when a provider with no active bid tries to chat — a predictable user
// condition that fell through mapDomainError's default to codes.Internal →
// gateway 500. The fix maps it to FailedPrecondition (422). Without the fix this
// test fails (the wrapped error maps to Internal).
func TestMapDomainError_WrappedNoBid_NotInternal(t *testing.T) {
	t.Parallel()
	wrapped := fmt.Errorf("create channel: %w", domain.ErrNoBidForChat)
	got := status.Code(mapDomainError(wrapped))
	if got == codes.Internal {
		t.Fatalf("wrapped no-bid-for-chat error mapped to Internal (500) — regression: a predictable user condition must not 500")
	}
	if got != codes.FailedPrecondition {
		t.Fatalf("mapDomainError(wrapped no-bid) = %v, want FailedPrecondition (gateway 422)", got)
	}
}

// TestDomainChannelToProto_LastReadAt pins MarkRead watermarks onto the wire
// Channel so gateway JSON (and clients) can render read receipts without a
// peer reply. Nil watermarks must stay unset (not zero-time).
func TestDomainChannelToProto_LastReadAt(t *testing.T) {
	t.Parallel()

	customerRead := time.Date(2024, 6, 15, 10, 0, 0, 0, time.UTC)
	providerRead := time.Date(2024, 6, 15, 11, 30, 0, 0, time.UTC)
	created := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)

	t.Run("both set", func(t *testing.T) {
		t.Parallel()
		ch := &domain.Channel{
			ID:                 "ch-1",
			JobID:              "job-1",
			CustomerID:         "cust-1",
			ProviderID:         "prov-1",
			ChannelType:        "contract",
			CustomerLastReadAt: &customerRead,
			ProviderLastReadAt: &providerRead,
			CreatedAt:          created,
			UpdatedAt:          created,
		}
		pb := domainChannelToProto(ch)
		if pb.GetCustomerLastReadAt() == nil {
			t.Fatal("expected customer_last_read_at set")
		}
		if !pb.GetCustomerLastReadAt().AsTime().Equal(customerRead) {
			t.Fatalf("customer_last_read_at = %v, want %v", pb.GetCustomerLastReadAt().AsTime(), customerRead)
		}
		if pb.GetProviderLastReadAt() == nil {
			t.Fatal("expected provider_last_read_at set")
		}
		if !pb.GetProviderLastReadAt().AsTime().Equal(providerRead) {
			t.Fatalf("provider_last_read_at = %v, want %v", pb.GetProviderLastReadAt().AsTime(), providerRead)
		}
	})

	t.Run("nil watermarks omitted", func(t *testing.T) {
		t.Parallel()
		ch := &domain.Channel{
			ID:          "ch-2",
			CustomerID:  "cust-1",
			ProviderID:  "prov-1",
			ChannelType: "pre_award",
			CreatedAt:   created,
			UpdatedAt:   created,
		}
		pb := domainChannelToProto(ch)
		if pb.GetCustomerLastReadAt() != nil {
			t.Fatalf("customer_last_read_at = %v, want nil", pb.GetCustomerLastReadAt())
		}
		if pb.GetProviderLastReadAt() != nil {
			t.Fatalf("provider_last_read_at = %v, want nil", pb.GetProviderLastReadAt())
		}
	})
}
