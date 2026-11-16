package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/chat/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockRepo implements domain.ChannelRepository for testing.
type mockRepo struct {
	channels map[string]*domain.Channel
	messages []*domain.Message
	err      error
}

func newMockRepo() *mockRepo {
	return &mockRepo{channels: make(map[string]*domain.Channel)}
}

func (m *mockRepo) CreateChannel(_ context.Context, ch *domain.Channel) (*domain.Channel, error) {
	if m.err != nil {
		return nil, m.err
	}
	ch.ID = "ch-1"
	ch.CreatedAt = time.Now()
	ch.UpdatedAt = time.Now()
	m.channels[ch.ID] = ch
	return ch, nil
}

func (m *mockRepo) GetChannel(_ context.Context, channelID string, _ string) (*domain.Channel, error) {
	if m.err != nil {
		return nil, m.err
	}
	ch, ok := m.channels[channelID]
	if !ok {
		return nil, domain.ErrChannelNotFound
	}
	return ch, nil
}

func (m *mockRepo) IsChannelMember(_ context.Context, channelID, userID string) (bool, error) {
	if m.err != nil {
		return false, m.err
	}
	ch, ok := m.channels[channelID]
	if !ok {
		return false, nil
	}
	return ch.CustomerID == userID || ch.ProviderID == userID, nil
}

func (m *mockRepo) IsJobParticipant(_ context.Context, jobID, userID string) (bool, error) {
	if m.err != nil {
		return false, m.err
	}
	for _, ch := range m.channels {
		if ch.JobID == jobID && (ch.CustomerID == userID || ch.ProviderID == userID) {
			return true, nil
		}
	}
	return false, nil
}

func (m *mockRepo) ListChannels(_ context.Context, _ string, _ int, _ int) ([]*domain.Channel, int, error) {
	if m.err != nil {
		return nil, 0, m.err
	}
	var channels []*domain.Channel
	for _, ch := range m.channels {
		channels = append(channels, ch)
	}
	return channels, len(channels), nil
}

func (m *mockRepo) SendMessage(_ context.Context, msg *domain.Message) (*domain.Message, error) {
	if m.err != nil {
		return nil, m.err
	}
	msg.ID = "msg-1"
	msg.CreatedAt = time.Now()
	m.messages = append(m.messages, msg)
	return msg, nil
}

func (m *mockRepo) ListMessages(_ context.Context, _ string, _ *time.Time, _ int, query string) ([]*domain.Message, error) {
	if m.err != nil {
		return nil, m.err
	}
	q := strings.TrimSpace(strings.ToLower(query))
	if q == "" {
		return m.messages, nil
	}
	var out []*domain.Message
	for _, msg := range m.messages {
		if strings.Contains(strings.ToLower(msg.Content), q) {
			out = append(out, msg)
		}
	}
	return out, nil
}

func (m *mockRepo) MarkRead(_ context.Context, _ string, _ string) error {
	return m.err
}

func (m *mockRepo) GetUnreadCounts(_ context.Context, _ string) ([]domain.ChannelUnread, error) {
	if m.err != nil {
		return nil, m.err
	}
	return []domain.ChannelUnread{{ChannelID: "ch-1", UnreadCount: 3}}, nil
}

func TestCreateChannel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		jobID       string
		customerID  string
		providerID  string
		channelType string
		wantErr     bool
		errContains string
	}{
		{
			name:        "valid channel",
			jobID:       "job-1",
			customerID:  "user-1",
			providerID:  "user-2",
			channelType: "pre_award",
			wantErr:     false,
		},
		{
			name:        "defaults to pre_award",
			jobID:       "job-1",
			customerID:  "user-1",
			providerID:  "user-2",
			channelType: "",
			wantErr:     false,
		},
		{
			name:        "missing job_id",
			jobID:       "",
			customerID:  "user-1",
			providerID:  "user-2",
			channelType: "pre_award",
			wantErr:     true,
			errContains: "job_id is required",
		},
		{
			name:        "missing customer_id",
			jobID:       "job-1",
			customerID:  "",
			providerID:  "user-2",
			channelType: "pre_award",
			wantErr:     true,
			errContains: "customer_id is required",
		},
		{
			name:        "missing provider_id",
			jobID:       "job-1",
			customerID:  "user-1",
			providerID:  "",
			channelType: "pre_award",
			wantErr:     true,
			errContains: "provider_id is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			repo := newMockRepo()
			svc := New(repo, nil)
			// FR-8.1 is fail-closed: a pre-award channel needs a bid checker
			// that confirms the provider bid. These cases exercise argument
			// validation and the happy path, so give them a checker that says
			// yes. The authorization behaviour itself is covered by
			// TestCreateChannel_bidVerification below.
			svc.SetBidChecker(stubBidChecker{hasBid: true})

			ch, err := svc.CreateChannel(context.Background(), tt.jobID, tt.customerID, tt.providerID, tt.channelType)
			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
				assert.Nil(t, ch)
			} else {
				require.NoError(t, err)
				assert.NotEmpty(t, ch.ID)
				assert.Equal(t, tt.jobID, ch.JobID)
				assert.Equal(t, "active", ch.Status)
				if tt.channelType == "" {
					assert.Equal(t, "bid", ch.ChannelType)
				}
			}
		})
	}
}

