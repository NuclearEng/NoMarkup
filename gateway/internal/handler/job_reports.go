package handler

// Job-level abuse reports (ASR-1.2.b). Closes the UGC-safety gap where only
// listings (CreateReport in admin_marketplace.go) and users (user_reports.go)
// could be flagged, leaving no path to report a job post.
//
// Mirrors listing_reports intake: optional auth, reason whitelist, owner
// cannot report their own job, idempotent already_reported, INSERT returning
// id. Persists to job_reports (migration 130). Auto-hide is a DB trigger
// (attributable reporters only — anonymous reports never auto-hide).
//
// Routes:
//
//   POST /api/v1/jobs/{id}/report                  CreateJobReport (optionalAuth)
//   GET  /api/v1/admin/job-reports                 ListJobReports  (admin)
//   POST /api/v1/admin/job-reports/{id}/resolve    ResolveJobReport (admin)

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// JobReportsHandler exposes job-report intake, admin list, and admin resolve.
// A nil db short-circuits every endpoint (503 on writes, empty list on reads).
type JobReportsHandler struct {
	db *pgxpool.Pool
}

// NewJobReportsHandler returns a JobReportsHandler.
func NewJobReportsHandler(db *pgxpool.Pool) *JobReportsHandler {
	return &JobReportsHandler{db: db}
}

// validJobReportReasons mirrors the CHECK constraint in migration 130.
// Jobs are not stolen/counterfeit (those are goods-only listing reasons).
var validJobReportReasons = map[string]struct{}{
	"prohibited": {},
	"misleading": {},
	"spam":       {},
	"scam":       {},
	"harassment": {},
	"other":      {},
}

// CreateJobReport handles POST /api/v1/jobs/{id}/report.
//
// Public-ish (rate-limited at the gateway). Anyone — including unauthenticated
// visitors — can flag a job. Wrapped in optionalAuth so a signed-in caller
// actually gets claims. Only attributable reports count toward auto-hide
// (migration 130, same rule as listing reports / 074).
func (h *JobReportsHandler) CreateJobReport(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	if !isValidUUID(jobID) {
		writeError(w, http.StatusBadRequest, "invalid job id")
		return
	}

	var body struct {
		Reason      string `json:"reason"`
		Description string `json:"description"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if _, ok := validJobReportReasons[body.Reason]; !ok {
		writeError(w, http.StatusBadRequest, "reason must be prohibited|misleading|spam|scam|harassment|other")
		return
	}
	if len(body.Description) > 2000 {
		body.Description = body.Description[:2000]
	}

	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "reporting unavailable")
		return
	}

	customerID, err := h.lookupJobCustomer(r.Context(), jobID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "job not found")
			return
		}
		slog.ErrorContext(r.Context(), "create job report: existence check failed", "error", err, "id", jobID)
		writeError(w, http.StatusInternalServerError, "failed to create report")
		return
	}

	var reporterID *string
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		uid := claims.UserID
		reporterID = &uid
		if uid == customerID {
			writeError(w, http.StatusForbidden, "you cannot report your own job")
			return
		}
	}

	// Fast-path duplicate check. uq_job_reports_open_reporter is the
	// authority — the read-then-write is racy on its own, so INSERT also
	// handles the unique violation as idempotent already_reported.
	if reporterID != nil {
		already, dupErr := h.hasOpenReport(r.Context(), jobID, *reporterID)
		if dupErr != nil {
			slog.ErrorContext(r.Context(), "create job report: duplicate check failed", "error", dupErr, "id", jobID)
			writeError(w, http.StatusInternalServerError, "failed to create report")
			return
		}
		if already {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status":  "already_reported",
				"message": "you've already flagged this job",
			})
			return
		}
	}

	id, err := h.insertReport(r.Context(), jobID, reporterID, body.Reason, body.Description, clientIP(r))
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status":  "already_reported",
				"message": "you've already flagged this job",
			})
			return
		}
		slog.ErrorContext(r.Context(), "create job report failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create report")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":     id,
		"status": "open",
	})
}

func (h *JobReportsHandler) lookupJobCustomer(ctx context.Context, jobID string) (string, error) {
	var customerID string
	err := h.db.QueryRow(ctx,
		`SELECT customer_id::text FROM jobs WHERE id = $1`, jobID,
	).Scan(&customerID)
	if err != nil {
		return "", fmt.Errorf("lookup job %s: %w", jobID, err)
	}
	return customerID, nil
}

func (h *JobReportsHandler) hasOpenReport(ctx context.Context, jobID, reporterID string) (bool, error) {
	var exists bool
	err := h.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM job_reports
			 WHERE job_id = $1 AND reporter_id = $2 AND status = 'open'
		)`, jobID, reporterID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check open job report: %w", err)
	}
	return exists, nil
}

func (h *JobReportsHandler) insertReport(
	ctx context.Context,
	jobID string,
	reporterID *string,
	reason, description string,
	ip interface{},
) (string, error) {
	var id string
	err := h.db.QueryRow(ctx, `
		INSERT INTO job_reports (job_id, reporter_id, reason, description, ip_address)
		VALUES ($1, $2, $3, $4, $5::inet)
		RETURNING id`,
		jobID, reporterID, reason, description, ip,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insert job report: %w", err)
	}
	return id, nil
}

