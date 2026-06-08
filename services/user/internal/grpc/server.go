package grpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
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
	auth               *service.Auth
	profile            *service.Profile
	admin              *service.Admin
	phone              *service.PhoneVerification
	verification       *service.Verification
	erasure            *service.Erasure
	notificationClient notificationv1.NotificationServiceClient
	baseURL            string
}

// NewServer creates a new gRPC server for the user service.
//
// `erasure` may be nil — when nil, the GDPR/CCPA endpoints will return
// FailedPrecondition. This lets older test setups keep working without
// having to wire the erasure pipeline.
func NewServer(
	auth *service.Auth,
	profile *service.Profile,
	admin *service.Admin,
	phone *service.PhoneVerification,
	verification *service.Verification,
	erasure *service.Erasure,
	notificationClient notificationv1.NotificationServiceClient,
	baseURL string,
) *Server {
	return &Server{
		auth:               auth,
		profile:            profile,
		admin:              admin,
		phone:              phone,
		verification:       verification,
		erasure:            erasure,
		notificationClient: notificationClient,
		baseURL:            baseURL,
	}
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

	userID, pair, verificationToken, err := s.auth.Register(ctx, input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	s.sendVerificationEmail(ctx, userID, input.Email, verificationToken)

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

	userID, pair, mfaRequired, mfaChallengeToken, err := s.auth.Login(ctx, input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	resp := &userv1.LoginResponse{
		UserId:            userID,
		MfaRequired:       mfaRequired,
		MfaChallengeToken: mfaChallengeToken,
	}

	if pair != nil {
		resp.AccessToken = pair.AccessToken
		resp.RefreshToken = pair.RefreshToken
		resp.AccessTokenExpiresAt = timestamppb.New(pair.AccessTokenExpiresAt)
	}

	return resp, nil
}

func (s *Server) FindOrCreateByOAuth(ctx context.Context, req *userv1.FindOrCreateByOAuthRequest) (*userv1.FindOrCreateByOAuthResponse, error) {
	if req.GetProvider() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider is required")
	}
	if req.GetProviderId() == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_id is required")
	}
	if req.GetEmail() == "" {
		return nil, status.Error(codes.InvalidArgument, "email is required")
	}

	input := domain.OAuthInput{
		Provider:   req.GetProvider(),
		ProviderID: req.GetProviderId(),
		Email:      req.GetEmail(),
		Name:       req.GetName(),
		AvatarURL:  req.GetAvatarUrl(),
	}

	userID, pair, isNewUser, err := s.auth.FindOrCreateByOAuth(ctx, input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.FindOrCreateByOAuthResponse{
		UserId:               userID,
		IsNewUser:            isNewUser,
		AccessToken:          pair.AccessToken,
		RefreshToken:         pair.RefreshToken,
		AccessTokenExpiresAt: timestamppb.New(pair.AccessTokenExpiresAt),
	}, nil
}

func (s *Server) RefreshToken(ctx context.Context, req *userv1.RefreshTokenRequest) (*userv1.RefreshTokenResponse, error) {
	pair, err := s.auth.RefreshToken(ctx, req.GetRefreshToken())
	if err != nil {
		slog.Error("refresh token failed", "error", err)
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

func (s *Server) ResendVerification(ctx context.Context, req *userv1.ResendVerificationRequest) (*userv1.ResendVerificationResponse, error) {
	if req.GetEmail() == "" {
		return nil, status.Error(codes.InvalidArgument, "email is required")
	}

	user, token, err := s.auth.ResendVerification(ctx, req.GetEmail())
	if err != nil {
		// Log but don't reveal whether the email exists.
		slog.Info("resend verification attempted", "email", req.GetEmail(), "error", err)
		return &userv1.ResendVerificationResponse{}, nil
	}

	s.sendVerificationEmail(ctx, user.ID, user.Email, token)
	return &userv1.ResendVerificationResponse{}, nil
}

func (s *Server) RequestPasswordReset(ctx context.Context, req *userv1.RequestPasswordResetRequest) (*userv1.RequestPasswordResetResponse, error) {
	if req.GetEmail() == "" {
		return nil, status.Error(codes.InvalidArgument, "email is required")
	}

	user, token, matched, err := s.auth.RequestPasswordReset(ctx, req.GetEmail())
	if err != nil {
		// Never reveal whether the email exists — log internally and still
		// return ok so the gateway can hold the anti-enumeration contract.
		slog.Error("password reset request failed", "error", err)
		return &userv1.RequestPasswordResetResponse{}, nil
	}

	if matched {
		s.sendPasswordResetEmail(ctx, user.ID, user.Email, token)
	}

	return &userv1.RequestPasswordResetResponse{}, nil
}

func (s *Server) ResetPassword(ctx context.Context, req *userv1.ResetPasswordRequest) (*userv1.ResetPasswordResponse, error) {
	if req.GetToken() == "" {
		return nil, status.Error(codes.InvalidArgument, "token is required")
	}
	if req.GetNewPassword() == "" {
		return nil, status.Error(codes.InvalidArgument, "new_password is required")
	}

	if err := s.auth.ResetPassword(ctx, req.GetToken(), req.GetNewPassword()); err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.ResetPasswordResponse{Success: true}, nil
}

// sendPasswordResetEmail dispatches a password-reset email via the notification
// service. Failures are logged but not propagated.
func (s *Server) sendPasswordResetEmail(ctx context.Context, userID, email, resetToken string) {
	if s.notificationClient == nil {
		slog.Warn("notification client not configured, password reset email not sent", "user_id", userID)
		return
	}
	_, err := s.notificationClient.SendNotification(ctx, &notificationv1.SendNotificationRequest{
		UserId:           userID,
		NotificationType: notificationv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED,
		Title:            "Reset your NoMarkup password",
		Body:             fmt.Sprintf("Click this link to reset your password: %s/reset-password?token=%s\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.", s.baseURL, resetToken),
		ActionUrl:        fmt.Sprintf("%s/reset-password?token=%s", s.baseURL, resetToken),
		Data: map[string]string{
			"user_email": email,
		},
		Channels: []notificationv1.NotificationChannel{
			notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_EMAIL,
		},
	})
	if err != nil {
		slog.Error("failed to send password reset email", "user_id", userID, "error", err)
	}
}

// sendVerificationEmail dispatches a verification email via the notification service.
// Failures are logged but not propagated so the caller can continue.
func (s *Server) sendVerificationEmail(ctx context.Context, userID, email, verificationToken string) {
	if s.notificationClient != nil {
		_, err := s.notificationClient.SendNotification(ctx, &notificationv1.SendNotificationRequest{
			UserId:           userID,
			NotificationType: notificationv1.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED,
			Title:            "Verify your NoMarkup email",
			Body:             fmt.Sprintf("Your verification code is: %s\n\nOr click this link to verify: %s/verify-email?token=%s", verificationToken, s.baseURL, verificationToken),
			ActionUrl:        fmt.Sprintf("%s/verify-email?token=%s", s.baseURL, verificationToken),
			Data: map[string]string{
				"user_email": email,
			},
			Channels: []notificationv1.NotificationChannel{
				notificationv1.NotificationChannel_NOTIFICATION_CHANNEL_EMAIL,
			},
		})
		if err != nil {
			slog.Error("failed to send verification email", "user_id", userID, "error", err)
			// Don't fail registration — the user can request a resend.
		}
	} else {
		slog.Warn("notification client not configured, verification email not sent", "user_id", userID)
	}
}

func (s *Server) SendPhoneOTP(ctx context.Context, req *userv1.SendPhoneOTPRequest) (*userv1.SendPhoneOTPResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if req.GetPhone() == "" {
		return nil, status.Error(codes.InvalidArgument, "phone is required")
	}

	if err := s.phone.SendPhoneOTP(ctx, req.GetUserId(), req.GetPhone()); err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.SendPhoneOTPResponse{Sent: true}, nil
}

func (s *Server) VerifyPhone(ctx context.Context, req *userv1.VerifyPhoneRequest) (*userv1.VerifyPhoneResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if req.GetOtpCode() == "" {
		return nil, status.Error(codes.InvalidArgument, "otp_code is required")
	}

	if err := s.phone.VerifyPhone(ctx, req.GetUserId(), req.GetOtpCode()); err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.VerifyPhoneResponse{Verified: true}, nil
}

// --- MFA ---

func (s *Server) EnableMFA(ctx context.Context, req *userv1.EnableMFARequest) (*userv1.EnableMFAResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	secret, qrURL, backupCodes, err := s.auth.GenerateMFASetup(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.EnableMFAResponse{
		Secret:      secret,
		QrCodeUrl:   qrURL,
		BackupCodes: backupCodes,
	}, nil
}

func (s *Server) ConfirmMFASetup(ctx context.Context, req *userv1.ConfirmMFASetupRequest) (*userv1.ConfirmMFASetupResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if req.GetTotpCode() == "" {
		return nil, status.Error(codes.InvalidArgument, "totp_code is required")
	}

	if err := s.auth.VerifyAndEnableMFA(ctx, req.GetUserId(), req.GetTotpCode(), req.GetBackupCodes()); err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.ConfirmMFASetupResponse{Success: true}, nil
}

func (s *Server) VerifyMFA(ctx context.Context, req *userv1.VerifyMFARequest) (*userv1.VerifyMFAResponse, error) {
	if req.GetMfaChallengeToken() == "" {
		return nil, status.Error(codes.InvalidArgument, "mfa_challenge_token is required")
	}
	if req.GetTotpCode() == "" {
		return nil, status.Error(codes.InvalidArgument, "totp_code is required")
	}

	_, pair, err := s.auth.CompleteMFALogin(ctx, req.GetMfaChallengeToken(), req.GetTotpCode(), "", "")
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.VerifyMFAResponse{
		AccessToken:          pair.AccessToken,
		RefreshToken:         pair.RefreshToken,
		AccessTokenExpiresAt: timestamppb.New(pair.AccessTokenExpiresAt),
	}, nil
}

func (s *Server) DisableMFA(ctx context.Context, req *userv1.DisableMFARequest) (*userv1.DisableMFAResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if req.GetTotpCode() == "" {
		return nil, status.Error(codes.InvalidArgument, "totp_code is required")
	}

	if err := s.auth.DisableMFA(ctx, req.GetUserId(), req.GetTotpCode()); err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.DisableMFAResponse{Success: true}, nil
}

func (s *Server) UploadDocument(ctx context.Context, req *userv1.UploadDocumentRequest) (*userv1.UploadDocumentResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if req.GetDocumentType() == "" {
		return nil, status.Error(codes.InvalidArgument, "document_type is required")
	}

	storageURL := ""
	fileName := ""
	if req.GetFile() != nil {
		storageURL = req.GetFile().GetUrl()
		fileName = req.GetFile().GetName()
	}

	doc, err := s.verification.UploadDocument(ctx, req.GetUserId(), domain.DocumentType(req.GetDocumentType()), fileName, storageURL)
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.UploadDocumentResponse{
		DocumentId: doc.ID,
		Status:     stringToProtoVerificationStatus(string(doc.Status)),
	}, nil
}

func (s *Server) GetDocumentStatus(ctx context.Context, req *userv1.GetDocumentStatusRequest) (*userv1.GetDocumentStatusResponse, error) {
	if req.GetDocumentId() == "" {
		return nil, status.Error(codes.InvalidArgument, "document_id is required")
	}

	doc, err := s.verification.GetDocumentStatus(ctx, req.GetDocumentId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	resp := &userv1.GetDocumentStatusResponse{
		Id:              doc.ID,
		DocumentType:    string(doc.Type),
		Status:          stringToProtoVerificationStatus(string(doc.Status)),
		RejectionReason: doc.RejectionReason,
	}
	if doc.ExpiresAt != nil {
		resp.ExpiresAt = timestamppb.New(*doc.ExpiresAt)
	}
	return resp, nil
}

func (s *Server) ListDocuments(ctx context.Context, req *userv1.ListDocumentsRequest) (*userv1.ListDocumentsResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	docs, err := s.verification.ListDocuments(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoDocs := make([]*userv1.GetDocumentStatusResponse, 0, len(docs))
	for _, doc := range docs {
		pd := &userv1.GetDocumentStatusResponse{
			Id:              doc.ID,
			DocumentType:    string(doc.Type),
			Status:          stringToProtoVerificationStatus(string(doc.Status)),
			RejectionReason: doc.RejectionReason,
		}
		if doc.ExpiresAt != nil {
			pd.ExpiresAt = timestamppb.New(*doc.ExpiresAt)
		}
		protoDocs = append(protoDocs, pd)
	}

	return &userv1.ListDocumentsResponse{Documents: protoDocs}, nil
}

func (s *Server) AdminReviewDocument(ctx context.Context, req *userv1.AdminReviewDocumentRequest) (*userv1.AdminReviewDocumentResponse, error) {
	if req.GetDocumentId() == "" {
		return nil, status.Error(codes.InvalidArgument, "document_id is required")
	}
	if req.GetAdminId() == "" {
		return nil, status.Error(codes.InvalidArgument, "admin_id is required")
	}

	if err := s.verification.AdminReviewDocument(ctx, req.GetDocumentId(), req.GetApproved(), req.GetRejectionReason()); err != nil {
		return nil, mapDomainError(err)
	}

	resultStatus := commonv1.VerificationStatus_VERIFICATION_STATUS_VERIFIED
	if !req.GetApproved() {
		resultStatus = commonv1.VerificationStatus_VERIFICATION_STATUS_REJECTED
	}

	return &userv1.AdminReviewDocumentResponse{Status: resultStatus}, nil
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

// --- Property RPCs ---

func (s *Server) ListProperties(ctx context.Context, req *userv1.ListPropertiesRequest) (*userv1.ListPropertiesResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	properties, err := s.profile.ListProperties(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoProps := make([]*userv1.Property, 0, len(properties))
	for _, p := range properties {
		protoProps = append(protoProps, domainPropertyToProto(&p))
	}

	return &userv1.ListPropertiesResponse{Properties: protoProps}, nil
}

func (s *Server) CreateProperty(ctx context.Context, req *userv1.CreatePropertyRequest) (*userv1.CreatePropertyResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	input := domain.CreatePropertyInput{
		UserID:    req.GetUserId(),
		Nickname:  req.GetNickname(),
		Notes:     req.GetNotes(),
		IsPrimary: req.GetIsPrimary(),
	}

	if addr := req.GetAddress(); addr != nil {
		input.Address = addr.GetStreet()
		input.City = addr.GetCity()
		input.State = addr.GetState()
		input.ZipCode = addr.GetZipCode()
		if loc := addr.GetLocation(); loc != nil {
			input.Latitude = loc.GetLatitude()
			input.Longitude = loc.GetLongitude()
		}
	}

	prop, err := s.profile.CreateProperty(ctx, input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.CreatePropertyResponse{Property: domainPropertyToProto(prop)}, nil
}

func (s *Server) UpdateProperty(ctx context.Context, req *userv1.UpdatePropertyRequest) (*userv1.UpdatePropertyResponse, error) {
	if req.GetPropertyId() == "" {
		return nil, status.Error(codes.InvalidArgument, "property_id is required")
	}

	input := domain.UpdatePropertyInput{
		Nickname:  req.Nickname,
		Notes:     req.Notes,
		IsPrimary: req.IsPrimary,
	}

	prop, err := s.profile.UpdateProperty(ctx, req.GetPropertyId(), input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.UpdatePropertyResponse{Property: domainPropertyToProto(prop)}, nil
}

func (s *Server) DeleteProperty(ctx context.Context, req *userv1.DeletePropertyRequest) (*userv1.DeletePropertyResponse, error) {
	if req.GetPropertyId() == "" {
		return nil, status.Error(codes.InvalidArgument, "property_id is required")
	}

	if err := s.profile.DeleteProperty(ctx, req.GetPropertyId()); err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.DeletePropertyResponse{}, nil
}

func domainPropertyToProto(p *domain.Property) *userv1.Property {
	if p == nil {
		return nil
	}

	prop := &userv1.Property{
		Id:        p.ID,
		UserId:    p.UserID,
		Nickname:  p.Nickname,
		Notes:     p.Notes,
		IsPrimary: p.IsPrimary,
		CreatedAt: timestamppb.New(p.CreatedAt),
		Address: &commonv1.Address{
			Street:  p.Address,
			City:    p.City,
			State:   p.State,
			ZipCode: p.ZipCode,
			Location: &commonv1.Location{
				Latitude:  p.Latitude,
				Longitude: p.Longitude,
			},
		},
	}

	return prop
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

func (s *Server) AdminReactivateUser(ctx context.Context, req *userv1.AdminReactivateUserRequest) (*userv1.AdminReactivateUserResponse, error) {
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if req.GetAdminId() == "" {
		return nil, status.Error(codes.InvalidArgument, "admin_id is required")
	}

	if err := s.admin.ReactivateUser(ctx, req.GetUserId(), req.GetAdminId()); err != nil {
		return nil, mapDomainError(err)
	}

	if err := s.admin.InsertAuditLog(ctx, req.GetAdminId(), "reactivate_user", "user", req.GetUserId(), map[string]any{
		"note": req.GetNote(),
	}, ""); err != nil {
		slog.Warn("failed to insert audit log for reactivate",
			"user_id", req.GetUserId(),
			"admin_id", req.GetAdminId(),
			"error", err,
		)
	}

	user, err := s.admin.AdminGetUser(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}

	return &userv1.AdminReactivateUserResponse{
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

	roleFilter := ""
	if req.RoleFilter != nil && *req.RoleFilter != commonv1.UserRole_USER_ROLE_UNSPECIFIED {
		roleFilter = protoRoleToString(*req.RoleFilter)
	}

	users, total, err := s.admin.AdminSearchUsers(ctx, req.GetQuery(), statusFilter, roleFilter, page, pageSize)
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

func (s *Server) AdminListPendingDocuments(ctx context.Context, req *userv1.AdminListPendingDocumentsRequest) (*userv1.AdminListPendingDocumentsResponse, error) {
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

	docs, total, err := s.admin.AdminListPendingDocuments(ctx, page, pageSize)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoDocs := make([]*userv1.PendingDocument, 0, len(docs))
	for i := range docs {
		d := &docs[i]
		protoDocs = append(protoDocs, &userv1.PendingDocument{
			Id:              d.ID,
			UserId:          d.UserID,
			UserEmail:       d.UserEmail,
			UserDisplayName: d.UserDisplayName,
			DocumentType:    string(d.Type),
			Status:          stringToProtoVerificationStatus(string(d.Status)),
			FileName:        d.FileName,
			FileUrl:         d.StorageURL,
			CreatedAt:       timestamppb.New(d.CreatedAt),
		})
	}

	totalPages := int32(total) / int32(pageSize)
	if int32(total)%int32(pageSize) > 0 {
		totalPages++
	}

	return &userv1.AdminListPendingDocumentsResponse{
		Documents: protoDocs,
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

func (s *Server) SearchProviders(ctx context.Context, req *userv1.SearchProvidersRequest) (*userv1.SearchProvidersResponse, error) {
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

	input := domain.ProviderSearchInput{
		CategoryIDs: req.GetCategoryIds(),
		RadiusKm:    req.GetRadiusKm(),
		Page:        page,
		PageSize:    pageSize,
	}

	if loc := req.GetLocation(); loc != nil {
		lat := loc.GetLatitude()
		lng := loc.GetLongitude()
		input.Latitude = &lat
		input.Longitude = &lng
	}

	if req.MinRating != nil {
		input.MinRating = req.MinRating
	}

	if req.MinTrustTier != nil {
		tier := protoTrustTierToString(*req.MinTrustTier)
		input.MinTrustTier = &tier
	}

	if req.VerifiedOnly != nil {
		input.VerifiedOnly = req.VerifiedOnly
	}

	if req.InstantAvailable != nil {
		input.InstantAvailable = req.InstantAvailable
	}

	if sort := req.GetSort(); sort != nil {
		input.SortField = sort.GetField()
		if sort.GetDirection() == commonv1.SortDirection_SORT_DIRECTION_DESC {
			input.SortDirection = "desc"
		} else {
			input.SortDirection = "asc"
		}
	}

	results, total, err := s.profile.SearchProviders(ctx, input)
	if err != nil {
		return nil, mapDomainError(err)
	}

	protoResults := make([]*userv1.ProviderSearchResult, 0, len(results))
	for _, r := range results {
		pr := &userv1.ProviderSearchResult{
			UserId:           r.UserID,
			DisplayName:      r.DisplayName,
			BusinessName:     r.BusinessName,
			AvatarUrl:        r.AvatarURL,
			DistanceKm:       r.DistanceKm,
			InstantAvailable: r.InstantAvailable,
			ReviewSummary: &userv1.ReviewSummary{
				AverageRating: r.AverageRating,
				ReviewCount:   int32(r.ReviewCount),
				OnTimeRate:    r.OnTimeRate,
			},
		}

		if r.TrustScore != nil {
			pr.TrustScore = &userv1.TrustScoreSummary{
				OverallScore:  r.TrustScore.OverallScore,
				Tier:          stringToProtoTrustTier(r.TrustScore.Tier),
				FeedbackScore: r.TrustScore.FeedbackScore,
				VolumeScore:   r.TrustScore.VolumeScore,
				RiskScore:     r.TrustScore.RiskScore,
				FraudScore:    r.TrustScore.FraudScore,
			}
		}

		for _, b := range r.Badges {
			badge := &userv1.VerificationBadge{
				DocumentType: b.DocumentType,
				Status:       stringToProtoVerificationStatus(b.Status),
			}
			if b.VerifiedAt != nil {
				badge.VerifiedAt = timestamppb.New(*b.VerifiedAt)
			}
			if b.ExpiresAt != nil {
				badge.ExpiresAt = timestamppb.New(*b.ExpiresAt)
			}
			pr.Badges = append(pr.Badges, badge)
		}

		for _, c := range r.Categories {
			pr.Categories = append(pr.Categories, &userv1.ServiceCategorySummary{
				Id:         c.ID,
				Name:       c.Name,
				Slug:       c.Slug,
				Level:      int32(c.Level),
				ParentName: c.ParentName,
			})
		}

		protoResults = append(protoResults, pr)
	}

	totalPages := int32(total) / int32(pageSize)
	if int32(total)%int32(pageSize) > 0 {
		totalPages++
	}

	return &userv1.SearchProvidersResponse{
		Providers: protoResults,
		Pagination: &commonv1.PaginationResponse{
			TotalCount: int32(total),
			Page:       int32(page),
			PageSize:   int32(pageSize),
			TotalPages: totalPages,
			HasNext:    int32(page) < totalPages,
		},
	}, nil
}

func protoTrustTierToString(t commonv1.TrustTier) string {
	switch t {
	case commonv1.TrustTier_TRUST_TIER_UNDER_REVIEW:
		return "under_review"
	case commonv1.TrustTier_TRUST_TIER_NEW:
		return "new"
	case commonv1.TrustTier_TRUST_TIER_RISING:
		return "rising"
	case commonv1.TrustTier_TRUST_TIER_TRUSTED:
		return "trusted"
	case commonv1.TrustTier_TRUST_TIER_TOP_RATED:
		return "top_rated"
	default:
		return ""
	}
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

	if p.TrustScore != nil {
		pb.TrustScore = &userv1.TrustScoreSummary{
			OverallScore:  p.TrustScore.OverallScore,
			Tier:          stringToProtoTrustTier(p.TrustScore.Tier),
			FeedbackScore: p.TrustScore.FeedbackScore,
			VolumeScore:   p.TrustScore.VolumeScore,
			RiskScore:     p.TrustScore.RiskScore,
			FraudScore:    p.TrustScore.FraudScore,
		}
	}

	return pb
}

func stringToProtoTrustTier(tier string) commonv1.TrustTier {
	switch tier {
	case "under_review":
		return commonv1.TrustTier_TRUST_TIER_UNDER_REVIEW
	case "new":
		return commonv1.TrustTier_TRUST_TIER_NEW
	case "rising":
		return commonv1.TrustTier_TRUST_TIER_RISING
	case "trusted":
		return commonv1.TrustTier_TRUST_TIER_TRUSTED
	case "top_rated":
		return commonv1.TrustTier_TRUST_TIER_TOP_RATED
	default:
		return commonv1.TrustTier_TRUST_TIER_UNSPECIFIED
	}
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

func stringToProtoVerificationStatus(s string) commonv1.VerificationStatus {
	switch s {
	case "not_uploaded":
		return commonv1.VerificationStatus_VERIFICATION_STATUS_NOT_UPLOADED
	case "pending":
		return commonv1.VerificationStatus_VERIFICATION_STATUS_PENDING
	case "verified":
		return commonv1.VerificationStatus_VERIFICATION_STATUS_VERIFIED
	case "rejected":
		return commonv1.VerificationStatus_VERIFICATION_STATUS_REJECTED
	default:
		return commonv1.VerificationStatus_VERIFICATION_STATUS_UNSPECIFIED
	}
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
	case errors.Is(err, domain.ErrInvalidToken):
		return status.Error(codes.InvalidArgument, "invalid or expired verification token")
	case errors.Is(err, domain.ErrInvalidOTP):
		return status.Error(codes.InvalidArgument, "invalid OTP code")
	case errors.Is(err, domain.ErrOTPExpired):
		return status.Error(codes.InvalidArgument, "OTP code expired")
	case errors.Is(err, domain.ErrDocumentNotFound):
		return status.Error(codes.NotFound, "document not found")
	case errors.Is(err, domain.ErrEmailNotVerified):
		return status.Error(codes.FailedPrecondition, "email not verified")
	case errors.Is(err, domain.ErrInvalidMFACode):
		return status.Error(codes.InvalidArgument, "invalid MFA code")
	case errors.Is(err, domain.ErrMFANotSetup):
		return status.Error(codes.FailedPrecondition, "MFA not set up")
	case errors.Is(err, domain.ErrMFAAlreadyEnabled):
		return status.Error(codes.AlreadyExists, "MFA already enabled")
	case errors.Is(err, domain.ErrInvalidMFAChallengeToken):
		return status.Error(codes.Unauthenticated, "invalid or expired MFA challenge token")
	case errors.Is(err, domain.ErrPropertyNotFound):
		return status.Error(codes.NotFound, "property not found")
	case errors.Is(err, domain.ErrDeletionAlreadyRequested):
		return status.Error(codes.AlreadyExists, "deletion already requested")
	case errors.Is(err, domain.ErrDeletionNotRequested):
		return status.Error(codes.FailedPrecondition, "no deletion request pending")
	case errors.Is(err, domain.ErrDeletionAlreadyFinalized):
		return status.Error(codes.FailedPrecondition, "deletion already finalized")
	case errors.Is(err, domain.ErrDeletionGracePeriodActive):
		return status.Error(codes.FailedPrecondition, "deletion grace period still active")
	case errors.Is(err, domain.ErrDeletionConfirmation):
		return status.Error(codes.InvalidArgument, "deletion confirmation phrase invalid")
	default:
		return status.Error(codes.Internal, "internal error")
	}
}

// RequestAccountDeletion handles the GDPR/CCPA self-service erasure request.
func (s *Server) RequestAccountDeletion(ctx context.Context, req *userv1.RequestAccountDeletionRequest) (*userv1.RequestAccountDeletionResponse, error) {
	if s.erasure == nil {
		return nil, status.Error(codes.FailedPrecondition, "erasure pipeline not configured")
	}
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	deadline, created, err := s.erasure.RequestAccountDeletion(ctx, req.GetUserId(), req.GetReason(), req.GetConfirmation())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.RequestAccountDeletionResponse{
		GraceDeadline: timestamppb.New(deadline),
		Created:       created,
	}, nil
}

// CancelAccountDeletion clears a pending deletion request within the grace
// window.
func (s *Server) CancelAccountDeletion(ctx context.Context, req *userv1.CancelAccountDeletionRequest) (*userv1.CancelAccountDeletionResponse, error) {
	if s.erasure == nil {
		return nil, status.Error(codes.FailedPrecondition, "erasure pipeline not configured")
	}
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	cancelled, err := s.erasure.CancelAccountDeletion(ctx, req.GetUserId())
	if err != nil {
		return nil, mapDomainError(err)
	}
	return &userv1.CancelAccountDeletionResponse{Cancelled: cancelled}, nil
}

// FinalizeAccountDeletion runs the erasure cascade. Used by the cron worker
// (force=false) and admin override (force=true).
func (s *Server) FinalizeAccountDeletion(ctx context.Context, req *userv1.FinalizeAccountDeletionRequest) (*userv1.FinalizeAccountDeletionResponse, error) {
	if s.erasure == nil {
		return nil, status.Error(codes.FailedPrecondition, "erasure pipeline not configured")
	}
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	outcome, err := s.erasure.FinalizeAccountDeletion(ctx, req.GetUserId(), req.GetForce())
	if err != nil {
		return nil, mapDomainError(err)
	}

	// Audit-log every finalize (admin force gets the admin_id; cron uses the
	// user's own id as actor since it is system-driven).
	actor := req.GetAdminId()
	if actor == "" {
		actor = req.GetUserId()
	}
	if logErr := s.admin.InsertAuditLog(ctx, actor, "gdpr_finalize", "user", req.GetUserId(), map[string]any{
		"force":                   req.GetForce(),
		"counts":                  outcome.Counts,
		"stripe_customer_outcome": outcome.StripeCustomerOutcome,
		"stripe_account_outcome":  outcome.StripeAccountOutcome,
	}, ""); logErr != nil {
		slog.Warn("gdpr: failed to write audit log",
			"user_id", req.GetUserId(),
			"error", logErr,
		)
	}

	rows := make(map[string]int64, len(outcome.Counts))
	for k, v := range outcome.Counts {
		rows[k] = v
	}

	return &userv1.FinalizeAccountDeletionResponse{
		FinalizedAt:           timestamppb.New(outcome.FinalizedAt),
		RowsAffected:          rows,
		StripeCustomerOutcome: outcome.StripeCustomerOutcome,
		StripeAccountOutcome:  outcome.StripeAccountOutcome,
	}, nil
}
