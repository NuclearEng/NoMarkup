package handler

// iCal calendar export — Wave 5 audit Section H. Exposes a single
// endpoint that emits an RFC 5545 VCALENDAR feed of the requesting
// user's upcoming service contracts, marketplace pickups, and
// auction-end deadlines so they can subscribe from Apple Calendar,
// Google Calendar, Outlook, etc.
//
// Routes (registered in router.go):
//
//   GET /api/v1/me/calendar.ics  (auth: cookie OR ?token=…)
//
// The token query-param path is required because most calendar-app
// subscriptions hit the URL directly without forwarding cookies. We
// reuse the existing JWT bearer flow — the same access token the SPA
// uses, just passed via ?token=… instead of the Authorization header.
//
// Wire pattern matches compliance.go / follows.go: pgx-direct, nil-safe
// DB pool (503 when DATABASE_URL isn't wired), structured slog errors.

import (
	"crypto/rsa"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// CalendarExportHandler exposes the iCal feed.
//
// publicKey is used to verify the optional ?token= JWT query-param fallback.
// When auth is provided via the standard cookie / Authorization header,
// the middleware-stamped Claims are used directly.
type CalendarExportHandler struct {
	db        *pgxpool.Pool
	publicKey *rsa.PublicKey
}

// NewCalendarExportHandler returns a CalendarExportHandler.
func NewCalendarExportHandler(db *pgxpool.Pool, publicKey *rsa.PublicKey) *CalendarExportHandler {
	return &CalendarExportHandler{db: db, publicKey: publicKey}
}

// ExportICS renders the user's calendar.ics. We prefer middleware-set
// claims (cookie/header auth); fall back to a ?token=… query param so
// calendar-app subscriptions Just Work.
func (h *CalendarExportHandler) ExportICS(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	userID, tz, ok := h.resolveCaller(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if tz == "" {
		tz = "UTC"
	}

	// Pull contracts (services) — scheduled work.
	type contractEvent struct {
		ID        string
		Number    string
		JobID     string
		JobTitle  string
		Address   string
		StartsAt  time.Time
		Status    string
	}

	contracts := make([]contractEvent, 0)
	contractRows, err := h.db.Query(r.Context(), `
		SELECT c.id, c.contract_number, c.job_id,
		       COALESCE(j.title, ''),
		       COALESCE(j.service_address, ''),
		       COALESCE(c.started_at, j.scheduled_date, c.created_at),
		       c.status
		  FROM contracts c
		  JOIN jobs j ON j.id = c.job_id
		 WHERE (c.customer_id = $1 OR c.provider_id = $1)
		   AND c.status NOT IN ('cancelled', 'voided')
		 ORDER BY COALESCE(c.started_at, j.scheduled_date, c.created_at) ASC
		 LIMIT 500`, userID)
	if err == nil {
		defer contractRows.Close()
		for contractRows.Next() {
			var ev contractEvent
			if err := contractRows.Scan(&ev.ID, &ev.Number, &ev.JobID,
				&ev.JobTitle, &ev.Address, &ev.StartsAt, &ev.Status); err != nil {
				slog.ErrorContext(r.Context(), "calendar contract scan failed", "error", err)
				continue
			}
			contracts = append(contracts, ev)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		slog.ErrorContext(r.Context(), "calendar contracts query failed", "error", err)
	}

	// Pull listing pickups (goods).
	type pickupEvent struct {
		OrderID    string
		ListingID  string
		Title      string
		Address    string
		ScheduleAt time.Time
		Status     string
	}

	pickups := make([]pickupEvent, 0)
	pickupRows, err := h.db.Query(r.Context(), `
		SELECT lo.id, lo.listing_id, COALESCE(l.title, ''),
		       COALESCE(l.pickup_zip_code, ''),
		       COALESCE(lo.paid_at, lo.created_at),
		       lo.status
		  FROM listing_orders lo
		  JOIN listings l ON l.id = lo.listing_id
		 WHERE (lo.buyer_id = $1 OR lo.seller_id = $1)
		   AND lo.status IN ('paid', 'pending', 'picked_up')
		 ORDER BY COALESCE(lo.paid_at, lo.created_at) ASC
		 LIMIT 500`, userID)
	if err == nil {
		defer pickupRows.Close()
		for pickupRows.Next() {
			var ev pickupEvent
			if err := pickupRows.Scan(&ev.OrderID, &ev.ListingID, &ev.Title,
				&ev.Address, &ev.ScheduleAt, &ev.Status); err != nil {
				slog.ErrorContext(r.Context(), "calendar pickup scan failed", "error", err)
				continue
			}
			pickups = append(pickups, ev)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		slog.ErrorContext(r.Context(), "calendar pickups query failed", "error", err)
	}

	// Pull auction-end deadlines for the user's posted-but-unawarded jobs.
	type auctionEvent struct {
		JobID    string
		Title    string
		EndsAt   time.Time
	}

	auctions := make([]auctionEvent, 0)
	auctionRows, err := h.db.Query(r.Context(), `
		SELECT id, COALESCE(title, ''), auction_ends_at
		  FROM jobs
		 WHERE customer_id = $1
		   AND status = 'active'
		   AND auction_ends_at IS NOT NULL
		   AND auction_ends_at > now()
		   AND deleted_at IS NULL
		 ORDER BY auction_ends_at ASC
		 LIMIT 500`, userID)
	if err == nil {
		defer auctionRows.Close()
		for auctionRows.Next() {
			var ev auctionEvent
			if err := auctionRows.Scan(&ev.JobID, &ev.Title, &ev.EndsAt); err != nil {
				slog.ErrorContext(r.Context(), "calendar auction scan failed", "error", err)
				continue
			}
			auctions = append(auctions, ev)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		slog.ErrorContext(r.Context(), "calendar auctions query failed", "error", err)
	}

	// Render VCALENDAR.
	var b strings.Builder
	b.Grow(4096)
	icsWrite(&b, "BEGIN:VCALENDAR")
	icsWrite(&b, "VERSION:2.0")
	icsWrite(&b, "PRODID:-//NoMarkup//Calendar Feed//EN")
	icsWrite(&b, "CALSCALE:GREGORIAN")
	icsWrite(&b, "METHOD:PUBLISH")
	icsWrite(&b, "X-WR-CALNAME:NoMarkup")
	icsWrite(&b, fmt.Sprintf("X-WR-TIMEZONE:%s", tz))

	siteBase := siteBaseURL()

	for _, c := range contracts {
		icsWrite(&b, "BEGIN:VEVENT")
		icsWrite(&b, fmt.Sprintf("UID:contract-%s@nomarkup", c.ID))
		icsWrite(&b, fmt.Sprintf("DTSTAMP:%s", icsFormatUTC(time.Now())))
		icsWrite(&b, fmt.Sprintf("DTSTART:%s", icsFormatUTC(c.StartsAt)))
		icsWrite(&b, fmt.Sprintf("DTEND:%s", icsFormatUTC(c.StartsAt.Add(2*time.Hour))))
		icsWrite(&b, "STATUS:CONFIRMED")
		icsWrite(&b, fmt.Sprintf("SUMMARY:%s", icsEscape(fmt.Sprintf("%s — %s", c.Number, c.JobTitle))))
		if c.Address != "" {
			icsWrite(&b, fmt.Sprintf("LOCATION:%s", icsEscape(c.Address)))
		}
		icsWrite(&b, fmt.Sprintf("URL:%s/contracts/%s", siteBase, c.ID))
		icsWrite(&b, "END:VEVENT")
	}

	for _, p := range pickups {
		icsWrite(&b, "BEGIN:VEVENT")
		icsWrite(&b, fmt.Sprintf("UID:pickup-%s@nomarkup", p.OrderID))
		icsWrite(&b, fmt.Sprintf("DTSTAMP:%s", icsFormatUTC(time.Now())))
		icsWrite(&b, fmt.Sprintf("DTSTART:%s", icsFormatUTC(p.ScheduleAt)))
		icsWrite(&b, fmt.Sprintf("DTEND:%s", icsFormatUTC(p.ScheduleAt.Add(1*time.Hour))))
		icsWrite(&b, "STATUS:CONFIRMED")
		icsWrite(&b, fmt.Sprintf("SUMMARY:%s", icsEscape(fmt.Sprintf("Pickup: %s", p.Title))))
		if p.Address != "" {
			icsWrite(&b, fmt.Sprintf("LOCATION:%s", icsEscape(p.Address)))
		}
		icsWrite(&b, fmt.Sprintf("URL:%s/orders/%s", siteBase, p.OrderID))
		icsWrite(&b, "END:VEVENT")
	}

	for _, a := range auctions {
		icsWrite(&b, "BEGIN:VEVENT")
		icsWrite(&b, fmt.Sprintf("UID:auction-%s@nomarkup", a.JobID))
		icsWrite(&b, fmt.Sprintf("DTSTAMP:%s", icsFormatUTC(time.Now())))
		icsWrite(&b, fmt.Sprintf("DTSTART:%s", icsFormatUTC(a.EndsAt)))
		icsWrite(&b, fmt.Sprintf("DTEND:%s", icsFormatUTC(a.EndsAt.Add(15*time.Minute))))
		icsWrite(&b, "STATUS:CONFIRMED")
		icsWrite(&b, fmt.Sprintf("SUMMARY:%s", icsEscape(fmt.Sprintf("Auction closes: %s", a.Title))))
		icsWrite(&b, fmt.Sprintf("URL:%s/jobs/%s", siteBase, a.JobID))
		icsWrite(&b, "END:VEVENT")
	}

	icsWrite(&b, "END:VCALENDAR")

	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `inline; filename="nomarkup.ics"`)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(b.String()))
}

// resolveCaller returns (userID, timezone, ok). Prefers middleware claims;
// falls back to a ?token=… query-param JWT for calendar-app subscriptions.
func (h *CalendarExportHandler) resolveCaller(r *http.Request) (string, string, bool) {
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		tz := h.lookupTimezone(r, claims.UserID)
		return claims.UserID, tz, true
	}
	if h.publicKey == nil {
		return "", "", false
	}
	tok := r.URL.Query().Get("token")
	if tok == "" {
		return "", "", false
	}

	parsed, err := jwt.Parse(tok, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return h.publicKey, nil
	})
	if err != nil || !parsed.Valid {
		return "", "", false
	}
	mc, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return "", "", false
	}
	uidRaw, ok := mc["sub"]
	if !ok {
		uidRaw, ok = mc["user_id"]
		if !ok {
			return "", "", false
		}
	}
	uid, ok := uidRaw.(string)
	if !ok || uid == "" {
		return "", "", false
	}
	return uid, h.lookupTimezone(r, uid), true
}

