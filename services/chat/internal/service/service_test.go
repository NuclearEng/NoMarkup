package service

import (
	"context"
	"errors"
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

func (m *mockRepo) ListMessages(_ context.Context, _ string, _ *time.Time, _ int) ([]*domain.Message, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.messages, nil
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
					assert.Equal(t, "pre_award", ch.ChannelType)
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

	msgs, err := svc.ListMessages(context.Background(), "ch-1", "user-1", nil, 50)
	require.NoError(t, err)
	assert.Len(t, msgs, 1)

	// Non-member should be denied.
	_, err = svc.ListMessages(context.Background(), "ch-1", "user-3", nil, 50)
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrNotChannelMember) || assert.ObjectsAreEqual("not a member", err.Error()))
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
