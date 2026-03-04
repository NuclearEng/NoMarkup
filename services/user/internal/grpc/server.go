package grpc

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/nomarkup/nomarkup/services/user/internal/service"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Server implements the UserService gRPC server.
type Server struct {
	userv1.UnimplementedUserServiceServer
	auth    *service.Auth
	profile *service.Profile
	admin   *service.Admin
}

// NewServer creates a new gRPC server for the user service.
func NewServer(auth *service.Auth, profile *service.Profile, admin *service.Admin) *Server {
	return &Server{auth: auth, profile: profile, admin: admin}
}

// Register registers the user service with a gRPC server.
func Register(s *grpclib.Server, srv *Server) {
	userv1.RegisterUserServiceServer(s, srv)
}

func (s *Server) Register(ctx context.Context, req *userv1.RegisterRequest) (*userv1.RegisterResponse, error) {
	roles := make([]string, 0, len(req.GetRoles()))
	for _, r := range req.GetRoles() {
		if r == commonv1.UserRole_USER_ROLE_UNSPECIFIED {
			continue
		}
		roles = append(roles, protoRoleToString(r))
	}
	if len(roles) == 0 {
		roles = []string{"customer"}
	}

	input := domain.RegisterInput{
		Email:       req.GetEmail(),
		Password:    req.GetPassword(),
		DisplayName: req.GetDisplayName(),
		Roles:       roles,
	}

	userID, pair, err := s.auth.Register(ctx, input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.RegisterResponse{
		UserId:               userID,
		AccessToken:          pair.AccessToken,
		RefreshToken:         pair.RefreshToken,
		AccessTokenExpiresAt: timestamppb.New(pair.AccessTokenExpiresAt),
	}, nil
}

func (s *Server) Login(ctx context.Context, req *userv1.LoginRequest) (*userv1.LoginResponse, error) {
	input := domain.LoginInput{
		Email:      req.GetEmail(),
		Password:   req.GetPassword(),
		DeviceInfo: req.GetDeviceInfo(),
		IPAddress:  req.GetIpAddress(),
	}

	userID, pair, mfaRequired, err := s.auth.Login(ctx, input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	resp := &userv1.LoginResponse{
		UserId:      userID,
		MfaRequired: mfaRequired,
	}

	if pair != nil {
		resp.AccessToken = pair.AccessToken
		resp.RefreshToken = pair.RefreshToken
		resp.AccessTokenExpiresAt = timestamppb.New(pair.AccessTokenExpiresAt)
	}

	return resp, nil
}

func (s *Server) RefreshToken(ctx context.Context, req *userv1.RefreshTokenRequest) (*userv1.RefreshTokenResponse, error) {
	pair, err := s.auth.RefreshToken(ctx, req.GetRefreshToken())
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.RefreshTokenResponse{
		AccessToken:          pair.AccessToken,
		RefreshToken:         pair.RefreshToken,
		AccessTokenExpiresAt: timestamppb.New(pair.AccessTokenExpiresAt),
	}, nil
}

func (s *Server) Logout(ctx context.Context, req *userv1.LogoutRequest) (*userv1.LogoutResponse, error) {
	if err := s.auth.Logout(ctx, req.GetRefreshToken()); err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.LogoutResponse{}, nil
}

func (s *Server) VerifyEmail(ctx context.Context, req *userv1.VerifyEmailRequest) (*userv1.VerifyEmailResponse, error) {
	verified, err := s.auth.VerifyEmail(ctx, req.GetToken())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.VerifyEmailResponse{Verified: verified}, nil
}

func (s *Server) GetUser(ctx context.Context, req *userv1.GetUserRequest) (*userv1.GetUserResponse, error) {
	user, err := s.profile.GetUser(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.GetUserResponse{User: domainUserToProto(user)}, nil
}

func (s *Server) UpdateUser(ctx context.Context, req *userv1.UpdateUserRequest) (*userv1.UpdateUserResponse, error) {
	input := domain.UpdateUserInput{
		DisplayName: req.DisplayName,
		Phone:       req.Phone,
		AvatarURL:   req.AvatarUrl,
		Timezone:    req.Timezone,
	}
	user, err := s.profile.UpdateUser(ctx, req.GetUserId(), input)
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.UpdateUserResponse{User: domainUserToProto(user)}, nil
}

func (s *Server) EnableRole(ctx context.Context, req *userv1.EnableRoleRequest) (*userv1.EnableRoleResponse, error) {
	role := protoRoleToString(req.GetRole())
	user, err := s.profile.EnableRole(ctx, req.GetUserId(), role)
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.EnableRoleResponse{User: domainUserToProto(user)}, nil
}

func (s *Server) GetProviderProfile(ctx context.Context, req *userv1.GetProviderProfileRequest) (*userv1.GetProviderProfileResponse, error) {
	p, err := s.profile.GetProviderProfile(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.GetProviderProfileResponse{Profile: domainProviderToProto(p)}, nil
}

func (s *Server) UpdateProviderProfile(ctx context.Context, req *userv1.UpdateProviderProfileRequest) (*userv1.UpdateProviderProfileResponse, error) {
	input := domain.UpdateProviderInput{
		BusinessName:    req.BusinessName,
		Bio:             req.Bio,
		ServiceAddress:  req.ServiceAddress,
		ServiceRadiusKm: req.ServiceRadiusKm,
	}
	if req.ServiceLocation != nil {
		lat := req.ServiceLocation.GetLatitude()
		lng := req.ServiceLocation.GetLongitude()
		input.Latitude = &lat
		input.Longitude = &lng
	}
	p, err := s.profile.UpdateProviderProfile(ctx, req.GetUserId(), input)
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.UpdateProviderProfileResponse{Profile: domainProviderToProto(p)}, nil
}

func (s *Server) SetGlobalTerms(ctx context.Context, req *userv1.SetGlobalTermsRequest) (*userv1.SetGlobalTermsResponse, error) {
	timing := protoPaymentTimingToString(req.GetPaymentTiming())
	milestones := make([]domain.MilestoneTemplate, 0, len(req.GetMilestones()))
	for _, m := range req.GetMilestones() {
		milestones = append(milestones, domain.MilestoneTemplate{
			Description: m.GetDescription(),
			Percentage:  int(m.GetPercentage()),
		})
	}
	input := domain.GlobalTermsInput{
		PaymentTiming:      timing,
		Milestones:         milestones,
		CancellationPolicy: req.GetCancellationPolicy(),
		WarrantyTerms:      req.GetWarrantyTerms(),
	}
	if err := s.profile.SetGlobalTerms(ctx, req.GetUserId(), input); err != nil {
		return nil, mapDomainError(err)
	}
	p, err := s.profile.GetProviderProfile(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.SetGlobalTermsResponse{Profile: domainProviderToProto(p)}, nil
}

func (s *Server) UpdateServiceCategories(ctx context.Context, req *userv1.UpdateServiceCategoriesRequest) (*userv1.UpdateServiceCategoriesResponse, error) {
	if err := s.profile.UpdateServiceCategories(ctx, req.GetUserId(), req.GetCategoryIds()); err != nil {
		return nil, mapDomainError(err)
	}
	cats, err := s.profile.GetProviderServiceCategories(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	protoCats := make([]*userv1.ServiceCategorySummary, 0, len(cats))
	for _, c := range cats {
		protoCats = append(protoCats, &userv1.ServiceCategorySummary{
			Id:         c.ID,
			Name:       c.Name,
			Slug:       c.Slug,
			Level:      int32(c.Level),
			ParentName: c.ParentName,
		})
	}
	return &userv1.UpdateServiceCategoriesResponse{Categories: protoCats}, nil
}

func (s *Server) UpdatePortfolio(ctx context.Context, req *userv1.UpdatePortfolioRequest) (*userv1.UpdatePortfolioResponse, error) {
	images := make([]domain.PortfolioImage, 0, len(req.GetImages()))
	for _, img := range req.GetImages() {
		images = append(images, domain.PortfolioImage{
			ImageURL:  img.GetImageUrl(),
			Caption:   img.GetCaption(),
			SortOrder: int(img.GetSortOrder()),
		})
	}
	if err := s.profile.UpdatePortfolio(ctx, req.GetUserId(), images); err != nil {
		return nil, mapDomainError(err)
	}
	// Re-fetch to get generated IDs
	p, err := s.profile.GetProviderProfile(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	protoImages := make([]*userv1.PortfolioImage, 0, len(p.PortfolioImages))
	for _, img := range p.PortfolioImages {
		protoImages = append(protoImages, &userv1.PortfolioImage{
			Id:        img.ID,
			ImageUrl:  img.ImageURL,
			Caption:   img.Caption,
			SortOrder: int32(img.SortOrder),
		})
	}
	return &userv1.UpdatePortfolioResponse{Images: protoImages}, nil
}

func (s *Server) SetInstantAvailability(ctx context.Context, req *userv1.SetInstantAvailabilityRequest) (*userv1.SetInstantAvailabilityResponse, error) {
	var scheduleJSON []byte
	if len(req.GetSchedule()) > 0 {
		var err error
		scheduleJSON, err = json.Marshal(req.GetSchedule())
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "invalid schedule")
		}
	}

	input := domain.AvailabilityInput{
		Enabled:      req.GetEnabled(),
		AvailableNow: req.GetAvailableNow(),
		Schedule:     scheduleJSON,
	}
	if err := s.profile.SetInstantAvailability(ctx, req.GetUserId(), input); err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.SetInstantAvailabilityResponse{
		InstantEnabled:   req.GetEnabled(),
		InstantAvailable: req.GetAvailableNow(),
	}, nil
}

func (s *Server) GetServiceCategories(ctx context.Context, req *userv1.GetServiceCategoriesRequest) (*userv1.GetServiceCategoriesResponse, error) {
	var level *int
	var parentID *string
	if req.Level != nil {
		l := int(*req.Level)
		level = &l
	}
	if req.ParentId != nil {
		parentID = req.ParentId
	}

	cats, err := s.profile.ListServiceCategories(ctx, level, parentID)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoCats := make([]*userv1.ServiceCategory, 0, len(cats))
	for _, c := range cats {
		pc := &userv1.ServiceCategory{
			Id:          c.ID,
			Name:        c.Name,
			Slug:        c.Slug,
			Level:       int32(c.Level),
			Description: c.Description,
			Icon:        c.Icon,
			SortOrder:   int32(c.SortOrder),
			Active:      c.Active,
		}
		if c.ParentID != nil {
			pc.ParentId = *c.ParentID
		}
		protoCats = append(protoCats, pc)
	}
	return &userv1.GetServiceCategoriesResponse{Categories: protoCats}, nil
}

func (s *Server) GetCategoryTree(ctx context.Context, _ *userv1.GetCategoryTreeRequest) (*userv1.GetCategoryTreeResponse, error) {
	cats, err := s.profile.GetCategoryTree(ctx)
	if err != nil {
		return nil, mapDomainError(err)
	}

	// Build tree: group by parent_id, attach children
	catMap := make(map[string]*userv1.ServiceCategory)
	var roots []*userv1.ServiceCategory

	for _, c := range cats {
		pc := &userv1.ServiceCategory{
			Id:          c.ID,
			Name:        c.Name,
			Slug:        c.Slug,
			Level:       int32(c.Level),
			Description: c.Description,
			Icon:        c.Icon,
			SortOrder:   int32(c.SortOrder),
			Active:      c.Active,
		}
		if c.ParentID != nil {
			pc.ParentId = *c.ParentID
		}
		catMap[c.ID] = pc
	}

	for _, c := range cats {
		pc := catMap[c.ID]
		if c.ParentID != nil {
			if parent, ok := catMap[*c.ParentID]; ok {
				parent.Children = append(parent.Children, pc)
				continue
			}
		}
		roots = append(roots, pc)
	}

	return &userv1.GetCategoryTreeResponse{Categories: roots}, nil
}

func (s *Server) AdminSuspendUser(ctx context.Context, req *userv1.AdminSuspendUserRequest) (*userv1.AdminSuspendUserResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if req.GetReason() == "" {
		return nil, status.Error(codes.InvalidArgument, "reason is required")
	}
	if req.GetAdminId() == "" {
		return nil, status.Error(codes.InvalidArgument, "admin_id is required")
	}

	if err := s.admin.SuspendUser(ctx, req.GetUserId(), req.GetReason(), req.GetAdminId()); err != nil {
		return nil, mapDomainError(err)
	}

	if err := s.admin.InsertAuditLog(ctx, req.GetAdminId(), "suspend_user", "user", req.GetUserId(), map[string]any{
		"reason": req.GetReason(),
	}, ""); err != nil {
		slog.Warn("failed to insert audit log for suspend",
			"user_id", req.GetUserId(),
			"admin_id", req.GetAdminId(),
			"error", err,
		)
	}

	user, err := s.admin.AdminGetUser(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.AdminSuspendUserResponse{
		User: domainUserToProto(user),
	}, nil
}

func (s *Server) AdminBanUser(ctx context.Context, req *userv1.AdminBanUserRequest) (*userv1.AdminBanUserResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if req.GetReason() == "" {
		return nil, status.Error(codes.InvalidArgument, "reason is required")
	}
	if req.GetAdminId() == "" {
		return nil, status.Error(codes.InvalidArgument, "admin_id is required")
	}

	if err := s.admin.BanUser(ctx, req.GetUserId(), req.GetReason(), req.GetAdminId()); err != nil {
		return nil, mapDomainError(err)
	}

	if err := s.admin.InsertAuditLog(ctx, req.GetAdminId(), "ban_user", "user", req.GetUserId(), map[string]any{
		"reason": req.GetReason(),
	}, ""); err != nil {
		slog.Warn("failed to insert audit log for ban",
			"user_id", req.GetUserId(),
			"admin_id", req.GetAdminId(),
			"error", err,
		)
	}

	user, err := s.admin.AdminGetUser(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.AdminBanUserResponse{
		User: domainUserToProto(user),
	}, nil
}

func (s *Server) AdminSearchUsers(ctx context.Context, req *userv1.AdminSearchUsersRequest) (*userv1.AdminSearchUsersResponse, error) {
	page := int(req.GetPagination().GetPage())
	pageSize := int(req.GetPagination().GetPageSize())
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	statusFilter := ""
	if req.StatusFilter != nil {
		statusFilter = protoUserStatusToString(*req.StatusFilter)
	}

	users, total, err := s.admin.AdminSearchUsers(ctx, req.GetQuery(), statusFilter, page, pageSize)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoUsers := make([]*userv1.User, 0, len(users))
	for i := range users {
		protoUsers = append(protoUsers, domainUserToProto(&users[i]))
	}

	totalPages := int32(total) / int32(pageSize)
	if int32(total)%int32(pageSize) > 0 {
		totalPages++
	}

	return &userv1.AdminSearchUsersResponse{
		Users: protoUsers,
		Pagination: &commonv1.PaginationResponse{
			TotalCount: int32(total),
			Page:       int32(page),
			PageSize:   int32(pageSize),
			TotalPages: totalPages,
			HasNext:    int32(page) < totalPages,
		},
	}, nil
}

func (s *Server) AdminGetUser(ctx context.Context, req *userv1.AdminGetUserRequest) (*userv1.AdminGetUserResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	user, err := s.admin.AdminGetUser(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	resp := &userv1.AdminGetUserResponse{
		User: domainUserToProto(user),
	}

	// Attempt to load provider profile if the user has the provider role.
	for _, role := range user.Roles {
		if role == "provider" {
			p, err := s.profile.GetProviderProfile(ctx, user.ID)
			if err == nil {
				resp.ProviderProfile = domainProviderToProto(p)
			}
			break
		}
	}

	return resp, nil
}

func protoUserStatusToString(s commonv1.UserStatus) string {
	switch s {
	case commonv1.UserStatus_USER_STATUS_ACTIVE:
		return "active"
	case commonv1.UserStatus_USER_STATUS_SUSPENDED:
		return "suspended"
	case commonv1.UserStatus_USER_STATUS_BANNED:
		return "banned"
	case commonv1.UserStatus_USER_STATUS_DEACTIVATED:
		return "deactivated"
	default:
		return ""
	}
}

func domainUserToProto(u *domain.User) *userv1.User {
	protoRoles := make([]commonv1.UserRole, 0, len(u.Roles))
	for _, r := range u.Roles {
		protoRoles = append(protoRoles, stringToProtoRole(r))
	}
	pb := &userv1.User{
		Id:            u.ID,
		Email:         u.Email,
		EmailVerified: u.EmailVerified,
		Phone:         u.Phone,
		PhoneVerified: u.PhoneVerified,
		DisplayName:   u.DisplayName,
		AvatarUrl:     u.AvatarURL,
		Roles:         protoRoles,
		Status:        stringToProtoUserStatus(u.Status),
		MfaEnabled:    u.MFAEnabled,
		CreatedAt:     timestamppb.New(u.CreatedAt),
	}
	if u.LastActiveAt != nil {
		pb.LastActiveAt = timestamppb.New(*u.LastActiveAt)
	}
	return pb
}

func domainProviderToProto(p *domain.ProviderProfile) *userv1.ProviderProfile {
	pb := &userv1.ProviderProfile{
		Id:                       p.ID,
		UserId:                   p.UserID,
		BusinessName:             p.BusinessName,
		Bio:                      p.Bio,
		ServiceAddress:           p.ServiceAddress,
		ServiceRadiusKm:          p.ServiceRadiusKm,
		DefaultPaymentTiming:     stringToProtoPaymentTiming(p.DefaultPaymentTiming),
		CancellationPolicy:       p.CancellationPolicy,
		WarrantyTerms:            p.WarrantyTerms,
		InstantEnabled:           p.InstantEnabled,
		InstantAvailable:         p.InstantAvailable,
		JobsCompleted:            int32(p.JobsCompleted),
		ProfileCompleteness:      int32(p.ProfileCompleteness),
		StripeOnboardingComplete: p.StripeOnboardingComplete,
		MemberSince:              timestamppb.New(p.CreatedAt),
	}

	if p.Latitude != nil && p.Longitude != nil {
		pb.ServiceLocation = &commonv1.Location{
			Latitude:  *p.Latitude,
			Longitude: *p.Longitude,
		}
	}

	if p.AvgResponseTimeMinutes != nil {
		pb.AvgResponseTimeMinutes = int32(*p.AvgResponseTimeMinutes)
	}
	if p.OnTimeRate != nil {
		pb.OnTimeRate = *p.OnTimeRate
	}

	if p.DefaultMilestoneJSON != nil {
		var milestones []domain.MilestoneTemplate
		if err := json.Unmarshal(p.DefaultMilestoneJSON, &milestones); err == nil {
			for _, m := range milestones {
				pb.DefaultMilestones = append(pb.DefaultMilestones, &userv1.MilestoneTemplate{
					Description: m.Description,
					Percentage:  int32(m.Percentage),
				})
			}
		}
	}

	for _, c := range p.Categories {
		pb.ServiceCategories = append(pb.ServiceCategories, &userv1.ServiceCategorySummary{
			Id:         c.ID,
			Name:       c.Name,
			Slug:       c.Slug,
			Level:      int32(c.Level),
			ParentName: c.ParentName,
		})
	}

	for _, img := range p.PortfolioImages {
		pb.Portfolio = append(pb.Portfolio, &userv1.PortfolioImage{
			Id:        img.ID,
			ImageUrl:  img.ImageURL,
			Caption:   img.Caption,
			SortOrder: int32(img.SortOrder),
		})
	}

	return pb
}

func stringToProtoRole(r string) commonv1.UserRole {
	switch r {
	case "customer":
		return commonv1.UserRole_USER_ROLE_CUSTOMER
	case "provider":
		return commonv1.UserRole_USER_ROLE_PROVIDER
	case "admin":
		return commonv1.UserRole_USER_ROLE_ADMIN
	default:
		return commonv1.UserRole_USER_ROLE_UNSPECIFIED
	}
}

func stringToProtoUserStatus(s string) commonv1.UserStatus {
	switch s {
	case "active":
		return commonv1.UserStatus_USER_STATUS_ACTIVE
	case "suspended":
		return commonv1.UserStatus_USER_STATUS_SUSPENDED
	case "banned":
		return commonv1.UserStatus_USER_STATUS_BANNED
	case "deactivated":
		return commonv1.UserStatus_USER_STATUS_DEACTIVATED
	default:
		return commonv1.UserStatus_USER_STATUS_UNSPECIFIED
	}
}

func protoPaymentTimingToString(t commonv1.PaymentTiming) string {
	switch t {
	case commonv1.PaymentTiming_PAYMENT_TIMING_UPFRONT:
		return "upfront"
	case commonv1.PaymentTiming_PAYMENT_TIMING_MILESTONE:
		return "milestone"
	case commonv1.PaymentTiming_PAYMENT_TIMING_COMPLETION:
		return "completion"
	case commonv1.PaymentTiming_PAYMENT_TIMING_PAYMENT_PLAN:
		return "payment_plan"
	case commonv1.PaymentTiming_PAYMENT_TIMING_RECURRING:
		return "recurring"
	default:
		return "completion"
	}
}

func stringToProtoPaymentTiming(s string) commonv1.PaymentTiming {
	switch s {
	case "upfront":
		return commonv1.PaymentTiming_PAYMENT_TIMING_UPFRONT
	case "milestone":
		return commonv1.PaymentTiming_PAYMENT_TIMING_MILESTONE
	case "completion":
		return commonv1.PaymentTiming_PAYMENT_TIMING_COMPLETION
	case "payment_plan":
		return commonv1.PaymentTiming_PAYMENT_TIMING_PAYMENT_PLAN
	case "recurring":
		return commonv1.PaymentTiming_PAYMENT_TIMING_RECURRING
	default:
		return commonv1.PaymentTiming_PAYMENT_TIMING_UNSPECIFIED
	}
}

// protoRoleToString converts a proto UserRole enum to its lowercase string representation.
func protoRoleToString(r commonv1.UserRole) string {
	name := r.String()
	// "USER_ROLE_CUSTOMER" -> "customer"
	name = strings.TrimPrefix(name, "USER_ROLE_")
	return strings.ToLower(name)
}

// mapDomainError maps domain errors to gRPC status errors.
func mapDomainError(err error) error {
	switch {
	case errors.Is(err, domain.ErrUserNotFound):
		return status.Error(codes.NotFound, "user not found")
	case errors.Is(err, domain.ErrEmailTaken):
		return status.Error(codes.AlreadyExists, "email already taken")
	case errors.Is(err, domain.ErrInvalidCredentials):
		return status.Error(codes.Unauthenticated, "invalid credentials")
	case errors.Is(err, domain.ErrTokenExpired):
		return status.Error(codes.Unauthenticated, "token expired")
	case errors.Is(err, domain.ErrTokenRevoked):
		return status.Error(codes.Unauthenticated, "token revoked")
	case errors.Is(err, domain.ErrAccountSuspended):
		return status.Error(codes.PermissionDenied, "account suspended")
	case errors.Is(err, domain.ErrAccountBanned):
		return status.Error(codes.PermissionDenied, "account banned")
	case errors.Is(err, domain.ErrAccountDeactivated):
		return status.Error(codes.PermissionDenied, "account deactivated")
	case errors.Is(err, domain.ErrProviderProfileNotFound):
		return status.Error(codes.NotFound, "provider profile not found")
	case errors.Is(err, domain.ErrInvalidRole):
		return status.Error(codes.InvalidArgument, "invalid role")
	case errors.Is(err, domain.ErrCategoryNotFound):
		return status.Error(codes.NotFound, "category not found")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
