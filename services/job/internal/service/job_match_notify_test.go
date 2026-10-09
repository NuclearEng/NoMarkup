package service

import (
	"context"
	"errors"
	"testing"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubNotifier struct {
	err     error
	calls   int
	lastPID string
}

func (s *stubNotifier) SendMatchNotification(_ context.Context, providerID, _, _, _ string, _ float64, _ int) error {
	s.calls++
	s.lastPID = providerID
	return s.err
}

func TestNotifyProviderOfMatch_recordsEvenWhenSendFails(t *testing.T) {
	var recorded [][2]string
	repo := &mockJobRepo{
		recordMatchFn: func(jobID, providerID string) error {
			recorded = append(recorded, [2]string{jobID, providerID})
			return nil
		},
	}
	svc := newTestJobService(repo)
	n := &stubNotifier{err: errors.New("push failed")}
	svc.SetNotifier(n)

	svc.notifyProviderOfMatch(context.Background(), domain.MatchedProvider{
		ProviderID: "prov-1",
		MatchScore: 0.8,
	}, "job-1", "Fix sink", "Plumbing")

	require.Len(t, recorded, 1)
	assert.Equal(t, "job-1", recorded[0][0])
	assert.Equal(t, "prov-1", recorded[0][1])
	assert.Equal(t, 1, n.calls)
}

func TestNotifyProviderOfMatch_recordsWhenNotifierNil(t *testing.T) {
	var recorded int
	repo := &mockJobRepo{
		recordMatchFn: func(_, _ string) error {
			recorded++
			return nil
		},
	}
	svc := newTestJobService(repo)

	svc.notifyProviderOfMatch(context.Background(), domain.MatchedProvider{
		ProviderID: "prov-2",
	}, "job-2", "Mow lawn", "Lawn")

	assert.Equal(t, 1, recorded)
}

func TestNotifyProviderOfMatch_recordsEvenWhenLedgerWriteFails(t *testing.T) {
	repo := &mockJobRepo{
		recordMatchFn: func(_, _ string) error { return errors.New("db down") },
	}
	svc := newTestJobService(repo)
	n := &stubNotifier{}
	svc.SetNotifier(n)

	// Ledger failure is fail-soft — notify still attempts.
	svc.notifyProviderOfMatch(context.Background(), domain.MatchedProvider{
		ProviderID: "prov-3",
	}, "job-3", "Wire outlet", "Electrical")

	assert.Equal(t, 1, n.calls)
	assert.Equal(t, "prov-3", n.lastPID)
}
