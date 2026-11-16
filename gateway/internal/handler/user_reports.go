package handler

// User & message abuse reports — closes the user-safety gap where only
// listings could be flagged (CreateReport in admin_marketplace.go), leaving
// no path to report an abusive USER or a harassing MESSAGE to moderation.
//
// Reuses the moderation model established by listing_reports (migration 036):
// the same open→reviewed→actioned→dismissed lifecycle and the same admin
// resolve shape, so reports surface in (and are actioned from) the existing
// admin moderation surface. Persists to user_reports (migration 067).
//
// Routes:
//
//   POST /api/v1/users/{id}/report          CreateUserReport (auth, owner-scoped)
//   GET  /api/v1/admin/user-reports         ListUserReports  (admin)
//   POST /api/v1/admin/user-reports/{id}/resolve  ResolveUserReport (admin)

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// UserReportsHandler exposes the user/message abuse-report surface plus the
// admin moderation queue for those reports. A nil db short-circuits every
// endpoint (503 on writes, empty list on reads) — same posture as
// AdminMarketplaceHandler.
type UserReportsHandler struct {
	db *pgxpool.Pool
}

// NewUserReportsHandler returns a UserReportsHandler.
func NewUserReportsHandler(db *pgxpool.Pool) *UserReportsHandler {
	return &UserReportsHandler{db: db}
}

// validUserReportReasons mirrors the CHECK constraint in migration 067.
var validUserReportReasons = map[string]struct{}{
	"harassment":    {},
	"spam":          {},
	"scam":          {},
	"inappropriate": {},
	"other":         {},
}

