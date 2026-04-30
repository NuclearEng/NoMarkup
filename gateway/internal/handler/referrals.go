package handler

// referrals.go — generation, redemption, and credit-ledger surface for the
// onboarding/growth program. Mounted under the auth-protected /api/v1/me/*
// block. Routes:
//
//   GET  /api/v1/me/referrals/code     GetMyReferralCode
//   POST /api/v1/me/referrals/redeem   RedeemReferralCode
//   GET  /api/v1/me/referrals          ListMyReferrals
//
// Schema relies on migration 048 (referral_credits + the additive
// credit_cents/credited_at columns on the existing `referrals` table from
// migration 001). The handler degrades gracefully when DATABASE_URL is
// unset (returns 503 — the same pattern as follows.go and watchlist.go).

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ReferralsHandler exposes the referral surface.
type ReferralsHandler struct {
	db *pgxpool.Pool
}

// NewReferralsHandler returns a ReferralsHandler. A nil db short-circuits
// every endpoint to a 503.
func NewReferralsHandler(db *pgxpool.Pool) *ReferralsHandler {
	return &ReferralsHandler{db: db}
}

// referralCodeAlphabet is human-readable: no 0/O/1/I/L confusion.
const referralCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// referralDefaultCreditCents is the per-side credit granted when a
// referral activates. Keep in sync with the migration default.
const referralDefaultCreditCents int64 = 1000

// generateReferralCode returns a fresh 8-character uppercase code.
func generateReferralCode() (string, error) {
	const length = 8
	out := make([]byte, length)
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(referralCodeAlphabet))))
		if err != nil {
			return "", fmt.Errorf("generate referral code: %w", err)
		}
		out[i] = referralCodeAlphabet[n.Int64()]
	}
	return string(out), nil
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes
// ─────────────────────────────────────────────────────────────────────────

type referralCodeJSON struct {
	Code            string `json:"code"`
	CreditCents     int64  `json:"credit_cents"`
	ShareURL        string `json:"share_url"`
	ShareMessage    string `json:"share_message"`
}

