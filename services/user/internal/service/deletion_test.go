package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeDeletionRepo is a focused in-memory fake that just supports the
// deletion-lifecycle methods. It composes mockUserRepo for the rest of the
// UserRepository surface.
type fakeDeletionRepo struct {
	mockUserRepo
	mu                sync.Mutex
	requested         map[string]time.Time
	finalized         map[string]time.Time
	reason            map[string]string
	stripeCustomerID  map[string]string
	stripeAccountID   map[string]string
	finalizeImpl      func(ctx context.Context, userID string) (domain.ErasureCounts, error)
	finalizeCallCount map[string]int
}

func newFakeDeletionRepo() *fakeDeletionRepo {
	return &fakeDeletionRepo{
		requested:         make(map[string]time.Time),
		finalized:         make(map[string]time.Time),
		reason:            make(map[string]string),
		stripeCustomerID:  make(map[string]string),
		stripeAccountID:   make(map[string]string),
		finalizeCallCount: make(map[string]int),
	}
}

func (r *fakeDeletionRepo) MarkDeletionRequested(_ context.Context, userID, reason string, requestedAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.finalized[userID]; ok {
		return domain.ErrDeletionAlreadyFinalized
	}
	if _, ok := r.requested[userID]; ok {
		return domain.ErrDeletionAlreadyRequested
	}
	r.requested[userID] = requestedAt
	r.reason[userID] = reason
	return nil
}

func (r *fakeDeletionRepo) ClearDeletionRequest(_ context.Context, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.finalized[userID]; ok {
		return domain.ErrDeletionAlreadyFinalized
	}
	if _, ok := r.requested[userID]; !ok {
		return domain.ErrDeletionNotRequested
	}
	delete(r.requested, userID)
	delete(r.reason, userID)
	return nil
}

func (r *fakeDeletionRepo) GetUserDeletionState(_ context.Context, userID string) (*time.Time, *time.Time, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var requested, finalized *time.Time
	if t, ok := r.requested[userID]; ok {
		t := t
		requested = &t
	}
	if t, ok := r.finalized[userID]; ok {
		t := t
		finalized = &t
	}
	return requested, finalized, nil
}

