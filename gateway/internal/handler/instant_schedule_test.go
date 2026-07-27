package handler

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsProviderInstantEligible(t *testing.T) {
	t.Parallel()

	// Wednesday 2026-07-15 14:00 UTC — inside a typical mon-fri 09-17 window.
	wedAfternoon := time.Date(2026, 7, 15, 14, 0, 0, 0, time.UTC)
	// Wednesday 2026-07-15 03:00 UTC — outside business hours.
	wedNight := time.Date(2026, 7, 15, 3, 0, 0, 0, time.UTC)

	weekdaySchedule := []availabilityWindowReq{
		{Day: "mon", StartTime: "09:00", EndTime: "17:00"},
		{Day: "wed", StartTime: "09:00", EndTime: "17:00"},
		{Day: "fri", StartTime: "09:00", EndTime: "17:00"},
	}

	cases := []struct {
		name         string
		enabled      bool
		availableNow bool
		schedule     []availabilityWindowReq
		now          time.Time
		loc          *time.Location
		want         bool
	}{
		{
			name:         "disabled never eligible even if available_now",
			enabled:      false,
			availableNow: true,
			schedule:     weekdaySchedule,
			now:          wedAfternoon,
			want:         false,
		},
		{
			name:         "enabled + available_now wins outside schedule",
			enabled:      true,
			availableNow: true,
			schedule:     weekdaySchedule,
			now:          wedNight,
			want:         true,
		},
		{
			name:         "enabled + available_now with empty schedule",
			enabled:      true,
			availableNow: true,
			schedule:     nil,
			now:          wedNight,
			want:         true,
		},
		{
			name:         "fail-soft empty schedule falls back to available_now only",
			enabled:      true,
			availableNow: false,
			schedule:     nil,
			now:          wedAfternoon,
			want:         false,
		},
		{
			name:         "fail-soft empty slice same as nil schedule",
			enabled:      true,
			availableNow: false,
			schedule:     []availabilityWindowReq{},
			now:          wedAfternoon,
			want:         false,
		},
		{
			name:         "inside schedule window without available_now",
			enabled:      true,
			availableNow: false,
			schedule:     weekdaySchedule,
			now:          wedAfternoon,
			want:         true,
		},
		{
			name:         "outside schedule window without available_now",
			enabled:      true,
			availableNow: false,
			schedule:     weekdaySchedule,
			now:          wedNight,
			want:         false,
		},
		{
			name:         "nil location treated as UTC",
			enabled:      true,
			availableNow: false,
			schedule:     weekdaySchedule,
			now:          wedAfternoon,
			loc:          nil,
			want:         true,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := isProviderInstantEligible(tc.enabled, tc.availableNow, tc.schedule, tc.now, tc.loc)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestInInstantScheduleWindow_sameDay(t *testing.T) {
	t.Parallel()

	// Fixed Wednesday 2026-07-15.
	schedule := []availabilityWindowReq{
		{Day: "wed", StartTime: "09:00", EndTime: "17:00"},
	}

	cases := []struct {
		name string
		hour int
		min  int
		want bool
	}{
		{name: "before start", hour: 8, min: 59, want: false},
		{name: "at start inclusive", hour: 9, min: 0, want: true},
		{name: "mid window", hour: 12, min: 30, want: true},
		{name: "just before end", hour: 16, min: 59, want: true},
		{name: "at end exclusive", hour: 17, min: 0, want: false},
		{name: "after end", hour: 18, min: 0, want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			now := time.Date(2026, 7, 15, tc.hour, tc.min, 0, 0, time.UTC)
			assert.Equal(t, tc.want, inInstantScheduleWindow(now, schedule, time.UTC))
		})
	}
}

func TestInInstantScheduleWindow_wrongDay(t *testing.T) {
	t.Parallel()

	// Wednesday afternoon should not match a Monday-only window.
	schedule := []availabilityWindowReq{
		{Day: "mon", StartTime: "00:00", EndTime: "23:59"},
	}
	wed := time.Date(2026, 7, 15, 14, 0, 0, 0, time.UTC) // Wednesday
	assert.False(t, inInstantScheduleWindow(wed, schedule, time.UTC))

	mon := time.Date(2026, 7, 13, 14, 0, 0, 0, time.UTC) // Monday
	assert.True(t, inInstantScheduleWindow(mon, schedule, time.UTC))
}

func TestInInstantScheduleWindow_overnight(t *testing.T) {
	t.Parallel()

	// Fri 22:00 → Sat 06:00 overnight window named on Friday.
	schedule := []availabilityWindowReq{
		{Day: "fri", StartTime: "22:00", EndTime: "06:00"},
	}

	cases := []struct {
		name string
		// 2026-07-17 is Friday, 2026-07-18 is Saturday.
		date time.Time
		want bool
	}{
		{
			name: "friday before overnight start",
			date: time.Date(2026, 7, 17, 21, 0, 0, 0, time.UTC),
			want: false,
		},
		{
			name: "friday at overnight start",
			date: time.Date(2026, 7, 17, 22, 0, 0, 0, time.UTC),
			want: true,
		},
		{
			name: "friday late night",
			date: time.Date(2026, 7, 17, 23, 30, 0, 0, time.UTC),
			want: true,
		},
		{
			name: "saturday early morning still in fri window",
			date: time.Date(2026, 7, 18, 5, 0, 0, 0, time.UTC),
			want: true,
		},
		{
			name: "saturday at end exclusive",
			date: time.Date(2026, 7, 18, 6, 0, 0, 0, time.UTC),
			want: false,
		},
		{
			name: "saturday midday not in window",
			date: time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC),
			want: false,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tc.want, inInstantScheduleWindow(tc.date, schedule, time.UTC))
		})
	}
}

