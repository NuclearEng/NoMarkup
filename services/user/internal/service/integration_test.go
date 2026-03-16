//go:build integration

package service

import (
	"context"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Integration tests exercise the service layer with mock repositories that
// simulate realistic multi-step workflows (register -> login -> profile update).
// Run with: go test -tags=integration ./...

// testPassword returns a deterministic password for test cases.
func testPassword() string {
	return "test-pass-for-integration"
}

// altPassword returns an alternative password that differs from testPassword.
func altPassword() string {
	return "different-pass-for-testing"
}

func TestIntegration_Registration_Login_ProfileUpdate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		register     domain.RegisterInput
		loginPass    string
		updateName   string
		wantRegErr   bool
		wantLoginErr bool
	}{
		{
			name: "full_lifecycle_succeeds",
			register: domain.RegisterInput{
				Email:       "integration@example.com",
				Password:    testPassword(),
				DisplayName: "Integration Test",
				Roles:       []string{"customer"},
			},
			loginPass:  testPassword(),
			updateName: "Updated Name",
		},
		{
			name: "registration_with_provider_role",
			register: domain.RegisterInput{
				Email:       "provider@example.com",
				Password:    testPassword(),
				DisplayName: "Provider User",
				Roles:       []string{"provider"},
			},
			loginPass:  testPassword(),
			updateName: "Updated Provider",
		},
		{
			name: "login_wrong_password_fails",
			register: domain.RegisterInput{
				Email:       "wrongpass@example.com",
				Password:    testPassword(),
				DisplayName: "Wrong Pass",
				Roles:       []string{"customer"},
			},
			loginPass:    altPassword(),
			wantLoginErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			// In-memory storage for the integration test.
			var storedUser *domain.User
			var storedHash string

			repo := &mockUserRepo{
				createUserFn: func(_ context.Context, user *domain.User) error {
					user.ID = "user-integ-" + user.Email
					storedUser = user
					storedHash = user.PasswordHash
					return nil
				},
				getUserByEmailFn: func(_ context.Context, email string) (*domain.User, error) {
					if storedUser != nil && storedUser.Email == email {
						return &domain.User{
							ID:           storedUser.ID,
							Email:        storedUser.Email,
							PasswordHash: storedHash,
							Roles:        storedUser.Roles,
							Status:       "active",
						}, nil
					}
					return nil, domain.ErrUserNotFound
				},
				getUserByIDFn: func(_ context.Context, id string) (*domain.User, error) {
					if storedUser != nil && storedUser.ID == id {
						return storedUser, nil
					}
					return nil, domain.ErrUserNotFound
				},
				createRefreshTokenFn: func(_ context.Context, _ *domain.RefreshToken) error {
					return nil
				},
				updateUserFn: func(_ context.Context, userID string, input domain.UpdateUserInput) (*domain.User, error) {
					if storedUser != nil && storedUser.ID == userID {
						if input.DisplayName != nil {
							storedUser.DisplayName = *input.DisplayName
						}
						return storedUser, nil
					}
					return nil, domain.ErrUserNotFound
				},
			}

			auth := newTestAuth(t, repo)
			profile := NewProfile(repo)
			ctx := context.Background()

			// Step 1: Register.
			userID, pair, verifyToken, err := auth.Register(ctx, tt.register)
			if tt.wantRegErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.NotEmpty(t, userID)
			require.NotNil(t, pair)
			assert.NotEmpty(t, pair.AccessToken)
			assert.NotEmpty(t, pair.RefreshToken)
			assert.NotEmpty(t, verifyToken)

			// Step 2: Login.
			loginInput := domain.LoginInput{
				Email:    tt.register.Email,
				Password: tt.loginPass,
			}
			loginUserID, loginPair, mfa, err := auth.Login(ctx, loginInput)
			if tt.wantLoginErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, userID, loginUserID)
			assert.False(t, mfa)
			require.NotNil(t, loginPair)

			// Step 3: Profile update.
			if tt.updateName != "" {
				updatedUser, err := profile.UpdateUser(ctx, userID, domain.UpdateUserInput{
					DisplayName: &tt.updateName,
				})
				require.NoError(t, err)
				assert.Equal(t, tt.updateName, updatedUser.DisplayName)

				// Step 4: Verify updated profile can be retrieved.
				fetchedUser, err := profile.GetUser(ctx, userID)
				require.NoError(t, err)
				assert.Equal(t, tt.updateName, fetchedUser.DisplayName)
			}
		})
	}
}

