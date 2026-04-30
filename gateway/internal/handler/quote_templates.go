package handler

// Quote templates handler — provider's reusable boilerplate quote
// composer (Wave 5 audit Section H). Backed by migration 046's
// quote_templates table.
//
// A provider that bids on dozens of similar jobs ("$150 drain unclog,
// 30 min, parts included") shouldn't retype the same paragraph every
// time. This handler is the CRUD surface for those templates; the
// client renders them in a picker next to the bid amount input.
//
// Routes (registered in router.go):
//
//   GET    /api/v1/me/quote-templates           (auth: provider)
//   POST   /api/v1/me/quote-templates           (auth: provider)
//   PATCH  /api/v1/me/quote-templates/{id}      (auth: provider)
//   DELETE /api/v1/me/quote-templates/{id}      (auth: provider)
//   POST   /api/v1/me/quote-templates/{id}/use  (auth: provider)
//                                                — increments use_count
//                                                  for "most-used first"
//                                                  ordering on next read.
//
// Pattern follows watchlist.go / follows.go: pgx-direct, nil-safe DB
// pool, structured slog errors, owner-bound on every endpoint.

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// QuoteTemplatesHandler exposes the provider quote-template surface.
type QuoteTemplatesHandler struct {
	db *pgxpool.Pool
}