func (r *fakeDeletionRepo) ListPendingFinalizations(_ context.Context, olderThan time.Time, limit int) ([]domain.PendingDeletion, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.PendingDeletion
	for userID, t := range r.requested {
		if _, done := r.finalized[userID]; done {
			continue
		}
		if !t.Before(olderThan) {
			continue
		}
		out = append(out, domain.PendingDeletion{
			UserID:              userID,
			StripeCustomerID:    r.stripeCustomerID[userID],
			StripeAccountID:     r.stripeAccountID[userID],
			DeletionRequestedAt: t,
		})
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (r *fakeDeletionRepo) FinalizeAccountDeletion(ctx context.Context, userID string) (domain.ErasureCounts, error) {
	r.mu.Lock()
	r.finalizeCallCount[userID]++
	count := r.finalizeCallCount[userID]
	r.mu.Unlock()

	if r.finalizeImpl != nil {
		return r.finalizeImpl(ctx, userID)
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.finalized[userID]; ok {
		return nil, domain.ErrDeletionAlreadyFinalized
	}
	if _, ok := r.requested[userID]; !ok {
		return nil, domain.ErrDeletionNotRequested
	}
	r.finalized[userID] = time.Now()
	delete(r.requested, userID)
	return domain.ErasureCounts{"users": 1, "_call": int64(count)}, nil
}

// recordingStripe captures every call so tests can assert on outcomes.
type recordingStripe struct {
	customerCalls  []string
	accountCalls   []string
	customerResult string
	accountResult  string
	customerErr    error
	accountErr     error
}

func (r *recordingStripe) DeleteCustomer(_ context.Context, id string) (string, error) {
	r.customerCalls = append(r.customerCalls, id)
	if r.customerErr != nil {
		return "", r.customerErr
	}
	if r.customerResult == "" {
		return "deleted", nil
	}
	return r.customerResult, nil
}

func (r *recordingStripe) DeleteConnectAccount(_ context.Context, id string) (string, error) {
	r.accountCalls = append(r.accountCalls, id)
	if r.accountErr != nil {
		return "", r.accountErr
	}
	if r.accountResult == "" {
		return "deleted", nil
	}
	return r.accountResult, nil
}

type fakeS3 struct {
	prefix string
	count  int
	err    error
}

func (f *fakeS3) DeletePrefix(_ context.Context, prefix string) (int, error) {
	f.prefix = prefix
	if f.err != nil {
		return 0, f.err
	}
	return f.count, nil
}

// --- RequestAccountDeletion ---

func TestErasure_Request_HappyPath(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	now := time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC)
	e := NewErasure(repo, nil, nil, nil).withClock(func() time.Time { return now })

	deadline, created, err := e.RequestAccountDeletion(ctx, "user-1", "no longer using", "DELETE")
	require.NoError(t, err)
	assert.True(t, created)
	assert.Equal(t, now.Add(domain.DeletionGracePeriod), deadline)
	assert.Equal(t, "no longer using", repo.reason["user-1"])
}

func TestErasure_Request_ConfirmationRequired(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	e := NewErasure(repo, nil, nil, nil)

	tests := []struct {
		confirmation string
		wantErr      bool
	}{
		{"", true},
		{"delete", false}, // case-insensitive match passes
		{"DELETE", false},
		{"yes", true},
	}
	for _, tt := range tests {
		_, _, err := e.RequestAccountDeletion(ctx, "u-"+tt.confirmation, "", tt.confirmation)
		if tt.wantErr {
			assert.ErrorIs(t, err, domain.ErrDeletionConfirmation, "confirmation=%q", tt.confirmation)
		} else {
			require.NoError(t, err, "confirmation=%q", tt.confirmation)
		}
	}
}

func TestErasure_Request_Idempotent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	now := time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC)
	e := NewErasure(repo, nil, nil, nil).withClock(func() time.Time { return now })

	deadline1, created1, err := e.RequestAccountDeletion(ctx, "user-1", "first reason", "DELETE")
	require.NoError(t, err)
	assert.True(t, created1)

	// Second call: should not error, should return same deadline, created=false.
	deadline2, created2, err := e.RequestAccountDeletion(ctx, "user-1", "different reason", "DELETE")
	require.NoError(t, err)
	assert.False(t, created2)
	assert.Equal(t, deadline1, deadline2)
	// Original reason preserved (we don't overwrite).
	assert.Equal(t, "first reason", repo.reason["user-1"])
}

// --- CancelAccountDeletion ---

func TestErasure_Cancel_WithinGrace(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	now := time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC)
	e := NewErasure(repo, nil, nil, nil).withClock(func() time.Time { return now })

	_, _, err := e.RequestAccountDeletion(ctx, "user-1", "", "DELETE")
	require.NoError(t, err)

	cancelled, err := e.CancelAccountDeletion(ctx, "user-1")
	require.NoError(t, err)
	assert.True(t, cancelled)
	assert.Empty(t, repo.requested)
}

func TestErasure_Cancel_NoRequest(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	e := NewErasure(repo, nil, nil, nil)

	cancelled, err := e.CancelAccountDeletion(ctx, "user-1")
	require.NoError(t, err)
	assert.False(t, cancelled, "no-op when nothing pending")
}

// --- FinalizeAccountDeletion ---

func TestErasure_Finalize_GracePeriodGuard(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	now := time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC)
	e := NewErasure(repo, nil, nil, nil).withClock(func() time.Time { return now })

	_, _, err := e.RequestAccountDeletion(ctx, "user-1", "", "DELETE")
	require.NoError(t, err)

	// Same instant — way before grace deadline.
	_, err = e.FinalizeAccountDeletion(ctx, "user-1", false)
	assert.ErrorIs(t, err, domain.ErrDeletionGracePeriodActive)

	// Force=true bypasses the guard.
	out, err := e.FinalizeAccountDeletion(ctx, "user-1", true)
	require.NoError(t, err)
	assert.NotNil(t, out)
	assert.Equal(t, "user-1", out.UserID)
}

func TestErasure_Finalize_AfterGracePeriod(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	requestedAt := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	now := requestedAt.Add(domain.DeletionGracePeriod + time.Hour)
	e := NewErasure(repo, nil, nil, nil).withClock(func() time.Time { return now })

	// Backdate the request so the grace window has elapsed.
	repo.requested["user-1"] = requestedAt

	out, err := e.FinalizeAccountDeletion(ctx, "user-1", false)
	require.NoError(t, err)
	assert.Equal(t, int64(1), out.Counts["users"])
}

