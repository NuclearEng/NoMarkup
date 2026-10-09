package handler

// iCal calendar export — Wave 5 audit Section H. Exposes an RFC 5545
// VCALENDAR feed of the requesting user's upcoming service contracts,
// marketplace pickups, and auction-end deadlines so they can subscribe
// from Apple Calendar, Google Calendar, Outlook, etc.
//
// Routes (registered in router.go):
//
//	POST /api/v1/me/calendar-feed   (auth: cookie / Bearer)
//	GET  /api/v1/me/calendar.ics    (auth: cookie / Bearer OR ?feed=…)
//
// Calendar apps hit the ICS URL without cookies or an Authorization
// header, so the SPA first POSTs calendar-feed to mint an opaque 90-day
// secret. Only SHA-256(secret) is stored (Redis). Session JWTs in
// ?token= are rejected — a 15-minute access token must not live in
// browser history, proxy logs, or a calendar client's subscription URL.
//
// Wire pattern matches compliance.go / follows.go: pgx-direct, structured
// slog errors. A missing DB after a successful auth still emits a valid
// empty VCALENDAR so a calendar client does not drop the subscription.

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// calendarFeedTTL is how long an opaque ICS secret remains valid.
const calendarFeedTTL = 90 * 24 * time.Hour

// calendarFeedSecretBytes is the raw entropy minted into ?feed=.
const calendarFeedSecretBytes = 32

// errCalendarFeedUnavailable is returned when Redis cannot persist a feed hash.
var errCalendarFeedUnavailable = errors.New("calendar feed store unavailable")

// calendarFeedStore maps SHA-256(secret) → user_id. The plaintext secret is
// never stored. Implementations must not log either value.
type calendarFeedStore interface {
	Put(ctx context.Context, hashHex, userID string, ttl time.Duration) error
	Get(ctx context.Context, hashHex string) (userID string, ok bool)
}

// redisCalendarFeedStore persists feed hashes in Redis via cache.Client.
type redisCalendarFeedStore struct {
	cache *cache.Client
}

func calendarFeedKey(hashHex string) string {
	return cache.Key("calfeed", hashHex)
}

func (s redisCalendarFeedStore) Put(ctx context.Context, hashHex, userID string, ttl time.Duration) error {
	if s.cache == nil {
		return errCalendarFeedUnavailable
	}
	rdb := s.cache.Redis()
	if rdb == nil {
		return errCalendarFeedUnavailable
	}
	if err := rdb.Set(ctx, calendarFeedKey(hashHex), userID, ttl).Err(); err != nil {
		return fmt.Errorf("store calendar feed: %w", err)
	}
	return nil
}

func (s redisCalendarFeedStore) Get(ctx context.Context, hashHex string) (string, bool) {
	if s.cache == nil {
		return "", false
	}
	rdb := s.cache.Redis()
	if rdb == nil {
		return "", false
	}
	userID, err := rdb.Get(ctx, calendarFeedKey(hashHex)).Result()
	if err != nil || userID == "" {
		return "", false
	}
	return userID, true
}

// CalendarExportHandler exposes the iCal feed and the feed-token mint.
//
// publicKey is accepted by the constructor for composition-root compatibility
// but is not used: session JWTs are not calendar credentials.
//
// When auth is provided via the standard cookie / Authorization header,
// the middleware-stamped Claims are used directly. Calendar-app fetches
// authenticate with ?feed= looked up against feeds (SHA-256 → user_id).
//
// cipher opens jobs.service_address, which is PII at rest as of migration 104.
// This feed is the gateway's only consumer of that column.
type CalendarExportHandler struct {
	db     *pgxpool.Pool
	cipher *crypto.Cipher
	feeds  calendarFeedStore
}

