package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/meilisearch/meilisearch-go"
)

// fakeSearchRetryStore is an in-memory searchRetryStore recording outcomes.
type fakeSearchRetryStore struct {
	mu          sync.Mutex
	enqueued    []SearchRetryTask
	claim       []claimedSearchRetryTask
	completed   []string
	rescheduled []fakeReschedule
	deadLetters []fakeDeadLetter
	enqueueErr  error
	claimErr    error
	pruneCalls  int
}

type fakeReschedule struct {
	id       string
	attempts int
	backoff  time.Duration
	lastErr  string
}

type fakeDeadLetter struct {
	id       string
	attempts int
	lastErr  string
}

func (f *fakeSearchRetryStore) Enqueue(_ context.Context, task SearchRetryTask) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.enqueueErr != nil {
		return f.enqueueErr
	}
	f.enqueued = append(f.enqueued, task)
	return nil
}

func (f *fakeSearchRetryStore) Import(_ context.Context, task SearchRetryTask, _ time.Time) (bool, error) {
	return true, f.Enqueue(context.Background(), task)
}

func (f *fakeSearchRetryStore) Claim(_ context.Context, limit int) ([]claimedSearchRetryTask, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.claimErr != nil {
		return nil, f.claimErr
	}
	n := min(limit, len(f.claim))
	out := f.claim[:n]
	f.claim = f.claim[n:]
	return out, nil
}

func (f *fakeSearchRetryStore) Complete(_ context.Context, id, _ string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.completed = append(f.completed, id)
	return true, nil
}

func (f *fakeSearchRetryStore) Reschedule(_ context.Context, id, _ string, attempts int, backoff time.Duration, lastErr string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rescheduled = append(f.rescheduled, fakeReschedule{id, attempts, backoff, lastErr})
	return true, nil
}

func (f *fakeSearchRetryStore) DeadLetter(_ context.Context, id, _ string, attempts int, lastErr string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deadLetters = append(f.deadLetters, fakeDeadLetter{id, attempts, lastErr})
	return true, nil
}

func (f *fakeSearchRetryStore) PendingCount(context.Context) (int64, error) { return 0, nil }

func (f *fakeSearchRetryStore) PruneDeadLetters(context.Context, time.Duration, int) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pruneCalls++
	return 0, nil
}

const testEntityID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

func claimed(id string, attempts int) claimedSearchRetryTask {
	return claimedSearchRetryTask{
		ID:    id,
		Token: "tok-" + id,
		Task: SearchRetryTask{
			Index: searchRetryIndexJobs, Op: searchRetryOpIndex,
			EntityID: testEntityID, Operation: "publish", Attempts: attempts,
		},
	}
}

func TestProcessDue_outcomes(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name         string
		attempts     int
		execErr      error
		wantComplete bool
		wantResched  int // attempts recorded, 0 = none
		wantBackoff  time.Duration
		wantDead     int // attempts recorded, 0 = none
	}{
		{name: "success_deletes", attempts: 0, execErr: nil, wantComplete: true},
		{name: "skip_deletes", attempts: 2, execErr: errSearchRetrySkip, wantComplete: true},
		{name: "wrapped_skip_deletes", attempts: 0, execErr: fmt.Errorf("x: %w", errSearchRetrySkip), wantComplete: true},
		{name: "first_failure_reschedules_30s", attempts: 0, execErr: errors.New("meili down"), wantResched: 1, wantBackoff: 30 * time.Second},
		{name: "third_failure_reschedules_120s", attempts: 2, execErr: errors.New("meili down"), wantResched: 3, wantBackoff: 120 * time.Second},
		{name: "fifth_failure_dead_letters", attempts: maxSearchRetryDurableAttempts - 1, execErr: errors.New("meili down"), wantDead: maxSearchRetryDurableAttempts},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &fakeSearchRetryStore{claim: []claimedSearchRetryTask{claimed("r1", tc.attempts)}}
			q := newSearchRetryQueueWithStore(store)
			q.execute = func(context.Context, SearchRetryTask) error { return tc.execErr }

			n, err := q.ProcessDue(context.Background(), 10)
			if err != nil {
				t.Fatalf("ProcessDue: %v", err)
			}
			if n != 1 {
				t.Fatalf("claimed = %d, want 1", n)
			}
			if got := len(store.completed) == 1; got != tc.wantComplete {
				t.Errorf("completed = %v, want %v", store.completed, tc.wantComplete)
			}
			if tc.wantResched > 0 {
				if len(store.rescheduled) != 1 {
					t.Fatalf("rescheduled = %+v, want 1", store.rescheduled)
				}
				r := store.rescheduled[0]
				if r.attempts != tc.wantResched || r.backoff != tc.wantBackoff || r.lastErr != "meili down" {
					t.Errorf("reschedule = %+v, want attempts=%d backoff=%v", r, tc.wantResched, tc.wantBackoff)
				}
			} else if len(store.rescheduled) != 0 {
				t.Errorf("unexpected reschedule %+v", store.rescheduled)
			}
			if tc.wantDead > 0 {
				if len(store.deadLetters) != 1 || store.deadLetters[0].attempts != tc.wantDead {
					t.Errorf("deadLetters = %+v, want attempts=%d", store.deadLetters, tc.wantDead)
				}
			} else if len(store.deadLetters) != 0 {
				t.Errorf("unexpected dead letter %+v", store.deadLetters)
			}
			if store.pruneCalls != 1 {
				t.Errorf("prune calls = %d, want 1 per tick", store.pruneCalls)
			}
		})
	}
}