func TestGetChannel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		setupRepo func(*mockRepo)
		channelID string
		userID    string
		wantErr   bool
	}{
		{
			name: "member can access",
			setupRepo: func(r *mockRepo) {
				r.channels["ch-1"] = &domain.Channel{
					ID: "ch-1", CustomerID: "user-1", ProviderID: "user-2", Status: "active",
				}
			},
			channelID: "ch-1",
			userID:    "user-1",
			wantErr:   false,
		},
		{
			name: "non-member denied",
			setupRepo: func(r *mockRepo) {
				r.channels["ch-1"] = &domain.Channel{
					ID: "ch-1", CustomerID: "user-1", ProviderID: "user-2", Status: "active",
				}
			},
			channelID: "ch-1",
			userID:    "user-3",
			wantErr:   true,
		},
		{
			name:      "channel not found",
			setupRepo: func(_ *mockRepo) {},
			channelID: "ch-nonexistent",
			userID:    "user-1",
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			repo := newMockRepo()
			tt.setupRepo(repo)
			svc := New(repo, nil)

			ch, err := svc.GetChannel(context.Background(), tt.channelID, tt.userID)
			if tt.wantErr {
				require.Error(t, err)
				assert.Nil(t, ch)
			} else {
				require.NoError(t, err)
				assert.NotNil(t, ch)
			}
		})
	}
}

