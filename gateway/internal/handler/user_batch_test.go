package handler

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// countingUserClient is a fake user service that COUNTS round trips, which is
// the whole point of these tests: the previous implementations were correct but
// issued one gRPC call per unique id. Only a call counter can tell "batched"
// apart from "refactored".
//
// GetUser deliberately fails the test if it is ever hit — a display-name path
// that still reaches the single-user RPC has not been fixed.
type countingUserClient struct {
	userv1.UserServiceClient // embed; any other method panics if hit

	t *testing.T

	mu sync.Mutex
	// batchCalls counts BatchGetUsers invocations.
	batchCalls int
	// getUserCalls counts single-user invocations (must stay 0).
	getUserCalls int
	// batchSizes records the id count of every batch request, in call order.
	batchSizes []int
	// requestedIDs is the union of every id ever asked for.
	requestedIDs []string

	// err, when non-nil, makes every BatchGetUsers call fail.
	err error
	// names maps user id -> display name for ids that "exist". Ids absent here
	// are omitted from the response, mirroring the server's real semantics.
	names map[string]string
	// avatars is optional, for the bid path which also reads avatar_url.
	avatars map[string]string
}

func (c *countingUserClient) BatchGetUsers(_ context.Context, req *userv1.BatchGetUsersRequest, _ ...grpc.CallOption) (*userv1.BatchGetUsersResponse, error) {
	c.mu.Lock()
	c.batchCalls++
	c.batchSizes = append(c.batchSizes, len(req.GetUserIds()))
	c.requestedIDs = append(c.requestedIDs, req.GetUserIds()...)
	err := c.err
	c.mu.Unlock()

	if err != nil {
		return nil, err
	}

	// Mirror the server contract: reject an over-cap list rather than truncate.
	if len(req.GetUserIds()) > userBatchChunkSize {
		return nil, status.Errorf(codes.InvalidArgument, "batch too large: %d > %d",
			len(req.GetUserIds()), userBatchChunkSize)
	}

	out := make([]*userv1.PublicUser, 0, len(req.GetUserIds()))
	for _, id := range req.GetUserIds() {
		name, ok := c.names[id]
		if !ok {
			continue // unknown id: omitted, NOT an error
		}
		out = append(out, &userv1.PublicUser{
			Id:          id,
			DisplayName: name,
			AvatarUrl:   c.avatars[id],
		})
	}
	return &userv1.BatchGetUsersResponse{Users: out}, nil
}

func (c *countingUserClient) GetUser(_ context.Context, _ *userv1.GetUserRequest, _ ...grpc.CallOption) (*userv1.GetUserResponse, error) {
	c.mu.Lock()
	c.getUserCalls++
	c.mu.Unlock()
	c.t.Errorf("GetUser was called — the N+1 display-name fan-out is still present")
	return nil, errors.New("GetUser must not be used for display-name hydration")
}

func (c *countingUserClient) snapshot() (batchCalls, getUserCalls int, sizes []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	sizes = make([]string, 0, len(c.batchSizes))
	for _, n := range c.batchSizes {
		sizes = append(sizes, fmt.Sprintf("%d", n))
	}
	return c.batchCalls, c.getUserCalls, sizes
}

// userIDs builds n distinct ids with a stable prefix.
func userIDs(prefix string, n int) []string {
	ids := make([]string, 0, n)
	for i := range n {
		ids = append(ids, fmt.Sprintf("%s-%04d", prefix, i))
	}
	return ids
}

// namesFor builds the fake directory for a set of ids.
func namesFor(ids []string) map[string]string {
	m := make(map[string]string, len(ids))
	for i, id := range ids {
		m[id] = fmt.Sprintf("User %d", i)
	}
	return m
}

func newCountingUserClient(t *testing.T, ids []string) *countingUserClient {
	t.Helper()
	return &countingUserClient{t: t, names: namesFor(ids)}
}

// ---------------------------------------------------------------------------
// batchGetUsers — the shared primitive
// ---------------------------------------------------------------------------

