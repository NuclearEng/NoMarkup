package handler

// Compliance surface — cookie consent log, ToS version-pinned acceptance,
// and DOB stamping for the age gate. Backs migration 043 (cookie_consent_log,
// tos_versions, tos_acceptances, users.dob/dob_verified_at).
//
// The audit (Sections C, N) flagged this surface as MISSING. Each endpoint
// here writes the minimum auditable record needed to demonstrate ePrivacy /
// GDPR / 13+ COPPA compliance and to defend the platform in a takedown.
//
// Routes (registered in router.go):
//   POST /api/v1/cookie-consent          (public)  — banner Save
//   GET  /api/v1/tos/current             (public)  — latest tos_versions row
//   POST /api/v1/me/tos-acceptance       (auth)    — record acceptance
//   GET  /api/v1/me/tos-acceptance       (auth)    — current acceptance status
//   PUT  /api/v1/me/dob                  (auth)    — set DOB + stamp verified_at
//
// Pattern follows watchlist.go / follows.go: pgx-direct, nil-safe DB pool
// (503 when DATABASE_URL is unset), structured slog errors.

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/crypto"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ComplianceHandler exposes cookie-consent / ToS / DOB endpoints.
//
// cipher seals users.dob_encrypted (migration 106). The DOB is PII with no
// production read path at all — the derived fact the platform consumes is
// dob_verified_at — so SetDOB retains the date only as encrypted evidence
// behind the age assertion and writes the plaintext DATE column NULL.
type ComplianceHandler struct {
	db     *pgxpool.Pool
	cipher *crypto.Cipher
}

// NewComplianceHandler returns a ComplianceHandler. A nil db short-circuits
// every endpoint to a 503, mirroring the rest of the marketplace surface.
//
// cipher is variadic so the existing single-argument composition root keeps
// compiling; callers SHOULD pass the gateway's shared piiCipher for guaranteed
// key parity. Mirrors NewDataExportHandler.
func NewComplianceHandler(db *pgxpool.Pool, cipher ...*crypto.Cipher) *ComplianceHandler {
	h := &ComplianceHandler{db: db}
	if len(cipher) > 0 && cipher[0] != nil {
		h.cipher = cipher[0]
		return h
	}
	c, err := crypto.FromEnv()
	if err != nil {
		// Outside development FromEnv fails closed on a missing key. A nil
		// cipher makes SetDOB a 503 rather than persisting a plaintext DOB.
		slog.Error("compliance: no PII cipher; DOB capture will fail closed", "error", err)
		return h
	}
	slog.Warn("compliance: constructed its own cipher from env; pass the shared piiCipher to NewComplianceHandler for guaranteed key parity")
	h.cipher = c
	return h
}

// minAgeYears is the global minimum age. Some categories (alcohol/tobacco)
// will require >=21 in v2; for v1 we gate at 18 globally.
const minAgeYears = 18

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes
// ─────────────────────────────────────────────────────────────────────────

type cookieConsentRequest struct {
	Necessary bool   `json:"necessary"`
	Analytics bool   `json:"analytics"`
	Marketing bool   `json:"marketing"`
	SessionID string `json:"session_id,omitempty"`
}

type tosVersionJSON struct {
	Version     string    `json:"version"`
	EffectiveAt time.Time `json:"effective_at"`
	BodyURL     *string   `json:"body_url"`
}

type tosAcceptRequest struct {
	TosVersion string `json:"tos_version"`
}

type dobRequest struct {
	// Dob is ISO YYYY-MM-DD. The gateway parses + validates server-side;
	// never trust the client's age math.
	Dob string `json:"dob"`
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/cookie-consent — public
// ─────────────────────────────────────────────────────────────────────────

// LogCookieConsent records a banner Save. user_id is set only if a valid
// claim is in context (the route is registered as public; auth middleware
// is not on it, but if a logged-in client passes a Bearer the gateway's
// optionalAuth helper would attach claims — we use GetClaims defensively).
//
// IP is hashed with SHA-256 to avoid storing raw addresses (PII).
func (h *ComplianceHandler) LogCookieConsent(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	var req cookieConsentRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	// Necessary cookies are always opted-in by definition (ePrivacy: strictly
	// necessary cookies do not require consent), but we record what the user
	// saw to keep the audit trail complete.
	req.Necessary = true

	var userID pgtype.UUID
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		_ = userID.Scan(claims.UserID)
	}

	// Hash the IP so we don't persist raw addresses.
	ipHash := hashIP(remoteIP(r))
	ua := r.Header.Get("User-Agent")
	if len(ua) > 512 {
		ua = ua[:512]
	}

	if _, err := h.db.Exec(r.Context(), `
		INSERT INTO cookie_consent_log
			(user_id, session_id, necessary, analytics, marketing, ip_hash, user_agent)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7)`,
		userID, req.SessionID, req.Necessary, req.Analytics, req.Marketing, ipHash, ua,
	); err != nil {
		slog.ErrorContext(r.Context(), "cookie-consent insert failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to record consent")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"recorded": true,
	})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/tos/current — public