// NewCalendarExportHandler returns a CalendarExportHandler.
//
// cipher is variadic so the existing two-argument composition root keeps
// compiling; callers SHOULD pass the gateway's shared piiCipher for guaranteed
// key parity. Mirrors NewDataExportHandler.
//
// publicKey is unused; kept so main.go's three-argument call still compiles.
// Call WithCache to wire Redis for ?feed= mint/lookup.
func NewCalendarExportHandler(db *pgxpool.Pool, publicKey *rsa.PublicKey, cipher ...*crypto.Cipher) *CalendarExportHandler {
	h := &CalendarExportHandler{db: db}
	_ = publicKey
	if len(cipher) > 0 && cipher[0] != nil {
		h.cipher = cipher[0]
		return h
	}
	c, err := crypto.FromEnv()
	if err != nil {
		// No key: every encrypted address degrades to an omitted LOCATION.
		// The feed still serves — see decryptEventAddress.
		slog.Error("calendar export: no PII cipher; encrypted addresses will be omitted from LOCATION", "error", err)
		return h
	}
	slog.Warn("calendar export: constructed its own cipher from env; pass the shared piiCipher to NewCalendarExportHandler for guaranteed key parity")
	h.cipher = c
	return h
}

// WithCache attaches the gateway Redis client used to persist opaque feed
// tokens. Safe to call with nil (mint then 503s; ?feed= lookups 401).
func (h *CalendarExportHandler) WithCache(c *cache.Client) *CalendarExportHandler {
	if h == nil {
		return h
	}
	h.feeds = redisCalendarFeedStore{cache: c}
	return h
}

// decryptEventAddress renders jobs.service_address for an ICS LOCATION line.
//
// Unlike the licence read path this DEGRADES rather than erroring. A calendar
// subscription is a background fetch by a third-party client; a hard failure
// takes out every event in the feed, including the ones with no address at all.
// So a value that cannot be opened is logged and dropped, producing a VEVENT
// with no LOCATION — an entry missing an address is far better than one whose
// address is a base64 blob, and far better than no calendar.
//
// Detection is per VALUE: a legacy plaintext address (written before migration
// 104) is not our wire format and passes straight through.
func (h *CalendarExportHandler) decryptEventAddress(ctx context.Context, stored string) string {
	if stored == "" {
		return ""
	}
	if h.cipher == nil {
		slog.ErrorContext(ctx, "calendar export: no PII cipher; omitting event address")
		return ""
	}
	plain, err := h.cipher.DecryptStringOrPassthrough(stored)
	if err != nil {
		slog.ErrorContext(ctx, "calendar export: service address is secretbox-shaped but no configured key opens it; omitting LOCATION", "error", err)
		return ""
	}
	return plain
}

