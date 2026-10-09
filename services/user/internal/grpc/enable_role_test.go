package grpc

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net"
	"testing"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	userv1 "github.com/nomarkup/nomarkup/proto/user/v1"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/nomarkup/nomarkup/services/user/internal/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// enableRoleTokenRepo stubs only the calls EnableRole + IssueSession make.
type enableRoleTokenRepo struct {
	domain.UserRepository
	user   *domain.User
	stored *domain.RefreshToken
}

func (r *enableRoleTokenRepo) EnableRole(_ context.Context, userID, role string) (*domain.User, error) {
	if r.user == nil || r.user.ID != userID {
		return nil, domain.ErrUserNotFound
	}
	roles := append([]string(nil), r.user.Roles...)
	for _, existing := range roles {
		if existing == role {
			updated := *r.user
			updated.Roles = roles
			return &updated, nil
		}
	}
	roles = append(roles, role)
	updated := *r.user
	updated.Roles = roles
	r.user = &updated
	return &updated, nil
}

func (r *enableRoleTokenRepo) CreateProviderProfile(_ context.Context, userID string) (*domain.ProviderProfile, error) {
	return &domain.ProviderProfile{UserID: userID}, nil
}

func (r *enableRoleTokenRepo) CreateRefreshToken(_ context.Context, token *domain.RefreshToken) error {
	copied := *token
	r.stored = &copied
	return nil
}

func TestEnableRole_customerReceivesProviderClaim(t *testing.T) {
	t.Parallel()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	repo := &enableRoleTokenRepo{
		user: &domain.User{
			ID:     "user-1",
			Email:  "customer@example.com",
			Roles:  []string{"customer"},
			Status: "active",
		},
	}
	jwtMgr := service.NewJWTManager(key)
	auth := service.NewAuth(repo, jwtMgr, "0123456789abcdef0123456789abcdef", false)
	profile := service.NewProfile(repo)
	srv := NewServer(auth, profile, nil, nil, nil, nil, nil, "http://localhost")

	resp, err := srv.EnableRole(context.Background(), &userv1.EnableRoleRequest{
		UserId:     "user-1",
		Role:       commonv1.UserRole_USER_ROLE_PROVIDER,
		DeviceInfo: "ios",
		IpAddress:  "203.0.113.10",
	})
	require.NoError(t, err)
	require.NotNil(t, resp.GetUser())
	require.NotEmpty(t, resp.GetAccessToken())
	require.NotEmpty(t, resp.GetRefreshToken())
	require.NotNil(t, resp.GetAccessTokenExpiresAt())

	claims, err := jwtMgr.ValidateAccessToken(resp.GetAccessToken())
	require.NoError(t, err)
	assert.Equal(t, "user-1", claims.Subject)
	assert.Equal(t, "customer@example.com", claims.Email)
	assert.Contains(t, claims.Roles, "customer")
	assert.Contains(t, claims.Roles, "provider")

	require.NotNil(t, repo.stored)
	assert.Equal(t, "user-1", repo.stored.UserID)
	assert.Equal(t, "ios", repo.stored.DeviceInfo)
	assert.True(t, net.ParseIP("203.0.113.10").Equal(repo.stored.IPAddress))
	assert.Empty(t, repo.stored.FamilyID)
}

func TestEnableRole_adminStillRejected(t *testing.T) {
	t.Parallel()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	repo := &enableRoleTokenRepo{
		user: &domain.User{
			ID:    "user-1",
			Email: "customer@example.com",
			Roles: []string{"customer"},
		},
	}
	auth := service.NewAuth(repo, service.NewJWTManager(key), "0123456789abcdef0123456789abcdef", false)
	srv := NewServer(auth, service.NewProfile(repo), nil, nil, nil, nil, nil, "http://localhost")

	_, err = srv.EnableRole(context.Background(), &userv1.EnableRoleRequest{
		UserId: "user-1",
		Role:   commonv1.UserRole_USER_ROLE_ADMIN,
	})
	require.Error(t, err)
	assert.Equal(t, codes.InvalidArgument, status.Code(err))
	assert.Nil(t, repo.stored, "rejected admin grant must not mint a session")
}
