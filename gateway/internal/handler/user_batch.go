package handler

import (
	"context"
	"errors"
	"fmt"
	"sync"

	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
)

// userBatchChunkSize mirrors services/user/internal/service.MaxBatchGetUsers.
//
// The user service rejects a BatchGetUsers request longer than this with
// InvalidArgument rather than truncating it (a silently partial answer is worse
// than an error, because the caller cannot tell it happened). The gateway must
// therefore chunk to stay under the cap instead of shipping an unbounded id
// list. Keep this value in lockstep with the server constant; lowering it here
// is always safe, raising it above the server's cap is not.
const userBatchChunkSize = 200

// userBatchMaxConcurrent bounds how many chunk lookups are in flight at once,
// matching the bounded fan-out already used for trust scores in bid.go. Chunking
// only kicks in above userBatchChunkSize unique ids, which no realistic display-
// name hydration hits, so this is a safety valve rather than a hot path.
const userBatchMaxConcurrent = 8

// dedupeUserIDs returns the unique, non-empty ids in first-seen order.
//
// Deduping is load-bearing, not cosmetic: the same provider appears on many bids
// and the same participant on many chat channels, so a raw id list is routinely
// several times longer than the set it represents.
func dedupeUserIDs(ids []string) []string {
	unique := make([]string, 0, len(ids))
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique
}

// batchGetUsers resolves user ids to their public projection in
// ceil(unique/userBatchChunkSize) gRPC round trips instead of one per id.
//
// Semantics callers depend on:
//   - A nil client or an empty id list issues NO call and returns an empty map.
//   - Ids are deduped before the call.
//   - Ids that do not resolve (unknown, soft-deleted, malformed) are simply
//     absent from the map — the server omits them rather than erroring, so
//     callers must index by id and tolerate absences. Never assume alignment
//     between the requested slice and the response.
//   - A failed chunk contributes no entries and is reported in the returned
//     error, but the successful chunks are still returned. The map and the error
//     are both meaningful; this is deliberately a partial result so that display
//     -name hydration stays fail-soft (a missing name renders a fallback) rather
//     than turning into a hard request failure.
//
// The returned users carry only PublicUser fields — exactly the projection the
// single-user display-name path already exposed. The batch RPC is structurally
// incapable of returning more than the single-user path, so this cannot widen
// what the gateway leaks.
func batchGetUsers(ctx context.Context, client userv1.UserServiceClient, ids []string) (map[string]*userv1.PublicUser, error) {
	out := make(map[string]*userv1.PublicUser, len(ids))
	if client == nil {
		return out, nil
	}

	unique := dedupeUserIDs(ids)
	if len(unique) == 0 {
		return out, nil
	}

	chunks := make([][]string, 0, (len(unique)+userBatchChunkSize-1)/userBatchChunkSize)
	for start := 0; start < len(unique); start += userBatchChunkSize {
		end := start + userBatchChunkSize
		if end > len(unique) {
			end = len(unique)
		}
		chunks = append(chunks, unique[start:end])
	}

	var (
		mu   sync.Mutex
		wg   sync.WaitGroup
		errs []error
	)
	sem := make(chan struct{}, userBatchMaxConcurrent)

	for i, chunk := range chunks {
		wg.Add(1)
		go func(idx int, batch []string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			resp, err := client.BatchGetUsers(ctx, &userv1.BatchGetUsersRequest{UserIds: batch})

			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, fmt.Errorf("batch get users (chunk %d of %d, %d ids): %w",
					idx+1, len(chunks), len(batch), err))
				return
			}
			for _, u := range resp.GetUsers() {
				if id := u.GetId(); id != "" {
					out[id] = u
				}
			}
		}(i, chunk)
	}
	wg.Wait()

	return out, errors.Join(errs...)
}

// batchGetDisplayNames is the common display-name shape: id → non-empty
// display_name, with unresolved ids and blank names simply absent. Callers that
// need more than the name (bid.go also wants the avatar) use batchGetUsers.
func batchGetDisplayNames(ctx context.Context, client userv1.UserServiceClient, ids []string) (map[string]string, error) {
	users, err := batchGetUsers(ctx, client, ids)
	names := make(map[string]string, len(users))
	for id, u := range users {
		if name := u.GetDisplayName(); name != "" {
			names[id] = name
		}
	}
	return names, err
}