func TestErasure_Finalize_Idempotent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	now := time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC)
	e := NewErasure(repo, nil, nil, nil).withClock(func() time.Time { return now })

	repo.requested["user-1"] = now.Add(-domain.DeletionGracePeriod - time.Hour)

	_, err := e.FinalizeAccountDeletion(ctx, "user-1", false)
	require.NoError(t, err)

	// Second call must not invoke FinalizeAccountDeletion again.
	_, err = e.FinalizeAccountDeletion(ctx, "user-1", false)
	assert.ErrorIs(t, err, domain.ErrDeletionAlreadyFinalized)
	assert.Equal(t, 1, repo.finalizeCallCount["user-1"], "cascade must run exactly once")
}

func TestErasure_Finalize_StripeOutcomes(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	repo.stripeCustomerID["user-1"] = "cus_abc"
	repo.stripeAccountID["user-1"] = "acct_xyz"
	repo.requested["user-1"] = time.Now().Add(-domain.DeletionGracePeriod - time.Hour)

	stripe := &recordingStripe{
		customerResult: "deleted",
		accountResult:  "skipped_balance", // open balance simulated
	}
	store := &fakeS3{count: 7}
	e := NewErasure(repo, stripe, store, nil)

	out, err := e.FinalizeAccountDeletion(ctx, "user-1", false)
	require.NoError(t, err)
	assert.Equal(t, []string{"cus_abc"}, stripe.customerCalls)
	assert.Equal(t, []string{"acct_xyz"}, stripe.accountCalls)
	assert.Equal(t, "deleted", out.StripeCustomerOutcome)
	assert.Equal(t, "skipped_balance", out.StripeAccountOutcome)
	assert.Equal(t, "users/user-1/", store.prefix)
	assert.Equal(t, int64(7), out.Counts["s3_objects"])
}

func TestErasure_Finalize_StripeErrorDoesNotRollBack(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	repo.stripeCustomerID["user-1"] = "cus_abc"
	repo.requested["user-1"] = time.Now().Add(-domain.DeletionGracePeriod - time.Hour)

	stripe := &recordingStripe{customerErr: errors.New("stripe down")}
	e := NewErasure(repo, stripe, nil, nil)

	out, err := e.FinalizeAccountDeletion(ctx, "user-1", false)
	require.NoError(t, err, "stripe failure must not roll back the cascade")
	assert.Contains(t, out.StripeCustomerOutcome, "error: stripe down")
	// The DB cascade still committed.
	assert.NotEmpty(t, repo.finalized["user-1"])
}

// --- ProcessPendingFinalizations (cron) ---

func TestErasure_Cron_OnlyProcessesExpired(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	now := time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC)
	e := NewErasure(repo, nil, nil, nil).withClock(func() time.Time { return now })

	// user-old: requested 31 days ago — should be processed.
	repo.requested["user-old"] = now.Add(-31 * 24 * time.Hour)
	// user-fresh: requested yesterday — should NOT be processed.
	repo.requested["user-fresh"] = now.Add(-24 * time.Hour)

	processed, failed, err := e.ProcessPendingFinalizations(ctx, 100)
	require.NoError(t, err)
	assert.Equal(t, 1, processed)
	assert.Equal(t, 0, failed)
	assert.Contains(t, repo.finalized, "user-old")
	assert.NotContains(t, repo.finalized, "user-fresh")
}

func TestErasure_Cron_ContinuesPastFailures(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeDeletionRepo()
	now := time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC)
	e := NewErasure(repo, nil, nil, nil).withClock(func() time.Time { return now })

	repo.requested["user-bad"] = now.Add(-31 * 24 * time.Hour)
	repo.requested["user-good"] = now.Add(-31 * 24 * time.Hour)

	repo.finalizeImpl = func(_ context.Context, userID string) (domain.ErasureCounts, error) {
		if userID == "user-bad" {
			return nil, errors.New("simulated cascade failure")
		}
		repo.mu.Lock()
		repo.finalized[userID] = time.Now()
		delete(repo.requested, userID)
		repo.mu.Unlock()
		return domain.ErasureCounts{"users": 1}, nil
	}

	processed, failed, err := e.ProcessPendingFinalizations(ctx, 100)
	require.NoError(t, err)
	assert.Equal(t, 1, processed)
	assert.Equal(t, 1, failed)
}