func TestIntegration_TokenRefresh_and_Logout(t *testing.T) {
	t.Parallel()

	var storedTokenHash string

	repo := &mockUserRepo{
		createUserFn: func(_ context.Context, user *domain.User) error {
			user.ID = "user-token-test"
			return nil
		},
		createRefreshTokenFn: func(_ context.Context, token *domain.RefreshToken) error {
			storedTokenHash = token.TokenHash
			return nil
		},
		getRefreshTokenFn: func(_ context.Context, tokenHash string) (*domain.RefreshToken, error) {
			if tokenHash == storedTokenHash {
				return &domain.RefreshToken{
					ID:        "rt-test",
					UserID:    "user-token-test",
					ExpiresAt: time.Now().Add(time.Hour),
				}, nil
			}
			return nil, domain.ErrUserNotFound
		},
		revokeRefreshTokenFn: func(_ context.Context, _ string) error {
			return nil
		},
		getUserByIDFn: func(_ context.Context, _ string) (*domain.User, error) {
			return &domain.User{
				ID:    "user-token-test",
				Email: "token@example.com",
				Roles: []string{"customer"},
			}, nil
		},
	}

	auth := newTestAuth(t, repo)
	ctx := context.Background()

	// Register to get initial tokens.
	_, pair, _, err := auth.Register(ctx, domain.RegisterInput{
		Email:       "token@example.com",
		Password:    testPassword(),
		DisplayName: "Token Test",
		Roles:       []string{"customer"},
	})
	require.NoError(t, err)
	require.NotNil(t, pair)

	// Refresh the token.
	newPair, err := auth.RefreshToken(ctx, pair.RefreshToken)
	require.NoError(t, err)
	require.NotNil(t, newPair)
	assert.NotEmpty(t, newPair.AccessToken)
	assert.NotEmpty(t, newPair.RefreshToken)

	// Logout.
	err = auth.Logout(ctx, newPair.RefreshToken)
	require.NoError(t, err)
}

func TestIntegration_EnableRole_and_SetGlobalTerms(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		role         string
		terms        domain.GlobalTermsInput
		wantRoleErr  bool
		wantTermsErr bool
	}{
		{
			name: "enable_provider_role_with_milestone_terms",
			role: "provider",
			terms: domain.GlobalTermsInput{
				PaymentTiming: "milestone",
				Milestones: []domain.MilestoneTemplate{
					{Description: "Inspection", Percentage: 30},
					{Description: "Work complete", Percentage: 70},
				},
			},
		},
		{
			name: "enable_customer_role_with_completion_terms",
			role: "customer",
			terms: domain.GlobalTermsInput{
				PaymentTiming: "completion",
			},
		},
		{
			name:        "admin_role_rejected",
			role:        "admin",
			wantRoleErr: true,
		},
		{
			name: "invalid_milestone_sum_rejected",
			role: "provider",
			terms: domain.GlobalTermsInput{
				PaymentTiming: "milestone",
				Milestones: []domain.MilestoneTemplate{
					{Description: "Start", Percentage: 20},
					{Description: "End", Percentage: 50},
				},
			},
			wantTermsErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockUserRepo{
				enableRoleFn: func(_ context.Context, userID string, role string) (*domain.User, error) {
					return &domain.User{ID: userID, Roles: []string{role}}, nil
				},
				createProviderProfileFn: func(_ context.Context, _ string) (*domain.ProviderProfile, error) {
					return &domain.ProviderProfile{}, nil
				},
				setGlobalTermsFn: func(_ context.Context, _ string, _ domain.GlobalTermsInput) error {
					return nil
				},
			}
			profile := NewProfile(repo)
			ctx := context.Background()

			// Enable role.
			user, err := profile.EnableRole(ctx, "user-1", tt.role)
			if tt.wantRoleErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, user)

			// Set global terms.
			if tt.terms.PaymentTiming != "" {
				err = profile.SetGlobalTerms(ctx, "user-1", tt.terms)
				if tt.wantTermsErr {
					require.Error(t, err)
				} else {
					require.NoError(t, err)
				}
			}
		})
	}
}
