package service

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Refresh-token reuse detection ---
//
// These tests exist to pin BOTH halves of the trade-off:
//   * a replayed (already-rotated) token must kill the whole session lineage,
//   * a client that merely raced itself must NOT lose its session.
//
// Getting only the first half right is a denial-of-service on real users;
// getting only the second right is what the code did before, which is to say
// no detection at all.

// fakeTokenStore faithfully emulates the refresh_tokens SQL semantics in
// memory: `UPDATE ... WHERE token_hash = $1 AND revoked_at IS NULL` is a
// single-winner compare-and-swap, family revocation only touches rows that are
// still active, and rotated_at is stamped by rotation ONLY (never by logout /
// password change / family revoke). Emulating the real statements rather than
// stubbing booleans is what makes the concurrency test meaningful.
type fakeTokenStore struct {
	mockUserRepo

	mu     sync.Mutex
	tokens map[string]*domain.RefreshToken // by token hash

	familyRevokeCalls []string
	familyRevokedRows int64
}

func newFakeTokenStore() *fakeTokenStore {
	s := &fakeTokenStore{tokens: make(map[string]*domain.RefreshToken)}
	s.mockUserRepo = mockUserRepo{
		getUserByIDFn: func(_ context.Context, id string) (*domain.User, error) {
			return &domain.User{ID: id, Email: "victim@example.com", Roles: []string{"customer"}}, nil
		},
	}
	return s
}

// seed inserts an active session root and returns its raw token.
func (s *fakeTokenStore) seed(rawToken, userID, familyID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tokens[HashToken(rawToken)] = &domain.RefreshToken{
		ID:        "tok-" + rawToken,
		UserID:    userID,
		TokenHash: HashToken(rawToken),
		FamilyID:  familyID,
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
		CreatedAt: time.Now(),
	}
}

func (s *fakeTokenStore) get(rawToken string) *domain.RefreshToken {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.tokens[HashToken(rawToken)]
}

// backdateRotation pushes a token's rotated_at into the past so a replay lands
// outside the grace window without the test having to sleep.
func (s *fakeTokenStore) backdateRotation(rawToken string, age time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t := s.tokens[HashToken(rawToken)]
	past := time.Now().Add(-age)
	t.RotatedAt = &past
}

func (s *fakeTokenStore) GetRefreshToken(_ context.Context, tokenHash string) (*domain.RefreshToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tokens[tokenHash]
	if !ok {
		return nil, domain.ErrTokenExpired
	}
	clone := *t // return a copy: the service must not see later mutations
	return &clone, nil
}

func (s *fakeTokenStore) RotateRefreshTokenIfActive(_ context.Context, tokenHash string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tokens[tokenHash]
	if !ok || t.RevokedAt != nil {
		return false, nil // zero rows matched
	}
	now := time.Now()
	t.RevokedAt = &now
	t.RotatedAt = &now
	return true, nil
}

func (s *fakeTokenStore) RevokeRefreshTokenFamily(_ context.Context, familyID string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.familyRevokeCalls = append(s.familyRevokeCalls, familyID)
	var n int64
	for _, t := range s.tokens {
		if t.FamilyID == familyID && t.RevokedAt == nil {
			now := time.Now()
			t.RevokedAt = &now // note: rotated_at deliberately untouched
			n++
		}
	}
	s.familyRevokedRows += n
	return n, nil
}

func (s *fakeTokenStore) CreateRefreshToken(_ context.Context, token *domain.RefreshToken) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if token.FamilyID == "" {
		token.FamilyID = "family-" + token.TokenHash[:8] // emulates the DB default
	}
	token.ID = "tok-" + token.TokenHash[:8]
	token.CreatedAt = time.Now()
	stored := *token
	s.tokens[token.TokenHash] = &stored
	return nil
}

func (s *fakeTokenStore) familyRevocations() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, len(s.familyRevokeCalls))
	copy(out, s.familyRevokeCalls)
	return out
}

