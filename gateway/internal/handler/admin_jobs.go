package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminJobsHandler handles admin job management endpoints.
type AdminJobsHandler struct {
	jobClient jobv1.JobServiceClient
}

// NewAdminJobsHandler creates a new AdminJobsHandler.
func NewAdminJobsHandler(jobClient jobv1.JobServiceClient) *AdminJobsHandler {
	return &AdminJobsHandler{jobClient: jobClient}
}

// ListJobs handles GET /api/v1/admin/jobs.
// Query params: status, customer_id, category_id, page, page_size.
func (h *AdminJobsHandler) ListJobs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &jobv1.AdminListJobsRequest{}

	// Parse optional status filter.
	if s := q.Get("status"); s != "" {
		status := parseJobStatus(s)
		if status != jobv1.JobStatus_JOB_STATUS_UNSPECIFIED {
			grpcReq.StatusFilter = &status
		}
	}

	// Parse optional customer_id filter.
	if cid := q.Get("customer_id"); cid != "" {
		grpcReq.CustomerId = &cid
	}

	// Parse optional category_id filter.
	if catID := q.Get("category_id"); catID != "" {
		grpcReq.CategoryId = &catID
	}

	// Parse pagination.
	page := int32(1)
	pageSize := int32(20)
	if p := q.Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = int32(v)
		}
	}
	if ps := q.Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 {
			pageSize = int32(v)
		}
	}
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     page,
		PageSize: pageSize,
	}

	resp, err := h.jobClient.AdminListJobs(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	jobs := make([]map[string]interface{}, 0, len(resp.GetJobs()))
	for _, j := range resp.GetJobs() {
		jobs = append(jobs, adminJobToJSON(j))
	}

	result := map[string]interface{}{
		"jobs": jobs,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = paginationToJSON(pg)
	}

	writeJSON(w, http.StatusOK, result)
}

// SuspendJob handles POST /api/v1/admin/jobs/{id}/suspend.
func (h *AdminJobsHandler) SuspendJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason is required")
		return
	}

	resp, err := h.jobClient.AdminSuspendJob(r.Context(), &jobv1.AdminSuspendJobRequest{
		JobId:   jobID,
		Reason:  body.Reason,
		AdminId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"job": adminJobToJSON(resp.GetJob()),
	})
}

// RemoveJob handles POST /api/v1/admin/jobs/{id}/remove.
func (h *AdminJobsHandler) RemoveJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason is required")
		return
	}

	_, err := h.jobClient.AdminRemoveJob(r.Context(), &jobv1.AdminRemoveJobRequest{
		JobId:   jobID,
		Reason:  body.Reason,
		AdminId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message": "job removed",
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func adminJobToJSON(j *jobv1.Job) map[string]interface{} {
	if j == nil {
		return map[string]interface{}{}
	}
	result := map[string]interface{}{
		"id":                 j.GetId(),
		"title":              j.GetTitle(),
		"description":        j.GetDescription(),
		"customer_id":        j.GetCustomerId(),
		"status":             j.GetStatus().String(),
		"starting_bid_cents": j.GetStartingBidCents(),
		"bid_count":          j.GetBidCount(),
		"created_at":         formatTimestamp(j.GetCreatedAt()),
	}
	if cat := j.GetCategory(); cat != nil {
		result["category_id"] = cat.GetId()
		result["category_name"] = cat.GetName()
	}
	if j.GetAuctionEndsAt() != nil {
		result["auction_ends_at"] = formatTimestamp(j.GetAuctionEndsAt())
	}
	return result
}

func parseJobStatus(s string) jobv1.JobStatus {
	switch s {
	case "draft":
		return jobv1.JobStatus_JOB_STATUS_DRAFT
	case "active":
		return jobv1.JobStatus_JOB_STATUS_ACTIVE
	case "closed":
		return jobv1.JobStatus_JOB_STATUS_CLOSED
	case "awarded":
		return jobv1.JobStatus_JOB_STATUS_AWARDED
	case "in_progress":
		return jobv1.JobStatus_JOB_STATUS_IN_PROGRESS
	case "completed":
		return jobv1.JobStatus_JOB_STATUS_COMPLETED
	case "cancelled":
		return jobv1.JobStatus_JOB_STATUS_CANCELLED
	case "suspended":
		return jobv1.JobStatus_JOB_STATUS_SUSPENDED
	case "expired":
		return jobv1.JobStatus_JOB_STATUS_EXPIRED
	default:
		return jobv1.JobStatus_JOB_STATUS_UNSPECIFIED
	}
}
