package handler

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// weekdayToInstantDay maps Go's time.Weekday to the mon/tue/... keys stored in
// provider_profiles.instant_schedule (see AvailabilityWindow proto).
var weekdayToInstantDay = map[time.Weekday]string{
	time.Monday:    "mon",
	time.Tuesday:   "tue",
	time.Wednesday: "wed",
	time.Thursday:  "thu",
	time.Friday:    "fri",
	time.Saturday:  "sat",
	time.Sunday:    "sun",
}

// isProviderInstantEligible reports whether a provider should receive/see
// instant-match fan-out.
//
// Rules:
//   - instant_enabled must be true
//   - available when available_now OR currently inside a schedule window
//   - fail-soft: missing/empty schedule falls back to available_now only
//
// Timezone: evaluate windows in loc; if loc is nil, use UTC.
func isProviderInstantEligible(
	enabled, availableNow bool,
	schedule []availabilityWindowReq,
	now time.Time,
	loc *time.Location,
) bool {
	if !enabled {
		return false
	}
	if availableNow {
		return true
	}
	if len(schedule) == 0 {
		// Fail-soft: no windows → available_now only (already false above).
		return false
	}
	if loc == nil {
		loc = time.UTC
	}
	return inInstantScheduleWindow(now, schedule, loc)
}

// inInstantScheduleWindow reports whether now (interpreted in loc) falls inside
// any weekly window. Windows use day = mon..sun and HH:MM start/end times.
//
// Same-day windows are half-open [start, end). Overnight windows (start > end)
// span from start on the named day through end on the following calendar day.
// start == end is treated as empty (no match).
func inInstantScheduleWindow(now time.Time, schedule []availabilityWindowReq, loc *time.Location) bool {
	if len(schedule) == 0 {
		return false
	}
	if loc == nil {
		loc = time.UTC
	}

	local := now.In(loc)
	day := weekdayToInstantDay[local.Weekday()]
	mins := local.Hour()*60 + local.Minute()

	prevLocal := local.Add(-24 * time.Hour)
	prevDay := weekdayToInstantDay[prevLocal.Weekday()]

	for _, w := range schedule {
		startMins, endMins, ok := parseHHMMPair(w.StartTime, w.EndTime)
		if !ok {
			continue
		}
		wDay := strings.ToLower(strings.TrimSpace(w.Day))

		if startMins < endMins {
			// Same calendar day: [start, end).
			if wDay == day && mins >= startMins && mins < endMins {
				return true
			}
			continue
		}
		if startMins > endMins {
			// Overnight: [start, 24:00) on named day, [00:00, end) on next day.
			if wDay == day && mins >= startMins {
				return true
			}
			if wDay == prevDay && mins < endMins {
				return true
			}
			continue
		}
		// startMins == endMins → empty window, skip.
	}
	return false
}

// parseHHMMPair parses two "HH:MM" (or "H:MM") clock times into minutes since
// midnight. Returns ok=false if either side is unparseable.
func parseHHMMPair(start, end string) (startMins, endMins int, ok bool) {
	s, ok1 := parseHHMM(start)
	e, ok2 := parseHHMM(end)
	if !ok1 || !ok2 {
		return 0, 0, false
	}
	return s, e, true
}

func parseHHMM(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	// Accept "15:04" and tolerate a trailing ":ss" by taking HH:MM when the
	// third colon-separated part looks like seconds ("15:04:00") — common JSONB drift.
	// Also accept single-digit hours ("9:30") used by some schedule editors.
	if parts := strings.Split(s, ":"); len(parts) >= 3 {
		// Rebuild as HH:MM from hour + minute only.
		s = parts[0] + ":" + parts[1]
	}
	// Prefer zero-padded layout; fall back to H:MM.
	if t, err := time.Parse("15:04", s); err == nil {
		return t.Hour()*60 + t.Minute(), true
	}
	if t, err := time.Parse("3:04", s); err == nil {
		return t.Hour()*60 + t.Minute(), true
	}
	return 0, false
}

// loadInstantScheduleAndLocation loads the provider's weekly windows and the
// caller's stored IANA timezone (users.timezone). Fail-soft:
//   - nil DB / missing row / corrupt schedule → empty schedule
//   - missing/invalid timezone → UTC
//
// Used by instant-match fan-out eligibility only — not for public profiles.
func (h *InstantMatchHandler) loadInstantScheduleAndLocation(
	ctx context.Context,
	userID string,
) (schedule []availabilityWindowReq, loc *time.Location) {
	loc = time.UTC
	schedule = make([]availabilityWindowReq, 0)
	if h.db == nil || userID == "" {
		return schedule, loc
	}

	var raw []byte
	var tz *string
	err := h.db.QueryRow(ctx, `
		SELECT pp.instant_schedule, u.timezone
		FROM provider_profiles pp
		JOIN users u ON u.id = pp.user_id
		WHERE pp.user_id = $1
	`, userID).Scan(&raw, &tz)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("instant match: schedule/timezone lookup failed",
				"user_id", userID,
				"error", err,
			)
		}
		return schedule, loc
	}

	schedule = parseInstantScheduleWindows(raw)
	if tz != nil {
		if name := strings.TrimSpace(*tz); name != "" {
			if loaded, err := time.LoadLocation(name); err == nil {
				loc = loaded
			} else {
				slog.Warn("instant match: invalid provider timezone, using UTC",
					"user_id", userID,
					"timezone", name,
					"error", err,
				)
			}
		}
	}
	return schedule, loc
}
