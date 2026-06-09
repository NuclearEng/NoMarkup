package handler

import (
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// TestEffectiveListingStatus covers the lazy past-deadline transition for goods
// auctions: an 'active' listing past its auction_ends_at must read as 'ended',
// while every other (status, deadline) combination is passed through unchanged.
func TestEffectiveListingStatus(t *testing.T) {
	t.Parallel()
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	tests := []struct {
		name    string
		status  string
		endsAt  *time.Time
		want    string
	}{
		{"active past deadline -> ended", "active", &past, "ended"},
		{"active before deadline -> active", "active", &future, "active"},
		{"active nil deadline -> active", "active", nil, "active"},
		{"sold past deadline stays sold", "sold", &past, "sold"},
		{"expired past deadline stays expired", "expired", &past, "expired"},
		{"draft past deadline stays draft", "draft", &past, "draft"},
		{"cancelled past deadline stays cancelled", "cancelled", &past, "cancelled"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := effectiveListingStatus(tc.status, tc.endsAt); got != tc.want {
				t.Errorf("effectiveListingStatus(%q, %v) = %q, want %q", tc.status, tc.endsAt, got, tc.want)
			}
		})
	}
}

// TestEffectiveJobStatus covers the lazy past-deadline transition for service
// (reverse-auction) jobs: an 'active' job past its auction_ends_at must read as
// 'closed' (bidding over, pending award), never fabricating an award/winner.
func TestEffectiveJobStatus(t *testing.T) {
	t.Parallel()
	past := timestamppb.New(time.Now().Add(-time.Hour))
	future := timestamppb.New(time.Now().Add(time.Hour))

	tests := []struct {
		name   string
		status string
		endsAt *timestamppb.Timestamp
		want   string
	}{
		{"active past deadline -> closed", "active", past, "closed"},
		{"active before deadline -> active", "active", future, "active"},
		{"active nil deadline -> active", "active", nil, "active"},
		{"closed past deadline stays closed", "closed", past, "closed"},
		{"awarded past deadline stays awarded", "awarded", past, "awarded"},
		{"completed past deadline stays completed", "completed", past, "completed"},
		{"draft past deadline stays draft", "draft", past, "draft"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := effectiveJobStatus(tc.status, tc.endsAt); got != tc.want {
				t.Errorf("effectiveJobStatus(%q, %v) = %q, want %q", tc.status, tc.endsAt, got, tc.want)
			}
		})
	}
}

// TestEffectiveContractStatus covers the lazy past-deadline transition for a
// contract still awaiting acceptance: past acceptance_deadline -> 'abandoned'.
func TestEffectiveContractStatus(t *testing.T) {
	t.Parallel()
	past := timestamppb.New(time.Now().Add(-time.Hour))
	future := timestamppb.New(time.Now().Add(time.Hour))

	tests := []struct {
		name   string
		status string
		dl     *timestamppb.Timestamp
		want   string
	}{
		{"pending past deadline -> abandoned", "pending_acceptance", past, "abandoned"},
		{"pending before deadline stays pending", "pending_acceptance", future, "pending_acceptance"},
		{"pending nil deadline stays pending", "pending_acceptance", nil, "pending_acceptance"},
		{"active past deadline stays active", "active", past, "active"},
		{"completed past deadline stays completed", "completed", past, "completed"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := effectiveContractStatus(tc.status, tc.dl); got != tc.want {
				t.Errorf("effectiveContractStatus(%q, %v) = %q, want %q", tc.status, tc.dl, got, tc.want)
			}
		})
	}
}

// TestEffectiveOfferStatus covers the lazy offer-expiry transition:
// a pending/countered offer past expires_at reads as 'expired'.
func TestEffectiveOfferStatus(t *testing.T) {
	t.Parallel()
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	tests := []struct {
		name   string
		status string
		exp    time.Time
		want   string
	}{
		{"pending past expiry -> expired", "pending", past, "expired"},
		{"countered past expiry -> expired", "countered", past, "expired"},
		{"pending before expiry stays pending", "pending", future, "pending"},
		{"accepted past expiry stays accepted", "accepted", past, "accepted"},
		{"rejected past expiry stays rejected", "rejected", past, "rejected"},
		{"withdrawn past expiry stays withdrawn", "withdrawn", past, "withdrawn"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := effectiveOfferStatus(tc.status, tc.exp); got != tc.want {
				t.Errorf("effectiveOfferStatus(%q, %v) = %q, want %q", tc.status, tc.exp, got, tc.want)
			}
		})
	}
}
