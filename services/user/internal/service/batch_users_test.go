package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func uuidN(n int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", n)
}

func TestProfile_BatchGetUsers(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		ids          []string
		repoUsers    []domain.PublicUser
		repoErr      error
		wantErr      error
		wantQueried  []string // exact ids the repo should receive, nil = repo not called
		wantReturned int
		reason       string
	}{
		{
			name:         "resolves_all_ids_in_one_call",
			ids:          []string{uuidN(1), uuidN(2), uuidN(3)},
			repoUsers:    []domain.PublicUser{{ID: uuidN(1)}, {ID: uuidN(2)}, {ID: uuidN(3)}},
			wantQueried:  []string{uuidN(1), uuidN(2), uuidN(3)},
			wantReturned: 3,
		},
		{
			name:         "duplicates_collapse_before_the_query",
			ids:          []string{uuidN(1), uuidN(1), uuidN(2), uuidN(1)},
			repoUsers:    []domain.PublicUser{{ID: uuidN(1)}, {ID: uuidN(2)}},
			wantQueried:  []string{uuidN(1), uuidN(2)},
			wantReturned: 2,
			reason:       "a 50-bid page with one repeat bidder must not widen the query",
		},
		{
			name:         "missing_ids_are_omitted_not_fatal",
			ids:          []string{uuidN(1), uuidN(2)},
			repoUsers:    []domain.PublicUser{{ID: uuidN(1)}},
			wantQueried:  []string{uuidN(1), uuidN(2)},
			wantReturned: 1,
			reason:       "hydration paths must fail soft on a deleted user",
		},
		{
			name:         "malformed_ids_dropped_without_failing_the_batch",
			ids:          []string{uuidN(1), "not-a-uuid", "'; DROP TABLE users;--", uuidN(2)},
			repoUsers:    []domain.PublicUser{{ID: uuidN(1)}, {ID: uuidN(2)}},
			wantQueried:  []string{uuidN(1), uuidN(2)},
			wantReturned: 2,
			reason:       "one bad id must not deny the other lookups, and must never reach the ::uuid[] cast",
		},
		{
			name:         "empty_ids_are_skipped",
			ids:          []string{"", uuidN(1), ""},
			repoUsers:    []domain.PublicUser{{ID: uuidN(1)}},
			wantQueried:  []string{uuidN(1)},
			wantReturned: 1,
		},
		{
			name:         "empty_request_short_circuits",
			ids:          nil,
			wantQueried:  nil,
			wantReturned: 0,
			reason:       "no ids means no query at all",
		},
		{
			name:         "all_ids_malformed_short_circuits",
			ids:          []string{"nope", "also-nope"},
			wantQueried:  nil,
			wantReturned: 0,
			reason:       "never issue a query with an empty array",
		},
		{
			name:        "over_the_cap_is_rejected_not_truncated",
			ids:         makeIDs(MaxBatchGetUsers + 1),
			wantErr:     domain.ErrBatchTooLarge,
			wantQueried: nil,
			reason:      "unbounded id lists are a resource-exhaustion vector; a silent truncation would be worse than an error",
		},
		{
			name:         "exactly_at_the_cap_is_allowed",
			ids:          makeIDs(MaxBatchGetUsers),
			repoUsers:    []domain.PublicUser{},
			wantQueried:  makeIDs(MaxBatchGetUsers),
			wantReturned: 0,
		},
		{
			name:        "repo_error_propagates_wrapped",
			ids:         []string{uuidN(1)},
			repoErr:     errors.New("connection refused"),
			wantErr:     nil, // asserted separately: not a sentinel
			wantQueried: []string{uuidN(1)},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var gotQueried []string
			calls := 0
			repo := &mockUserRepo{
				getPublicUsersByIDsFn: func(_ context.Context, ids []string) ([]domain.PublicUser, error) {
					calls++
					gotQueried = ids
					if tt.repoErr != nil {
						return nil, tt.repoErr
					}
					return tt.repoUsers, nil
				},
			}
			profile := NewProfile(repo)

			got, err := profile.BatchGetUsers(context.Background(), tt.ids)

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.ErrorIs(t, err, tt.wantErr, tt.reason)
				assert.Zero(t, calls, "must reject before touching the database")
				return
			}
			if tt.repoErr != nil {
				require.Error(t, err)
				assert.ErrorIs(t, err, tt.repoErr, "repo errors must be wrapped with %%w")
				return
			}

			require.NoError(t, err)
			assert.Len(t, got, tt.wantReturned, tt.reason)

			if tt.wantQueried == nil {
				assert.Zero(t, calls, tt.reason)
				return
			}
			// The whole point: ONE query for N ids, never a loop.
			assert.Equal(t, 1, calls, "batch lookup must issue exactly one repository call")
			assert.True(t, reflect.DeepEqual(tt.wantQueried, gotQueried),
				"expected repo to be queried with %v, got %v", tt.wantQueried, gotQueried)
		})
	}
}

func makeIDs(n int) []string {
	out := make([]string, n)
	for i := 0; i < n; i++ {
		out[i] = uuidN(i)
	}
	return out
}

// TestProfile_BatchGetUsers_SingleQueryForLargeBatch is the performance claim
// stated as a test: the fan-out that used to be N sequential GetUser round
// trips is now exactly one repository call regardless of N.
func TestProfile_BatchGetUsers_SingleQueryForLargeBatch(t *testing.T) {
	t.Parallel()

	const n = 50 // the "job with 50 unique bidders" case from the audit

	calls := 0
	repo := &mockUserRepo{
		getPublicUsersByIDsFn: func(_ context.Context, ids []string) ([]domain.PublicUser, error) {
			calls++
			out := make([]domain.PublicUser, 0, len(ids))
			for _, id := range ids {
				out = append(out, domain.PublicUser{ID: id, DisplayName: "u" + id})
			}
			return out, nil
		},
	}

	got, err := NewProfile(repo).BatchGetUsers(context.Background(), makeIDs(n))
	require.NoError(t, err)
	assert.Len(t, got, n)
	assert.Equal(t, 1, calls, "50 ids must cost 1 query, not 50")
}

// TestPublicUser_CarriesNoPII is a structural guard, not a behavioural one. The
// batch response must not be able to leak more than the single-user endpoint
// does after the gateway's PII strip. Rather than trusting a runtime check
// somebody could delete, we assert the type has nowhere to put PII — so adding
// a leak requires deliberately editing this test too.
func TestPublicUser_CarriesNoPII(t *testing.T) {
	t.Parallel()

	forbidden := []string{"email", "phone", "mfa", "password", "ssn", "secret", "token", "address", "dob"}

	typ := reflect.TypeOf(domain.PublicUser{})
	for i := 0; i < typ.NumField(); i++ {
		name := strings.ToLower(typ.Field(i).Name)
		for _, bad := range forbidden {
			assert.NotContains(t, name, bad,
				"domain.PublicUser gained a PII-shaped field %q; the batch endpoint would then return more than GetUser does for a non-self caller",
				typ.Field(i).Name)
		}
	}

	// And pin the exact allowed field set, so a rename cannot smuggle one past
	// the substring check above.
	var got []string
	for i := 0; i < typ.NumField(); i++ {
		got = append(got, typ.Field(i).Name)
	}
	assert.Equal(t,
		[]string{"ID", "DisplayName", "AvatarURL", "Roles", "Status", "CreatedAt", "LastActiveAt"},
		got,
		"PublicUser field set changed — re-verify it against the gateway PII strip in handler/user.go before updating this list")
}