func TestIsChannelMember(t *testing.T) {
	t.Parallel()

	repo := newMockRepo()
	repo.channels["ch-1"] = &domain.Channel{
		ID: "ch-1", JobID: "job-1", CustomerID: "user-1", ProviderID: "user-2", Status: "active",
	}
	svc := New(repo, nil)

	tests := []struct {
		name      string
		channelID string
		userID    string
		want      bool
	}{
		{"customer is member", "ch-1", "user-1", true},
		{"provider is member", "ch-1", "user-2", true},
		{"outsider is not a member", "ch-1", "user-3", false},
		{"nonexistent channel", "ch-nope", "user-1", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := svc.IsChannelMember(context.Background(), tt.channelID, tt.userID)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestIsJobParticipant(t *testing.T) {
	t.Parallel()

	repo := newMockRepo()
	repo.channels["ch-1"] = &domain.Channel{
		ID: "ch-1", JobID: "job-1", CustomerID: "owner-1", ProviderID: "bidder-1", Status: "active",
	}
	svc := New(repo, nil)

	tests := []struct {
		name   string
		jobID  string
		userID string
		want   bool
	}{
		{"job owner is participant", "job-1", "owner-1", true},
		{"bidder is participant", "job-1", "bidder-1", true},
		{"outsider is not a participant", "job-1", "stranger", false},
		{"unrelated job", "job-2", "owner-1", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := svc.IsJobParticipant(context.Background(), tt.jobID, tt.userID)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestSendMessage(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		setupRepo   func(*mockRepo)
		channelID   string
		senderID    string
		msgType     string
		content     string
		wantErr     bool
		errContains string
	}{
		{
			name: "valid text message",
			setupRepo: func(r *mockRepo) {
				r.channels["ch-1"] = &domain.Channel{
					ID: "ch-1", CustomerID: "user-1", ProviderID: "user-2", Status: "active",
				}
			},
			channelID: "ch-1",
			senderID:  "user-1",
			msgType:   "text",
			content:   "Hello!",
			wantErr:   false,
		},
		{
			name: "empty text message rejected",
			setupRepo: func(r *mockRepo) {
				r.channels["ch-1"] = &domain.Channel{
					ID: "ch-1", CustomerID: "user-1", ProviderID: "user-2", Status: "active",
				}
			},
			channelID:   "ch-1",
			senderID:    "user-1",
			msgType:     "text",
			content:     "   ",
			wantErr:     true,
			errContains: "empty",
		},
		{
			name: "closed channel rejected",
			setupRepo: func(r *mockRepo) {
				r.channels["ch-1"] = &domain.Channel{
					ID: "ch-1", CustomerID: "user-1", ProviderID: "user-2", Status: "closed",
				}
			},
			channelID:   "ch-1",
			senderID:    "user-1",
			msgType:     "text",
			content:     "Hello",
			wantErr:     true,
			errContains: "closed",
		},
		{
			name: "non-member rejected",
			setupRepo: func(r *mockRepo) {
				r.channels["ch-1"] = &domain.Channel{
					ID: "ch-1", CustomerID: "user-1", ProviderID: "user-2", Status: "active",
				}
			},
			channelID:   "ch-1",
			senderID:    "user-3",
			msgType:     "text",
			content:     "Hello",
			wantErr:     true,
			errContains: "not a member",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			repo := newMockRepo()
			tt.setupRepo(repo)
			svc := New(repo, nil)

			msg, err := svc.SendMessage(context.Background(), tt.channelID, tt.senderID, tt.msgType, tt.content)
			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
				assert.Nil(t, msg)
			} else {
				require.NoError(t, err)
				assert.NotEmpty(t, msg.ID)
				assert.Equal(t, tt.content, msg.Content)
			}
		})
	}
}

func TestDetectContactInfo(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		content string
		want    bool
	}{
		{"plain text", "Hello, how are you?", false},
		{"phone number", "Call me at 555-123-4567", true},
		{"email address", "Reach me at test@example.com", true},
		{"phone with parens", "My number is (555) 123-4567", true},
		{"international phone", "+1 555-123-4567", true},
		{"no contact info", "The job costs about $500 and takes 3 days", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := DetectContactInfo(tt.content)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestListMessages(t *testing.T) {
	t.Parallel()

	repo := newMockRepo()
	repo.channels["ch-1"] = &domain.Channel{
		ID: "ch-1", CustomerID: "user-1", ProviderID: "user-2", Status: "active",
	}
	repo.messages = []*domain.Message{
		{ID: "msg-1", ChannelID: "ch-1", Content: "Hello"},
	}
	svc := New(repo, nil)

	msgs, err := svc.ListMessages(context.Background(), "ch-1", "user-1", nil, 50, "")
	require.NoError(t, err)
	assert.Len(t, msgs, 1)

	// Non-member should be denied.
	_, err = svc.ListMessages(context.Background(), "ch-1", "user-3", nil, 50, "")
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrNotChannelMember) || assert.ObjectsAreEqual("not a member", err.Error()))
}

func TestListMessages_SearchQuery(t *testing.T) {
	t.Parallel()

	repo := newMockRepo()
	repo.channels["ch-1"] = &domain.Channel{
		ID: "ch-1", CustomerID: "user-1", ProviderID: "user-2", Status: "active",
	}
	repo.messages = []*domain.Message{
		{ID: "msg-1", ChannelID: "ch-1", Content: "Hello world"},
		{ID: "msg-2", ChannelID: "ch-1", Content: "Invoice attached"},
		{ID: "msg-3", ChannelID: "ch-1", Content: "hello again"},
	}
	svc := New(repo, nil)

	msgs, err := svc.ListMessages(context.Background(), "ch-1", "user-1", nil, 50, "hello")
	require.NoError(t, err)
	require.Len(t, msgs, 2)
	assert.Equal(t, "msg-1", msgs[0].ID)
	assert.Equal(t, "msg-3", msgs[1].ID)

	// Membership still enforced under search.
	_, err = svc.ListMessages(context.Background(), "ch-1", "user-3", nil, 50, "hello")
	require.Error(t, err)
}

// TestSendTypingIndicatorMembership covers SEC-10: non-members must not publish typing.
func TestSendTypingIndicatorMembership(t *testing.T) {
	t.Parallel()

	repo := newMockRepo()
	repo.channels["ch-1"] = &domain.Channel{
		ID: "ch-1", CustomerID: "user-1", ProviderID: "user-2", Status: "active",
	}
	// pubsub nil is fine — membership is checked first; members short-circuit to nil.
	svc := New(repo, nil)

	err := svc.SendTypingIndicator(context.Background(), "ch-1", "user-1")
	require.NoError(t, err)

	err = svc.SendTypingIndicator(context.Background(), "ch-1", "user-2")
	require.NoError(t, err)

	err = svc.SendTypingIndicator(context.Background(), "ch-1", "user-3")
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrNotChannelMember))

	err = svc.SendTypingIndicator(context.Background(), "ch-missing", "user-1")
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrNotChannelMember))
}