// CreateUserReport handles POST /api/v1/users/{id}/report.
//
// Owner-scoped: the reporter is always the authed user (never client-supplied),
// you cannot report yourself (400), and the same reporter cannot open a second
// OPEN report against the same target/message (a partial UNIQUE index dedups —
// we surface that as an idempotent "already_reported" 200 rather than a 409).
func (h *UserReportsHandler) CreateUserReport(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "reporting unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	targetID := chi.URLParam(r, "id")
	if !isValidUUID(targetID) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if targetID == claims.UserID {
		writeError(w, http.StatusBadRequest, "you cannot report yourself")
		return
	}

	var body struct {
		Reason      string `json:"reason"`
		Description string `json:"description"`
		ChannelID   string `json:"channel_id"`
		MessageID   string `json:"message_id"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if _, ok := validUserReportReasons[body.Reason]; !ok {
		writeError(w, http.StatusBadRequest, "reason must be harassment|spam|scam|inappropriate|other")
		return
	}
	if len(body.Description) > 2000 {
		body.Description = body.Description[:2000]
	}

	// Optional chat context — only accept well-formed UUIDs, else store NULL.
	var channelID, messageID *string
	if body.ChannelID != "" && isValidUUID(body.ChannelID) {
		c := body.ChannelID
		channelID = &c
	}
	if body.MessageID != "" && isValidUUID(body.MessageID) {
		m := body.MessageID
		messageID = &m
	}

	// Verify the target exists — clearer than swallowing an FK violation.
	var exists bool
	if err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, targetID,
	).Scan(&exists); err != nil {
		slog.ErrorContext(r.Context(), "user report: target existence check failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to verify user")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	// Insert. ON CONFLICT against the partial-unique OPEN-report indexes makes
	// a duplicate flag a no-op so a single user can't spam-report the same
	// target while a prior report is still open.
	var id string
	err := h.db.QueryRow(r.Context(), `
		INSERT INTO user_reports
			(reporter_id, reported_user_id, channel_id, message_id, reason, description)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT DO NOTHING
		RETURNING id`,
		claims.UserID, targetID, channelID, messageID, body.Reason, body.Description,
	).Scan(&id)
	if err != nil {
		// pgx returns ErrNoRows when ON CONFLICT DO NOTHING suppressed the
		// insert — i.e. an open report from this reporter already exists.
		if err.Error() == "no rows in result set" {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status":  "already_reported",
				"message": "you've already reported this; our team is reviewing it",
			})
			return
		}
		slog.ErrorContext(r.Context(), "create user report failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create report")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":     id,
		"status": "open",
	})
}

type adminUserReport struct {
	ID              string     `json:"id"`
	ReporterID      string     `json:"reporter_id"`
	ReporterEmail   *string    `json:"reporter_email,omitempty"`
	ReportedUserID  string     `json:"reported_user_id"`
	ReportedEmail   *string    `json:"reported_user_email,omitempty"`
	ChannelID       *string    `json:"channel_id,omitempty"`
	MessageID       *string    `json:"message_id,omitempty"`
	Reason          string     `json:"reason"`
	Description     string     `json:"description"`
	Status          string     `json:"status"`
	Resolution      *string    `json:"resolution,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	ReviewedAt      *time.Time `json:"reviewed_at,omitempty"`
}

// ListUserReports handles GET /api/v1/admin/user-reports.
// Query params: status, reported_user_id, page, page_size.
func (h *UserReportsHandler) ListUserReports(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"reports": []interface{}{}})
		return
	}

	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 20, 100)

	args := []interface{}{}
	where := "1=1"
	if s := q.Get("status"); s != "" {
		args = append(args, s)
		where += " AND ur.status = $" + itoa(len(args))
	}
	if t := q.Get("reported_user_id"); t != "" && isValidUUID(t) {
		args = append(args, t)
		where += " AND ur.reported_user_id = $" + itoa(len(args))
	}

	var total int
	if err := h.db.QueryRow(r.Context(),
		"SELECT COUNT(*) FROM user_reports ur WHERE "+where, args...).Scan(&total); err != nil {
		slog.ErrorContext(r.Context(), "admin user reports count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count reports")
		return
	}

	args = append(args, pageSize, (page-1)*pageSize)
	limitArg := itoa(len(args) - 1)
	offsetArg := itoa(len(args))

	rows, err := h.db.Query(r.Context(), `
		SELECT ur.id, ur.reporter_id, ru.email,
			ur.reported_user_id, tu.email,
			ur.channel_id, ur.message_id,
			ur.reason, ur.description, ur.status, ur.resolution,
			ur.created_at, ur.reviewed_at
		  FROM user_reports ur
		  LEFT JOIN users ru ON ru.id = ur.reporter_id
		  LEFT JOIN users tu ON tu.id = ur.reported_user_id
		 WHERE `+where+`
		 ORDER BY ur.created_at DESC
		 LIMIT $`+limitArg+` OFFSET $`+offsetArg, args...)
	if err != nil {
		slog.ErrorContext(r.Context(), "admin user reports query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list reports")
		return
	}
	defer rows.Close()

	out := make([]adminUserReport, 0)
	for rows.Next() {
		var rpt adminUserReport
		if err := rows.Scan(&rpt.ID, &rpt.ReporterID, &rpt.ReporterEmail,
			&rpt.ReportedUserID, &rpt.ReportedEmail,
			&rpt.ChannelID, &rpt.MessageID,
			&rpt.Reason, &rpt.Description, &rpt.Status, &rpt.Resolution,
			&rpt.CreatedAt, &rpt.ReviewedAt); err != nil {
			slog.ErrorContext(r.Context(), "admin user reports scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, rpt)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"reports": out,
		"pagination": map[string]interface{}{
			"page":      page,
			"page_size": pageSize,
			"total":     total,
		},
	})
}

// ResolveUserReport handles POST /api/v1/admin/user-reports/{id}/resolve.
// Body: { "action": "dismiss" | "actioned" | "review", "notes": "..." }
func (h *UserReportsHandler) ResolveUserReport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid report id")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "reporting unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	var body struct {
		Action string `json:"action"`
		Notes  string `json:"notes"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}

	var newStatus string
	switch body.Action {
	case "dismiss":
		newStatus = "dismissed"
	case "actioned":
		newStatus = "actioned"
	case "review":
		newStatus = "reviewed"
	default:
		writeError(w, http.StatusBadRequest, "action must be dismiss|actioned|review")
		return
	}

	tag, err := h.db.Exec(r.Context(), `
		UPDATE user_reports
		   SET status = $1, reviewed_by = $2, reviewed_at = now(),
		       resolution = $3, updated_at = now()
		 WHERE id = $4`, newStatus, claims.UserID, body.Notes, id)
	if err != nil {
		slog.ErrorContext(r.Context(), "admin resolve user report failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to resolve")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "report not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"report_id": id,
		"status":    newStatus,
	})
}
