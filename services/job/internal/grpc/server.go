package grpc

import (
	"context"
	"errors"
	"strings"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	jobv1 "github.com/nomarkup/nomarkup/proto/job/v1"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/service"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Server implements the JobService gRPC server.
type Server struct {
	jobv1.UnimplementedJobServiceServer
	svc *service.JobService
}

// NewServer creates a new gRPC server for the job service.
func NewServer(svc *service.JobService) *Server {
	return &Server{svc: svc}
}

// Register registers the job service with a gRPC server.
func Register(s *grpclib.Server, srv *Server) {
	jobv1.RegisterJobServiceServer(s, srv)
}

func (s *Server) CreateJob(ctx context.Context, req *jobv1.CreateJobRequest) (*jobv1.CreateJobResponse, error) {
	input := domain.CreateJobInput{
		CustomerID:           req.GetCustomerId(),
		PropertyID:           req.GetPropertyId(),
		Title:                req.GetTitle(),
		Description:          req.GetDescription(),
		CategoryID:           req.GetCategoryId(),
		SubcategoryID:        req.GetSubcategoryId(),
		ServiceTypeID:        req.GetServiceTypeId(),
		ScheduleType:         protoScheduleTypeToString(req.GetScheduleType()),
		IsRecurring:          req.GetIsRecurring(),
		AuctionDurationHours: int(req.GetAuctionDurationHours()),
		PhotoURLs:            req.GetPhotoUrls(),
		TagCategoryIDs:       req.GetTagCategoryIds(),
		Publish:              req.GetPublish(),
	}

	if req.GetScheduledDate() != nil {
		t := req.GetScheduledDate().AsTime()
		input.ScheduledDate = &t
	}
	if req.GetScheduleRange() != nil {
		if req.GetScheduleRange().GetStart() != nil {
			t := req.GetScheduleRange().GetStart().AsTime()
			input.ScheduleRangeStart = &t
		}
		if req.GetScheduleRange().GetEnd() != nil {
			t := req.GetScheduleRange().GetEnd().AsTime()
			input.ScheduleRangeEnd = &t
		}
	}
	if req.GetRecurrenceFrequency() != commonv1.RecurrenceFrequency_RECURRENCE_FREQUENCY_UNSPECIFIED {
		freq := protoRecurrenceToString(req.GetRecurrenceFrequency())
		input.RecurrenceFrequency = &freq
	}
	if req.StartingBidCents != nil {
		v := req.GetStartingBidCents()
		input.StartingBidCents = &v
	}
	if req.OfferAcceptedCents != nil {
		v := req.GetOfferAcceptedCents()
		input.OfferAcceptedCents = &v
	}
	if req.MinProviderRating != nil {
		v := req.GetMinProviderRating()
		input.MinProviderRating = &v
	}

	job, err := s.svc.CreateJob(ctx, input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &jobv1.CreateJobResponse{Job: domainJobToProto(job)}, nil
}

func (s *Server) UpdateJob(ctx context.Context, req *jobv1.UpdateJobRequest) (*jobv1.UpdateJobResponse, error) {
	input := domain.UpdateJobInput{
		Title:       req.Title,
		Description: req.Description,
		CategoryID:  req.CategoryId,
	}
	if req.SubcategoryId != nil {
		input.SubcategoryID = req.SubcategoryId
	}
	if req.ServiceTypeId != nil {
		input.ServiceTypeID = req.ServiceTypeId
	}
	if req.ScheduleType != nil {
		st := protoScheduleTypeToString(req.GetScheduleType())
		input.ScheduleType = &st
	}
	if req.StartingBidCents != nil {
		v := req.GetStartingBidCents()
		input.StartingBidCents = &v
	}
	if req.OfferAcceptedCents != nil {
		v := req.GetOfferAcceptedCents()
		input.OfferAcceptedCents = &v
	}
	if req.AuctionDurationHours != nil {
		v := int(req.GetAuctionDurationHours())
		input.AuctionDurationHours = &v
	}
	if req.GetPhotoUrls() != nil {
		input.PhotoURLs = req.GetPhotoUrls()
	}

	job, err := s.svc.UpdateJob(ctx, req.GetJobId(), input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &jobv1.UpdateJobResponse{Job: domainJobToProto(job)}, nil
}

func (s *Server) GetJob(ctx context.Context, req *jobv1.GetJobRequest) (*jobv1.GetJobResponse, error) {
	job, err := s.svc.GetJobDetail(ctx, req.GetJobId(), req.GetRequestingUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	detail := &jobv1.JobDetail{
		Job: domainJobToProto(job),
	}

	// Populate approximate address for all viewers.
	detail.Job.ApproximateAddress = &commonv1.Address{
		City:    job.ServiceCity,
		State:   job.ServiceState,
		ZipCode: job.ServiceZip,
	}

	// Reveal exact address to job owner or awarded provider.
	requestingUserID := req.GetRequestingUserId()
	if requestingUserID != "" &&
		(requestingUserID == job.CustomerID ||
			(job.AwardedProviderID != nil && requestingUserID == *job.AwardedProviderID)) {
		detail.ExactAddress = &commonv1.Address{
			Street:  job.ServiceAddress,
			City:    job.ServiceCity,
			State:   job.ServiceState,
			ZipCode: job.ServiceZip,
		}
	}

	return &jobv1.GetJobResponse{Job: detail}, nil
}

func (s *Server) DeleteDraft(ctx context.Context, req *jobv1.DeleteDraftRequest) (*jobv1.DeleteDraftResponse, error) {
	if err := s.svc.DeleteDraft(ctx, req.GetJobId()); err != nil {
		return nil, mapDomainError(err)
	}
	return &jobv1.DeleteDraftResponse{}, nil
}

func (s *Server) PublishJob(ctx context.Context, req *jobv1.PublishJobRequest) (*jobv1.PublishJobResponse, error) {
	job, err := s.svc.PublishJob(ctx, req.GetJobId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &jobv1.PublishJobResponse{Job: domainJobToProto(job)}, nil
}

func (s *Server) CloseAuction(ctx context.Context, req *jobv1.CloseAuctionRequest) (*jobv1.CloseAuctionResponse, error) {
	job, err := s.svc.CloseAuction(ctx, req.GetJobId(), req.GetCustomerId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &jobv1.CloseAuctionResponse{Job: domainJobToProto(job)}, nil
}

func (s *Server) CancelJob(ctx context.Context, req *jobv1.CancelJobRequest) (*jobv1.CancelJobResponse, error) {
	job, err := s.svc.CancelJob(ctx, req.GetJobId(), req.GetCustomerId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &jobv1.CancelJobResponse{Job: domainJobToProto(job)}, nil
}

func (s *Server) SearchJobs(ctx context.Context, req *jobv1.SearchJobsRequest) (*jobv1.SearchJobsResponse, error) {
	input := domain.SearchJobsInput{
		CategoryIDs: req.GetCategoryIds(),
		TextQuery:   req.GetTextQuery(),
	}

	if loc := req.GetLocation(); loc != nil {
		input.Latitude = loc.GetLatitude()
		input.Longitude = loc.GetLongitude()
	}
	input.RadiusKm = req.GetRadiusKm()

	if req.MinPriceCents != nil {
		v := req.GetMinPriceCents()
		input.MinPriceCents = &v
	}
	if req.MaxPriceCents != nil {
		v := req.GetMaxPriceCents()
		input.MaxPriceCents = &v
	}
	if req.ScheduleType != nil {
		st := protoScheduleTypeToString(req.GetScheduleType())
		input.ScheduleType = &st
	}
	if req.RecurringOnly != nil {
		v := req.GetRecurringOnly()
		input.RecurringOnly = &v
	}

	if sort := req.GetSort(); sort != nil {
		input.SortField = sort.GetField()
		input.SortDesc = sort.GetDirection() == commonv1.SortDirection_SORT_DIRECTION_DESC
	}

	if pg := req.GetPagination(); pg != nil {
		input.Page = int(pg.GetPage())
		input.PageSize = int(pg.GetPageSize())
	}

	jobs, pagination, err := s.svc.SearchJobs(ctx, input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoJobs := make([]*jobv1.Job, 0, len(jobs))
	for _, j := range jobs {
		protoJobs = append(protoJobs, domainJobToProto(j))
	}

	return &jobv1.SearchJobsResponse{
		Jobs:       protoJobs,
		Pagination: domainPaginationToProto(pagination),
	}, nil
}

func (s *Server) ListCustomerJobs(ctx context.Context, req *jobv1.ListCustomerJobsRequest) (*jobv1.ListCustomerJobsResponse, error) {
	var statusFilter *string
	if req.StatusFilter != nil {
		sf := protoJobStatusToString(req.GetStatusFilter())
		statusFilter = &sf
	}
	var propertyID *string
	if req.PropertyId != nil {
		v := req.GetPropertyId()
		propertyID = &v
	}

	page := 1
	pageSize := 20
	if pg := req.GetPagination(); pg != nil {
		if pg.GetPage() > 0 {
			page = int(pg.GetPage())
		}
		if pg.GetPageSize() > 0 {
			pageSize = int(pg.GetPageSize())
		}
	}

	jobs, pagination, err := s.svc.ListCustomerJobs(ctx, req.GetCustomerId(), statusFilter, propertyID, page, pageSize)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoJobs := make([]*jobv1.Job, 0, len(jobs))
	for _, j := range jobs {
		protoJobs = append(protoJobs, domainJobToProto(j))
	}

	return &jobv1.ListCustomerJobsResponse{
		Jobs:       protoJobs,
		Pagination: domainPaginationToProto(pagination),
	}, nil
}

func (s *Server) ListDrafts(ctx context.Context, req *jobv1.ListDraftsRequest) (*jobv1.ListDraftsResponse, error) {
	drafts, err := s.svc.ListDrafts(ctx, req.GetCustomerId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoDrafts := make([]*jobv1.Job, 0, len(drafts))
	for _, d := range drafts {
		protoDrafts = append(protoDrafts, domainJobToProto(d))
	}

	return &jobv1.ListDraftsResponse{Drafts: protoDrafts}, nil
}

func (s *Server) GetServiceCategories(ctx context.Context, req *jobv1.GetServiceCategoriesRequest) (*jobv1.GetServiceCategoriesResponse, error) {
	var level *int
	var parentID *string
	if req.Level != nil {
		l := int(*req.Level)
		level = &l
	}
	if req.ParentId != nil {
		parentID = req.ParentId
	}

	cats, err := s.svc.ListServiceCategories(ctx, level, parentID)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoCats := make([]*jobv1.ServiceCategory, 0, len(cats))
	for _, c := range cats {
		pc := &jobv1.ServiceCategory{
			Id:    c.ID,
			Name:  c.Name,
			Slug:  c.Slug,
			Level: int32(c.Level),
			Icon:  c.Icon,
		}
		if c.ParentID != nil {
			pc.ParentId = *c.ParentID
		}
		protoCats = append(protoCats, pc)
	}

	return &jobv1.GetServiceCategoriesResponse{Categories: protoCats}, nil
}

func (s *Server) GetCategoryTree(ctx context.Context, _ *jobv1.GetCategoryTreeRequest) (*jobv1.GetCategoryTreeResponse, error) {
	cats, err := s.svc.GetCategoryTree(ctx)
	if err != nil {
		return nil, mapDomainError(err)
	}

	// Build tree: group by parent_id.
	catMap := make(map[string]*jobv1.CategoryTreeNode)
	var roots []*jobv1.CategoryTreeNode

	for _, c := range cats {
		node := &jobv1.CategoryTreeNode{
			Category: &jobv1.ServiceCategory{
				Id:    c.ID,
				Name:  c.Name,
				Slug:  c.Slug,
				Level: int32(c.Level),
				Icon:  c.Icon,
			},
		}
		if c.ParentID != nil {
			node.Category.ParentId = *c.ParentID
		}
		catMap[c.ID] = node
	}

	for _, c := range cats {
		node := catMap[c.ID]
		if c.ParentID != nil {
			if parent, ok := catMap[*c.ParentID]; ok {
				parent.Children = append(parent.Children, node)
				continue
			}
		}
		roots = append(roots, node)
	}

	return &jobv1.GetCategoryTreeResponse{Tree: roots}, nil
}

func (s *Server) AdminListJobs(ctx context.Context, req *jobv1.AdminListJobsRequest) (*jobv1.AdminListJobsResponse, error) {
	var statusFilter *string
	if req.StatusFilter != nil {
		sf := protoJobStatusToString(req.GetStatusFilter())
		statusFilter = &sf
	}

	page := 1
	pageSize := 20
	if pg := req.GetPagination(); pg != nil {
		if pg.GetPage() > 0 {
			page = int(pg.GetPage())
		}
		if pg.GetPageSize() > 0 {
			pageSize = int(pg.GetPageSize())
		}
	}

	jobs, pagination, err := s.svc.AdminListJobs(ctx, statusFilter, req.CategoryId, req.CustomerId, page, pageSize)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoJobs := make([]*jobv1.Job, 0, len(jobs))
	for _, j := range jobs {
		protoJobs = append(protoJobs, domainJobToProto(j))
	}

	return &jobv1.AdminListJobsResponse{
		Jobs:       protoJobs,
		Pagination: domainPaginationToProto(pagination),
	}, nil
}

func (s *Server) AdminSuspendJob(ctx context.Context, req *jobv1.AdminSuspendJobRequest) (*jobv1.AdminSuspendJobResponse, error) {
	if err := s.svc.AdminSuspendJob(ctx, req.GetJobId(), req.GetReason(), req.GetAdminId()); err != nil {
		return nil, mapDomainError(err)
	}

	job, err := s.svc.GetJob(ctx, req.GetJobId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &jobv1.AdminSuspendJobResponse{
		Job: domainJobToProto(job),
	}, nil
}

func (s *Server) AdminRemoveJob(ctx context.Context, req *jobv1.AdminRemoveJobRequest) (*jobv1.AdminRemoveJobResponse, error) {
	if err := s.svc.AdminRemoveJob(ctx, req.GetJobId(), req.GetReason(), req.GetAdminId()); err != nil {
		return nil, mapDomainError(err)
	}

	return &jobv1.AdminRemoveJobResponse{}, nil
}

// domainJobToProto converts a domain Job to a proto Job.
func domainJobToProto(j *domain.Job) *jobv1.Job {
	pb := &jobv1.Job{
		Id:                   j.ID,
		CustomerId:           j.CustomerID,
		PropertyId:           j.PropertyID,
		Title:                j.Title,
		Description:          j.Description,
		ScheduleType:         stringToProtoScheduleType(j.ScheduleType),
		IsRecurring:          j.IsRecurring,
		AuctionDurationHours: int32(j.AuctionDurationHours),
		Status:               stringToProtoJobStatus(j.Status),
		BidCount:             int32(j.BidCount),
		RepostCount:          int32(j.RepostCount),
		CreatedAt:            timestamppb.New(j.CreatedAt),
	}

	// Approximate address.
	if j.ServiceCity != "" {
		pb.ApproximateAddress = &commonv1.Address{
			City:    j.ServiceCity,
			State:   j.ServiceState,
			ZipCode: j.ServiceZip,
		}
	}

	// Category.
	if j.Category != nil {
		pb.Category = &jobv1.ServiceCategory{
			Id:   j.Category.ID,
			Name: j.Category.Name,
			Slug: j.Category.Slug,
			Icon: j.Category.Icon,
		}
	}
	if j.Subcategory != nil {
		pb.Subcategory = &jobv1.ServiceCategory{
			Id:   j.Subcategory.ID,
			Name: j.Subcategory.Name,
			Slug: j.Subcategory.Slug,
			Icon: j.Subcategory.Icon,
		}
	}
	if j.ServiceType != nil {
		pb.ServiceType = &jobv1.ServiceCategory{
			Id:   j.ServiceType.ID,
			Name: j.ServiceType.Name,
			Slug: j.ServiceType.Slug,
			Icon: j.ServiceType.Icon,
		}
	}

	// Schedule.
	if j.ScheduledDate != nil {
		pb.ScheduledDate = timestamppb.New(*j.ScheduledDate)
	}
	if j.ScheduleRangeStart != nil || j.ScheduleRangeEnd != nil {
		pb.ScheduleRange = &commonv1.DateRange{}
		if j.ScheduleRangeStart != nil {
			pb.ScheduleRange.Start = timestamppb.New(*j.ScheduleRangeStart)
		}
		if j.ScheduleRangeEnd != nil {
			pb.ScheduleRange.End = timestamppb.New(*j.ScheduleRangeEnd)
		}
	}

	// Recurrence.
	if j.RecurrenceFrequency != nil {
		pb.RecurrenceFrequency = stringToProtoRecurrence(*j.RecurrenceFrequency)
	}

	// Auction.
	if j.StartingBidCents != nil {
		pb.StartingBidCents = j.StartingBidCents
	}
	if j.OfferAcceptedCents != nil {
		pb.OfferAcceptedCents = j.OfferAcceptedCents
	}
	if j.AuctionEndsAt != nil {
		pb.AuctionEndsAt = timestamppb.New(*j.AuctionEndsAt)
	}
	if j.MinProviderRating != nil {
		pb.MinProviderRating = j.MinProviderRating
	}

	// Photos.
	photoURLs := make([]string, 0, len(j.Photos))
	for _, p := range j.Photos {
		photoURLs = append(photoURLs, p.ImageURL)
	}
	pb.PhotoUrls = photoURLs

	// Relationships.
	if j.AwardedProviderID != nil {
		pb.AwardedProviderId = *j.AwardedProviderID
	}
	if j.RepostedFromID != nil {
		pb.RepostedFromId = *j.RepostedFromID
	}

	// Market range.
	if j.MarketRange != nil {
		pb.MarketRange = &jobv1.MarketRange{
			LowCents:    j.MarketRange.LowCents,
			MedianCents: j.MarketRange.MedianCents,
			HighCents:   j.MarketRange.HighCents,
			DataPoints:  int32(j.MarketRange.DataPoints),
			Source:      j.MarketRange.Source,
			Confidence:  j.MarketRange.Confidence,
		}
	}

	// Timestamps.
	if j.ClosedAt != nil {
		pb.AuctionClosedAt = timestamppb.New(*j.ClosedAt)
	}
	if j.AwardedAt != nil {
		pb.AwardedAt = timestamppb.New(*j.AwardedAt)
	}
	if j.CompletedAt != nil {
		pb.CompletedAt = timestamppb.New(*j.CompletedAt)
	}

	return pb
}

func domainPaginationToProto(p *domain.Pagination) *commonv1.PaginationResponse {
	if p == nil {
		return nil
	}
	return &commonv1.PaginationResponse{
		TotalCount: int32(p.TotalCount),
		Page:       int32(p.Page),
		PageSize:   int32(p.PageSize),
		TotalPages: int32(p.TotalPages),
		HasNext:    p.HasNext,
	}
}

// Enum conversion helpers.

func protoScheduleTypeToString(st commonv1.ScheduleType) string {
	switch st {
	case commonv1.ScheduleType_SCHEDULE_TYPE_SPECIFIC_DATE:
		return "specific_date"
	case commonv1.ScheduleType_SCHEDULE_TYPE_DATE_RANGE:
		return "date_range"
	case commonv1.ScheduleType_SCHEDULE_TYPE_FLEXIBLE:
		return "flexible"
	default:
		return "flexible"
	}
}

func stringToProtoScheduleType(s string) commonv1.ScheduleType {
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

func protoRecurrenceToString(r commonv1.RecurrenceFrequency) string {
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

func stringToProtoRecurrence(s string) commonv1.RecurrenceFrequency {
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

func protoJobStatusToString(s jobv1.JobStatus) string {
	name := s.String()
	name = strings.TrimPrefix(name, "JOB_STATUS_")
	return strings.ToLower(name)
}

func stringToProtoJobStatus(s string) jobv1.JobStatus {
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

// mapDomainError maps domain errors to gRPC status errors.
func mapDomainError(err error) error {
	switch {
	case errors.Is(err, domain.ErrJobNotFound):
		return status.Error(codes.NotFound, "job not found")
	case errors.Is(err, domain.ErrNotDraft):
		return status.Error(codes.FailedPrecondition, "job is not a draft")
	case errors.Is(err, domain.ErrNotActive):
		return status.Error(codes.FailedPrecondition, "job is not active")
	case errors.Is(err, domain.ErrNotOwner):
		return status.Error(codes.PermissionDenied, "not the job owner")
	case errors.Is(err, domain.ErrInvalidStatus):
		return status.Error(codes.FailedPrecondition, "invalid status transition")
	case errors.Is(err, domain.ErrCategoryNotFound):
		return status.Error(codes.NotFound, "category not found")
	case errors.Is(err, domain.ErrPropertyNotFound):
		return status.Error(codes.NotFound, "property not found")
	case errors.Is(err, domain.ErrMissingTitle):
		return status.Error(codes.InvalidArgument, "title is required")
	case errors.Is(err, domain.ErrMissingDescription):
		return status.Error(codes.InvalidArgument, "description is required")
	case errors.Is(err, domain.ErrMissingCategory):
		return status.Error(codes.InvalidArgument, "category is required")
	case errors.Is(err, domain.ErrInvalidDuration):
		return status.Error(codes.InvalidArgument, "auction duration must be between 1 and 168 hours")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