func TestGetUnreadCounts(t *testing.T) {
	t.Parallel()

	repo := newMockRepo()
	svc := New(repo, nil)

	counts, err := svc.GetUnreadCounts(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Len(t, counts, 1)
	assert.Equal(t, 3, counts[0].UnreadCount)
}

// stubLookup is a hand-wired AliasLookup for relay-rewrite tests.
type stubLookup struct {
	emailAlias string
	phoneProxy string
	hasReplied bool
	err        error
}

func (s stubLookup) LookupCold(_ context.Context, _, _ string) (string, string, bool, error) {
	return s.emailAlias, s.phoneProxy, s.hasReplied, s.err
}

// TestMaybeRewriteForRelay locks in the cold-open privacy contract: a phone or
// email in a message body is rewritten to the recipient's alias (or masked)
// until the recipient has replied, after which the body passes through.
func TestMaybeRewriteForRelay(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	tests := []struct {
		name    string
		lookup  AliasLookup
		content string
		want    string
	}{
		{
			name:    "nil lookup is a no-op",
			lookup:  nil,
			content: "Call me at 555-123-4567",
			want:    "Call me at 555-123-4567",
		},
		{
			name:    "no contact info passes through",
			lookup:  stubLookup{},
			content: "Can you do it next week?",
			want:    "Can you do it next week?",
		},
		{
			name:    "warm channel (recipient replied) does not rewrite",
			lookup:  stubLookup{hasReplied: true, phoneProxy: "555-000-0000"},
			content: "Here is my cell 555-123-4567",
			want:    "Here is my cell 555-123-4567",
		},
		{
			name:    "cold-open with alias rewrites email and phone",
			lookup:  stubLookup{emailAlias: "alias-xyz@relay.nomarkup.com", phoneProxy: "555-000-0000"},
			content: "Email me a@b.com or call 555-123-4567",
			want:    "Email me alias-xyz@relay.nomarkup.com or call 555-000-0000",
		},
		{
			name:    "cold-open without proxy masks the phone (fail-closed)",
			lookup:  stubLookup{},
			content: "Reach me at 555-123-4567",
			want:    "Reach me at ***-***-****",
		},
		{
			name:    "lookup error leaves content untouched",
			lookup:  stubLookup{err: errors.New("db down")},
			content: "Text 555-123-4567",
			want:    "Text 555-123-4567",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := maybeRewriteForRelay(ctx, tt.lookup, "chan-1", "recip-1", tt.content)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestSendProposedTerms(t *testing.T) {
	t.Parallel()

	repo := newMockRepo()
	repo.channels["ch-1"] = &domain.Channel{
		ID: "ch-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
	}
	svc := New(repo, nil)

	t.Run("provider can propose", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
		}
		s := New(r, nil)
		msg, err := s.SendProposedTerms(context.Background(), "ch-1", "prov-1", map[string]interface{}{
			"payment_type": "milestone",
			"amount":       "$1,200",
			"description":  "Full remodel",
		})
		require.NoError(t, err)
		require.NotNil(t, msg)
		assert.Equal(t, domain.MessageTypeProposedTerms, msg.MessageType)
		assert.True(t, strings.HasPrefix(msg.Content, "[Proposed Terms]"))
		assert.Contains(t, msg.Content, "Payment Type: milestone")
		assert.Contains(t, msg.Content, "Amount: $1,200")
		assert.Contains(t, msg.Content, "Description: Full remodel")
		assert.NotEmpty(t, msg.MetadataJSON)
	})

	t.Run("customer cannot propose", func(t *testing.T) {
		t.Parallel()
		_, err := svc.SendProposedTerms(context.Background(), "ch-1", "cust-1", map[string]interface{}{
			"amount": "100",
		})
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrOnlyProviderCanPropose))
	})

	t.Run("non-member cannot propose", func(t *testing.T) {
		t.Parallel()
		_, err := svc.SendProposedTerms(context.Background(), "ch-1", "outsider", nil)
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrNotChannelMember))
	})

	t.Run("closed channel rejected", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "closed",
		}
		s := New(r, nil)
		_, err := s.SendProposedTerms(context.Background(), "ch-1", "prov-1", map[string]interface{}{
			"amount": "1",
		})
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrChannelClosed))
	})
}