// TestAuth_RefreshToken_ReplayRevokesFamily is the theft scenario end to end.
//
// An attacker steals the victim's refresh token and spends it first. The
// attacker now holds a live descendant and the victim's next refresh is a
// replay of a token rotated minutes ago. That replay must destroy the whole
// lineage — crucially INCLUDING the attacker's freshly minted token, which is
// the entire point: rejecting the victim alone leaves the thief with a rolling
// session.
func TestAuth_RefreshToken_ReplayRevokesFamily(t *testing.T) {
	t.Parallel()

	store := newFakeTokenStore()
	store.seed("victim-raw-token", "user-1", "family-1")
	auth := newTestAuth(t, &store.mockUserRepo)
	auth.repo = store

	// 1. The attacker refreshes first with the stolen token and gets a new pair.
	attackerPair, err := auth.RefreshToken(context.Background(), "victim-raw-token")
	require.NoError(t, err)
	require.NotEmpty(t, attackerPair.RefreshToken)

	attackerToken := store.get(attackerPair.RefreshToken)
	require.NotNil(t, attackerToken)
	require.Equal(t, "family-1", attackerToken.FamilyID, "successor must inherit the lineage")
	require.Nil(t, attackerToken.RevokedAt, "attacker token is live at this point")

	// 2. Time passes; the victim's client refreshes with the token it still holds.
	store.backdateRotation("victim-raw-token", 10*time.Minute)

	_, err = auth.RefreshToken(context.Background(), "victim-raw-token")
	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrRefreshTokenReuse, "replay outside grace must be classified as reuse")

	// 3. The family — including the attacker's live token — is dead.
	assert.Equal(t, []string{"family-1"}, store.familyRevocations())
	assert.NotNil(t, store.get(attackerPair.RefreshToken).RevokedAt,
		"the thief's live descendant must be revoked, not just the replayed token")

	// 4. And the attacker's token is now unusable.
	_, err = auth.RefreshToken(context.Background(), attackerPair.RefreshToken)
	require.Error(t, err, "revoked descendant must not refresh")
}

// TestAuth_RefreshToken_ConcurrentRefreshDoesNotRevokeFamily is the
// false-positive guard, and the reason the grace window exists.
//
// N goroutines refresh the SAME token at once — a real pattern when several
// queued API calls all 401 together. Exactly one wins the atomic gate; the
// losers are replaying a token rotated microseconds ago. They must be rejected
// (single-use is preserved) WITHOUT the family being touched, or an ordinary
// client race would log the user out of every device.
func TestAuth_RefreshToken_ConcurrentRefreshDoesNotRevokeFamily(t *testing.T) {
	t.Parallel()

	const n = 16

	store := newFakeTokenStore()
	store.seed("shared-raw-token", "user-1", "family-1")
	auth := newTestAuth(t, &store.mockUserRepo)
	auth.repo = store

	var successes, rejected, reuseFlagged int32
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			_, err := auth.RefreshToken(context.Background(), "shared-raw-token")
			switch {
			case err == nil:
				atomic.AddInt32(&successes, 1)
			case errors.Is(err, domain.ErrRefreshTokenReuse):
				atomic.AddInt32(&reuseFlagged, 1)
			default:
				atomic.AddInt32(&rejected, 1)
			}
		}()
	}
	wg.Wait()

	assert.Equal(t, int32(1), successes, "single-use rotation must still have exactly one winner")
	assert.Equal(t, int32(n-1), rejected, "losers are rejected as plain revoked")
	assert.Zero(t, reuseFlagged, "a benign client race must never be classified as reuse")
	assert.Empty(t, store.familyRevocations(), "a benign client race must not revoke the token family")
}

