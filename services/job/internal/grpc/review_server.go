package grpc

import (
	"context"
	"errors"
	"strings"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	reviewv1 "github.com/nomarkup/nomarkup/proto/review/v1"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/service"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ReviewServer implements the ReviewService gRPC server.
type ReviewServer struct {
	reviewv1.UnimplementedReviewServiceServer
	svc *service.ReviewService
}

// NewReviewServer creates a new gRPC server for the review service.
func NewReviewServer(svc *service.ReviewService) *ReviewServer {
	return &ReviewServer{svc: svc}
}

// RegisterReview registers the review service with a gRPC server.
func RegisterReview(s *grpclib.Server, srv *ReviewServer) {
	reviewv1.RegisterReviewServiceServer(s, srv)
}

func (s *ReviewServer) CreateReview(ctx context.Context, req *reviewv1.CreateReviewRequest) (*reviewv1.CreateReviewResponse, error) {
	var qualityRating, communicationRating, timelinessRating, valueRating *int
	if req.QualityRating != nil {
		v := int(req.GetQualityRating())
		qualityRating = &v
	}
	if req.CommunicationRating != nil {
		v := int(req.GetCommunicationRating())
		communicationRating = &v
	}
	if req.TimelinessRating != nil {
		v := int(req.GetTimelinessRating())
		timelinessRating = &v
	}
	if req.ValueRating != nil {
		v := int(req.GetValueRating())
		valueRating = &v
	}

	review, err := s.svc.CreateReview(
		ctx,
		req.GetContractId(),
		req.GetReviewerId(),
		int(req.GetOverallRating()),
		qualityRating, communicationRating, timelinessRating, valueRating,
		req.GetComment(),
		req.GetPhotoUrls(),
	)
	if err != nil {
		return nil, mapReviewDomainError(err)
	}

	return &reviewv1.CreateReviewResponse{
		Review: domainReviewToProto(review),
	}, nil
}

func (s *ReviewServer) GetReview(ctx context.Context, req *reviewv1.GetReviewRequest) (*reviewv1.GetReviewResponse, error) {
	review, err := s.svc.GetReview(ctx, req.GetReviewId())
	if err != nil {
		return nil, mapReviewDomainError(err)
	}

	return &reviewv1.GetReviewResponse{
		Review: domainReviewToProto(review),
	}, nil
}

func (s *ReviewServer) ListReviewsForUser(ctx context.Context, req *reviewv1.ListReviewsForUserRequest) (*reviewv1.ListReviewsForUserResponse, error) {
	var directionFilter *string
	if req.DirectionFilter != nil && req.GetDirectionFilter() != reviewv1.ReviewDirection_REVIEW_DIRECTION_UNSPECIFIED {
		df := protoReviewDirectionToString(req.GetDirectionFilter())
		directionFilter = &df
	}

	page := int32(1)
	pageSize := int32(20)
	if pg := req.GetPagination(); pg != nil {
		if pg.GetPage() > 0 {
			page = pg.GetPage()
		}
		if pg.GetPageSize() > 0 {
			pageSize = pg.GetPageSize()
		}
	}

	reviews, pagination, avgRating, totalReviews, err := s.svc.ListReviewsForUser(
		ctx, req.GetUserId(), directionFilter, int(page), int(pageSize))
	if err != nil {
		return nil, mapReviewDomainError(err)
	}

	protoReviews := make([]*reviewv1.Review, 0, len(reviews))
	for _, r := range reviews {
		protoReviews = append(protoReviews, domainReviewToProto(r))
	}

	return &reviewv1.ListReviewsForUserResponse{
		Reviews:       protoReviews,
		Pagination:    domainReviewPaginationToProto(pagination),
		AverageRating: avgRating,
		TotalReviews:  int32(totalReviews),
	}, nil
}

func (s *ReviewServer) ListReviewsByUser(ctx context.Context, req *reviewv1.ListReviewsByUserRequest) (*reviewv1.ListReviewsByUserResponse, error) {
	page := int32(1)
	pageSize := int32(20)
	if pg := req.GetPagination(); pg != nil {
		if pg.GetPage() > 0 {
			page = pg.GetPage()
		}
		if pg.GetPageSize() > 0 {
			pageSize = pg.GetPageSize()
		}
	}

	reviews, pagination, err := s.svc.ListReviewsByUser(ctx, req.GetUserId(), int(page), int(pageSize))
	if err != nil {
		return nil, mapReviewDomainError(err)
	}

	protoReviews := make([]*reviewv1.Review, 0, len(reviews))
	for _, r := range reviews {
		protoReviews = append(protoReviews, domainReviewToProto(r))
	}

	return &reviewv1.ListReviewsByUserResponse{
		Reviews:    protoReviews,
		Pagination: domainReviewPaginationToProto(pagination),
	}, nil
}

func (s *ReviewServer) RespondToReview(ctx context.Context, req *reviewv1.RespondToReviewRequest) (*reviewv1.RespondToReviewResponse, error) {
	resp, err := s.svc.RespondToReview(ctx, req.GetReviewId(), req.GetResponderId(), req.GetComment())
	if err != nil {
		return nil, mapReviewDomainError(err)
	}

	return &reviewv1.RespondToReviewResponse{
		Response: domainReviewResponseToProto(resp),
	}, nil
}

func (s *ReviewServer) FlagReview(ctx context.Context, req *reviewv1.FlagReviewRequest) (*reviewv1.FlagReviewResponse, error) {
	reason := protoFlagReasonToString(req.GetReason())

	flagID, err := s.svc.FlagReview(ctx, req.GetReviewId(), req.GetFlaggedBy(), reason, req.GetDetails())
	if err != nil {
		return nil, mapReviewDomainError(err)
	}

	return &reviewv1.FlagReviewResponse{
		FlagId: flagID,
	}, nil
}

func (s *ReviewServer) GetReviewEligibility(ctx context.Context, req *reviewv1.GetReviewEligibilityRequest) (*reviewv1.GetReviewEligibilityResponse, error) {
	elig, err := s.svc.GetReviewEligibility(ctx, req.GetContractId(), req.GetUserId())
	if err != nil {
		return nil, mapReviewDomainError(err)
	}

	resp := &reviewv1.GetReviewEligibilityResponse{
		Eligible:        elig.Eligible,
		AlreadyReviewed: elig.AlreadyReviewed,
	}
	if !elig.WindowClosesAt.IsZero() {
		resp.ReviewWindowClosesAt = timestamppb.New(elig.WindowClosesAt)
	}

	return resp, nil
}

func (s *ReviewServer) AdminRemoveReview(ctx context.Context, req *reviewv1.AdminRemoveReviewRequest) (*reviewv1.AdminRemoveReviewResponse, error) {
	if err := s.svc.AdminRemoveReview(ctx, req.GetReviewId(), req.GetReason(), req.GetAdminId()); err != nil {
		return nil, mapReviewDomainError(err)
	}

	return &reviewv1.AdminRemoveReviewResponse{}, nil
}

func (s *ReviewServer) AdminListFlaggedReviews(ctx context.Context, req *reviewv1.AdminListFlaggedReviewsRequest) (*reviewv1.AdminListFlaggedReviewsResponse, error) {
	var statusFilter *string
	if req.StatusFilter != nil {
		sf := protoFlagStatusToString(req.GetStatusFilter())
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

	flagged, pagination, err := s.svc.AdminListFlaggedReviews(ctx, statusFilter, page, pageSize)
	if err != nil {
		return nil, mapReviewDomainError(err)
	}

	protoFlagged := make([]*reviewv1.FlaggedReview, 0, len(flagged))
	for _, f := range flagged {
		protoFlagged = append(protoFlagged, domainFlaggedReviewToProto(&f))
	}

	return &reviewv1.AdminListFlaggedReviewsResponse{
		FlaggedReviews: protoFlagged,
		Pagination:     domainReviewPaginationToProto(pagination),
	}, nil
}

func (s *ReviewServer) AdminResolveFlag(ctx context.Context, req *reviewv1.AdminResolveFlagRequest) (*reviewv1.AdminResolveFlagResponse, error) {
	resultStatus, err := s.svc.AdminResolveFlag(ctx, req.GetFlagId(), req.GetAdminId(), req.GetUphold(), req.GetResolutionNotes())
	if err != nil {
		return nil, mapReviewDomainError(err)
	}

	return &reviewv1.AdminResolveFlagResponse{
		Status: stringToProtoFlagStatus(resultStatus),
	}, nil
}

// --- Proto conversion helpers ---

func domainReviewToProto(r *domain.Review) *reviewv1.Review {
	if r == nil {
		return nil
	}

	pb := &reviewv1.Review{
		Id:            r.ID,
		ContractId:    r.ContractID,
		ReviewerId:    r.ReviewerID,
		RevieweeId:    r.RevieweeID,
		Direction:     stringToProtoReviewDirection(r.Direction),
		OverallRating: int32(r.OverallRating),
		Comment:       r.Comment,
		PhotoUrls:     r.PhotoURLs,
		IsFlagged:     r.IsFlagged,
		CreatedAt:     timestamppb.New(r.CreatedAt),
	}

	if r.QualityRating != nil {
		pb.QualityRating = int32(*r.QualityRating)
	}
	if r.CommunicationRating != nil {
		pb.CommunicationRating = int32(*r.CommunicationRating)
	}
	if r.TimelinessRating != nil {
		pb.TimelinessRating = int32(*r.TimelinessRating)
	}
	if r.ValueRating != nil {
		pb.ValueRating = int32(*r.ValueRating)
	}

	if r.Response != nil {
		pb.Response = domainReviewResponseToProto(r.Response)
	}

	return pb
}

func domainReviewResponseToProto(r *domain.ReviewResponse) *reviewv1.ReviewResponse {
	if r == nil {
		return nil
	}
	return &reviewv1.ReviewResponse{
		Id:          r.ID,
		ReviewId:    r.ReviewID,
		ResponderId: r.ResponderID,
		Comment:     r.Comment,
		CreatedAt:   timestamppb.New(r.CreatedAt),
	}
}

func domainReviewPaginationToProto(p *domain.Pagination) *commonv1.PaginationResponse {
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

// --- Enum conversions ---

func protoReviewDirectionToString(d reviewv1.ReviewDirection) string {
	switch d {
	case reviewv1.ReviewDirection_REVIEW_DIRECTION_CUSTOMER_TO_PROVIDER:
		return "customer_to_provider"
	case reviewv1.ReviewDirection_REVIEW_DIRECTION_PROVIDER_TO_CUSTOMER:
		return "provider_to_customer"
	default:
		return ""
	}
}

func stringToProtoReviewDirection(s string) reviewv1.ReviewDirection {
	switch s {
	case "customer_to_provider":
		return reviewv1.ReviewDirection_REVIEW_DIRECTION_CUSTOMER_TO_PROVIDER
	case "provider_to_customer":
		return reviewv1.ReviewDirection_REVIEW_DIRECTION_PROVIDER_TO_CUSTOMER
	default:
		return reviewv1.ReviewDirection_REVIEW_DIRECTION_UNSPECIFIED
	}
}

func protoFlagReasonToString(r reviewv1.FlagReason) string {
	name := r.String()
	name = strings.TrimPrefix(name, "FLAG_REASON_")
	return strings.ToLower(name)
}

func domainFlaggedReviewToProto(f *domain.FlaggedReviewWithFlag) *reviewv1.FlaggedReview {
	if f == nil {
		return nil
	}

	review := f.Review
	return &reviewv1.FlaggedReview{
		FlagId:    f.Flag.ID,
		Review:    domainReviewToProto(&review),
		FlaggedBy: f.Flag.FlaggedBy,
		Reason:    stringToProtoFlagReason(f.Flag.Reason),
		Details:   f.Flag.Details,
		Status:    stringToProtoFlagStatus(f.Flag.Status),
		FlaggedAt: timestamppb.New(f.Flag.FlaggedAt),
	}
}

func protoFlagStatusToString(s reviewv1.FlagStatus) string {
	switch s {
	case reviewv1.FlagStatus_FLAG_STATUS_PENDING:
		return "pending"
	case reviewv1.FlagStatus_FLAG_STATUS_UPHELD:
		return "upheld"
	case reviewv1.FlagStatus_FLAG_STATUS_DISMISSED:
		return "dismissed"
	default:
		return ""
	}
}

func stringToProtoFlagStatus(s string) reviewv1.FlagStatus {
	switch s {
	case "pending":
		return reviewv1.FlagStatus_FLAG_STATUS_PENDING
	case "upheld":
		return reviewv1.FlagStatus_FLAG_STATUS_UPHELD
	case "dismissed":
		return reviewv1.FlagStatus_FLAG_STATUS_DISMISSED
	default:
		return reviewv1.FlagStatus_FLAG_STATUS_UNSPECIFIED
	}
}

func stringToProtoFlagReason(s string) reviewv1.FlagReason {
	switch s {
	case "inappropriate":
		return reviewv1.FlagReason_FLAG_REASON_INAPPROPRIATE
	case "fake":
		return reviewv1.FlagReason_FLAG_REASON_FAKE
	case "harassment":
		return reviewv1.FlagReason_FLAG_REASON_HARASSMENT
	case "spam":
		return reviewv1.FlagReason_FLAG_REASON_SPAM
	case "irrelevant":
		return reviewv1.FlagReason_FLAG_REASON_IRRELEVANT
	default:
		return reviewv1.FlagReason_FLAG_REASON_UNSPECIFIED
	}
}

// mapReviewDomainError maps review domain errors to gRPC status errors.
func mapReviewDomainError(err error) error {
	switch {
	case errors.Is(err, domain.ErrReviewNotFound):
		return status.Error(codes.NotFound, "review not found")
	case errors.Is(err, domain.ErrNotEligible):
		return status.Error(codes.FailedPrecondition, "not eligible to review")
	case errors.Is(err, domain.ErrAlreadyReviewed):
		return status.Error(codes.AlreadyExists, "already reviewed this contract")
	case errors.Is(err, domain.ErrReviewWindowClosed):
		return status.Error(codes.FailedPrecondition, "review window has closed")
	case errors.Is(err, domain.ErrNotReviewee):
		return status.Error(codes.PermissionDenied, "only the reviewee can respond")
	case errors.Is(err, domain.ErrAlreadyResponded):
		return status.Error(codes.AlreadyExists, "already responded to this review")
	case errors.Is(err, domain.ErrContractNotFound):
		return status.Error(codes.NotFound, "contract not found")
	case errors.Is(err, domain.ErrFlagNotFound):
		return status.Error(codes.NotFound, "flag not found")
	case errors.Is(err, domain.ErrFlagAlreadyResolved):
		return status.Error(codes.FailedPrecondition, "flag already resolved")
	case errors.Is(err, domain.ErrReviewAlreadyRemoved):
		return status.Error(codes.FailedPrecondition, "review already removed")
	default:
		// Check for validation errors (contain known messages).
		msg := err.Error()
		if strings.Contains(msg, "must be between") || strings.Contains(msg, "must be at least") {
			return status.Error(codes.InvalidArgument, msg)
		}
		return status.Error(codes.Internal, "internal error")
	}
}