// ─────────────────────────────────────────────────────────────────────────

// GetCurrentToS returns the latest effective tos_versions row. Public so
// signup/login flows can render the link before auth.
func (h *ComplianceHandler) GetCurrentToS(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		// Dev fallback (no DB) — avoid 5xx on every refresh/login page.
		fallback := tosVersionJSON{
			Version:     "1.0",
			EffectiveAt: time.Now(),
			BodyURL:     stringPtr("/terms"),
		}
		writeCachedJSON(w, r, http.StatusOK, fallback, 60, 300)
		return
	}
	var row tosVersionJSON
	var bodyURL pgtype.Text
	err := h.db.QueryRow(r.Context(), `
		SELECT version, effective_at, body_url
		  FROM tos_versions
		 WHERE effective_at <= now()
		 ORDER BY effective_at DESC
		 LIMIT 1`,
	).Scan(&row.Version, &row.EffectiveAt, &bodyURL)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.ErrorContext(r.Context(), "fetch current tos failed", "error", err)
		}
		// Fallback to the seeded default so public pages (incl. login + refresh)
		// don't spam 5xx / console errors while DB is being brought up.
		// body_url points at the public ToS page (not /legal attorney marketplace).
		fallback := tosVersionJSON{
			Version:     "1.0",
			EffectiveAt: time.Now(),
			BodyURL:     stringPtr("/terms"),
		}
		writeCachedJSON(w, r, http.StatusOK, fallback, 60, 300)
		return
	}
	if bodyURL.Valid {
		s := bodyURL.String
		row.BodyURL = &s
	}
	// Public, near-static legal document pointer — edge-cacheable per §14.
	writeCachedJSON(w, r, http.StatusOK, row, 300, 3600)
}

func stringPtr(s string) *string { return &s }

// Note: this was added to prevent 5xx on every browser refresh when the DB
// is not yet available (common in dev before `bin/dev up infra` + migrate).

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/me/tos-acceptance — auth required
// ─────────────────────────────────────────────────────────────────────────