func TestBatchGetUsers_CallCountIsCeilOverChunkSize(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		uniqueCount int
		wantCalls   int
	}{
		{name: "single id", uniqueCount: 1, wantCalls: 1},
		{name: "fifty bidders was fifty calls", uniqueCount: 50, wantCalls: 1},
		{name: "exactly at the cap", uniqueCount: userBatchChunkSize, wantCalls: 1},
		{name: "one over the cap chunks", uniqueCount: userBatchChunkSize + 1, wantCalls: 2},
		{name: "well over the cap", uniqueCount: 450, wantCalls: 3},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			ids := userIDs("u", tt.uniqueCount)
			client := newCountingUserClient(t, ids)

			got, err := batchGetUsers(context.Background(), client, ids)
			require.NoError(t, err)
			require.Len(t, got, tt.uniqueCount, "every known id must resolve")

			batchCalls, getUserCalls, sizes := client.snapshot()
			assert.Equal(t, tt.wantCalls, batchCalls,
				"want ceil(%d/%d)=%d round trips, got %d (chunk sizes %v)",
				tt.uniqueCount, userBatchChunkSize, tt.wantCalls, batchCalls, sizes)
			assert.Zero(t, getUserCalls, "must not fall back to per-id GetUser")

			// No chunk may exceed the server's cap — the server rejects, not truncates.
			client.mu.Lock()
			for i, n := range client.batchSizes {
				assert.LessOrEqual(t, n, userBatchChunkSize, "chunk %d over the server cap", i)
			}
			client.mu.Unlock()
		})
	}
}

func TestBatchGetUsers_DedupesBeforeCalling(t *testing.T) {
	t.Parallel()

	unique := userIDs("dup", 10)
	// 200 raw ids representing only 10 distinct users, plus empty strings.
	raw := make([]string, 0, 210)
	for range 20 {
		raw = append(raw, unique...)
	}
	raw = append(raw, "", "", "")

	client := newCountingUserClient(t, unique)

	got, err := batchGetUsers(context.Background(), client, raw)
	require.NoError(t, err)
	assert.Len(t, got, 10)

	batchCalls, getUserCalls, _ := client.snapshot()
	assert.Equal(t, 1, batchCalls, "203 raw ids over 10 unique users must be ONE call")
	assert.Zero(t, getUserCalls)

	client.mu.Lock()
	requested := append([]string(nil), client.requestedIDs...)
	client.mu.Unlock()
	assert.Len(t, requested, 10, "the wire request must carry deduped ids, not the raw list")
	assert.ElementsMatch(t, unique, requested)
	assert.NotContains(t, requested, "", "empty ids must never reach the wire")
}

func TestBatchGetUsers_EmptyInputIssuesNoCall(t *testing.T) {
	t.Parallel()

	for _, ids := range [][]string{nil, {}, {"", "", ""}} {
		client := newCountingUserClient(t, nil)
		got, err := batchGetUsers(context.Background(), client, ids)
		require.NoError(t, err)
		assert.Empty(t, got)

		batchCalls, getUserCalls, _ := client.snapshot()
		assert.Zero(t, batchCalls, "an empty id list must not issue a call (ids=%v)", ids)
		assert.Zero(t, getUserCalls)
	}
}

func TestBatchGetUsers_NilClientIssuesNoCall(t *testing.T) {
	t.Parallel()

	got, err := batchGetUsers(context.Background(), nil, userIDs("u", 5))
	require.NoError(t, err)
	assert.Empty(t, got)
}

func TestBatchGetUsers_TolerantOfMissingIDs(t *testing.T) {
	t.Parallel()

	known := userIDs("known", 3)
	client := newCountingUserClient(t, known)

	// Interleave ids the server will omit. Index alignment is impossible here,
	// which is exactly what callers must tolerate.
	asked := []string{known[0], "ghost-1", known[1], "ghost-2", known[2], "ghost-3"}

	got, err := batchGetUsers(context.Background(), client, asked)
	require.NoError(t, err)
	require.Len(t, got, 3)
	for _, id := range known {
		assert.Contains(t, got, id)
	}
	assert.NotContains(t, got, "ghost-1")

	batchCalls, _, _ := client.snapshot()
	assert.Equal(t, 1, batchCalls)
}

func TestBatchGetUsers_ChunkErrorReturnsPartialResult(t *testing.T) {
	t.Parallel()

	ids := userIDs("u", userBatchChunkSize+5)
	client := newCountingUserClient(t, ids)
	client.err = status.Error(codes.Unavailable, "user service down")

	got, err := batchGetUsers(context.Background(), client, ids)
	require.Error(t, err, "a failed chunk must be reported, not swallowed")
	assert.Empty(t, got, "no chunk succeeded, so nothing resolves")

	batchCalls, getUserCalls, _ := client.snapshot()
	assert.Equal(t, 2, batchCalls, "an error must not trigger a per-id retry storm")
	assert.Zero(t, getUserCalls)
}