// ExportICS renders the user's calendar.ics. We prefer middleware-set
// claims (cookie/header auth); calendar-app subscriptions authenticate
// with ?feed= (opaque secret minted by MintFeed). ?token= session JWTs
// are rejected.
func (h *CalendarExportHandler) ExportICS(w http.ResponseWriter, r *http.Request) {
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
		ID       string
		Number   string
		JobID    string
		JobTitle string
		Address  string
		StartsAt time.Time
		Status   string
	}

	type pickupEvent struct {
		OrderID    string
		ListingID  string
		Title      string
		Address    string
		ScheduleAt time.Time
		Status     string
	}
	type auctionEvent struct {
		JobID  string
		Title  string
		EndsAt time.Time
	}

	contracts := make([]contractEvent, 0)
	pickups := make([]pickupEvent, 0)
	auctions := make([]auctionEvent, 0)
	if h.db != nil {
		contractRows, err := h.db.Query(r.Context(), `
		SELECT c.id, c.contract_number, c.job_id,
		       COALESCE(j.title, ''),
		       COALESCE(j.service_address, ''),
		       COALESCE(c.started_at, j.scheduled_date, c.created_at),
		       c.status
		  FROM contracts c
		  JOIN jobs j ON j.id = c.job_id
		 WHERE (c.customer_id = $1 OR c.provider_id = $1)
		   AND c.deleted_at IS NULL
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
				// jobs.service_address is PII at rest (migration 104).
				ev.Address = h.decryptEventAddress(r.Context(), ev.Address)
				contracts = append(contracts, ev)
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			slog.ErrorContext(r.Context(), "calendar contracts query failed", "error", err)
		}

		// listing_orders has no paid_at/status: use escrow_status + schedule columns
		// (pickup_window_start / pickup_confirmed_at / created_at). See migrations 034/101.
		pickupRows, err := h.db.Query(r.Context(), `
		SELECT lo.id, lo.listing_id, COALESCE(l.title, ''),
		       COALESCE(l.pickup_zip_code, ''),
		       COALESCE(lo.pickup_window_start, lo.pickup_confirmed_at, lo.created_at),
		       lo.escrow_status
		  FROM listing_orders lo
		  JOIN listings l ON l.id = lo.listing_id
		 WHERE (lo.buyer_id = $1 OR lo.seller_id = $1)
		   AND lo.escrow_status IN ('pending_payment', 'held', 'pickup_confirmed', 'released')
		 ORDER BY COALESCE(lo.pickup_window_start, lo.pickup_confirmed_at, lo.created_at) ASC
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
// falls back to an opaque ?feed= secret. Session JWTs in ?token= are ignored.
func (h *CalendarExportHandler) resolveCaller(r *http.Request) (string, string, bool) {
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		tz := h.lookupTimezone(r, claims.UserID)
		return claims.UserID, tz, true
	}
	feed := strings.TrimSpace(r.URL.Query().Get("feed"))
	if feed == "" {
		return "", "", false
	}
	uid, ok := h.lookupFeed(r.Context(), feed)
	if !ok {
		return "", "", false
	}
	return uid, h.lookupTimezone(r, uid), true
}

// MintFeed handles POST /api/v1/me/calendar-feed. It mints a 32-byte opaque
// secret, stores SHA-256(secret) → user_id in Redis (90 days), and returns
// the public ICS URL. The raw secret is never logged.
func (h *CalendarExportHandler) MintFeed(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok || claims.UserID == "" {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if h.feeds == nil {
		writeError(w, http.StatusServiceUnavailable, "calendar feed unavailable")
		return
	}

	secret, hashHex, err := mintCalendarFeedSecret()
	if err != nil {
		slog.ErrorContext(r.Context(), "calendar feed: failed to mint secret", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create calendar feed")
		return
	}
	if err := h.feeds.Put(r.Context(), hashHex, claims.UserID, calendarFeedTTL); err != nil {
		slog.ErrorContext(r.Context(), "calendar feed: failed to persist token hash", "error", err)
		writeError(w, http.StatusServiceUnavailable, "calendar feed unavailable")
		return
	}

	icsURL := calendarAPIOrigin(r) + "/api/v1/me/calendar.ics?feed=" + url.QueryEscape(secret)
	writeJSON(w, http.StatusOK, map[string]string{"url": icsURL})
}

func (h *CalendarExportHandler) lookupFeed(ctx context.Context, secret string) (string, bool) {
	if h.feeds == nil || secret == "" {
		return "", false
	}
	sum := sha256.Sum256([]byte(secret))
	return h.feeds.Get(ctx, hex.EncodeToString(sum[:]))
}

func mintCalendarFeedSecret() (plain, hashHex string, err error) {
	raw := make([]byte, calendarFeedSecretBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("mint calendar feed: %w", err)
	}
	plain = hex.EncodeToString(raw)
	sum := sha256.Sum256([]byte(plain))
	return plain, hex.EncodeToString(sum[:]), nil
}

// calendarAPIOrigin is the host calendar clients must fetch. Prefer an
// explicit public API origin; otherwise reconstruct from the mint request.
func calendarAPIOrigin(r *http.Request) string {
	for _, key := range []string{"PUBLIC_API_URL", "API_PUBLIC_URL", "GATEWAY_PUBLIC_URL"} {
		if v := strings.TrimRight(strings.TrimSpace(os.Getenv(key)), "/"); v != "" {
			return v
		}
	}
	scheme := "https"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = strings.TrimSpace(strings.Split(proto, ",")[0])
	} else if r.TLS == nil {
		scheme = "http"
	}
	host := r.Host
	if fwd := r.Header.Get("X-Forwarded-Host"); fwd != "" {
		host = strings.TrimSpace(strings.Split(fwd, ",")[0])
	}
	if host == "" {
		host = "localhost:8080"
	}
	return scheme + "://" + host
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