// AcceptToS records a per-(user, version) acceptance row. Idempotent on
// the (user_id, tos_version) UNIQUE constraint.
func (h *ComplianceHandler) AcceptToS(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	var req tosAcceptRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.TosVersion == "" {
		writeError(w, http.StatusBadRequest, "tos_version is required")
		return
	}
	// Verify the version exists — block accidental acceptance of typos.
	var exists bool
	if err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM tos_versions WHERE version = $1)`, req.TosVersion,
	).Scan(&exists); err != nil {
		slog.ErrorContext(r.Context(), "tos version lookup failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to verify version")
		return
	}
	if !exists {
		writeError(w, http.StatusBadRequest, "unknown tos_version")
		return
	}
	if _, err := h.db.Exec(r.Context(), `
		INSERT INTO tos_acceptances (user_id, tos_version)
		VALUES ($1, $2)
		ON CONFLICT (user_id, tos_version) DO NOTHING`,
		claims.UserID, req.TosVersion,
	); err != nil {
		slog.ErrorContext(r.Context(), "tos acceptance insert failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to record acceptance")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"accepted":    true,
		"tos_version": req.TosVersion,
	})
}

// GetMyToSAcceptance returns the user's latest accepted version (or null).
func (h *ComplianceHandler) GetMyToSAcceptance(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	var (
		latest   pgtype.Text
		accepted pgtype.Timestamptz
	)
	err := h.db.QueryRow(r.Context(), `
		SELECT tos_version, accepted_at
		  FROM tos_acceptances
		 WHERE user_id = $1
		 ORDER BY accepted_at DESC
		 LIMIT 1`, claims.UserID,
	).Scan(&latest, &accepted)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		slog.ErrorContext(r.Context(), "fetch my tos acceptance failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load acceptance")
		return
	}
	resp := map[string]interface{}{
		"tos_version": nil,
		"accepted_at": nil,
	}
	if latest.Valid {
		resp["tos_version"] = latest.String
	}
	if accepted.Valid {
		resp["accepted_at"] = accepted.Time.UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, resp)
}

// ─────────────────────────────────────────────────────────────────────────
// PUT /api/v1/me/dob — auth required
// ─────────────────────────────────────────────────────────────────────────

// SetDOB stamps the user's DOB and dob_verified_at. Validates >=18 server
// side. Idempotent (overwrites). Never exposed via GET.
func (h *ComplianceHandler) SetDOB(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	var req dobRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Dob == "" {
		writeError(w, http.StatusBadRequest, "dob is required")
		return
	}
	dob, err := time.Parse("2006-01-02", req.Dob)
	if err != nil {
		writeError(w, http.StatusBadRequest, "dob must be YYYY-MM-DD")
		return
	}
	if dob.After(time.Now()) {
		writeError(w, http.StatusBadRequest, "dob cannot be in the future")
		return
	}
	// The age check runs in memory on the parsed date, BEFORE anything is
	// persisted, and is unchanged by encryption — encrypting the evidence must
	// never weaken the gate that produced dob_verified_at.
	if !meetsMinimumAge(dob, minAgeYears, time.Now()) {
		writeError(w, http.StatusForbidden, "must be at least 18 years old")
		return
	}

	// PII at rest (migration 106). The DOB is sealed into dob_encrypted and the
	// plaintext DATE column is written NULL: nothing in production ever SELECTs
	// users.dob, so retaining the cleartext buys nothing and costs a full date
	// of birth in every backup and replica. The date survives only as encrypted
	// evidence behind the age assertion; the assertion itself is
	// dob_verified_at, which stays a plain timestamp because it is a derived
	// fact, not an identifier.
	if h.cipher == nil {
		slog.ErrorContext(r.Context(), "dob capture blocked: no PII cipher configured", "user_id", claims.UserID)
		writeError(w, http.StatusServiceUnavailable, "age verification is temporarily unavailable")
		return
	}
	encDOB, err := h.cipher.EncryptString(dob.Format("2006-01-02"))
	if err != nil {
		slog.ErrorContext(r.Context(), "dob encrypt failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to record dob")
		return
	}

	if _, err := h.db.Exec(r.Context(), `
		UPDATE users
		   SET dob = NULL, dob_encrypted = $2, dob_verified_at = now(), updated_at = now()
		 WHERE id = $1`,
		claims.UserID, encDOB,
	); err != nil {
		slog.ErrorContext(r.Context(), "dob update failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to record dob")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"dob_verified": true,
	})
}

// GetMyAgeStatus returns whether the user has cleared the age gate. Does
// NOT return the DOB itself.
//
// It reads dob_verified_at ALONE and must keep doing so. That single column is
// the entire production read path for the DOB pair, which is what makes it safe
// for SetDOB to clear users.dob and keep only dob_encrypted. Adding a
// dob/dob_encrypted SELECT here would re-introduce a plaintext DOB into a
// response body and undo migration 106's data minimisation.
func (h *ComplianceHandler) GetMyAgeStatus(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	var verified pgtype.Timestamptz
	if err := h.db.QueryRow(r.Context(),
		`SELECT dob_verified_at FROM users WHERE id = $1`, claims.UserID,
	).Scan(&verified); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		slog.ErrorContext(r.Context(), "age status lookup failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load age status")
		return
	}
	resp := map[string]interface{}{
		"verified":    verified.Valid,
		"verified_at": nil,
	}
	if verified.Valid {
		resp["verified_at"] = verified.Time.UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, resp)
}

// ─────────────────────────────────────────────────────────────────────────
// helpers (exported for unit tests in the same package)
// ─────────────────────────────────────────────────────────────────────────

// meetsMinimumAge returns true iff dob is at least minYears before ref.
// Honors birthday rollover: someone whose 18th birthday is tomorrow is NOT
// 18 today.
func meetsMinimumAge(dob time.Time, minYears int, ref time.Time) bool {
	cutoff := ref.AddDate(-minYears, 0, 0)
	// dob must be on or before the cutoff date (UTC date-only comparison).
	return !dob.After(cutoff)
}

// hashIP returns a SHA-256 hex digest of an IP string. Returns "" for an
// empty input so we don't store the digest of empty bytes.
func hashIP(ip string) string {
	if ip == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(ip))
	return hex.EncodeToString(sum[:])
}

// remoteIP extracts the caller's IP, preferring X-Forwarded-For (first hop)
// when present (gateway is typically behind a proxy in production).
func remoteIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// First entry is the original client; subsequent entries are
		// proxies. Strip whitespace and any port suffix.
		if comma := strings.Index(xff, ","); comma >= 0 {
			return strings.TrimSpace(xff[:comma])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