// ---------------------------------------------------------------------------
// Call sites — call counts and unchanged failure behaviour
// ---------------------------------------------------------------------------

// TestResolveHelpers_CallCounts is the before/after proof for all four
// handlers: N unique ids used to cost N sequential GetUser calls; they now cost
// ceil(N/userBatchChunkSize) batched calls.
func TestResolveHelpers_CallCounts(t *testing.T) {
	t.Parallel()

	// resolvers are keyed by call site; each takes ids and returns id -> name.
	resolvers := map[string]func(client userv1.UserServiceClient) func(context.Context, []string) map[string]string{
		"bid.resolveProviderNames": func(client userv1.UserServiceClient) func(context.Context, []string) map[string]string {
			h := &BidHandler{userClient: client}
			return func(ctx context.Context, ids []string) map[string]string {
				out := make(map[string]string)
				for id, fields := range h.resolveProviderNames(ctx, ids) {
					if n := fields["display_name"]; n != "" {
						out[id] = n
					}
				}
				return out
			}
		},
		"review.resolveReviewerNames": func(client userv1.UserServiceClient) func(context.Context, []string) map[string]string {
			h := &ReviewHandler{userClient: client}
			return func(ctx context.Context, ids []string) map[string]string {
				return h.resolveReviewerNames(ctx, ids...)
			}
		},
		"chat.resolveParticipantNames": func(client userv1.UserServiceClient) func(context.Context, []string) map[string]string {
			h := &ChatHandler{userClient: client}
			return func(ctx context.Context, ids []string) map[string]string {
				return h.resolveParticipantNames(ctx, ids...)
			}
		},
		"contract.resolvePartyNames": func(client userv1.UserServiceClient) func(context.Context, []string) map[string]string {
			h := &ContractHandler{userClient: client}
			return func(ctx context.Context, ids []string) map[string]string {
				return h.resolvePartyNames(ctx, ids...)
			}
		},
	}

	cases := []struct {
		name      string
		unique    int
		repeats   int // how many times the unique set is repeated in the raw list
		wantCalls int
	}{
		{name: "50 unique bidders", unique: 50, repeats: 1, wantCalls: 1},
		{name: "50 unique across 200 rows (dedup)", unique: 50, repeats: 4, wantCalls: 1},
		{name: "over the batch limit (chunking)", unique: 250, repeats: 1, wantCalls: 2},
	}

	for site, build := range resolvers {
		for _, tc := range cases {
			t.Run(site+"/"+tc.name, func(t *testing.T) {
				t.Parallel()

				ids := userIDs("p", tc.unique)
				raw := make([]string, 0, tc.unique*tc.repeats)
				for range tc.repeats {
					raw = append(raw, ids...)
				}

				client := newCountingUserClient(t, ids)
				resolve := build(client)

				names := resolve(context.Background(), raw)
				require.Len(t, names, tc.unique, "every bidder must still get a name")

				batchCalls, getUserCalls, sizes := client.snapshot()
				assert.Equal(t, tc.wantCalls, batchCalls,
					"%s: %d raw ids / %d unique -> want %d calls, got %d (sizes %v); before the fix this was %d",
					site, len(raw), tc.unique, tc.wantCalls, batchCalls, sizes, tc.unique)
				assert.Zero(t, getUserCalls, "%s must not use per-id GetUser", site)

				client.mu.Lock()
				for _, n := range client.batchSizes {
					assert.LessOrEqual(t, n, userBatchChunkSize)
				}
				client.mu.Unlock()
			})
		}
	}
}

