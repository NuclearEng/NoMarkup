package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// JobHandler handles HTTP endpoints for jobs.
type JobHandler struct {
	jobClient jobv1.JobServiceClient
}

// NewJobHandler creates a new JobHandler.
func NewJobHandler(jobClient jobv1.JobServiceClient) *JobHandler {
	return &JobHandler{jobClient: jobClient}
}

type createJobRequest struct {
	PropertyID           string   `json:"property_id"`
	Title                string   `json:"title"`
	Description          string   `json:"description"`
	CategoryID           string   `json:"category_id"`
	SubcategoryID        string   `json:"subcategory_id"`
	ServiceTypeID        string   `json:"service_type_id"`
	ScheduleType         string   `json:"schedule_type"`
	ScheduledDate        *string  `json:"scheduled_date"`
	ScheduleRangeStart   *string  `json:"schedule_range_start"`
	ScheduleRangeEnd     *string  `json:"schedule_range_end"`
	IsRecurring          bool     `json:"is_recurring"`
	RecurrenceFrequency  string   `json:"recurrence_frequency"`
	StartingBidCents     *int64   `json:"starting_bid_cents"`
	OfferAcceptedCents   *int64   `json:"offer_accepted_cents"`
	AuctionDurationHours int32    `json:"auction_duration_hours"`
	MinProviderRating    *float64 `json:"min_provider_rating"`
	PhotoURLs            []string `json:"photo_urls"`
	TagCategoryIDs       []string `json:"tag_category_ids"`
	Publish              bool     `json:"publish"`
}

type updateJobRequest struct {
	Title                *string  `json:"title,omitempty"`
	Description          *string  `json:"description,omitempty"`
	CategoryID           *string  `json:"category_id,omitempty"`
	SubcategoryID        *string  `json:"subcategory_id,omitempty"`
	ServiceTypeID        *string  `json:"service_type_id,omitempty"`
	ScheduleType         *string  `json:"schedule_type,omitempty"`
	StartingBidCents     *int64   `json:"starting_bid_cents,omitempty"`
	OfferAcceptedCents   *int64   `json:"offer_accepted_cents,omitempty"`
	AuctionDurationHours *int32   `json:"auction_duration_hours,omitempty"`
	PhotoURLs            []string `json:"photo_urls,omitempty"`
}

type cancelJobRequest struct {
	Reason string `json:"reason"`
}

// Create handles POST /api/v1/jobs.
func (h *JobHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req createJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	grpcReq := &jobv1.CreateJobRequest{
		CustomerId:           claims.UserID,
		PropertyId:           req.PropertyID,
		Title:                req.Title,
		Description:          req.Description,
		CategoryId:           req.CategoryID,
		SubcategoryId:        req.SubcategoryID,
		ServiceTypeId:        req.ServiceTypeID,
		ScheduleType:         stringToScheduleType(req.ScheduleType),
		IsRecurring:          req.IsRecurring,
		RecurrenceFrequency:  stringToRecurrenceFrequency(req.RecurrenceFrequency),
		AuctionDurationHours: req.AuctionDurationHours,
		PhotoUrls:            req.PhotoURLs,
		TagCategoryIds:       req.TagCategoryIDs,
		Publish:              req.Publish,
	}

	if req.StartingBidCents != nil {
		grpcReq.StartingBidCents = req.StartingBidCents
	}
	if req.OfferAcceptedCents != nil {
		grpcReq.OfferAcceptedCents = req.OfferAcceptedCents
	}
	if req.MinProviderRating != nil {
		grpcReq.MinProviderRating = req.MinProviderRating
	}
	if req.ScheduledDate != nil {
		if t, err := parseTimestamp(*req.ScheduledDate); err == nil {
			grpcReq.ScheduledDate = t
		}
	}
	if req.ScheduleRangeStart != nil || req.ScheduleRangeEnd != nil {
		grpcReq.ScheduleRange = &commonv1.DateRange{}
		if req.ScheduleRangeStart != nil {
			if t, err := parseTimestamp(*req.ScheduleRangeStart); err == nil {
				grpcReq.ScheduleRange.Start = t
			}
		}
		if req.ScheduleRangeEnd != nil {
			if t, err := parseTimestamp(*req.ScheduleRangeEnd); err == nil {
				grpcReq.ScheduleRange.End = t
			}
		}
	}

	resp, err := h.jobClient.CreateJob(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, protoJobToJSON(resp.GetJob()))
}