// NewQuoteTemplatesHandler returns a QuoteTemplatesHandler. A nil db
// short-circuits every endpoint to a 503.
func NewQuoteTemplatesHandler(db *pgxpool.Pool) *QuoteTemplatesHandler {
	return &QuoteTemplatesHandler{db: db}
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes
// ─────────────────────────────────────────────────────────────────────────

type quoteTemplateJSON struct {
	ID                   string    `json:"id"`
	UserID               string    `json:"user_id"`
	Name                 string    `json:"name"`
	Body                 string    `json:"body"`
	DefaultAmountCents   *int64    `json:"default_amount_cents,omitempty"`
	DefaultDurationHours *int      `json:"default_duration_hours,omitempty"`
	UseCount             int       `json:"use_count"`
	CreatedAt            time.Time `json:"created_at"`
}

type createQuoteTemplateRequest struct {
	Name                 string `json:"name"`
	Body                 string `json:"body"`
	DefaultAmountCents   *int64 `json:"default_amount_cents,omitempty"`
	DefaultDurationHours *int   `json:"default_duration_hours,omitempty"`
}

type updateQuoteTemplateRequest struct {
	Name                 *string `json:"name,omitempty"`
	Body                 *string `json:"body,omitempty"`
	DefaultAmountCents   *int64  `json:"default_amount_cents,omitempty"`
	DefaultDurationHours *int    `json:"default_duration_hours,omitempty"`
}

// maxQuoteBodyLen caps a template body. Mirrors the chat message
// envelope so providers can't exfil novels through this surface.
const maxQuoteBodyLen = 4000

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/me/quote-templates — list mine
// ─────────────────────────────────────────────────────────────────────────

// List returns the requesting user's templates ordered by use_count
// DESC then created_at DESC — most-used surface to the top.
func (h *QuoteTemplatesHandler) List(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"templates": []quoteTemplateJSON{}})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id, user_id, name, body,
		       default_amount_cents, default_duration_hours,
		       use_count, created_at
		  FROM quote_templates
		 WHERE user_id = $1
		 ORDER BY use_count DESC, created_at DESC
		 LIMIT 100`, claims.UserID)
	if err != nil {
		slog.ErrorContext(r.Context(), "list quote templates failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load templates")
		return
	}
	defer rows.Close()

	out := make([]quoteTemplateJSON, 0)
	for rows.Next() {
		var t quoteTemplateJSON
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &t.Body,
			&t.DefaultAmountCents, &t.DefaultDurationHours,
			&t.UseCount, &t.CreatedAt); err != nil {
			slog.ErrorContext(r.Context(), "scan quote template failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"templates": out})
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/me/quote-templates — create
// ─────────────────────────────────────────────────────────────────────────

// Create inserts a template owned by the requesting user.
func (h *QuoteTemplatesHandler) Create(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	var req createQuoteTemplateRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Body == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	if len(req.Body) > maxQuoteBodyLen {
		writeError(w, http.StatusBadRequest, "body too long")
		return
	}
	if req.DefaultAmountCents != nil && *req.DefaultAmountCents < 0 {
		writeError(w, http.StatusBadRequest, "default_amount_cents must be non-negative")
		return
	}
	if req.DefaultDurationHours != nil && *req.DefaultDurationHours < 0 {
		writeError(w, http.StatusBadRequest, "default_duration_hours must be non-negative")
		return
	}

	var t quoteTemplateJSON
	err := h.db.QueryRow(r.Context(), `
		INSERT INTO quote_templates
		    (user_id, name, body, default_amount_cents, default_duration_hours)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, name, body,
		          default_amount_cents, default_duration_hours,
		          use_count, created_at`,
		claims.UserID, req.Name, req.Body, req.DefaultAmountCents, req.DefaultDurationHours,
	).Scan(&t.ID, &t.UserID, &t.Name, &t.Body,
		&t.DefaultAmountCents, &t.DefaultDurationHours, &t.UseCount, &t.CreatedAt)
	if err != nil {
		slog.ErrorContext(r.Context(), "insert quote template failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create template")
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/me/quote-templates/{id} — update
// ─────────────────────────────────────────────────────────────────────────

// Update patches a template. Owner-bound: WHERE user_id = caller, so
// non-owners get a 404.
func (h *QuoteTemplatesHandler) Update(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid template id")
		return
	}
	var req updateQuoteTemplateRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Body != nil && len(*req.Body) > maxQuoteBodyLen {
		writeError(w, http.StatusBadRequest, "body too long")
		return
	}

	tag, err := h.db.Exec(r.Context(), `
		UPDATE quote_templates
		   SET name                   = COALESCE($3, name),
		       body                   = COALESCE($4, body),
		       default_amount_cents   = COALESCE($5, default_amount_cents),
		       default_duration_hours = COALESCE($6, default_duration_hours)
		 WHERE id = $1 AND user_id = $2`,
		id, claims.UserID, req.Name, req.Body, req.DefaultAmountCents, req.DefaultDurationHours)
	if err != nil {
		slog.ErrorContext(r.Context(), "update quote template failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update template")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"updated": true})
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/me/quote-templates/{id}
// ─────────────────────────────────────────────────────────────────────────

// Delete removes a template. Idempotent — non-existent / not-owner
// returns 404 (we don't confirm existence to non-owners).
func (h *QuoteTemplatesHandler) Delete(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid template id")
		return
	}
	tag, err := h.db.Exec(r.Context(),
		`DELETE FROM quote_templates WHERE id = $1 AND user_id = $2`, id, claims.UserID)
	if err != nil {
		slog.ErrorContext(r.Context(), "delete quote template failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete template")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"deleted": true})
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/me/quote-templates/{id}/use — increment use_count
// ─────────────────────────────────────────────────────────────────────────

// IncrementUse bumps use_count atomically. The client calls this when a
// template is applied to a bid so popular templates float to the top of
// the picker on the next read.
func (h *QuoteTemplatesHandler) IncrementUse(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid template id")
		return
	}

	var newCount int
	err := h.db.QueryRow(r.Context(), `
		UPDATE quote_templates
		   SET use_count = use_count + 1
		 WHERE id = $1 AND user_id = $2
		 RETURNING use_count`,
		id, claims.UserID,
	).Scan(&newCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "template not found")
			return
		}
		slog.ErrorContext(r.Context(), "increment use_count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to record use")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"use_count": newCount})
}

// ─────────────────────────────────────────────────────────────────────────
// ContractTipHandler — POST /api/v1/contracts/{id}/tip
//
// Customer-facing companion to the quote template surface (Wave 5
// audit Section H). Records a post-completion gratuity against a
// completed contract. The actual Stripe charge is a separate
// transaction billed to the customer's saved card; payout flows
// through the existing Connect transfer pipeline. v1 inserts the row
// only — live charge wiring is a follow-up tracked in PLAN §6.5.
//
// Constraints:
//   - Only the contract's customer may tip.
//   - Contract must be in 'completed' status.
//   - Only one tip per contract (tip_amount_cents starts at 0; non-zero
//     means already tipped).
// ─────────────────────────────────────────────────────────────────────────

// ContractTipHandler exposes the tip endpoint.
type ContractTipHandler struct {
	db *pgxpool.Pool
}

// NewContractTipHandler returns a ContractTipHandler.
func NewContractTipHandler(db *pgxpool.Pool) *ContractTipHandler {
	return &ContractTipHandler{db: db}
}

type tipRequest struct {
	AmountCents int64 `json:"amount_cents"`
}

// minTipCents / maxTipCents bound the tip amount. We refuse zero so a
// "tip applied" UI state can't be poisoned by an empty submission.
const (
	minTipCents = 100     // $1
	maxTipCents = 1000000 // $10,000
)

// Tip records a tip against a completed contract.
func (h *ContractTipHandler) Tip(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	contractID := chi.URLParam(r, "id")
	if !isValidUUID(contractID) {
		writeError(w, http.StatusBadRequest, "invalid contract id")
		return
	}
	var req tipRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.AmountCents < minTipCents || req.AmountCents > maxTipCents {
		writeError(w, http.StatusBadRequest, "amount_cents out of range")
		return
	}

	// Conditional UPDATE — atomic guard against double-tipping and
	// non-customer / non-completed access. RowsAffected==0 => the
	// caller is not the customer, contract isn't completed, or the
	// tip slot is already taken.
	tag, err := h.db.Exec(r.Context(), `
		UPDATE contracts
		   SET tip_amount_cents = $3, updated_at = now()
		 WHERE id = $1
		   AND customer_id = $2
		   AND status = 'completed'
		   AND tip_amount_cents = 0`,
		contractID, claims.UserID, req.AmountCents)
	if err != nil {
		slog.ErrorContext(r.Context(), "tip insert failed", "error", err, "contract_id", contractID)
		writeError(w, http.StatusInternalServerError, "failed to record tip")
		return
	}
	if tag.RowsAffected() == 0 {
		// Distinguish three cases for the operator log without
		// leaking info to the caller.
		var status string
		var customerID string
		var existingTip int64
		err := h.db.QueryRow(r.Context(),
			`SELECT status, customer_id, tip_amount_cents FROM contracts WHERE id = $1`, contractID,
		).Scan(&status, &customerID, &existingTip)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, http.StatusNotFound, "contract not found")
				return
			}
			slog.ErrorContext(r.Context(), "tip diagnose failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to record tip")
			return
		}
		if customerID != claims.UserID {
			writeError(w, http.StatusForbidden, "only the customer can tip")
			return
		}
		if status != "completed" {
			writeError(w, http.StatusUnprocessableEntity, "contract is not completed")
			return
		}
		if existingTip != 0 {
			writeError(w, http.StatusConflict, "tip already recorded")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to record tip")
		return
	}

	slog.InfoContext(r.Context(), "tip recorded",
		"contract_id", contractID,
		"customer_id", claims.UserID,
		"amount_cents", req.AmountCents,
	)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tip_amount_cents": req.AmountCents,
	})
}

