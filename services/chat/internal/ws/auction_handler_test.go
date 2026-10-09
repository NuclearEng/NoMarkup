package ws

import (
	"context"
	"testing"

	"github.com/redis/go-redis/v9"
)

// stubJobAuthorizer authorizes every (job, user) pair so subscribe() proceeds
// to register the connection.
type stubJobAuthorizer struct{}

func (stubJobAuthorizer) IsJobParticipant(_ context.Context, _, _ string) (bool, error) {
	return true, nil
}

// newTestAuctionHandler builds an AuctionHandler with a Redis client pointed at
// an unreachable address. subscribe() spawns a listenRedis goroutine that calls
// rdb.Subscribe; with no reachable server it simply blocks/errs harmlessly and
// never touches the connection — fine for exercising the subscribe/unsubscribe
// bookkeeping under test.
func newTestAuctionHandler() *AuctionHandler {
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	return &AuctionHandler{
		rdb:        rdb,
		authorizer: stubJobAuthorizer{},
		jobs:       make(map[string]*auctionJob),
	}
}

// TestUnsubscribeAllClearsEveryJoinedJob is the regression test for the
// connection/goroutine leak: a connection that subscribed to multiple jobs over
// the wire (subscribe_auction) must have ALL of them torn down on disconnect,
// not just the initial query-param job. Otherwise the dead conn lingers in
// h.jobs[*].conns and keeps the per-job Redis listener alive forever.
func TestUnsubscribeAllClearsEveryJoinedJob(t *testing.T) {
	t.Parallel()

	h := newTestAuctionHandler()
	ac := &auctionConn{
		sendCh: make(chan []byte, auctionSendBuffer),
		jobs:   make(map[string]struct{}),
	}

	ctx := context.Background()
	for _, jobID := range []string{"job-a", "job-b", "job-c"} {
		if !h.subscribe(ctx, "user-1", jobID, ac) {
			t.Fatalf("subscribe(%s) returned false", jobID)
		}
	}

	h.mu.RLock()
	gotJobs := len(h.jobs)
	h.mu.RUnlock()
	if gotJobs != 3 {
		t.Fatalf("expected 3 tracked jobs after subscribe, got %d", gotJobs)
	}

	ac.jobsMu.Lock()
	gotConnJobs := len(ac.jobs)
	ac.jobsMu.Unlock()
	if gotConnJobs != 3 {
		t.Fatalf("expected connection to track 3 jobs, got %d", gotConnJobs)
	}

	// Disconnect cleanup must drop every job (listener refcount → 0).
	h.unsubscribeAll(ac)

	h.mu.RLock()
	remaining := len(h.jobs)
	h.mu.RUnlock()
	if remaining != 0 {
		t.Fatalf("expected 0 tracked jobs after unsubscribeAll, got %d (leak)", remaining)
	}

	ac.jobsMu.Lock()
	remainingConnJobs := len(ac.jobs)
	ac.jobsMu.Unlock()
	if remainingConnJobs != 0 {
		t.Fatalf("expected connection to track 0 jobs after cleanup, got %d", remainingConnJobs)
	}
}

// TestSubscribeIsIdempotentPerConn verifies a repeated subscribe to the same job
// from the same connection does not double-register or grow the tracking set.
func TestSubscribeIsIdempotentPerConn(t *testing.T) {
	t.Parallel()

	h := newTestAuctionHandler()
	ac := &auctionConn{
		sendCh: make(chan []byte, auctionSendBuffer),
		jobs:   make(map[string]struct{}),
	}

	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if !h.subscribe(ctx, "user-1", "job-a", ac) {
			t.Fatalf("subscribe iteration %d returned false", i)
		}
	}

	h.mu.RLock()
	job := h.jobs["job-a"]
	conns := 0
	if job != nil {
		conns = len(job.conns)
	}
	h.mu.RUnlock()
	if conns != 1 {
		t.Fatalf("expected 1 registered conn for job-a, got %d", conns)
	}

	h.unsubscribeAll(ac)
	h.mu.RLock()
	remaining := len(h.jobs)
	h.mu.RUnlock()
	if remaining != 0 {
		t.Fatalf("expected job dropped after last unsubscribe, got %d", remaining)
	}
}