// TestAuth_RefreshToken_RejectionClassification covers the branches of
// classifyRefreshRejection that decide whether a family lives or dies.
func TestAuth_RefreshToken_RejectionClassification(t *testing.T) {
	t.Parallel()

	recentRotation := time.Now().Add(-500 * time.Millisecond)
	staleRotation := time.Now().Add(-10 * time.Minute)
	revokedAt := time.Now().Add(-time.Hour)

	tests := []struct {
		name string
		// current is what the post-gate re-read observes.
		current        *domain.RefreshToken
		rereadErr      error
		wantErr        error
		wantFamilyDead bool
		reason         string
	}{
		{
			name: "rotated_long_ago_is_reuse_and_kills_family",
			current: &domain.RefreshToken{
				ID: "rt-1", UserID: "u1", FamilyID: "fam-1",
				ExpiresAt: time.Now().Add(time.Hour),
				RevokedAt: &staleRotation, RotatedAt: &staleRotation,
			},
			wantErr:        domain.ErrRefreshTokenReuse,
			wantFamilyDead: true,
			reason:         "nobody honest still holds a token spent ten minutes ago",
		},
		{
			name: "rotated_just_now_is_a_benign_race",
			current: &domain.RefreshToken{
				ID: "rt-2", UserID: "u2", FamilyID: "fam-2",
				ExpiresAt: time.Now().Add(time.Hour),
				RevokedAt: &recentRotation, RotatedAt: &recentRotation,
			},
			wantErr:        domain.ErrTokenRevoked,
			wantFamilyDead: false,
			reason:         "inside the grace window this is a client racing itself",
		},
		{
			name: "revoked_but_never_rotated_is_not_theft",
			current: &domain.RefreshToken{
				ID: "rt-3", UserID: "u3", FamilyID: "fam-3",
				ExpiresAt: time.Now().Add(time.Hour),
				RevokedAt: &revokedAt, RotatedAt: nil,
			},
			wantErr:        domain.ErrTokenRevoked,
			wantFamilyDead: false,
			reason:         "logout / password change / admin revoke set revoked_at but never rotated_at",
		},
		{
			name: "reread_failure_does_not_destroy_sessions",
			current: &domain.RefreshToken{
				ID: "rt-4", UserID: "u4", FamilyID: "fam-4",
				ExpiresAt: time.Now().Add(time.Hour),
			},
			rereadErr:      errors.New("connection reset"),
			wantErr:        domain.ErrTokenRevoked,
			wantFamilyDead: false,
			reason:         "a DB blip must not be allowed to log the fleet out",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var familyRevoked []string
			// firstRead serves the pre-gate read; every later read is the
			// post-gate re-read and may fail per the test case.
			var reads int32
			repo := &mockUserRepo{
				getRefreshTokenFn: func(_ context.Context, _ string) (*domain.RefreshToken, error) {
					if atomic.AddInt32(&reads, 1) > 1 && tt.rereadErr != nil {
						return nil, tt.rereadErr
					}
					clone := *tt.current
					return &clone, nil
				},
				// The gate always loses here: we are testing the rejection path.
				rotateRefreshTokenIfActiveFn: func(_ context.Context, _ string) (bool, error) {
					return false, nil
				},
				revokeRefreshTokenFamilyFn: func(_ context.Context, familyID string) (int64, error) {
					familyRevoked = append(familyRevoked, familyID)
					return 2, nil
				},
			}
			auth := newTestAuth(t, repo)

			_, err := auth.RefreshToken(context.Background(), "raw-token")

			require.Error(t, err)
			assert.ErrorIs(t, err, tt.wantErr, tt.reason)

			if tt.wantFamilyDead {
				assert.Equal(t, []string{tt.current.FamilyID}, familyRevoked, tt.reason)
			} else {
				assert.Empty(t, familyRevoked, tt.reason)
			}
		})
	}
}

// TestAuth_RefreshToken_GraceWindowBoundary pins that the window is what
// separates the two verdicts — the same replay flips classification purely on
// elapsed time since rotation.
func TestAuth_RefreshToken_GraceWindowBoundary(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		graceWindow time.Duration
		rotatedAgo  time.Duration
		wantErr     error
	}{
		{"inside_window_is_forgiven", 30 * time.Second, time.Second, domain.ErrTokenRevoked},
		{"outside_window_is_reuse", 30 * time.Second, 31 * time.Second, domain.ErrRefreshTokenReuse},
		{"zero_window_prosecutes_everything", 0, time.Millisecond, domain.ErrRefreshTokenReuse},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rotatedAt := time.Now().Add(-tt.rotatedAgo)
			repo := &mockUserRepo{
				getRefreshTokenFn: func(_ context.Context, _ string) (*domain.RefreshToken, error) {
					return &domain.RefreshToken{
						ID: "rt", UserID: "u", FamilyID: "fam",
						ExpiresAt: time.Now().Add(time.Hour),
						RevokedAt: &rotatedAt, RotatedAt: &rotatedAt,
					}, nil
				},
				rotateRefreshTokenIfActiveFn: func(_ context.Context, _ string) (bool, error) {
					return false, nil
				},
				revokeRefreshTokenFamilyFn: func(_ context.Context, _ string) (int64, error) {
					return 1, nil
				},
			}
			auth := newTestAuth(t, repo)
			auth.reuseGraceWindow = tt.graceWindow

			_, err := auth.RefreshToken(context.Background(), "raw-token")
			require.Error(t, err)
			assert.ErrorIs(t, err, tt.wantErr)
		})
	}
}