type referralEntryJSON struct {
	ID            string    `json:"id"`
	Status        string    `json:"status"`
	ReferredID    *string   `json:"referred_id,omitempty"`
	CreditCents   int64     `json:"credit_cents"`
	CreditedAt    *time.Time `json:"credited_at,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

type referralListJSON struct {
	Code              string              `json:"code"`
	Referrals         []referralEntryJSON `json:"referrals"`
	CreditBalanceCents int64              `json:"credit_balance_cents"`
}

type redeemReferralRequest struct {
	Code string `json:"code"`
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/referrals/code
// ─────────────────────────────────────────────────────────────────────────

// GetMyReferralCode returns (and lazily creates) the requesting user's
// referral code. The first hit creates a `referrals` row with
// referred_id=NULL — that row acts as the canonical "issued" code; future
// redemptions create new rows with referred_id set.
func (h *ReferralsHandler) GetMyReferralCode(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	code, err := h.getOrCreateCode(r.Context(), claims.UserID)
	if err != nil {
		slog.ErrorContext(r.Context(), "referrals: get/create code failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to load referral code")
		return
	}

	frontend := strings.TrimRight(getFrontendURL(), "/")
	share := fmt.Sprintf("%s/register?ref=%s", frontend, code)

	writeJSON(w, http.StatusOK, referralCodeJSON{
		Code:         code,
		CreditCents:  referralDefaultCreditCents,
		ShareURL:     share,
		ShareMessage: fmt.Sprintf("Sign up to NoMarkup with my code %s and we both get $%d off.", code, referralDefaultCreditCents/100),
	})
}

// getOrCreateCode looks up the user's existing canonical code (the row
// with referred_id IS NULL). If none exists, creates one. Retries on
// referral_code uniqueness conflicts (cosmically improbable but cheap).
func (h *ReferralsHandler) getOrCreateCode(ctx context.Context, userID string) (string, error) {
	var existing string
	err := h.db.QueryRow(ctx, `
		SELECT referral_code
		  FROM referrals
		 WHERE referrer_id = $1
		   AND referred_id IS NULL
		 ORDER BY created_at ASC
		 LIMIT 1`, userID).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	// Insert a fresh canonical row. referral_type='customer' is a benign
	// default — the legacy CHECK constraint requires one of three values.
	for attempt := 0; attempt < 5; attempt++ {
		code, err := generateReferralCode()
		if err != nil {
			return "", err
		}
		_, err = h.db.Exec(ctx, `
			INSERT INTO referrals
			  (referrer_id, referral_code, referral_type, status, credit_cents, expires_at)
			VALUES ($1, $2, 'customer', 'pending', $3, now() + interval '90 days')`,
			userID, code, referralDefaultCreditCents,
		)
		if err == nil {
			return code, nil
		}
		// 23505 = unique_violation; only retry on collisions on referral_code.
		if isUniqueViolation(err) {
			continue
		}
		return "", err
	}
	return "", errors.New("failed to allocate unique referral code after retries")
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/me/referrals/redeem
// ─────────────────────────────────────────────────────────────────────────

// RedeemReferralCode binds the requesting user to a referrer via the code.
// The referral activates ($10 credit to both parties, ledger row inserted)
// only on the redeemer's first completed transaction — but we still need
// to record the binding immediately so the trigger has something to fire.
//
// Validations: code must exist, referrer != self, redeemer not already
// bound to anyone via any other code.
func (h *ReferralsHandler) RedeemReferralCode(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req redeemReferralRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	if code == "" {
		writeError(w, http.StatusBadRequest, "code is required")
		return
	}

	// Resolve the referrer.
	var referrerID string
	if err := h.db.QueryRow(r.Context(), `
		SELECT referrer_id::text
		  FROM referrals
		 WHERE referral_code = $1
		   AND referred_id IS NULL
		 LIMIT 1`, code,
	).Scan(&referrerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "referral code not found")
			return
		}
		slog.ErrorContext(r.Context(), "referrals: lookup code failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to look up code")
		return
	}

	if referrerID == claims.UserID {
		writeError(w, http.StatusBadRequest, "cannot redeem your own code")
		return
	}

	// Reject if the user has already redeemed any referral.
	var alreadyBound bool
	if err := h.db.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM referrals WHERE referred_id = $1)`,
		claims.UserID,
	).Scan(&alreadyBound); err != nil {
		slog.ErrorContext(r.Context(), "referrals: check existing failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to verify redemption")
		return
	}
	if alreadyBound {
		writeError(w, http.StatusConflict, "you have already redeemed a referral code")
		return
	}

	// Insert the binding row. Status starts at 'signed_up' to align with the
	// legacy state machine; activation flips it to 'first_transaction' →
	// 'credited' on the redeemer's first completed transaction (handled by
	// a separate worker — out of scope for this handler).
	_, err := h.db.Exec(r.Context(), `
		INSERT INTO referrals
		  (referrer_id, referred_id, referral_code, referral_type, status, credit_cents, expires_at)
		VALUES ($1, $2, $3, 'customer', 'signed_up', $4, now() + interval '90 days')`,
		referrerID, claims.UserID, code, referralDefaultCreditCents,
	)
	if err != nil {
		if isUniqueViolation(err) {
			// Race: another concurrent redeem won. Treat as conflict.
			writeError(w, http.StatusConflict, "code already redeemed")
			return
		}
		slog.ErrorContext(r.Context(), "referrals: redeem insert failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to redeem")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"redeemed":     true,
		"credit_cents": referralDefaultCreditCents,
		"message":      "Code redeemed. Credit unlocks on your first completed transaction.",
	})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/referrals
// ─────────────────────────────────────────────────────────────────────────

// ListMyReferrals returns the authenticated user's referral code, every
// referral they've made, and a credit balance computed from the ledger.
func (h *ReferralsHandler) ListMyReferrals(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	code, err := h.getOrCreateCode(r.Context(), claims.UserID)
	if err != nil {
		slog.ErrorContext(r.Context(), "referrals: list — get/create code failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load referrals")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id::text,
		       status,
		       referred_id::text,
		       credit_cents,
		       credited_at,
		       created_at
		  FROM referrals
		 WHERE referrer_id = $1
		   AND referred_id IS NOT NULL
		 ORDER BY created_at DESC
		 LIMIT 200`, claims.UserID)
	if err != nil {
		slog.ErrorContext(r.Context(), "referrals: list query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list referrals")
		return
	}
	defer rows.Close()

	out := make([]referralEntryJSON, 0)
	for rows.Next() {
		var entry referralEntryJSON
		var refID *string
		var creditedAt *time.Time
		if err := rows.Scan(&entry.ID, &entry.Status, &refID, &entry.CreditCents, &creditedAt, &entry.CreatedAt); err != nil {
			slog.ErrorContext(r.Context(), "referrals: list scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		entry.ReferredID = refID
		entry.CreditedAt = creditedAt
		out = append(out, entry)
	}

	balance, err := h.creditBalance(r.Context(), claims.UserID)
	if err != nil {
		// Don't fail the whole response — log and serve zero.
		slog.WarnContext(r.Context(), "referrals: credit balance lookup failed", "error", err)
		balance = 0
	}

	writeJSON(w, http.StatusOK, referralListJSON{
		Code:               code,
		Referrals:          out,
		CreditBalanceCents: balance,
	})
}

// creditBalance sums the user's referral_credits ledger. Empty / missing
// table returns 0 (the migration may not have run yet in dev).
func (h *ReferralsHandler) creditBalance(ctx context.Context, userID string) (int64, error) {
	var total int64
	err := h.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_cents), 0)::bigint
		   FROM referral_credits
		  WHERE user_id = $1`, userID,
	).Scan(&total)
	if err != nil {
		// Tolerate a missing table (migration not applied yet).
		if isUndefinedTable(err) {
			return 0, nil
		}
		return 0, err
	}
	return total, nil
}

