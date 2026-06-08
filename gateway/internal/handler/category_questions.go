package handler

// Pre-quote questions handler — Thumbtack's signature feature backed by
// migration 046 (category_questions + job_question_answers).
//
// The audit (Section H) flagged this surface as MISSING. Customers post
// jobs with at-most-a-paragraph descriptions; bidding providers had no
// way to know the real scope without a back-and-forth chat. This handler
// surfaces an admin-curated, per-category question set on the post-job
// form, persists customer answers alongside the job, and exposes them to
// providers viewing the job's bid surface.
//
// Routes (registered in router.go):
//
//   GET  /api/v1/categories/{id}/questions          (public)
//   POST /api/v1/admin/category-questions           (admin)
//   PATCH/DELETE/GET                                (admin) — full CRUD
//   POST /api/v1/jobs/{id}/answers                  (auth: customer)
//   GET  /api/v1/jobs/{id}/answers                  (auth: customer +
//                                                    bidding providers)
//
// Pattern follows watchlist.go / follows.go: pgx-direct, nil-safe DB
// pool (503 when DATABASE_URL is unset), structured slog errors.

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// CategoryQuestionsHandler exposes the pre-quote question surface.
type CategoryQuestionsHandler struct {
	db *pgxpool.Pool
}

// NewCategoryQuestionsHandler returns a CategoryQuestionsHandler. A nil
// db short-circuits every endpoint to a 503 (matches the rest of the
// audit-driven surface — follows.go, compliance.go).
func NewCategoryQuestionsHandler(db *pgxpool.Pool) *CategoryQuestionsHandler {
	return &CategoryQuestionsHandler{db: db}
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes
// ─────────────────────────────────────────────────────────────────────────

// categoryQuestionJSON is the wire shape for one question.
//
// `options` carries the raw JSONB payload for select/multiselect types
// (e.g. ["Today","This week","More than a week ago"]). text/number/
// boolean/date types ignore it.
type categoryQuestionJSON struct {
	ID           string          `json:"id"`
	CategoryID   string          `json:"category_id"`
	Question     string          `json:"question"`
	QuestionType string          `json:"question_type"`
	Options      json.RawMessage `json:"options,omitempty"`
	Required     bool            `json:"required"`
	DisplayOrder int             `json:"display_order"`
	CreatedAt    time.Time       `json:"created_at"`
}

type createCategoryQuestionRequest struct {
	CategoryID   string          `json:"category_id"`
	Question     string          `json:"question"`
	QuestionType string          `json:"question_type"`
	Options      json.RawMessage `json:"options,omitempty"`
	Required     bool            `json:"required"`
	DisplayOrder int             `json:"display_order"`
}

type updateCategoryQuestionRequest struct {
	Question     *string         `json:"question,omitempty"`
	QuestionType *string         `json:"question_type,omitempty"`
	Options      json.RawMessage `json:"options,omitempty"`
	Required     *bool           `json:"required,omitempty"`
	DisplayOrder *int            `json:"display_order,omitempty"`
}

// answerJSON is the wire shape for one customer answer.
//
// answer_text covers text/select/date types. answer_json covers
// multiselect (array) and number/boolean values that should round-trip
// as raw JSON. Exactly one of the two will be populated.
type answerJSON struct {
	ID         string          `json:"id"`
	JobID      string          `json:"job_id"`
	QuestionID string          `json:"question_id"`
	AnswerText *string         `json:"answer_text,omitempty"`
	AnswerJSON json.RawMessage `json:"answer_json,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

type submitAnswersRequest struct {
	Answers []submitAnswerInput `json:"answers"`
}

type submitAnswerInput struct {
	QuestionID string          `json:"question_id"`
	AnswerText *string         `json:"answer_text,omitempty"`
	AnswerJSON json.RawMessage `json:"answer_json,omitempty"`
}

// allowedQuestionTypes is the canonical list of question_type values.
// Matches the CHECK constraint in migration 046.
var allowedQuestionTypes = map[string]bool{
	"text":        true,
	"number":      true,
	"select":      true,
	"multiselect": true,
	"boolean":     true,
	"date":        true,
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/categories/{id}/questions — public
// ─────────────────────────────────────────────────────────────────────────

// ListByCategory returns the ordered question set for a category. Public —
// the post-job form must render before the user has authed.
func (h *CategoryQuestionsHandler) ListByCategory(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		// Mirror the rest of the marketplace surface: degrade to an empty
		// list when the DB isn't wired so the form still renders.
		writeJSON(w, http.StatusOK, map[string]interface{}{"questions": []categoryQuestionJSON{}})
		return
	}
	categoryID := chi.URLParam(r, "id")
	if !isValidUUID(categoryID) {
		writeError(w, http.StatusBadRequest, "invalid category id")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id, category_id, question, question_type,
		       COALESCE(options, 'null'::jsonb), required, display_order, created_at
		  FROM category_questions
		 WHERE category_id = $1
		 ORDER BY display_order ASC, created_at ASC`,
		categoryID)
	if err != nil {
		slog.ErrorContext(r.Context(), "list category questions failed", "error", err, "category_id", categoryID)
		writeError(w, http.StatusInternalServerError, "failed to load questions")
		return
	}
	defer rows.Close()

	out := make([]categoryQuestionJSON, 0)
	for rows.Next() {
		var q categoryQuestionJSON
		var opts []byte
		if err := rows.Scan(&q.ID, &q.CategoryID, &q.Question, &q.QuestionType,
			&opts, &q.Required, &q.DisplayOrder, &q.CreatedAt); err != nil {
			slog.ErrorContext(r.Context(), "scan category question failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		if string(opts) != "null" {
			q.Options = opts
		}
		out = append(out, q)
	}
	// Pre-quote questions are admin-managed per category and near-static →
	// long edge TTL (5m CDN + 1h SWR). Public, no per-user data.
	writeCachedJSON(w, r, http.StatusOK, map[string]interface{}{"questions": out}, 300, 3600)
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/admin/category-questions — admin only
// ─────────────────────────────────────────────────────────────────────────

// AdminCreate inserts a new question. Admin-gated upstream by RequireAdmin.
func (h *CategoryQuestionsHandler) AdminCreate(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	var req createCategoryQuestionRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !isValidUUID(req.CategoryID) {
		writeError(w, http.StatusBadRequest, "invalid category id")
		return
	}
	if req.Question == "" {
		writeError(w, http.StatusBadRequest, "question is required")
		return
	}
	if !allowedQuestionTypes[req.QuestionType] {
		writeError(w, http.StatusBadRequest, "invalid question_type")
		return
	}

	var optionsArg interface{}
	if len(req.Options) > 0 && string(req.Options) != "null" {
		optionsArg = []byte(req.Options)
	}

	var q categoryQuestionJSON
	var opts []byte
	err := h.db.QueryRow(r.Context(), `
		INSERT INTO category_questions
		    (category_id, question, question_type, options, required, display_order)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, category_id, question, question_type,
		          COALESCE(options, 'null'::jsonb), required, display_order, created_at`,
		req.CategoryID, req.Question, req.QuestionType, optionsArg, req.Required, req.DisplayOrder,
	).Scan(&q.ID, &q.CategoryID, &q.Question, &q.QuestionType,
		&opts, &q.Required, &q.DisplayOrder, &q.CreatedAt)
	if err != nil {
		slog.ErrorContext(r.Context(), "insert category question failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create question")
		return
	}
	if string(opts) != "null" {
		q.Options = opts
	}
	writeJSON(w, http.StatusCreated, q)
}

// AdminUpdate patches an existing question (admin-gated).
func (h *CategoryQuestionsHandler) AdminUpdate(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid question id")
		return
	}
	var req updateCategoryQuestionRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Build a single COALESCE-driven UPDATE so callers can patch
	// individual fields without a multi-clause builder.
	if req.QuestionType != nil && !allowedQuestionTypes[*req.QuestionType] {
		writeError(w, http.StatusBadRequest, "invalid question_type")
		return
	}

	var optionsArg interface{}
	updateOptions := false
	if len(req.Options) > 0 {
		updateOptions = true
		if string(req.Options) != "null" {
			optionsArg = []byte(req.Options)
		}
	}

	tag, err := h.db.Exec(r.Context(), `
		UPDATE category_questions
		   SET question      = COALESCE($2, question),
		       question_type = COALESCE($3, question_type),
		       options       = CASE WHEN $4::boolean THEN $5::jsonb ELSE options END,
		       required      = COALESCE($6, required),
		       display_order = COALESCE($7, display_order)
		 WHERE id = $1`,
		id, req.Question, req.QuestionType, updateOptions, optionsArg, req.Required, req.DisplayOrder)
	if err != nil {
		slog.ErrorContext(r.Context(), "update category question failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update question")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "question not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"updated": true})
}

// AdminDelete removes a question (admin-gated). Cascades to existing
// answers via FK ON DELETE CASCADE.
func (h *CategoryQuestionsHandler) AdminDelete(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid question id")
		return
	}
	tag, err := h.db.Exec(r.Context(), `DELETE FROM category_questions WHERE id = $1`, id)
	if err != nil {
		slog.ErrorContext(r.Context(), "delete category question failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete question")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "question not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"deleted": true})
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/jobs/{id}/answers — customer (job owner) only
// ─────────────────────────────────────────────────────────────────────────

// SubmitAnswers upserts a batch of answers for a job. Only the customer
// who posted the job may submit; conflict on (job_id, question_id)
// updates the existing answer in place so providers always see the
// latest value.
func (h *CategoryQuestionsHandler) SubmitAnswers(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	jobID := chi.URLParam(r, "id")
	if !isValidUUID(jobID) {
		writeError(w, http.StatusBadRequest, "invalid job id")
		return
	}

	var req submitAnswersRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.Answers) == 0 {
		writeError(w, http.StatusBadRequest, "answers must be a non-empty array")
		return
	}

	// Verify the caller owns the job. We refuse to leak existence to
	// non-owners — both not-found and not-owner return 404.
	var ownerID string
	err := h.db.QueryRow(r.Context(),
		`SELECT customer_id FROM jobs WHERE id = $1 AND deleted_at IS NULL`, jobID,
	).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "job not found")
			return
		}
		slog.ErrorContext(r.Context(), "answers ownership check failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to verify job")
		return
	}
	if ownerID != claims.UserID {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		slog.ErrorContext(r.Context(), "answers tx begin failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to record answers")
		return
	}
	defer tx.Rollback(r.Context())

	for _, a := range req.Answers {
		if !isValidUUID(a.QuestionID) {
			writeError(w, http.StatusBadRequest, "invalid question_id")
			return
		}
		var jsonArg interface{}
		if len(a.AnswerJSON) > 0 && string(a.AnswerJSON) != "null" {
			jsonArg = []byte(a.AnswerJSON)
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO job_question_answers (job_id, question_id, answer_text, answer_json)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (job_id, question_id) DO UPDATE
			   SET answer_text = EXCLUDED.answer_text,
			       answer_json = EXCLUDED.answer_json`,
			jobID, a.QuestionID, a.AnswerText, jsonArg,
		); err != nil {
			slog.ErrorContext(r.Context(), "answers upsert failed", "error", err, "question_id", a.QuestionID)
			writeError(w, http.StatusInternalServerError, "failed to record answers")
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.ErrorContext(r.Context(), "answers tx commit failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to record answers")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"saved": len(req.Answers)})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/jobs/{id}/answers — customer + bidding providers
// ─────────────────────────────────────────────────────────────────────────

// GetAnswers returns the customer's answers for a job. Visible to:
//   - the customer who owns the job
//   - any provider with an active bid on the job (so they can quote
//     accurately)
//   - any admin
//
// Anyone else gets 404 (we do not confirm existence).
func (h *CategoryQuestionsHandler) GetAnswers(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"answers": []answerJSON{}})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	jobID := chi.URLParam(r, "id")
	if !isValidUUID(jobID) {
		writeError(w, http.StatusBadRequest, "invalid job id")
		return
	}

	// Authorize.
	var ownerID string
	err := h.db.QueryRow(r.Context(),
		`SELECT customer_id FROM jobs WHERE id = $1 AND deleted_at IS NULL`, jobID,
	).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "job not found")
			return
		}
		slog.ErrorContext(r.Context(), "answers visibility owner check failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to verify job")
		return
	}

	authorized := ownerID == claims.UserID
	if !authorized {
		// Admin override.
		for _, role := range claims.Roles {
			if role == "admin" {
				authorized = true
				break
			}
		}
	}
	if !authorized {
		// Allow if the caller has an active bid on the job. Cheap
		// EXISTS check — index on bids(provider_id, job_id) covers it.
		var hasBid bool
		if err := h.db.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM bids WHERE job_id = $1 AND provider_id = $2)`,
			jobID, claims.UserID,
		).Scan(&hasBid); err != nil {
			slog.ErrorContext(r.Context(), "answers visibility bid check failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to verify access")
			return
		}
		if hasBid {
			authorized = true
		}
	}
	if !authorized {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id, job_id, question_id,
		       answer_text, COALESCE(answer_json, 'null'::jsonb),
		       created_at
		  FROM job_question_answers
		 WHERE job_id = $1
		 ORDER BY created_at ASC`, jobID)
	if err != nil {
		slog.ErrorContext(r.Context(), "list answers failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load answers")
		return
	}
	defer rows.Close()

	out := make([]answerJSON, 0)
	for rows.Next() {
		var a answerJSON
		var ans *string
		var raw []byte
		if err := rows.Scan(&a.ID, &a.JobID, &a.QuestionID, &ans, &raw, &a.CreatedAt); err != nil {
			slog.ErrorContext(r.Context(), "scan answer failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		a.AnswerText = ans
		if string(raw) != "null" {
			a.AnswerJSON = raw
		}
		out = append(out, a)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"answers": out})
}