// Update handles PATCH /api/v1/jobs/{id}.
func (h *JobHandler) Update(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	var req updateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	grpcReq := &jobv1.UpdateJobRequest{
		JobId:       jobID,
		Title:       req.Title,
		Description: req.Description,
		CategoryId:  req.CategoryID,
	}
	if req.SubcategoryID != nil {
		grpcReq.SubcategoryId = req.SubcategoryID
	}
	if req.ServiceTypeID != nil {
		grpcReq.ServiceTypeId = req.ServiceTypeID
	}
	if req.ScheduleType != nil {
		st := stringToScheduleType(*req.ScheduleType)
		grpcReq.ScheduleType = &st
	}
	if req.StartingBidCents != nil {
		grpcReq.StartingBidCents = req.StartingBidCents
	}
	if req.OfferAcceptedCents != nil {
		grpcReq.OfferAcceptedCents = req.OfferAcceptedCents
	}
	if req.AuctionDurationHours != nil {
		grpcReq.AuctionDurationHours = req.AuctionDurationHours
	}
	if req.PhotoURLs != nil {
		grpcReq.PhotoUrls = req.PhotoURLs
	}

	resp, err := h.jobClient.UpdateJob(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoJobToJSON(resp.GetJob()))
}

// Delete handles DELETE /api/v1/jobs/{id}.
func (h *JobHandler) Delete(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	_, err := h.jobClient.DeleteDraft(r.Context(), &jobv1.DeleteDraftRequest{
		JobId: jobID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Publish handles POST /api/v1/jobs/{id}/publish.
func (h *JobHandler) Publish(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	resp, err := h.jobClient.PublishJob(r.Context(), &jobv1.PublishJobRequest{
		JobId: jobID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoJobToJSON(resp.GetJob()))
}

// Close handles POST /api/v1/jobs/{id}/close.
func (h *JobHandler) Close(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	resp, err := h.jobClient.CloseAuction(r.Context(), &jobv1.CloseAuctionRequest{
		JobId:      jobID,
		CustomerId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoJobToJSON(resp.GetJob()))
}

// Cancel handles POST /api/v1/jobs/{id}/cancel.
func (h *JobHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	var req cancelJobRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	resp, err := h.jobClient.CancelJob(r.Context(), &jobv1.CancelJobRequest{
		JobId:      jobID,
		CustomerId: claims.UserID,
		Reason:     req.Reason,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protoJobToJSON(resp.GetJob()))
}

// Search handles GET /api/v1/jobs (public).
func (h *JobHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	grpcReq := &jobv1.SearchJobsRequest{
		TextQuery: q.Get("q"),
	}

	if catIDs := q.Get("category_ids"); catIDs != "" {
		grpcReq.CategoryIds = splitCommas(catIDs)
	}

	if lat := q.Get("latitude"); lat != "" {
		if lng := q.Get("longitude"); lng != "" {
			latF, _ := strconv.ParseFloat(lat, 64)
			lngF, _ := strconv.ParseFloat(lng, 64)
			grpcReq.Location = &commonv1.Location{
				Latitude:  latF,
				Longitude: lngF,
			}
		}
	}
	if radius := q.Get("radius_km"); radius != "" {
		r, _ := strconv.ParseFloat(radius, 64)
		grpcReq.RadiusKm = r
	}

	if minPrice := q.Get("min_price_cents"); minPrice != "" {
		v, _ := strconv.ParseInt(minPrice, 10, 64)
		grpcReq.MinPriceCents = &v
	}
	if maxPrice := q.Get("max_price_cents"); maxPrice != "" {
		v, _ := strconv.ParseInt(maxPrice, 10, 64)
		grpcReq.MaxPriceCents = &v
	}

	if schedType := q.Get("schedule_type"); schedType != "" {
		st := stringToScheduleType(schedType)
		grpcReq.ScheduleType = &st
	}
	if recurring := q.Get("recurring_only"); recurring == "true" {
		v := true
		grpcReq.RecurringOnly = &v
	}

	if sortField := q.Get("sort"); sortField != "" {
		dir := commonv1.SortDirection_SORT_DIRECTION_ASC
		if q.Get("sort_dir") == "desc" {
			dir = commonv1.SortDirection_SORT_DIRECTION_DESC
		}
		grpcReq.Sort = &commonv1.SortRequest{
			Field:     sortField,
			Direction: dir,
		}
	}

	page := 1
	pageSize := 20
	if p := q.Get("page"); p != "" {
		page, _ = strconv.Atoi(p)
	}
	if ps := q.Get("page_size"); ps != "" {
		pageSize, _ = strconv.Atoi(ps)
	}
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     int32(page),
		PageSize: int32(pageSize),
	}

	resp, err := h.jobClient.SearchJobs(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	jobs := make([]map[string]interface{}, 0, len(resp.GetJobs()))
	for _, j := range resp.GetJobs() {
		jobs = append(jobs, protoJobToJSON(j))
	}

	result := map[string]interface{}{
		"jobs": jobs,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"total_count": pg.GetTotalCount(),
			"page":        pg.GetPage(),
			"page_size":   pg.GetPageSize(),
			"total_pages": pg.GetTotalPages(),
			"has_next":    pg.GetHasNext(),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// GetJob handles GET /api/v1/jobs/{id} (public with optional auth).
func (h *JobHandler) GetJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	if jobID == "" {
		writeError(w, http.StatusBadRequest, "job id required")
		return
	}

	requestingUserID := ""
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		requestingUserID = claims.UserID
	}

	resp, err := h.jobClient.GetJob(r.Context(), &jobv1.GetJobRequest{
		JobId:            jobID,
		RequestingUserId: requestingUserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	detail := resp.GetJob()
	result := protoJobToJSON(detail.GetJob())

	if ea := detail.GetExactAddress(); ea != nil {
		result["exact_address"] = map[string]interface{}{
			"street":   ea.GetStreet(),
			"city":     ea.GetCity(),
			"state":    ea.GetState(),
			"zip_code": ea.GetZipCode(),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// ListMine handles GET /api/v1/jobs/mine.
func (h *JobHandler) ListMine(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()
	grpcReq := &jobv1.ListCustomerJobsRequest{
		CustomerId: claims.UserID,
	}

	if statusStr := q.Get("status"); statusStr != "" {
		st := stringToJobStatus(statusStr)
		grpcReq.StatusFilter = &st
	}
	if propID := q.Get("property_id"); propID != "" {
		grpcReq.PropertyId = &propID
	}

	page := 1
	pageSize := 20
	if p := q.Get("page"); p != "" {
		page, _ = strconv.Atoi(p)
	}
	if ps := q.Get("page_size"); ps != "" {
		pageSize, _ = strconv.Atoi(ps)
	}
	grpcReq.Pagination = &commonv1.PaginationRequest{
		Page:     int32(page),
		PageSize: int32(pageSize),
	}

	resp, err := h.jobClient.ListCustomerJobs(r.Context(), grpcReq)
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	jobs := make([]map[string]interface{}, 0, len(resp.GetJobs()))
	for _, j := range resp.GetJobs() {
		jobs = append(jobs, protoJobToJSON(j))
	}

	result := map[string]interface{}{
		"jobs": jobs,
	}
	if pg := resp.GetPagination(); pg != nil {
		result["pagination"] = map[string]interface{}{
			"total_count": pg.GetTotalCount(),
			"page":        pg.GetPage(),
			"page_size":   pg.GetPageSize(),
			"total_pages": pg.GetTotalPages(),
			"has_next":    pg.GetHasNext(),
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// ListDrafts handles GET /api/v1/jobs/drafts.
func (h *JobHandler) ListDrafts(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	resp, err := h.jobClient.ListDrafts(r.Context(), &jobv1.ListDraftsRequest{
		CustomerId: claims.UserID,
	})
	if err != nil {
		writeGRPCError(w, err)
		return
	}

	drafts := make([]map[string]interface{}, 0, len(resp.GetDrafts()))
	for _, d := range resp.GetDrafts() {
		drafts = append(drafts, protoJobToJSON(d))
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"drafts": drafts})
}

// protoJobToJSON converts a proto Job to a JSON-friendly map.
func protoJobToJSON(j *jobv1.Job) map[string]interface{} {
	if j == nil {
		return nil
	}

	result := map[string]interface{}{
		"id":                     j.GetId(),
		"customer_id":            j.GetCustomerId(),
		"title":                  j.GetTitle(),
		"description":            j.GetDescription(),
		"status":                 jobStatusToString(j.GetStatus()),
		"schedule_type":          scheduleTypeToString(j.GetScheduleType()),
		"is_recurring":           j.GetIsRecurring(),
		"auction_duration_hours": j.GetAuctionDurationHours(),
		"bid_count":              j.GetBidCount(),
		"repost_count":           j.GetRepostCount(),
		"photo_urls":             j.GetPhotoUrls(),
		"created_at":             formatTimestamp(j.GetCreatedAt()),
	}

	if j.GetPropertyId() != "" {
		result["property_id"] = j.GetPropertyId()
	}
	if j.GetAwardedProviderId() != "" {
		result["awarded_provider_id"] = j.GetAwardedProviderId()
	}
	if j.GetRepostedFromId() != "" {
		result["reposted_from_id"] = j.GetRepostedFromId()
	}

	// Category.
	if cat := j.GetCategory(); cat != nil {
		result["category"] = map[string]interface{}{
			"id": cat.GetId(), "name": cat.GetName(), "slug": cat.GetSlug(), "icon": cat.GetIcon(),
		}
	}
	if sub := j.GetSubcategory(); sub != nil {
		result["subcategory"] = map[string]interface{}{
			"id": sub.GetId(), "name": sub.GetName(), "slug": sub.GetSlug(), "icon": sub.GetIcon(),
		}
	}
	if st := j.GetServiceType(); st != nil {
		result["service_type"] = map[string]interface{}{
			"id": st.GetId(), "name": st.GetName(), "slug": st.GetSlug(), "icon": st.GetIcon(),
		}
	}

	// Address.
	if addr := j.GetApproximateAddress(); addr != nil {
		result["approximate_address"] = map[string]interface{}{
			"city": addr.GetCity(), "state": addr.GetState(), "zip_code": addr.GetZipCode(),
		}
	}

	// Schedule details.
	if j.GetScheduledDate() != nil {
		result["scheduled_date"] = formatTimestamp(j.GetScheduledDate())
	}
	if sr := j.GetScheduleRange(); sr != nil {
		result["schedule_range"] = map[string]interface{}{
			"start": formatTimestamp(sr.GetStart()),
			"end":   formatTimestamp(sr.GetEnd()),
		}
	}
	if j.GetRecurrenceFrequency() != commonv1.RecurrenceFrequency_RECURRENCE_FREQUENCY_UNSPECIFIED {
		result["recurrence_frequency"] = recurrenceFrequencyToString(j.GetRecurrenceFrequency())
	}

	// Auction.
	if j.StartingBidCents != nil {
		result["starting_bid_cents"] = j.GetStartingBidCents()
	}
	if j.OfferAcceptedCents != nil {
		result["offer_accepted_cents"] = j.GetOfferAcceptedCents()
	}
	if j.GetAuctionEndsAt() != nil {
		result["auction_ends_at"] = formatTimestamp(j.GetAuctionEndsAt())
	}
	if j.MinProviderRating != nil {
		result["min_provider_rating"] = j.GetMinProviderRating()
	}

	// Market range.
	if mr := j.GetMarketRange(); mr != nil {
		result["market_range"] = map[string]interface{}{
			"low_cents":    mr.GetLowCents(),
			"median_cents": mr.GetMedianCents(),
			"high_cents":   mr.GetHighCents(),
			"data_points":  mr.GetDataPoints(),
			"source":       mr.GetSource(),
			"confidence":   mr.GetConfidence(),
		}
	}

	// Timestamps.
	if j.GetAuctionClosedAt() != nil {
		result["auction_closed_at"] = formatTimestamp(j.GetAuctionClosedAt())
	}
	if j.GetAwardedAt() != nil {
		result["awarded_at"] = formatTimestamp(j.GetAwardedAt())
	}
	if j.GetCompletedAt() != nil {
		result["completed_at"] = formatTimestamp(j.GetCompletedAt())
	}

	return result
}

func stringToScheduleType(s string) commonv1.ScheduleType {
	switch s {
	case "specific_date":
		return commonv1.ScheduleType_SCHEDULE_TYPE_SPECIFIC_DATE
	case "date_range":
		return commonv1.ScheduleType_SCHEDULE_TYPE_DATE_RANGE
	case "flexible":
		return commonv1.ScheduleType_SCHEDULE_TYPE_FLEXIBLE
	default:
		return commonv1.ScheduleType_SCHEDULE_TYPE_UNSPECIFIED
	}
}

func scheduleTypeToString(st commonv1.ScheduleType) string {
	switch st {
	case commonv1.ScheduleType_SCHEDULE_TYPE_SPECIFIC_DATE:
		return "specific_date"
	case commonv1.ScheduleType_SCHEDULE_TYPE_DATE_RANGE:
		return "date_range"
	case commonv1.ScheduleType_SCHEDULE_TYPE_FLEXIBLE:
		return "flexible"
	default:
		return "unspecified"
	}
}

func stringToRecurrenceFrequency(s string) commonv1.RecurrenceFrequency {
	switch s {
	case "weekly":
		return commonv1.RecurrenceFrequency_RECURRENCE_FREQUENCY_WEEKLY
	case "biweekly":
		return commonv1.RecurrenceFrequency_RECURRENCE_FREQUENCY_BIWEEKLY
	case "monthly":
		return commonv1.RecurrenceFrequency_RECURRENCE_FREQUENCY_MONTHLY
	default:
		return commonv1.RecurrenceFrequency_RECURRENCE_FREQUENCY_UNSPECIFIED
	}
}

func recurrenceFrequencyToString(r commonv1.RecurrenceFrequency) string {
	switch r {
	case commonv1.RecurrenceFrequency_RECURRENCE_FREQUENCY_WEEKLY:
		return "weekly"
	case commonv1.RecurrenceFrequency_RECURRENCE_FREQUENCY_BIWEEKLY:
		return "biweekly"
	case commonv1.RecurrenceFrequency_RECURRENCE_FREQUENCY_MONTHLY:
		return "monthly"
	default:
		return ""
	}
}

func stringToJobStatus(s string) jobv1.JobStatus {
	switch s {
	case "draft":
		return jobv1.JobStatus_JOB_STATUS_DRAFT
	case "active":
		return jobv1.JobStatus_JOB_STATUS_ACTIVE
	case "closed":
		return jobv1.JobStatus_JOB_STATUS_CLOSED
	case "closed_zero_bids":
		return jobv1.JobStatus_JOB_STATUS_CLOSED_ZERO_BIDS
	case "awarded":
		return jobv1.JobStatus_JOB_STATUS_AWARDED
	case "contract_pending":
		return jobv1.JobStatus_JOB_STATUS_CONTRACT_PENDING
	case "in_progress":
		return jobv1.JobStatus_JOB_STATUS_IN_PROGRESS
	case "completed":
		return jobv1.JobStatus_JOB_STATUS_COMPLETED
	case "reviewed":
		return jobv1.JobStatus_JOB_STATUS_REVIEWED
	case "cancelled":
		return jobv1.JobStatus_JOB_STATUS_CANCELLED
	case "reposted":
		return jobv1.JobStatus_JOB_STATUS_REPOSTED
	case "expired":
		return jobv1.JobStatus_JOB_STATUS_EXPIRED
	case "suspended":
		return jobv1.JobStatus_JOB_STATUS_SUSPENDED
	default:
		return jobv1.JobStatus_JOB_STATUS_UNSPECIFIED
	}
}

func jobStatusToString(s jobv1.JobStatus) string {
	switch s {
	case jobv1.JobStatus_JOB_STATUS_DRAFT:
		return "draft"
	case jobv1.JobStatus_JOB_STATUS_ACTIVE:
		return "active"
	case jobv1.JobStatus_JOB_STATUS_CLOSED:
		return "closed"
	case jobv1.JobStatus_JOB_STATUS_CLOSED_ZERO_BIDS:
		return "closed_zero_bids"
	case jobv1.JobStatus_JOB_STATUS_AWARDED:
		return "awarded"
	case jobv1.JobStatus_JOB_STATUS_CONTRACT_PENDING:
		return "contract_pending"
	case jobv1.JobStatus_JOB_STATUS_IN_PROGRESS:
		return "in_progress"
	case jobv1.JobStatus_JOB_STATUS_COMPLETED:
		return "completed"
	case jobv1.JobStatus_JOB_STATUS_REVIEWED:
		return "reviewed"
	case jobv1.JobStatus_JOB_STATUS_CANCELLED:
		return "cancelled"
	case jobv1.JobStatus_JOB_STATUS_REPOSTED:
		return "reposted"
	case jobv1.JobStatus_JOB_STATUS_EXPIRED:
		return "expired"
	case jobv1.JobStatus_JOB_STATUS_SUSPENDED:
		return "suspended"
	default:
		return "unspecified"
	}
}

func parseTimestamp(s string) (*timestamppb.Timestamp, error) {
	layouts := []string{
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05-07:00",
		"2006-01-02",
	}
	for _, layout := range layouts {
		t, err := time.Parse(layout, s)
		if err == nil {
			return timestamppb.New(t), nil
		}
	}
	return nil, fmt.Errorf("unable to parse timestamp: %s", s)
}

func splitCommas(s string) []string {
	parts := make([]string, 0)
	for _, p := range splitString(s, ',') {
		trimmed := trimSpace(p)
		if trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	return parts
}

func splitString(s string, sep byte) []string {
	var result []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == sep {
			result = append(result, s[start:i])
			start = i + 1
		}
	}
	result = append(result, s[start:])
	return result
}

func trimSpace(s string) string {
	start := 0
	for start < len(s) && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	end := len(s)
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}