func TestProcessDue_claimErrorIsReturned(t *testing.T) {
	t.Parallel()
	q := newSearchRetryQueueWithStore(&fakeSearchRetryStore{claimErr: errors.New("db down")})
	if _, err := q.ProcessDue(context.Background(), 10); err == nil {
		t.Fatal("expected claim error")
	}
}

func TestProcessDue_nilQueue(t *testing.T) {
	t.Parallel()
	var q *SearchRetryQueue
	if _, err := q.ProcessDue(context.Background(), 10); err == nil {
		t.Fatal("expected error for nil queue")
	}
}

func TestNewSearchRetryQueue_nilPool(t *testing.T) {
	t.Parallel()
	if q := NewSearchRetryQueue(nil); q != nil {
		t.Fatalf("NewSearchRetryQueue(nil) = %+v, want nil", q)
	}
}

func TestEnqueue_resetsAttemptsAndValidates(t *testing.T) {
	t.Parallel()
	store := &fakeSearchRetryStore{}
	q := newSearchRetryQueueWithStore(store)
	task := SearchRetryTask{Index: searchRetryIndexListings, Op: searchRetryOpRemove, EntityID: testEntityID, Attempts: 3}
	if err := q.Enqueue(context.Background(), task); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	if len(store.enqueued) != 1 || store.enqueued[0].Attempts != 0 {
		t.Fatalf("enqueued = %+v, want one task with attempts=0", store.enqueued)
	}
	if err := q.Enqueue(context.Background(), SearchRetryTask{Index: "bogus", Op: "index", EntityID: testEntityID}); err == nil {
		t.Fatal("expected validation error")
	}
}

func TestEscalateToDurableQueue_enqueueErrorDoesNotPanic(t *testing.T) {
	t.Parallel()
	store := &fakeSearchRetryStore{enqueueErr: errors.New("db down")}
	escalateToDurableQueue(newSearchRetryQueueWithStore(store), SearchRetryTask{
		Index: searchRetryIndexJobs, Op: searchRetryOpIndex, EntityID: testEntityID,
	})
	escalateToDurableQueue(nil, SearchRetryTask{Index: searchRetryIndexJobs, Op: searchRetryOpIndex, EntityID: testEntityID})
	if len(store.enqueued) != 0 {
		t.Fatalf("enqueued despite error: %+v", store.enqueued)
	}
}

func TestSanitizeSearchRetryError(t *testing.T) {
	t.Parallel()
	if got := sanitizeSearchRetryError(nil); got != "" {
		t.Errorf("nil → %q", got)
	}
	me := &meilisearch.Error{
		Endpoint:        "/indexes/jobs/documents",
		Method:          "POST",
		RequestToString: `{"title":"secret customer text"}`,
		StatusCode:      503,
	}
	got := sanitizeSearchRetryError(fmt.Errorf("index job: %w", me))
	if strings.Contains(got, "secret customer text") {
		t.Fatalf("request body leaked into last_error: %q", got)
	}
	if !strings.Contains(got, "status=503") {
		t.Errorf("want status in %q", got)
	}
	long := strings.Repeat("é", searchRetryLastErrorMax) // 2 bytes per rune
	got = sanitizeSearchRetryError(errors.New(long))
	if len(got) > searchRetryLastErrorMax || !utf8.ValidString(got) {
		t.Errorf("truncation: len=%d valid=%v", len(got), utf8.ValidString(got))
	}
}

func TestDecodeLegacySearchRetryMember(t *testing.T) {
	t.Parallel()
	good, err := marshalSearchRetryMember(SearchRetryTask{
		Index: searchRetryIndexJobs, Op: searchRetryOpIndex, EntityID: testEntityID, Operation: "publish", Attempts: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	over, _ := marshalSearchRetryMember(SearchRetryTask{
		Index: searchRetryIndexListings, Op: searchRetryOpRemove, EntityID: testEntityID, Attempts: 9,
	})

	task, due, err := decodeLegacySearchRetryMember(good, 1_800_000_000)
	if err != nil {
		t.Fatalf("decode good: %v", err)
	}
	if task.Attempts != 2 || task.Operation != "publish" || !due.Equal(time.Unix(1_800_000_000, 0)) {
		t.Errorf("decoded %+v due=%v", task, due)
	}

	task, _, err = decodeLegacySearchRetryMember(over, 0)
	if err != nil || task.Attempts != maxSearchRetryDurableAttempts-1 {
		t.Errorf("over-budget member: attempts=%d err=%v", task.Attempts, err)
	}

	before := time.Now().Add(-time.Second)
	_, due, err = decodeLegacySearchRetryMember(good, math.NaN())
	if err != nil || due.Before(before) {
		t.Errorf("NaN score should be due now: due=%v err=%v", due, err)
	}

	for _, bad := range []string{
		"not-json",
		`{"index":"jobs","op":"index","id":"not-a-uuid","attempts":0}`,
		`{"index":"nope","op":"index","id":"` + testEntityID + `"}`,
	} {
		if _, _, err := decodeLegacySearchRetryMember(bad, 1); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
}