func TestRespondToTerms(t *testing.T) {
	t.Parallel()

	t.Run("customer accept", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
		}
		s := New(r, nil)
		msg, err := s.RespondToTerms(context.Background(), "ch-1", "cust-1", true)
		require.NoError(t, err)
		require.NotNil(t, msg)
		assert.Equal(t, domain.MessageTypeTermsAccepted, msg.MessageType)
		assert.Contains(t, msg.Content, "accepted")
		// No binder wired → residual consent-only.
		assert.Contains(t, string(msg.MetadataJSON), `"contract_override_applied":false`)
		assert.Contains(t, string(msg.MetadataJSON), "binder_unavailable")
	})

	t.Run("customer accept binds live contract", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", JobID: "job-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
		}
		s := New(r, nil)
		binder := &mockLocalTermsBinder{
			proposed: map[string]interface{}{
				"payment_type": "milestone",
				"amount":       "50000",
				"description":  "half at mid, half at end",
			},
			proposedMsgID: "prop-msg-1",
			contractID:    "contract-99",
		}
		s.SetLocalTermsBinder(binder)

		msg, err := s.RespondToTerms(context.Background(), "ch-1", "cust-1", true)
		require.NoError(t, err)
		require.NotNil(t, msg)
		assert.Equal(t, domain.MessageTypeTermsAccepted, msg.MessageType)
		assert.Equal(t, 1, binder.applyCalls)
		require.NotNil(t, binder.lastPaymentTiming)
		assert.Equal(t, "milestone", *binder.lastPaymentTiming)
		assert.NotEmpty(t, binder.lastTermsJSON)
		assert.Contains(t, string(binder.lastTermsJSON), "local_terms")
		assert.Contains(t, string(msg.MetadataJSON), `"contract_override_applied":true`)
		assert.Contains(t, string(msg.MetadataJSON), "contract-99")
		assert.Contains(t, string(msg.MetadataJSON), `"payment_timing_applied":"milestone"`)
	})

	t.Run("customer accept with job but no live contract is residual", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", JobID: "job-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
		}
		s := New(r, nil)
		binder := &mockLocalTermsBinder{
			proposed: map[string]interface{}{
				"payment_type": "upfront",
			},
			proposedMsgID: "prop-msg-1",
			contractID:    "", // no live contract
		}
		s.SetLocalTermsBinder(binder)

		msg, err := s.RespondToTerms(context.Background(), "ch-1", "cust-1", true)
		require.NoError(t, err)
		assert.Equal(t, 1, binder.applyCalls)
		assert.Contains(t, string(msg.MetadataJSON), `"contract_override_applied":false`)
		assert.Contains(t, string(msg.MetadataJSON), "no_live_contract")
	})

	t.Run("customer accept without prior proposal skips bind", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", JobID: "job-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
		}
		s := New(r, nil)
		binder := &mockLocalTermsBinder{proposedMsgID: ""}
		s.SetLocalTermsBinder(binder)

		msg, err := s.RespondToTerms(context.Background(), "ch-1", "cust-1", true)
		require.NoError(t, err)
		assert.Equal(t, 0, binder.applyCalls)
		assert.Contains(t, string(msg.MetadataJSON), "no_proposed_terms")
	})

	t.Run("customer reject does not bind contract", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", JobID: "job-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
		}
		s := New(r, nil)
		binder := &mockLocalTermsBinder{
			proposed:      map[string]interface{}{"payment_type": "milestone"},
			proposedMsgID: "prop-msg-1",
			contractID:    "contract-99",
		}
		s.SetLocalTermsBinder(binder)

		msg, err := s.RespondToTerms(context.Background(), "ch-1", "cust-1", false)
		require.NoError(t, err)
		assert.Equal(t, domain.MessageTypeTermsRejected, msg.MessageType)
		assert.Contains(t, msg.Content, "rejected")
		assert.Equal(t, 0, binder.applyCalls)
		assert.Contains(t, string(msg.MetadataJSON), `"contract_override_applied":false`)
	})

	t.Run("free-text payment_type still merges terms_json without timing override", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", JobID: "job-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
		}
		s := New(r, nil)
		binder := &mockLocalTermsBinder{
			proposed: map[string]interface{}{
				"payment_type": "50% now, 50% on completion",
				"amount":       "1000",
			},
			proposedMsgID: "prop-msg-2",
			contractID:    "contract-1",
		}
		s.SetLocalTermsBinder(binder)

		msg, err := s.RespondToTerms(context.Background(), "ch-1", "cust-1", true)
		require.NoError(t, err)
		assert.Equal(t, 1, binder.applyCalls)
		assert.Nil(t, binder.lastPaymentTiming)
		assert.Contains(t, string(binder.lastTermsJSON), "50% now")
		assert.Contains(t, string(msg.MetadataJSON), `"contract_override_applied":true`)
		assert.NotContains(t, string(msg.MetadataJSON), "payment_timing_applied")
	})

	t.Run("provider cannot respond", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
		}
		s := New(r, nil)
		_, err := s.RespondToTerms(context.Background(), "ch-1", "prov-1", true)
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrOnlyCustomerCanRespond))
	})

	t.Run("non-member cannot respond", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "active",
		}
		s := New(r, nil)
		_, err := s.RespondToTerms(context.Background(), "ch-1", "outsider", true)
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrNotChannelMember))
	})

	t.Run("closed channel rejected", func(t *testing.T) {
		t.Parallel()
		r := newMockRepo()
		r.channels["ch-1"] = &domain.Channel{
			ID: "ch-1", CustomerID: "cust-1", ProviderID: "prov-1", Status: "read_only",
		}
		s := New(r, nil)
		_, err := s.RespondToTerms(context.Background(), "ch-1", "cust-1", true)
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrChannelClosed))
	})
}

