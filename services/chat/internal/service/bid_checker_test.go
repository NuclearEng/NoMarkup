package service

// Authorization tests for FR-8.1 pre-award chat access.
//
// Regression context: the guard in CreateChannel read
// `channelType == "pre_award" && s.bidChecker != nil`, and SetBidChecker had
// no call sites anywhere in the repo — so the checker was permanently nil and
// the entire check was dead code. Any provider could open a pre-award channel
// on any job without bidding, while the surrounding comment claimed the path
// failed closed and docs/TODOS.md marked it done.
//
// These tests pin all three outcomes, including the one that matters most:
// an UNCONFIGURED checker must DENY, not skip.

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
)

type stubBidChecker struct {
	hasBid bool
	err    error
}

func (s stubBidChecker) HasActiveBid(_ context.Context, _, _ string) (bool, error) {
	return s.hasBid, s.err
}

func TestCreateChannel_bidVerification(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		checker     domain.BidChecker // nil means "never wired"
		setChecker  bool
		wantErr     bool
		errContains string
	}{
		{
			name:       "provider with an active bid may open the channel",
			checker:    stubBidChecker{hasBid: true},
			setChecker: true,
		},
		{
			name:        "provider with no bid is refused",
			checker:     stubBidChecker{hasBid: false},
			setChecker:  true,
			wantErr:     true,
			errContains: domain.ErrNoBidForChat.Error(),
		},
		{
			name:        "verification error fails closed",
			checker:     stubBidChecker{err: errors.New("db down")},
			setChecker:  true,
			wantErr:     true,
			errContains: "bid verification unavailable",
		},
		{
			// The regression itself: an unwired checker must deny.
			name:        "unconfigured checker fails closed",
			setChecker:  false,
			wantErr:     true,
			errContains: "bid verification unavailable",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			svc := New(newMockRepo(), nil)
			if tt.setChecker {
				svc.SetBidChecker(tt.checker)
			}

			ch, err := svc.CreateChannel(context.Background(), "job-1", "cust-1", "prov-1", "pre_award")

			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
				assert.Nil(t, ch, "no channel may be created when access is refused")
				return
			}
			require.NoError(t, err)
			require.NotNil(t, ch)
			assert.Equal(t, "pre_award", ch.ChannelType)
		})
	}
}

// An empty channel type defaults to pre_award, so it must be gated too —
// otherwise the check is trivially bypassed by omitting the field.
func TestCreateChannel_emptyChannelTypeIsAlsoGated(t *testing.T) {
	t.Parallel()

	svc := New(newMockRepo(), nil)
	svc.SetBidChecker(stubBidChecker{hasBid: false})

	ch, err := svc.CreateChannel(context.Background(), "job-1", "cust-1", "prov-1", "")

	require.Error(t, err)
	assert.Contains(t, err.Error(), domain.ErrNoBidForChat.Error())
	assert.Nil(t, ch)
}