// lookupTimezone returns the user's stored timezone or empty if not set.
// Failure to read is non-fatal — we fall back to UTC.
func (h *CalendarExportHandler) lookupTimezone(r *http.Request, userID string) string {
	if h.db == nil {
		return ""
	}
	var tz *string
	if err := h.db.QueryRow(r.Context(),
		`SELECT timezone FROM users WHERE id = $1`, userID,
	).Scan(&tz); err != nil {
		return ""
	}
	if tz == nil {
		return ""
	}
	return *tz
}

// ─────────────────────────────────────────────────────────────────────────
// ICS rendering helpers (RFC 5545)
// ─────────────────────────────────────────────────────────────────────────

// icsWrite appends a single line with the standard CRLF terminator.
// Long-line folding (>75 octets) is intentionally skipped — modern
// clients (Apple Calendar, Google, Outlook) accept un-folded lines and
// our SUMMARY/LOCATION values are bounded by user inputs that almost
// never exceed the limit.
func icsWrite(b *strings.Builder, line string) {
	b.WriteString(line)
	b.WriteString("\r\n")
}

// icsEscape applies RFC 5545 §3.3.11 escaping to TEXT values. Order
// matters — backslash first so we don't double-escape our own escapes.
func icsEscape(s string) string {
	r := strings.NewReplacer(
		`\`, `\\`,
		"\n", `\n`,
		"\r", "",
		",", `\,`,
		";", `\;`,
	)
	return r.Replace(s)
}

// icsFormatUTC renders a timestamp in the UTC ISO basic form (Z suffix).
// We always emit UTC and pin the calendar TZID via X-WR-TIMEZONE so the
// client can render in the user's local time without us shipping a
// VTIMEZONE block.
func icsFormatUTC(t time.Time) string {
	return t.UTC().Format("20060102T150405Z")
}

// siteBaseURL returns the public host the URL: lines should point at.
// Falls back to a sensible default to keep deep links functional in dev.
func siteBaseURL() string {
	for _, env := range []string{"WEB_BASE_URL", "PUBLIC_BASE_URL", "APP_BASE_URL"} {
		if v := strings.TrimRight(os.Getenv(env), "/"); v != "" {
			return v
		}
	}
	return "https://nomarkup.com"
}