// TestResolveHelpers_FailureDegradesSoftly pins the pre-existing failure
// contract: a user-service failure omits the name, it never fails the request
// and never panics. The map shape (nil vs empty) must also be what it was.
func TestResolveHelpers_FailureDegradesSoftly(t *testing.T) {
	t.Parallel()

	ids := userIDs("p", 12)
	newFailing := func(t *testing.T) *countingUserClient {
		t.Helper()
		c := newCountingUserClient(t, ids)
		c.err = status.Error(codes.Unavailable, "user service down")
		return c
	}

	t.Run("bid: empty non-nil map, blank names", func(t *testing.T) {
		t.Parallel()
		client := newFailing(t)
		h := &BidHandler{userClient: client}

		got := h.resolveProviderNames(context.Background(), ids)
		assert.NotNil(t, got, "bid returned a non-nil map before; a nil map would change the caller")
		assert.Empty(t, got, "a failed lookup omits the provider entirely")

		batchCalls, getUserCalls, _ := client.snapshot()
		assert.Equal(t, 1, batchCalls)
		assert.Zero(t, getUserCalls)
	})

	t.Run("review: non-nil empty map", func(t *testing.T) {
		t.Parallel()
		h := &ReviewHandler{userClient: newFailing(t)}
		got := h.resolveReviewerNames(context.Background(), ids...)
		assert.NotNil(t, got)
		assert.Empty(t, got)
	})

	t.Run("chat: non-nil empty map", func(t *testing.T) {
		t.Parallel()
		h := &ChatHandler{userClient: newFailing(t)}
		got := h.resolveParticipantNames(context.Background(), ids...)
		assert.NotNil(t, got)
		assert.Empty(t, got)
	})

	t.Run("contract: non-nil empty map", func(t *testing.T) {
		t.Parallel()
		h := &ContractHandler{userClient: newFailing(t)}
		got := h.resolvePartyNames(context.Background(), ids...)
		assert.NotNil(t, got)
		assert.Empty(t, got)
	})
}

// TestResolveHelpers_NilClientAndEmptyIDs pins the other two degradation paths
// that predate this change: a nil user client and an empty id list.
func TestResolveHelpers_NilClientAndEmptyIDs(t *testing.T) {
	t.Parallel()

	t.Run("nil client", func(t *testing.T) {
		t.Parallel()
		assert.NotNil(t, (&BidHandler{}).resolveProviderNames(context.Background(), userIDs("p", 3)))
		assert.Empty(t, (&BidHandler{}).resolveProviderNames(context.Background(), userIDs("p", 3)))
		assert.Nil(t, (&ReviewHandler{}).resolveReviewerNames(context.Background(), "a"))
		assert.Nil(t, (&ChatHandler{}).resolveParticipantNames(context.Background(), "a"))
		assert.Nil(t, (&ContractHandler{}).resolvePartyNames(context.Background(), "a"))
	})

	t.Run("empty ids issue no call", func(t *testing.T) {
		t.Parallel()

		bidClient := newCountingUserClient(t, nil)
		assert.Empty(t, (&BidHandler{userClient: bidClient}).resolveProviderNames(context.Background(), nil))

		reviewClient := newCountingUserClient(t, nil)
		assert.Nil(t, (&ReviewHandler{userClient: reviewClient}).resolveReviewerNames(context.Background(), "", ""))

		chatClient := newCountingUserClient(t, nil)
		assert.Nil(t, (&ChatHandler{userClient: chatClient}).resolveParticipantNames(context.Background()))

		contractClient := newCountingUserClient(t, nil)
		assert.Nil(t, (&ContractHandler{userClient: contractClient}).resolvePartyNames(context.Background(), ""))

		for name, c := range map[string]*countingUserClient{
			"bid": bidClient, "review": reviewClient, "chat": chatClient, "contract": contractClient,
		} {
			batchCalls, getUserCalls, _ := c.snapshot()
			assert.Zero(t, batchCalls, "%s: empty id list must not issue a call", name)
			assert.Zero(t, getUserCalls, "%s", name)
		}
	})
}

// TestResolveProviderNames_PreservesAvatarProjection guards the one call site
// that reads more than display_name, so the JSON shape the web BidCard consumes
// is unchanged.
func TestResolveProviderNames_PreservesAvatarProjection(t *testing.T) {
	t.Parallel()

	ids := userIDs("p", 2)
	client := newCountingUserClient(t, ids)
	client.avatars = map[string]string{ids[0]: "https://cdn.example/a.png"}

	h := &BidHandler{userClient: client}
	got := h.resolveProviderNames(context.Background(), ids)

	require.Len(t, got, 2)
	assert.Equal(t, "User 0", got[ids[0]]["display_name"])
	assert.Equal(t, "https://cdn.example/a.png", got[ids[0]]["avatar_url"])
	assert.Equal(t, "User 1", got[ids[1]]["display_name"])
	assert.Equal(t, "", got[ids[1]]["avatar_url"], "a user with no avatar still gets the key, as before")
}