// ─────────────────────────────────────────────────────────────────────────
// NPS surveys (post-transaction)
// ─────────────────────────────────────────────────────────────────────────

type npsPendingJSON struct {
	ID          string    `json:"id"`
	ContextType string    `json:"context_type"`
	ContextID   string    `json:"context_id"`
	PromptedAt  time.Time `json:"prompted_at"`
}

type submitNPSRequest struct {
	Score   int    `json:"score"`
	Comment string `json:"comment"`
}

// ListPendingNPS returns the NPS survey rows that have been prompted but
// not yet responded. The web client mounts <NPSSurvey> when ≥1 row exists.
func (h *ReferralsHandler) ListPendingNPS(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id::text, context_type, context_id::text, prompted_at
		  FROM nps_surveys
		 WHERE user_id = $1
		   AND responded_at IS NULL
		 ORDER BY prompted_at ASC
		 LIMIT 5`, claims.UserID)
	if err != nil {
		// Tolerate missing table on dev DBs that haven't run migration 048.
		if isUndefinedTable(err) {
			writeJSON(w, http.StatusOK, map[string]interface{}{"pending": []npsPendingJSON{}})
			return
		}
		slog.ErrorContext(r.Context(), "nps: list pending failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load nps surveys")
		return
	}
	defer rows.Close()

	out := make([]npsPendingJSON, 0)
	for rows.Next() {
		var p npsPendingJSON
		if err := rows.Scan(&p.ID, &p.ContextType, &p.ContextID, &p.PromptedAt); err != nil {
			slog.ErrorContext(r.Context(), "nps: scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, p)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"pending": out})
}

// SubmitNPS records the user's score (and optional comment) for the
// survey identified in the URL path. UPDATE is scoped by user_id to make
// IDOR impossible.
func (h *ReferralsHandler) SubmitNPS(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var req submitNPSRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Score < 0 || req.Score > 10 {
		writeError(w, http.StatusBadRequest, "score must be between 0 and 10")
		return
	}

	tag, err := h.db.Exec(r.Context(), `
		UPDATE nps_surveys
		   SET score = $1,
		       comment = NULLIF($2, ''),
		       responded_at = now()
		 WHERE id = $3
		   AND user_id = $4
		   AND responded_at IS NULL`,
		req.Score, strings.TrimSpace(req.Comment), id, claims.UserID,
	)
	if err != nil {
		if isUndefinedTable(err) {
			writeError(w, http.StatusServiceUnavailable, "nps surveys not enabled")
			return
		}
		slog.ErrorContext(r.Context(), "nps: submit failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to submit nps")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "survey not found or already submitted")
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"submitted": true})
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

// isUniqueViolation returns true for Postgres SQLSTATE 23505. We compare
// the error string rather than importing pgconn here — keeps the handler
// dependency surface light, mirroring isUndefinedColumn elsewhere.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "23505") || strings.Contains(strings.ToLower(msg), "unique constraint")
}

// isUndefinedTable returns true for Postgres SQLSTATE 42P01.
func isUndefinedTable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "42p01") || strings.Contains(msg, "does not exist")
}

// getFrontendURL reads FRONTEND_URL with a localhost default.
func getFrontendURL() string {
	if v := os.Getenv("FRONTEND_URL"); v != "" {
		return v
	}
	return "http://localhost:3000"
}
