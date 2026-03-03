package grpc

import (
	"context"
	"errors"
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
	auth *service.Auth
}

// NewServer creates a new gRPC server for the user service.
func NewServer(auth *service.Auth) *Server {
	return &Server{auth: auth}
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
	default:
		return status.Error(codes.Internal, "internal error")
	}
}