func TestInInstantScheduleWindow_emptyAndInvalid(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)

	assert.False(t, inInstantScheduleWindow(now, nil, time.UTC))
	assert.False(t, inInstantScheduleWindow(now, []availabilityWindowReq{}, time.UTC))

	// start == end is empty (no match).
	assert.False(t, inInstantScheduleWindow(now, []availabilityWindowReq{
		{Day: "wed", StartTime: "12:00", EndTime: "12:00"},
	}, time.UTC))

	// Unparseable times are skipped.
	assert.False(t, inInstantScheduleWindow(now, []availabilityWindowReq{
		{Day: "wed", StartTime: "nope", EndTime: "17:00"},
		{Day: "wed", StartTime: "09:00", EndTime: "bad"},
	}, time.UTC))
}

func TestInInstantScheduleWindow_providerTimezone(t *testing.T) {
	t.Parallel()

	// Provider in America/New_York: window mon 09:00-17:00 local.
	// 2026-07-13 is Monday. 13:00 UTC = 09:00 EDT → at start → eligible.
	// 12:59 UTC = 08:59 EDT → before start → not eligible.
	loc, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)

	schedule := []availabilityWindowReq{
		{Day: "mon", StartTime: "09:00", EndTime: "17:00"},
	}

	atStartUTC := time.Date(2026, 7, 13, 13, 0, 0, 0, time.UTC)
	assert.True(t, inInstantScheduleWindow(atStartUTC, schedule, loc),
		"13:00 UTC should be 09:00 EDT Monday")

	beforeUTC := time.Date(2026, 7, 13, 12, 59, 0, 0, time.UTC)
	assert.False(t, inInstantScheduleWindow(beforeUTC, schedule, loc),
		"12:59 UTC should be 08:59 EDT Monday")

	// Prove timezone matters: 12:00 UTC is 08:00 EDT (outside NY window) but
	// still inside the same wall-clock window when evaluated in UTC.
	beforeNYOpenUTC := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	assert.False(t, inInstantScheduleWindow(beforeNYOpenUTC, schedule, loc),
		"12:00 UTC = 08:00 EDT should be outside NY 09-17")
	assert.True(t, inInstantScheduleWindow(beforeNYOpenUTC, schedule, time.UTC),
		"12:00 UTC is inside 09-17 when evaluated in UTC")
}

func TestParseHHMM(t *testing.T) {
	t.Parallel()

	mins, ok := parseHHMM("09:30")
	require.True(t, ok)
	assert.Equal(t, 9*60+30, mins)

	mins, ok = parseHHMM("00:00")
	require.True(t, ok)
	assert.Equal(t, 0, mins)

	mins, ok = parseHHMM("23:59")
	require.True(t, ok)
	assert.Equal(t, 23*60+59, mins)

	// Seconds stripped when present.
	mins, ok = parseHHMM("15:04:00")
	require.True(t, ok)
	assert.Equal(t, 15*60+4, mins)

	_, ok = parseHHMM("")
	assert.False(t, ok)
	_, ok = parseHHMM("25:00")
	assert.False(t, ok)
	_, ok = parseHHMM("abc")
	assert.False(t, ok)
}

func TestParseInstantScheduleWindows(t *testing.T) {
	t.Parallel()

	got := parseInstantScheduleWindows([]byte(
		`[{"day":" Mon ","start_time":" 09:00 ","end_time":"17:00"},{"day":"","start_time":"10:00","end_time":"12:00"}]`,
	))
	require.Len(t, got, 1)
	assert.Equal(t, availabilityWindowReq{Day: "mon", StartTime: "09:00", EndTime: "17:00"}, got[0])

	assert.Empty(t, parseInstantScheduleWindows(nil))
	assert.Empty(t, parseInstantScheduleWindows([]byte("null")))
	assert.Empty(t, parseInstantScheduleWindows([]byte("{bad")))
}