// TestAuth_ReuseMetricsAreEmitted proves the security signal is actually
// observable. A detector whose output nobody can alert on is not a control, so
// the counters are part of the contract, not decoration.
//
// Deliberately NOT parallel: the counters are process-global, so this test
// measures deltas while no sibling test is mutating them.
func TestAuth_ReuseMetricsAreEmitted(t *testing.T) {
	staleRotation := time.Now().Add(-10 * time.Minute)
	recentRotation := time.Now().Add(-time.Millisecond)

	newAuthFor := func(rotatedAt *time.Time, familyRows int64) *Auth {
		repo := &mockUserRepo{
			getRefreshTokenFn: func(_ context.Context, _ string) (*domain.RefreshToken, error) {
				return &domain.RefreshToken{
					ID: "rt", UserID: "u", FamilyID: "fam",
					ExpiresAt: time.Now().Add(time.Hour),
					RevokedAt: rotatedAt, RotatedAt: rotatedAt,
				}, nil
			},
			rotateRefreshTokenIfActiveFn: func(_ context.Context, _ string) (bool, error) {
				return false, nil
			},
			revokeRefreshTokenFamilyFn: func(_ context.Context, _ string) (int64, error) {
				return familyRows, nil
			},
		}
		return newTestAuth(t, repo)
	}

	// --- confirmed reuse ---
	beforeReuse := testutil.ToFloat64(refreshTokenReuseTotal)
	beforeFamilies := testutil.ToFloat64(refreshTokenFamilyRevokedTotal)
	beforeSessions := testutil.ToFloat64(refreshTokenFamilySessionsRevokedTotal)

	_, err := newAuthFor(&staleRotation, 3).RefreshToken(context.Background(), "raw")
	require.ErrorIs(t, err, domain.ErrRefreshTokenReuse)

	assert.Equal(t, beforeReuse+1, testutil.ToFloat64(refreshTokenReuseTotal),
		"a detection must increment the reuse counter — this is what ops alerts on")
	assert.Equal(t, beforeFamilies+1, testutil.ToFloat64(refreshTokenFamilyRevokedTotal))
	assert.Equal(t, beforeSessions+3, testutil.ToFloat64(refreshTokenFamilySessionsRevokedTotal),
		"blast radius must be recorded as the number of sessions actually killed")

	// --- benign race: the control group ---
	beforeGrace := testutil.ToFloat64(refreshTokenReplayGraceTotal)
	reuseBeforeGraceCase := testutil.ToFloat64(refreshTokenReuseTotal)

	_, err = newAuthFor(&recentRotation, 0).RefreshToken(context.Background(), "raw")
	require.ErrorIs(t, err, domain.ErrTokenRevoked)

	assert.Equal(t, beforeGrace+1, testutil.ToFloat64(refreshTokenReplayGraceTotal),
		"benign races get their own counter so a mistuned window is diagnosable")
	assert.Equal(t, reuseBeforeGraceCase, testutil.ToFloat64(refreshTokenReuseTotal),
		"a benign race must NOT pollute the theft signal")

	// --- revoked-but-never-rotated: also not a theft signal ---
	beforeRevokedReplay := testutil.ToFloat64(refreshTokenRevokedReplayTotal)
	reuseBeforeRevokedCase := testutil.ToFloat64(refreshTokenReuseTotal)

	_, err = newAuthFor(nil, 0).RefreshToken(context.Background(), "raw")
	require.ErrorIs(t, err, domain.ErrTokenRevoked)

	assert.Equal(t, beforeRevokedReplay+1, testutil.ToFloat64(refreshTokenRevokedReplayTotal))
	assert.Equal(t, reuseBeforeRevokedCase, testutil.ToFloat64(refreshTokenReuseTotal),
		"logout/password-change replays must not look like theft")
}

// TestAuth_DefaultGraceWindow guards the shipped default against an accidental
// edit to something absurd in either direction.
func TestAuth_DefaultGraceWindow(t *testing.T) {
	t.Parallel()

	auth := newTestAuth(t, &mockUserRepo{})
	assert.Equal(t, defaultReuseGraceWindow, auth.reuseGraceWindow)
	assert.Greater(t, auth.reuseGraceWindow, time.Second,
		"too small and ordinary client races become false theft reports")
	assert.Less(t, auth.reuseGraceWindow, 5*time.Minute,
		"too large and a thief gets a free window to rotate undetected")
}