type adminJobReport struct {
	ID            string     `json:"id"`
	JobID         string     `json:"job_id"`
	JobTitle      string     `json:"job_title"`
	ReporterID    *string    `json:"reporter_id,omitempty"`
	ReporterEmail *string    `json:"reporter_email,omitempty"`
	Reason        string     `json:"reason"`
	Description   string     `json:"description"`
	Status        string     `json:"status"`
	Resolution    *string    `json:"resolution,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	ReviewedAt    *time.Time `json:"reviewed_at,omitempty"`
}

// ListJobReports handles GET /api/v1/admin/job-reports.
// Query params: status, job_id, page, page_size.
func (h *JobReportsHandler) ListJobReports(w http.ResponseWriter, r *http.Request) {
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
		where += " AND jr.status = $" + itoa(len(args))
	}
	if jobID := q.Get("job_id"); jobID != "" && isValidUUID(jobID) {
		args = append(args, jobID)
		where += " AND jr.job_id = $" + itoa(len(args))
	}

	var total int
	if err := h.db.QueryRow(r.Context(),
		"SELECT COUNT(*) FROM job_reports jr WHERE "+where, args...).Scan(&total); err != nil {
		slog.ErrorContext(r.Context(), "admin job reports count failed", "error", fmt.Errorf("count job reports: %w", err))
		writeError(w, http.StatusInternalServerError, "failed to count reports")
		return
	}

	args = append(args, pageSize, (page-1)*pageSize)
	limitArg := itoa(len(args) - 1)
	offsetArg := itoa(len(args))

	rows, err := h.db.Query(r.Context(), `
		SELECT jr.id, jr.job_id, j.title,
			jr.reporter_id, u.email,
			jr.reason, jr.description, jr.status, jr.resolution,
			jr.created_at, jr.reviewed_at
		  FROM job_reports jr
		  LEFT JOIN jobs j ON j.id = jr.job_id
		  LEFT JOIN users u ON u.id = jr.reporter_id
		 WHERE `+where+`
		 ORDER BY jr.created_at DESC
		 LIMIT $`+limitArg+` OFFSET $`+offsetArg, args...)
	if err != nil {
		slog.ErrorContext(r.Context(), "admin job reports query failed", "error", fmt.Errorf("list job reports: %w", err))
		writeError(w, http.StatusInternalServerError, "failed to list reports")
		return
	}
	defer rows.Close()

	out := make([]adminJobReport, 0)
	for rows.Next() {
		var rpt adminJobReport
		if err := rows.Scan(&rpt.ID, &rpt.JobID, &rpt.JobTitle,
			&rpt.ReporterID, &rpt.ReporterEmail,
			&rpt.Reason, &rpt.Description, &rpt.Status, &rpt.Resolution,
			&rpt.CreatedAt, &rpt.ReviewedAt); err != nil {
			slog.ErrorContext(r.Context(), "admin job reports scan failed", "error", fmt.Errorf("scan job report: %w", err))
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

// ResolveJobReport handles POST /api/v1/admin/job-reports/{id}/resolve.
// Body: { "action": "dismiss" | "actioned" | "review", "notes": "..." }
//
// Same semantics as AdminMarketplaceHandler.ResolveReport: parameterized
// UPDATE, terminal states (dismissed/actioned) are immutable (409), missing
// rows 404. 'reviewed' is intermediate and may still advance. Dismissing so
// open reports drop below 3 does not undelete the job — auto-hide is
// one-way (safer; deleted_at is already set at 3 attributable reports).
func (h *JobReportsHandler) ResolveJobReport(w http.ResponseWriter, r *http.Request) {
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

	// Only resolve a report that is not already in a terminal state. Without
	// this, a second resolve silently overwrites the prior resolution,
	// reviewed_by, and reviewed_at — letting one admin's verdict be replaced with
	// no audit trail. 'reviewed' is intermediate and may still advance.
	tag, err := h.db.Exec(r.Context(), `
		UPDATE job_reports
		   SET status = $1, reviewed_by = $2, reviewed_at = now(),
		       resolution = $3, updated_at = now()
		 WHERE id = $4 AND status NOT IN ('dismissed', 'actioned')`,
		newStatus, claims.UserID, body.Notes, id)
	if err != nil {
		slog.ErrorContext(r.Context(), "admin resolve job report failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to resolve")
		return
	}
	if tag.RowsAffected() == 0 {
		// Either the report doesn't exist (404) or it's already terminal (409).
		var exists bool
		if e := h.db.QueryRow(r.Context(),
			`SELECT EXISTS (SELECT 1 FROM job_reports WHERE id = $1)`, id).Scan(&exists); e != nil {
			slog.ErrorContext(r.Context(), "admin resolve job report existence check failed", "error", e)
			writeError(w, http.StatusInternalServerError, "failed to resolve")
			return
		}
		if !exists {
			writeError(w, http.StatusNotFound, "report not found")
			return
		}
		writeError(w, http.StatusConflict, "report already resolved")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"report_id": id,
		"status":    newStatus,
	})
}
