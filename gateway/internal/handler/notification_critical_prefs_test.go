package handler

import "testing"

func TestIsCriticalNotificationType(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want bool
	}{
		{"payment_failed", true},
		{"PAYMENT_FAILED", true},
		{"dispute_opened", true},
		{"dispute_resolved", true},
		{"guarantee_claim", true},
		{"nomarkup_guarantee", true},
		{"account_flag", true},
		{"new_bid", false},
		{"payment_received", false},
		{"", false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.in, func(t *testing.T) {
			t.Parallel()
			if got := isCriticalNotificationType(tc.in); got != tc.want {
				t.Fatalf("isCriticalNotificationType(%q)=%v want %v", tc.in, got, tc.want)
			}
		})
	}
}
