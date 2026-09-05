package main

import (
	"context"
	"testing"
	"time"
)

// TestWithCronLock_NilPoolSkips pins the fail-closed default. Both callers are
// money workers; without a pool there is no advisory lock, and an unserialized
// money worker is worse than no worker, so the tick must be skipped rather than
// run unprotected.
func TestWithCronLock_NilPoolSkips(t *testing.T) {
	t.Parallel()

	ran := false
	skipped, err := withCronLock(context.Background(), nil, installmentCronLockKey, func(context.Context) error {
		ran = true
		return nil
	})
	if err != nil {
		t.Fatalf("withCronLock: %v", err)
	}
	if !skipped {
		t.Fatal("skipped = false, want true when there is no pool")
	}
	if ran {
		t.Fatal("the worker body ran without an advisory lock")
	}
}

func TestCronLockKeys_AreDistinct(t *testing.T) {
	t.Parallel()
	if installmentCronLockKey == listingSettlementLockKey {
		t.Fatal("the two money workers share an advisory-lock key; one would starve the other")
	}
}

// Not parallel: t.Setenv mutates process-wide state.
func TestEnvHelpers(t *testing.T) {
	t.Run("duration", func(t *testing.T) {
		tests := []struct {
			name string
			set  string
			want time.Duration
		}{
			{name: "unset_uses_default", set: "", want: time.Hour},
			{name: "valid_is_parsed", set: "15m", want: 15 * time.Minute},
			{name: "garbage_uses_default", set: "not-a-duration", want: time.Hour},
			{name: "zero_uses_default", set: "0s", want: time.Hour},
			{name: "negative_uses_default", set: "-5m", want: time.Hour},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				key := "NOMARKUP_TEST_DURATION_" + tc.name
				if tc.set != "" {
					t.Setenv(key, tc.set)
				}
				if got := envDurationOr(key, time.Hour); got != tc.want {
					t.Fatalf("envDurationOr = %v, want %v", got, tc.want)
				}
			})
		}
	})

	t.Run("int", func(t *testing.T) {
		tests := []struct {
			name string
			set  string
			want int
		}{
			{name: "unset_uses_default", set: "", want: 200},
			{name: "valid_is_parsed", set: "50", want: 50},
			{name: "garbage_uses_default", set: "many", want: 200},
			{name: "zero_uses_default", set: "0", want: 200},
			{name: "negative_uses_default", set: "-1", want: 200},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				key := "NOMARKUP_TEST_INT_" + tc.name
				if tc.set != "" {
					t.Setenv(key, tc.set)
				}
				if got := envIntOr(key, 200); got != tc.want {
					t.Fatalf("envIntOr = %v, want %v", got, tc.want)
				}
			})
		}
	})
}
