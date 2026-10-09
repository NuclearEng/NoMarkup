package service

import (
	"testing"
	"time"
)

func TestSearchRetryBackoff(t *testing.T) {
	t.Parallel()
	cases := []struct {
		attempts int
		want     time.Duration
	}{
		{0, 30 * time.Second}, // clamped to 1
		{1, 30 * time.Second},
		{2, 60 * time.Second},
		{3, 120 * time.Second},
		{4, 240 * time.Second},
		{5, 480 * time.Second},
		{6, 15 * time.Minute}, // would be 960s → capped
		{10, 15 * time.Minute},
	}
	for _, tc := range cases {
		got := SearchRetryBackoff(tc.attempts)
		if got != tc.want {
			t.Errorf("SearchRetryBackoff(%d) = %v, want %v", tc.attempts, got, tc.want)
		}
	}
}

func TestSearchRetryNextScore(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	// attempt 1 → +30s
	got := SearchRetryNextScore(now, 1)
	want := float64(now.Add(30 * time.Second).Unix())
	if got != want {
		t.Errorf("SearchRetryNextScore(attempt=1) = %v, want %v", got, want)
	}
	// attempt 6 → +15m cap
	got = SearchRetryNextScore(now, 6)
	want = float64(now.Add(15 * time.Minute).Unix())
	if got != want {
		t.Errorf("SearchRetryNextScore(attempt=6) = %v, want %v", got, want)
	}
}

func TestMarshalUnmarshalSearchRetryMember_roundTrip(t *testing.T) {
	t.Parallel()
	in := SearchRetryTask{
		Index:     searchRetryIndexJobs,
		Op:        searchRetryOpIndex,
		EntityID:  "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
		Operation: "publish",
		Attempts:  2,
	}
	member, err := marshalSearchRetryMember(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	out, err := unmarshalSearchRetryMember(member)
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out != in {
		t.Errorf("round-trip mismatch: got %+v want %+v", out, in)
	}
}

func TestMarshalSearchRetryMember_rejectsInvalid(t *testing.T) {
	t.Parallel()
	cases := []SearchRetryTask{
		{Index: "jobs", Op: "index", EntityID: ""},
		{Index: "bogus", Op: "index", EntityID: "id"},
		{Index: "jobs", Op: "upsert", EntityID: "id"},
		{Index: "listings", Op: "", EntityID: "id"},
	}
	for _, tc := range cases {
		if _, err := marshalSearchRetryMember(tc); err == nil {
			t.Errorf("expected error for %+v", tc)
		}
	}
}

func TestUnmarshalSearchRetryMember_rejectsCorrupt(t *testing.T) {
	t.Parallel()
	if _, err := unmarshalSearchRetryMember(`not-json`); err == nil {
		t.Fatal("expected error for corrupt JSON")
	}
	// Valid JSON, invalid op.
	if _, err := unmarshalSearchRetryMember(`{"index":"jobs","op":"nope","id":"x","attempts":0}`); err == nil {
		t.Fatal("expected error for invalid op")
	}
}

func TestValidateSearchRetryTask_ok(t *testing.T) {
	t.Parallel()
	ok := []SearchRetryTask{
		{Index: searchRetryIndexJobs, Op: searchRetryOpIndex, EntityID: "j1"},
		{Index: searchRetryIndexJobs, Op: searchRetryOpRemove, EntityID: "j1"},
		{Index: searchRetryIndexListings, Op: searchRetryOpIndex, EntityID: "l1"},
		{Index: searchRetryIndexListings, Op: searchRetryOpRemove, EntityID: "l1"},
	}
	for _, tc := range ok {
		if err := validateSearchRetryTask(tc); err != nil {
			t.Errorf("validate(%+v) unexpected err: %v", tc, err)
		}
	}
}

func TestMaxSearchRetryDurableAttempts_isPositive(t *testing.T) {
	t.Parallel()
	if maxSearchRetryDurableAttempts < 1 {
		t.Fatalf("max durable attempts must be >= 1, got %d", maxSearchRetryDurableAttempts)
	}
	// In-process path is 3; durable path adds more without unbounded growth.
	if maxSearchRetryDurableAttempts > 20 {
		t.Fatalf("max durable attempts looks unbounded: %d", maxSearchRetryDurableAttempts)
	}
}
