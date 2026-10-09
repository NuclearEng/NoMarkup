package repository

import (
	"testing"
	"time"
)

func TestMessageCountsAsUnread(t *testing.T) {
	t.Parallel()
	viewer := "user-a"
	peer := "user-b"
	base := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	before := base.Add(-time.Minute)
	after := base.Add(time.Minute)

	cases := []struct {
		name     string
		sender   string
		viewer   string
		msgAt    time.Time
		lastRead *time.Time
		want     bool
	}{
		{"peer after watermark", peer, viewer, after, &base, true},
		{"peer before watermark", peer, viewer, before, &base, false},
		{"own after watermark", viewer, viewer, after, &base, false},
		{"peer nil watermark", peer, viewer, after, nil, true},
		{"own nil watermark", viewer, viewer, after, nil, false},
		{"empty sender", "", viewer, after, &base, false},
		{"empty viewer", peer, "", after, &base, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := messageCountsAsUnread(tc.sender, tc.viewer, tc.msgAt, tc.lastRead); got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}