// mockLocalTermsBinder captures ApplyLocalTerms calls for FR-5.4 accept tests.
type mockLocalTermsBinder struct {
	proposed           map[string]interface{}
	proposedMsgID      string
	contractID         string
	applyErr           error
	lookupErr          error
	applyCalls         int
	lastPaymentTiming  *string
	lastTermsJSON      []byte
	lastJobID          string
	lastCustomerID     string
	lastProviderID     string
}

func (m *mockLocalTermsBinder) LatestProposedTerms(_ context.Context, _ string) ([]byte, string, error) {
	if m.lookupErr != nil {
		return nil, "", m.lookupErr
	}
	if m.proposedMsgID == "" {
		return nil, "", nil
	}
	if m.proposed == nil {
		return []byte(`{}`), m.proposedMsgID, nil
	}
	b, err := json.Marshal(m.proposed)
	if err != nil {
		return nil, "", err
	}
	return b, m.proposedMsgID, nil
}

func (m *mockLocalTermsBinder) ApplyLocalTerms(
	_ context.Context,
	jobID, customerID, providerID string,
	paymentTiming *string,
	termsJSON []byte,
) (string, error) {
	m.applyCalls++
	m.lastJobID = jobID
	m.lastCustomerID = customerID
	m.lastProviderID = providerID
	m.lastPaymentTiming = paymentTiming
	m.lastTermsJSON = append([]byte(nil), termsJSON...)
	if m.applyErr != nil {
		return "", m.applyErr
	}
	return m.contractID, nil
}

func TestNormalizePaymentTiming(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   string
		want string
		ok   bool
	}{
		{name: "milestone", in: "milestone", want: "milestone", ok: true},
		{name: "Milestones", in: "Milestones", want: "milestone", ok: true},
		{name: "up-front", in: "up-front", want: "upfront", ok: true},
		{name: "payment plan", in: "payment plan", want: "payment_plan", ok: true},
		{name: "completion", in: "completion", want: "completion", ok: true},
		{name: "recurring", in: "recurring", want: "recurring", ok: true},
		{name: "free text", in: "50% now", want: "", ok: false},
		{name: "empty", in: "", want: "", ok: false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := normalizePaymentTiming(tc.in)
			assert.Equal(t, tc.ok, ok)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestExtractPaymentTiming(t *testing.T) {
	t.Parallel()
	pt := extractPaymentTiming(map[string]interface{}{
		"payment_type": "upfront",
	})
	require.NotNil(t, pt)
	assert.Equal(t, "upfront", *pt)

	// Explicit payment_timing wins over free-text payment_type.
	pt = extractPaymentTiming(map[string]interface{}{
		"payment_timing": "milestone",
		"payment_type":   "ignore me",
	})
	require.NotNil(t, pt)
	assert.Equal(t, "milestone", *pt)

	assert.Nil(t, extractPaymentTiming(map[string]interface{}{
		"payment_type": "custom split",
	}))
}
