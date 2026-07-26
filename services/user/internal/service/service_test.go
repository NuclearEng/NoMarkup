package service

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mock Repository ---

type mockUserRepo struct {
	createUserFn            func(ctx context.Context, user *domain.User) error
	getUserByIDFn           func(ctx context.Context, id string) (*domain.User, error)
	getUserByEmailFn        func(ctx context.Context, email string) (*domain.User, error)
	updateLastLoginFn       func(ctx context.Context, userID string, at time.Time) error
	updateEmailVerifiedFn   func(ctx context.Context, userID string, verified bool) error
	updatePasswordFn        func(ctx context.Context, userID, passwordHash string) error
	createRefreshTokenFn         func(ctx context.Context, token *domain.RefreshToken) error
	getRefreshTokenFn            func(ctx context.Context, tokenHash string) (*domain.RefreshToken, error)
	revokeRefreshTokenFn         func(ctx context.Context, tokenHash string) error
	rotateRefreshTokenIfActiveFn func(ctx context.Context, tokenHash string) (bool, error)
	revokeRefreshTokenFamilyFn   func(ctx context.Context, familyID string) (int64, error)
	revokeAllUserTokensFn        func(ctx context.Context, userID string) error
	getPublicUsersByIDsFn        func(ctx context.Context, ids []string) ([]domain.PublicUser, error)
	updateUserFn            func(ctx context.Context, userID string, input domain.UpdateUserInput) (*domain.User, error)
	enableRoleFn            func(ctx context.Context, userID string, role string) (*domain.User, error)
	createProviderProfileFn func(ctx context.Context, userID string) (*domain.ProviderProfile, error)
	getProviderProfileFn    func(ctx context.Context, userID string) (*domain.ProviderProfile, error)
	updateProviderProfileFn func(ctx context.Context, userID string, input domain.UpdateProviderInput) (*domain.ProviderProfile, error)
	setGlobalTermsFn        func(ctx context.Context, userID string, input domain.GlobalTermsInput) error
	updateServiceCatsFn     func(ctx context.Context, providerID string, categoryIDs []string) error
	updatePortfolioFn       func(ctx context.Context, providerID string, images []domain.PortfolioImage) error
	setInstantAvailFn       func(ctx context.Context, userID string, input domain.AvailabilityInput) error
	getProviderIDFn         func(ctx context.Context, userID string) (string, error)
	getServiceCatsFn        func(ctx context.Context, providerID string) ([]domain.ServiceCategory, error)
	getPortfolioImagesFn    func(ctx context.Context, providerID string) ([]domain.PortfolioImage, error)
	listServiceCatsFn       func(ctx context.Context, level *int, parentID *string) ([]domain.ServiceCategory, error)
	getCategoryTreeFn       func(ctx context.Context) ([]domain.ServiceCategory, error)
	suspendUserFn           func(ctx context.Context, userID, reason, adminID string) error
	banUserFn               func(ctx context.Context, userID, reason, adminID string) error
	insertAuditLogFn        func(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any, ipAddress string) error
	adminSearchUsersFn      func(ctx context.Context, query, status, role string, page, pageSize int) ([]domain.User, int, error)
}

func (m *mockUserRepo) CreateUser(ctx context.Context, user *domain.User) error {
	return m.createUserFn(ctx, user)
}
func (m *mockUserRepo) GetUserByID(ctx context.Context, id string) (*domain.User, error) {
	return m.getUserByIDFn(ctx, id)
}
func (m *mockUserRepo) GetUserByEmail(ctx context.Context, email string) (*domain.User, error) {
	return m.getUserByEmailFn(ctx, email)
}
func (m *mockUserRepo) UpdateLastLogin(ctx context.Context, userID string, at time.Time) error {
	if m.updateLastLoginFn != nil {
		return m.updateLastLoginFn(ctx, userID, at)
	}
	return nil
}
func (m *mockUserRepo) UpdateEmailVerified(ctx context.Context, userID string, verified bool) error {
	return m.updateEmailVerifiedFn(ctx, userID, verified)
}
func (m *mockUserRepo) UpdatePassword(ctx context.Context, userID, passwordHash string) error {
	if m.updatePasswordFn != nil {
		return m.updatePasswordFn(ctx, userID, passwordHash)
	}
	return nil
}
func (m *mockUserRepo) CreateRefreshToken(ctx context.Context, token *domain.RefreshToken) error {
	return m.createRefreshTokenFn(ctx, token)
}
func (m *mockUserRepo) GetRefreshToken(ctx context.Context, tokenHash string) (*domain.RefreshToken, error) {
	return m.getRefreshTokenFn(ctx, tokenHash)
}
func (m *mockUserRepo) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	return m.revokeRefreshTokenFn(ctx, tokenHash)
}
func (m *mockUserRepo) RotateRefreshTokenIfActive(ctx context.Context, tokenHash string) (bool, error) {
	return m.rotateRefreshTokenIfActiveFn(ctx, tokenHash)
}
func (m *mockUserRepo) RevokeRefreshTokenFamily(ctx context.Context, familyID string) (int64, error) {
	if m.revokeRefreshTokenFamilyFn != nil {
		return m.revokeRefreshTokenFamilyFn(ctx, familyID)
	}
	return 0, nil
}
func (m *mockUserRepo) GetPublicUsersByIDs(ctx context.Context, ids []string) ([]domain.PublicUser, error) {
	if m.getPublicUsersByIDsFn != nil {
		return m.getPublicUsersByIDsFn(ctx, ids)
	}
	return nil, nil
}
func (m *mockUserRepo) RevokeAllUserTokens(ctx context.Context, userID string) error {
	if m.revokeAllUserTokensFn != nil {
		return m.revokeAllUserTokensFn(ctx, userID)
	}
	return nil
}
func (m *mockUserRepo) UpdateUser(ctx context.Context, userID string, input domain.UpdateUserInput) (*domain.User, error) {
	return m.updateUserFn(ctx, userID, input)
}
func (m *mockUserRepo) EnableRole(ctx context.Context, userID string, role string) (*domain.User, error) {
	return m.enableRoleFn(ctx, userID, role)
}
func (m *mockUserRepo) CreateProviderProfile(ctx context.Context, userID string) (*domain.ProviderProfile, error) {
	return m.createProviderProfileFn(ctx, userID)
}
func (m *mockUserRepo) GetProviderProfile(ctx context.Context, userID string) (*domain.ProviderProfile, error) {
	return m.getProviderProfileFn(ctx, userID)
}
func (m *mockUserRepo) UpdateProviderProfile(ctx context.Context, userID string, input domain.UpdateProviderInput) (*domain.ProviderProfile, error) {
	return m.updateProviderProfileFn(ctx, userID, input)
}
func (m *mockUserRepo) SetGlobalTerms(ctx context.Context, userID string, input domain.GlobalTermsInput) error {
	return m.setGlobalTermsFn(ctx, userID, input)
}
func (m *mockUserRepo) UpdateServiceCategories(ctx context.Context, providerID string, categoryIDs []string) error {
	return m.updateServiceCatsFn(ctx, providerID, categoryIDs)
}
func (m *mockUserRepo) UpdatePortfolio(ctx context.Context, providerID string, images []domain.PortfolioImage) error {
	return m.updatePortfolioFn(ctx, providerID, images)
}
func (m *mockUserRepo) SetInstantAvailability(ctx context.Context, userID string, input domain.AvailabilityInput) error {
	return m.setInstantAvailFn(ctx, userID, input)
}
func (m *mockUserRepo) GetProviderIDByUserID(ctx context.Context, userID string) (string, error) {
	return m.getProviderIDFn(ctx, userID)
}
func (m *mockUserRepo) GetServiceCategories(ctx context.Context, providerID string) ([]domain.ServiceCategory, error) {
	return m.getServiceCatsFn(ctx, providerID)
}
func (m *mockUserRepo) GetPortfolioImages(ctx context.Context, providerID string) ([]domain.PortfolioImage, error) {
	return m.getPortfolioImagesFn(ctx, providerID)
}
func (m *mockUserRepo) ListServiceCategories(ctx context.Context, level *int, parentID *string) ([]domain.ServiceCategory, error) {
	return m.listServiceCatsFn(ctx, level, parentID)
}
func (m *mockUserRepo) GetCategoryTree(ctx context.Context) ([]domain.ServiceCategory, error) {
	return m.getCategoryTreeFn(ctx)
}
func (m *mockUserRepo) SuspendUser(ctx context.Context, userID, reason, adminID string) error {
	if m.suspendUserFn != nil {
		return m.suspendUserFn(ctx, userID, reason, adminID)
	}
	return nil
}
func (m *mockUserRepo) BanUser(ctx context.Context, userID, reason, adminID string) error {
	if m.banUserFn != nil {
		return m.banUserFn(ctx, userID, reason, adminID)
	}
	return nil
}
func (m *mockUserRepo) SuspendUserAndRevokeTokens(ctx context.Context, userID, reason, adminID string) error {
	if m.suspendUserFn != nil {
		if err := m.suspendUserFn(ctx, userID, reason, adminID); err != nil {
			return err
		}
	}
	if m.revokeAllUserTokensFn != nil {
		return m.revokeAllUserTokensFn(ctx, userID)
	}
	return nil
}
func (m *mockUserRepo) BanUserAndRevokeTokens(ctx context.Context, userID, reason, adminID string) error {
	if m.banUserFn != nil {
		if err := m.banUserFn(ctx, userID, reason, adminID); err != nil {
			return err
		}
	}
	if m.revokeAllUserTokensFn != nil {
		return m.revokeAllUserTokensFn(ctx, userID)
	}
	return nil
}
func (m *mockUserRepo) ReactivateUser(ctx context.Context, userID, adminID string) error {
	// No mock hook needed today — admin tests exercise the full Admin service
	// directly and do not assert on this path. Return nil so the interface is
	// satisfied without changing existing test expectations.
	return nil
}
func (m *mockUserRepo) InsertAuditLog(ctx context.Context, adminID, action, targetType, targetID string, details map[string]any, ipAddress string) error {
	if m.insertAuditLogFn != nil {
		return m.insertAuditLogFn(ctx, adminID, action, targetType, targetID, details, ipAddress)
	}
	return nil
}
func (m *mockUserRepo) AdminSearchUsers(ctx context.Context, query, status, role string, page, pageSize int) ([]domain.User, int, error) {
	if m.adminSearchUsersFn != nil {
		return m.adminSearchUsersFn(ctx, query, status, role, page, pageSize)
	}
	return nil, 0, nil
}
func (m *mockUserRepo) UpdatePhoneVerified(_ context.Context, _ string, _ bool) error {
	return nil
}
func (m *mockUserRepo) CreateDocument(_ context.Context, _ *domain.Document) error {
	return nil
}
func (m *mockUserRepo) GetDocument(_ context.Context, _ string) (*domain.Document, error) {
	return nil, domain.ErrDocumentNotFound
}
func (m *mockUserRepo) GetDocumentByUserAndType(_ context.Context, _ string, _ domain.DocumentType) (*domain.Document, error) {
	return nil, domain.ErrDocumentNotFound
}
func (m *mockUserRepo) ListDocuments(_ context.Context, _ string) ([]domain.Document, error) {
	return nil, nil
}
func (m *mockUserRepo) UpdateDocumentStatus(_ context.Context, _ string, _ domain.DocumentStatus, _ string) error {
	return nil
}
func (m *mockUserRepo) ListPendingDocuments(_ context.Context, _, _ int) ([]domain.PendingDocument, int, error) {
	return nil, 0, nil
}
func (m *mockUserRepo) FindUserByOAuth(_ context.Context, _, _ string) (*domain.User, error) {
	return nil, domain.ErrUserNotFound
}
func (m *mockUserRepo) CreateOAuthUser(_ context.Context, _ *domain.User, _, _ string) error {
	return nil
}
func (m *mockUserRepo) LinkOAuthAccount(_ context.Context, _, _, _, _ string) error {
	return nil
}
func (m *mockUserRepo) StoreMFASecret(_ context.Context, _, _ string) error {
	return nil
}
func (m *mockUserRepo) GetMFASecret(_ context.Context, _ string) (string, error) {
	return "", domain.ErrMFANotSetup
}
func (m *mockUserRepo) EnableMFA(_ context.Context, _ string, _ []string) error {
	return nil
}
func (m *mockUserRepo) DisableMFA(_ context.Context, _ string) error {
	return nil
}
func (m *mockUserRepo) IsMFAEnabled(_ context.Context, _ string) (bool, error) {
	return false, nil
}
func (m *mockUserRepo) SearchProviders(_ context.Context, _ domain.ProviderSearchInput) ([]domain.ProviderSearchResult, int, error) {
	return nil, 0, nil
}
func (m *mockUserRepo) CreateProperty(_ context.Context, _ domain.CreatePropertyInput) (*domain.Property, error) {
	return nil, nil
}
func (m *mockUserRepo) ListProperties(_ context.Context, _ string) ([]domain.Property, error) {
	return nil, nil
}
func (m *mockUserRepo) UpdateProperty(_ context.Context, _ string, _ domain.UpdatePropertyInput) (*domain.Property, error) {
	return nil, nil
}
func (m *mockUserRepo) DeleteProperty(_ context.Context, _ string) error {
	return nil
}

// --- GDPR / CCPA erasure stubs (full mocks live in deletion_test.go) ---

func (m *mockUserRepo) MarkDeletionRequested(_ context.Context, _, _ string, _ time.Time) error {
	return nil
}
func (m *mockUserRepo) ClearDeletionRequest(_ context.Context, _ string) error {
	return nil
}
func (m *mockUserRepo) GetUserDeletionState(_ context.Context, _ string) (*time.Time, *time.Time, error) {
	return nil, nil, nil
}
func (m *mockUserRepo) ListPendingFinalizations(_ context.Context, _ time.Time, _ int) ([]domain.PendingDeletion, error) {
	return nil, nil
}
func (m *mockUserRepo) FinalizeAccountDeletion(_ context.Context, _ string) (domain.ErasureCounts, error) {
	return nil, nil
}

// --- helpers ---

func testKeyPair(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	return key
}

// testHMACKey returns a deterministic key for signing verification tokens in tests.
func testHMACKey() string {
	return strings.Repeat("k", 32)
}

func newTestAuth(t *testing.T, repo *mockUserRepo) *Auth {
	t.Helper()
	key := testKeyPair(t)
	jwtMgr := NewJWTManager(key)
	return NewAuth(repo, jwtMgr, testHMACKey(), false)
}

// --- Auth.Register tests ---

func TestAuth_Register(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		input      domain.RegisterInput
		createUser func(ctx context.Context, user *domain.User) error
		wantErr    bool
		errContain string
	}{
		{
			name: "successful_registration",
			input: domain.RegisterInput{
				Email:       "test@example.com",
				Password:    "strongpassword123",
				DisplayName: "Test User",
				Roles:       []string{"customer"},
			},
			createUser: func(_ context.Context, user *domain.User) error {
				user.ID = "user-gen-123"
				return nil
			},
			wantErr: false,
		},
		{
			name: "email_taken_returns_error",
			input: domain.RegisterInput{
				Email:       "taken@example.com",
				Password:    "password123",
				DisplayName: "Taken",
				Roles:       []string{"customer"},
			},
			createUser: func(_ context.Context, _ *domain.User) error {
				return domain.ErrEmailTaken
			},
			wantErr:    true,
			errContain: "email already taken",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockUserRepo{
				createUserFn: tt.createUser,
				createRefreshTokenFn: func(_ context.Context, _ *domain.RefreshToken) error {
					return nil
				},
			}
			auth := newTestAuth(t, repo)

			userID, pair, verifyToken, err := auth.Register(context.Background(), tt.input)

			if tt.wantErr {
				require.Error(t, err)
				if tt.errContain != "" {
					assert.Contains(t, err.Error(), tt.errContain)
				}
				return
			}

			require.NoError(t, err)
			assert.NotEmpty(t, userID)
			require.NotNil(t, pair)
			assert.NotEmpty(t, pair.AccessToken)
			assert.NotEmpty(t, pair.RefreshToken)
			assert.True(t, pair.AccessTokenExpiresAt.After(time.Now()))
			assert.NotEmpty(t, verifyToken, "verification token should be returned")
		})
	}
}

// --- Auth.Login tests ---

func TestAuth_Login(t *testing.T) {
	t.Parallel()

	// Pre-hash a known password for test.
	knownPassword := "correct-password"
	knownHash, err := hashPassword(knownPassword)
	require.NoError(t, err)

	tests := []struct {
		name       string
		input      domain.LoginInput
		getByEmail func(ctx context.Context, email string) (*domain.User, error)
		wantErr    error
		wantMFA    bool
	}{
		{
			name: "successful_login",
			input: domain.LoginInput{
				Email:    "test@example.com",
				Password: knownPassword,
			},
			getByEmail: func(_ context.Context, _ string) (*domain.User, error) {
				return &domain.User{
					ID:            "user-1",
					Email:         "test@example.com",
					PasswordHash:  knownHash,
					Roles:         []string{"customer"},
					Status:        "active",
					EmailVerified: true,
				}, nil
			},
		},
		{
			name: "user_not_found_returns_invalid_credentials",
			input: domain.LoginInput{
				Email:    "nonexistent@example.com",
				Password: "password",
			},
			getByEmail: func(_ context.Context, _ string) (*domain.User, error) {
				return nil, domain.ErrUserNotFound
			},
			wantErr: domain.ErrInvalidCredentials,
		},
		{
			name: "wrong_password_returns_invalid_credentials",
			input: domain.LoginInput{
				Email:    "test@example.com",
				Password: "wrong-password",
			},
			getByEmail: func(_ context.Context, _ string) (*domain.User, error) {
				return &domain.User{
					ID:           "user-1",
					Email:        "test@example.com",
					PasswordHash: knownHash,
					Roles:        []string{"customer"},
					Status:       "active",
				}, nil
			},
			wantErr: domain.ErrInvalidCredentials,
		},
		{
			name: "suspended_account_returns_error",
			input: domain.LoginInput{
				Email:    "suspended@example.com",
				Password: knownPassword,
			},
			getByEmail: func(_ context.Context, _ string) (*domain.User, error) {
				return &domain.User{
					ID:     "user-2",
					Status: "suspended",
				}, nil
			},
			wantErr: domain.ErrAccountSuspended,
		},
		{
			name: "banned_account_returns_error",
			input: domain.LoginInput{
				Email:    "banned@example.com",
				Password: knownPassword,
			},
			getByEmail: func(_ context.Context, _ string) (*domain.User, error) {
				return &domain.User{
					ID:     "user-3",
					Status: "banned",
				}, nil
			},
			wantErr: domain.ErrAccountBanned,
		},
		{
			name: "deactivated_account_returns_error",
			input: domain.LoginInput{
				Email:    "deactivated@example.com",
				Password: knownPassword,
			},
			getByEmail: func(_ context.Context, _ string) (*domain.User, error) {
				return &domain.User{
					ID:     "user-4",
					Status: "deactivated",
				}, nil
			},
			wantErr: domain.ErrAccountDeactivated,
		},
		{
			name: "mfa_enabled_returns_mfa_required",
			input: domain.LoginInput{
				Email:    "mfa@example.com",
				Password: knownPassword,
			},
			getByEmail: func(_ context.Context, _ string) (*domain.User, error) {
				return &domain.User{
					ID:            "user-5",
					Email:         "mfa@example.com",
					PasswordHash:  knownHash,
					Roles:         []string{"customer"},
					Status:        "active",
					EmailVerified: true,
					MFAEnabled:    true,
				}, nil
			},
			wantMFA: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockUserRepo{
				getUserByEmailFn: tt.getByEmail,
				createRefreshTokenFn: func(_ context.Context, _ *domain.RefreshToken) error {
					return nil
				},
			}
			auth := newTestAuth(t, repo)

			userID, pair, mfa, _, err := auth.Login(context.Background(), tt.input)

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr), "expected %v, got %v", tt.wantErr, err)
				return
			}

			require.NoError(t, err)
			assert.NotEmpty(t, userID)

			if tt.wantMFA {
				assert.True(t, mfa)
				assert.Nil(t, pair, "should not issue tokens when MFA is required")
			} else {
				assert.False(t, mfa)
				require.NotNil(t, pair)
				assert.NotEmpty(t, pair.AccessToken)
				assert.NotEmpty(t, pair.RefreshToken)
			}
		})
	}
}

// --- Auth.RefreshToken tests ---

func TestAuth_RefreshToken(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		getRefreshToken func(ctx context.Context, tokenHash string) (*domain.RefreshToken, error)
		revokeIfActive  func(ctx context.Context, tokenHash string) (bool, error)
		getUserByIDFn   func(ctx context.Context, id string) (*domain.User, error)
		wantErr         bool
		errContain      string
	}{
		{
			name: "successful_refresh_rotates_token",
			getRefreshToken: func(_ context.Context, _ string) (*domain.RefreshToken, error) {
				return &domain.RefreshToken{
					ID:        "rt-1",
					UserID:    "user-1",
					ExpiresAt: time.Now().Add(time.Hour),
				}, nil
			},
			// Active token: the atomic revoke affects exactly one row.
			revokeIfActive: func(_ context.Context, _ string) (bool, error) { return true, nil },
			getUserByIDFn: func(_ context.Context, _ string) (*domain.User, error) {
				return &domain.User{
					ID:    "user-1",
					Email: "test@example.com",
					Roles: []string{"customer"},
				}, nil
			},
		},
		{
			name: "revoked_token_returns_error",
			getRefreshToken: func(_ context.Context, _ string) (*domain.RefreshToken, error) {
				now := time.Now()
				return &domain.RefreshToken{
					ID:        "rt-2",
					UserID:    "user-2",
					ExpiresAt: time.Now().Add(time.Hour),
					RevokedAt: &now,
				}, nil
			},
			// Already revoked: the gated revoke affects zero rows -> reject.
			revokeIfActive: func(_ context.Context, _ string) (bool, error) { return false, nil },
			wantErr:        true,
			errContain:     "token revoked",
		},
		{
			name: "expired_token_returns_error",
			getRefreshToken: func(_ context.Context, _ string) (*domain.RefreshToken, error) {
				return &domain.RefreshToken{
					ID:        "rt-3",
					UserID:    "user-3",
					ExpiresAt: time.Now().Add(-time.Hour),
				}, nil
			},
			wantErr:    true,
			errContain: "token expired",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockUserRepo{
				getRefreshTokenFn:            tt.getRefreshToken,
				rotateRefreshTokenIfActiveFn: tt.revokeIfActive,
				getUserByIDFn:                tt.getUserByIDFn,
				createRefreshTokenFn: func(_ context.Context, _ *domain.RefreshToken) error {
					return nil
				},
			}
			auth := newTestAuth(t, repo)

			pair, err := auth.RefreshToken(context.Background(), "raw-refresh-token")

			if tt.wantErr {
				require.Error(t, err)
				if tt.errContain != "" {
					assert.Contains(t, err.Error(), tt.errContain)
				}
				return
			}

			require.NoError(t, err)
			require.NotNil(t, pair)
			assert.NotEmpty(t, pair.AccessToken)
			assert.NotEmpty(t, pair.RefreshToken)
		})
	}
}

// TestAuth_RefreshToken_ConcurrentSingleWinner proves the atomic-revoke gate:
// when N goroutines refresh the SAME single-use token at once, exactly one
// succeeds (mints a new pair) and the rest are rejected with ErrTokenRevoked.
// The mock emulates the DB's `UPDATE ... WHERE revoked_at IS NULL` semantics
// with an atomic compare-and-swap so the first caller wins and later callers
// see zero rows affected.
func TestAuth_RefreshToken_ConcurrentSingleWinner(t *testing.T) {
	t.Parallel()

	const n = 12

	// revoked is flipped 0 -> 1 exactly once; only that caller "affected a row".
	var revoked int32
	repo := &mockUserRepo{
		getRefreshTokenFn: func(_ context.Context, _ string) (*domain.RefreshToken, error) {
			return &domain.RefreshToken{
				ID:        "rt-shared",
				UserID:    "user-shared",
				ExpiresAt: time.Now().Add(time.Hour),
			}, nil
		},
		rotateRefreshTokenIfActiveFn: func(_ context.Context, _ string) (bool, error) {
			return atomic.CompareAndSwapInt32(&revoked, 0, 1), nil
		},
		getUserByIDFn: func(_ context.Context, _ string) (*domain.User, error) {
			return &domain.User{ID: "user-shared", Email: "s@example.com", Roles: []string{"customer"}}, nil
		},
		createRefreshTokenFn: func(_ context.Context, _ *domain.RefreshToken) error { return nil },
	}
	auth := newTestAuth(t, repo)

	var wg sync.WaitGroup
	var successes, revokedErrs int32
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			pair, err := auth.RefreshToken(context.Background(), "raw-refresh-token")
			if err == nil {
				require.NotNil(t, pair)
				atomic.AddInt32(&successes, 1)
				return
			}
			if errors.Is(err, domain.ErrTokenRevoked) {
				atomic.AddInt32(&revokedErrs, 1)
			}
		}()
	}
	wg.Wait()

	assert.Equal(t, int32(1), atomic.LoadInt32(&successes), "exactly one refresh must win")
	assert.Equal(t, int32(n-1), atomic.LoadInt32(&revokedErrs), "all losers must get ErrTokenRevoked")
}

// --- Auth.Logout tests ---

func TestAuth_Logout(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		revokeFn func(ctx context.Context, tokenHash string) error
		wantErr  bool
	}{
		{
			name:     "successful_logout",
			revokeFn: func(_ context.Context, _ string) error { return nil },
		},
		{
			name:     "revoke_failure_returns_error",
			revokeFn: func(_ context.Context, _ string) error { return errors.New("db error") },
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockUserRepo{revokeRefreshTokenFn: tt.revokeFn}
			auth := newTestAuth(t, repo)

			err := auth.Logout(context.Background(), "some-refresh-token")

			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// --- Auth.VerifyEmail tests ---

func TestAuth_VerifyEmail(t *testing.T) {
	t.Parallel()

	// Helper to create a valid signed token for a given user ID.
	makeToken := func(userID string) string {
		key := testKeyPair(t)
		jwtMgr := NewJWTManager(key)
		a := NewAuth(nil, jwtMgr, testHMACKey(), false)
		return a.GenerateVerificationToken(userID)
	}

	tests := []struct {
		name         string
		token        string
		updateFn     func(ctx context.Context, userID string, verified bool) error
		wantVerified bool
		wantErr      bool
	}{
		{
			name:  "successful_verification_with_signed_token",
			token: makeToken("user-id-123"),
			updateFn: func(_ context.Context, _ string, _ bool) error {
				return nil
			},
			wantVerified: true,
		},
		{
			name:  "user_not_found_returns_false",
			token: makeToken("nonexistent-user"),
			updateFn: func(_ context.Context, _ string, _ bool) error {
				return domain.ErrUserNotFound
			},
			wantVerified: false,
		},
		{
			name:  "db_error_returns_error",
			token: makeToken("user-id-456"),
			updateFn: func(_ context.Context, _ string, _ bool) error {
				return errors.New("db connection lost")
			},
			wantErr: true,
		},
		{
			name:  "invalid_token_returns_error",
			token: "not-a-valid-token",
			updateFn: func(_ context.Context, _ string, _ bool) error {
				return nil
			},
			wantErr: true,
		},
		{
			name:  "raw_user_id_rejected",
			token: "user-id-123",
			updateFn: func(_ context.Context, _ string, _ bool) error {
				return nil
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockUserRepo{updateEmailVerifiedFn: tt.updateFn}
			auth := newTestAuth(t, repo)

			verified, err := auth.VerifyEmail(context.Background(), tt.token)

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantVerified, verified)
		})
	}
}

func TestGenerateAndValidateVerificationToken(t *testing.T) {
	t.Parallel()

	auth := newTestAuth(t, &mockUserRepo{})

	token := auth.GenerateVerificationToken("user-abc-123")
	assert.NotEmpty(t, token)

	// Valid token returns the user ID.
	userID, err := auth.ValidateVerificationToken(token)
	require.NoError(t, err)
	assert.Equal(t, "user-abc-123", userID)

	// Token signed with a different key is rejected.
	otherAuth := NewAuth(nil, nil, "different-hmac-key-value-here", false)
	_, err = otherAuth.ValidateVerificationToken(token)
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrInvalidToken))
}

func TestGenerateAndValidatePasswordResetToken(t *testing.T) {
	t.Parallel()

	auth := newTestAuth(t, &mockUserRepo{})

	const currentHash = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA"
	token := auth.GeneratePasswordResetToken("user-xyz-789", currentHash)
	assert.NotEmpty(t, token)

	// Valid token verified against the SAME (current) hash returns the userID.
	userID, err := auth.ValidatePasswordResetToken(token, currentHash)
	require.NoError(t, err)
	assert.Equal(t, "user-xyz-789", userID)

	// Hash binding: once the password hash changes, the same token no longer
	// verifies -> single-use semantics for free.
	_, err = auth.ValidatePasswordResetToken(token, currentHash+"-changed")
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrInvalidToken))

	// A token signed with a different key is rejected.
	otherAuth := NewAuth(nil, nil, "different-hmac-key-value-here", false)
	_, err = otherAuth.ValidatePasswordResetToken(token, currentHash)
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrInvalidToken))

	// A verification token must NOT be accepted as a password-reset token
	// (purpose namespacing).
	verifyToken := auth.GenerateVerificationToken("user-xyz-789")
	_, err = auth.ValidatePasswordResetToken(verifyToken, currentHash)
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrInvalidToken))
}

func TestAuth_RequestPasswordReset(t *testing.T) {
	t.Parallel()

	t.Run("known email returns token and matched=true", func(t *testing.T) {
		t.Parallel()
		repo := &mockUserRepo{
			getUserByEmailFn: func(_ context.Context, email string) (*domain.User, error) {
				return &domain.User{ID: "user-1", Email: email}, nil
			},
		}
		auth := newTestAuth(t, repo)

		user, token, matched, err := auth.RequestPasswordReset(context.Background(), "real@example.com")
		require.NoError(t, err)
		assert.True(t, matched)
		assert.NotNil(t, user)
		assert.NotEmpty(t, token)
	})

	t.Run("unknown email is a no-op success (anti-enumeration)", func(t *testing.T) {
		t.Parallel()
		repo := &mockUserRepo{
			getUserByEmailFn: func(_ context.Context, _ string) (*domain.User, error) {
				return nil, domain.ErrUserNotFound
			},
		}
		auth := newTestAuth(t, repo)

		user, token, matched, err := auth.RequestPasswordReset(context.Background(), "nobody@example.com")
		require.NoError(t, err)
		assert.False(t, matched)
		assert.Nil(t, user)
		assert.Empty(t, token)
	})
}

func TestAuth_ResetPassword(t *testing.T) {
	t.Parallel()

	// originalHash is the password hash in effect when the reset token is
	// minted. The token is HMAC-bound to it.
	const originalHash = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$b3JpZ2luYWw"

	t.Run("valid token updates password and revokes sessions", func(t *testing.T) {
		t.Parallel()
		var storedHash string
		var revoked bool
		repo := &mockUserRepo{
			getUserByIDFn: func(_ context.Context, id string) (*domain.User, error) {
				return &domain.User{ID: id, PasswordHash: originalHash}, nil
			},
			updatePasswordFn: func(_ context.Context, _ string, hash string) error {
				storedHash = hash
				return nil
			},
			revokeAllUserTokensFn: func(_ context.Context, _ string) error {
				revoked = true
				return nil
			},
		}
		auth := newTestAuth(t, repo)
		token := auth.GeneratePasswordResetToken("user-42", originalHash)

		err := auth.ResetPassword(context.Background(), token, "NewPassword123!")
		require.NoError(t, err)
		assert.NotEmpty(t, storedHash)
		assert.True(t, verifyPassword("NewPassword123!", storedHash))
		assert.True(t, revoked)
	})

	t.Run("token is single-use: rejected on replay after password changed", func(t *testing.T) {
		t.Parallel()
		// Simulate stateful storage: the first reset mutates the stored hash,
		// so the second use validates against the NEW hash and the token's
		// HMAC (bound to originalHash) no longer matches.
		currentHash := originalHash
		repo := &mockUserRepo{
			getUserByIDFn: func(_ context.Context, id string) (*domain.User, error) {
				return &domain.User{ID: id, PasswordHash: currentHash}, nil
			},
			updatePasswordFn: func(_ context.Context, _ string, hash string) error {
				currentHash = hash // password rotates -> binding fingerprint changes
				return nil
			},
		}
		auth := newTestAuth(t, repo)
		token := auth.GeneratePasswordResetToken("user-99", originalHash)

		// First use succeeds.
		require.NoError(t, auth.ResetPassword(context.Background(), token, "FirstNewPass1!"))

		// Replay of the SAME token must now fail (token bound to the old hash).
		err := auth.ResetPassword(context.Background(), token, "AttackerPass2!")
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrInvalidToken))
	})

	t.Run("invalid token returns ErrInvalidToken, not a 500", func(t *testing.T) {
		t.Parallel()
		auth := newTestAuth(t, &mockUserRepo{})

		err := auth.ResetPassword(context.Background(), "not-a-real-token", "NewPassword123!")
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrInvalidToken))
	})
}

func TestAuth_ChangePassword(t *testing.T) {
	t.Parallel()

	// A real argon2id hash of the known current password so verifyPassword
	// inside ChangePassword exercises the genuine re-auth gate.
	currentHash, err := hashPassword("CurrentPass1!")
	require.NoError(t, err)

	t.Run("correct current password updates hash and revokes sessions", func(t *testing.T) {
		t.Parallel()
		var storedHash string
		var revoked bool
		repo := &mockUserRepo{
			getUserByIDFn: func(_ context.Context, id string) (*domain.User, error) {
				return &domain.User{ID: id, PasswordHash: currentHash}, nil
			},
			updatePasswordFn: func(_ context.Context, _ string, hash string) error {
				storedHash = hash
				return nil
			},
			revokeAllUserTokensFn: func(_ context.Context, _ string) error {
				revoked = true
				return nil
			},
		}
		auth := newTestAuth(t, repo)

		err := auth.ChangePassword(context.Background(), "user-1", "CurrentPass1!", "BrandNewPass2!")
		require.NoError(t, err)
		assert.True(t, verifyPassword("BrandNewPass2!", storedHash))
		assert.True(t, revoked, "all sessions must be revoked after a password change")
	})

	t.Run("wrong current password is rejected with ErrInvalidCredentials and does not write", func(t *testing.T) {
		t.Parallel()
		wrote := false
		repo := &mockUserRepo{
			getUserByIDFn: func(_ context.Context, id string) (*domain.User, error) {
				return &domain.User{ID: id, PasswordHash: currentHash}, nil
			},
			updatePasswordFn: func(_ context.Context, _ string, _ string) error {
				wrote = true
				return nil
			},
		}
		auth := newTestAuth(t, repo)

		err := auth.ChangePassword(context.Background(), "user-1", "WrongPass9!", "BrandNewPass2!")
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrInvalidCredentials))
		assert.False(t, wrote, "password must not be updated when the current password is wrong")
	})
}

// --- Profile tests ---

func TestProfile_GetUser(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		getFn   func(ctx context.Context, id string) (*domain.User, error)
		wantErr bool
	}{
		{
			name: "found",
			getFn: func(_ context.Context, id string) (*domain.User, error) {
				return &domain.User{ID: id, Email: "test@example.com"}, nil
			},
		},
		{
			name: "not_found",
			getFn: func(_ context.Context, _ string) (*domain.User, error) {
				return nil, domain.ErrUserNotFound
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockUserRepo{getUserByIDFn: tt.getFn}
			profile := NewProfile(repo)

			user, err := profile.GetUser(context.Background(), "user-1")

			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, "user-1", user.ID)
		})
	}
}

func TestProfile_UpdateUser(t *testing.T) {
	t.Parallel()

	name := "New Name"
	repo := &mockUserRepo{
		updateUserFn: func(_ context.Context, userID string, input domain.UpdateUserInput) (*domain.User, error) {
			return &domain.User{ID: userID, DisplayName: *input.DisplayName}, nil
		},
	}
	profile := NewProfile(repo)

	user, err := profile.UpdateUser(context.Background(), "user-1", domain.UpdateUserInput{
		DisplayName: &name,
	})

	require.NoError(t, err)
	assert.Equal(t, "New Name", user.DisplayName)
}

func TestProfile_EnableRole(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		role    string
		wantErr bool
		errIs   error
	}{
		{name: "valid_customer_role", role: "customer"},
		{name: "valid_provider_role", role: "provider"},
		{name: "invalid_admin_role", role: "admin", wantErr: true, errIs: domain.ErrInvalidRole},
		{name: "invalid_unknown_role", role: "unknown", wantErr: true, errIs: domain.ErrInvalidRole},
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
			}
			profile := NewProfile(repo)

			user, err := profile.EnableRole(context.Background(), "user-1", tt.role)

			if tt.wantErr {
				require.Error(t, err)
				if tt.errIs != nil {
					assert.True(t, errors.Is(err, tt.errIs))
				}
				return
			}

			require.NoError(t, err)
			require.NotNil(t, user)
		})
	}
}

func TestProfile_SetGlobalTerms(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   domain.GlobalTermsInput
		wantErr bool
	}{
		{
			name: "milestone_percentages_sum_to_100",
			input: domain.GlobalTermsInput{
				PaymentTiming: "milestone",
				Milestones: []domain.MilestoneTemplate{
					{Description: "Start", Percentage: 50},
					{Description: "End", Percentage: 50},
				},
			},
		},
		{
			name: "milestone_percentages_do_not_sum_to_100",
			input: domain.GlobalTermsInput{
				PaymentTiming: "milestone",
				Milestones: []domain.MilestoneTemplate{
					{Description: "Start", Percentage: 30},
					{Description: "End", Percentage: 40},
				},
			},
			wantErr: true,
		},
		{
			name: "non_milestone_timing_no_sum_check",
			input: domain.GlobalTermsInput{
				PaymentTiming: "completion",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockUserRepo{
				setGlobalTermsFn: func(_ context.Context, _ string, _ domain.GlobalTermsInput) error {
					return nil
				},
			}
			profile := NewProfile(repo)

			err := profile.SetGlobalTerms(context.Background(), "user-1", tt.input)

			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), "milestone percentages must sum to 100")
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// --- Password hashing tests ---

func TestHashPassword_and_verify(t *testing.T) {
	t.Parallel()

	password := "mySecureP@ssw0rd"
	hash, err := hashPassword(password)
	require.NoError(t, err)
	assert.NotEmpty(t, hash)
	assert.Contains(t, hash, "$argon2id$")

	// Correct password verifies.
	assert.True(t, verifyPassword(password, hash))

	// Wrong password does not verify.
	assert.False(t, verifyPassword("wrong-password", hash))
}

func TestVerifyPassword_invalid_hash_format(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		hash string
	}{
		{name: "empty_hash", hash: ""},
		{name: "not_argon2id", hash: "$bcrypt$some$hash"},
		{name: "too_few_parts", hash: "$argon2id$v=19$m=65536"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.False(t, verifyPassword("password", tt.hash))
		})
	}
}

// --- JWT tests ---

func TestJWTManager_GenerateAndValidate(t *testing.T) {
	t.Parallel()

	key := testKeyPair(t)
	mgr := NewJWTManager(key)

	token, expiresAt, err := mgr.GenerateAccessToken("user-abc", "test@example.com", []string{"customer", "provider"})
	require.NoError(t, err)
	assert.NotEmpty(t, token)
	assert.True(t, expiresAt.After(time.Now()))

	claims, err := mgr.ValidateAccessToken(token)
	require.NoError(t, err)
	assert.Equal(t, "user-abc", claims.Subject)
	assert.Equal(t, "test@example.com", claims.Email)
	assert.Equal(t, []string{"customer", "provider"}, claims.Roles)
}

func TestJWTManager_ValidateToken_wrong_key(t *testing.T) {
	t.Parallel()

	key1 := testKeyPair(t)
	key2 := testKeyPair(t)

	mgr1 := NewJWTManager(key1)
	mgr2 := NewJWTManager(key2)

	token, _, err := mgr1.GenerateAccessToken("user-1", "a@b.com", []string{"customer"})
	require.NoError(t, err)

	_, err = mgr2.ValidateAccessToken(token)
	require.Error(t, err)
}

// --- Token generation tests ---

func TestGenerateRefreshToken(t *testing.T) {
	t.Parallel()

	raw, hash, err := GenerateRefreshToken()
	require.NoError(t, err)
	assert.NotEmpty(t, raw)
	assert.NotEmpty(t, hash)
	assert.NotEqual(t, raw, hash)

	// Hash should match
	assert.Equal(t, hash, HashToken(raw))
}

func TestHashToken_deterministic(t *testing.T) {
	t.Parallel()

	token := "my-secret-token"
	hash1 := HashToken(token)
	hash2 := HashToken(token)
	assert.Equal(t, hash1, hash2)

	different := HashToken("other-token")
	assert.NotEqual(t, hash1, different)
}

func TestRefreshTokenExpiry(t *testing.T) {
	t.Parallel()
	assert.Equal(t, 7*24*time.Hour, RefreshTokenExpiry())
}

// --- generateTokenPair helper test ---

func TestAuth_generateTokenPair_stores_refresh_token(t *testing.T) {
	t.Parallel()

	var storedToken *domain.RefreshToken
	repo := &mockUserRepo{
		createRefreshTokenFn: func(_ context.Context, token *domain.RefreshToken) error {
			storedToken = token
			return nil
		},
	}

	key := testKeyPair(t)
	jwtMgr := NewJWTManager(key)
	auth := NewAuth(repo, jwtMgr, testHMACKey(), false)

	user := &domain.User{
		ID:    "user-1",
		Email: "test@example.com",
		Roles: []string{"customer"},
	}

	pair, err := auth.generateTokenPair(context.Background(), user, "Chrome/100", "192.168.1.1", "", nil)
	require.NoError(t, err)
	require.NotNil(t, pair)

	require.NotNil(t, storedToken)
	assert.Equal(t, "user-1", storedToken.UserID)
	assert.Equal(t, "Chrome/100", storedToken.DeviceInfo)
	assert.True(t, net.ParseIP("192.168.1.1").Equal(storedToken.IPAddress))
	assert.NotEmpty(t, storedToken.TokenHash)
	assert.True(t, storedToken.ExpiresAt.After(time.Now()))
	// A session root carries no lineage: the DB mints the family (COALESCE to
	// gen_random_uuid()), so the service must NOT invent one.
	assert.Empty(t, storedToken.FamilyID, "session root must let the DB mint the family id")
	assert.Nil(t, storedToken.ParentID, "session root has no parent")
}

// TestAuth_generateTokenPair_rotation_inherits_lineage pins the other half of
// the contract: a rotation must extend the existing family, not start a new
// one. If this regresses, reuse detection silently stops working — every token
// becomes its own family and revoking a family revokes nothing.
func TestAuth_generateTokenPair_rotation_inherits_lineage(t *testing.T) {
	t.Parallel()

	var storedToken *domain.RefreshToken
	repo := &mockUserRepo{
		createRefreshTokenFn: func(_ context.Context, token *domain.RefreshToken) error {
			storedToken = token
			return nil
		},
	}

	key := testKeyPair(t)
	auth := NewAuth(repo, NewJWTManager(key), testHMACKey(), false)

	user := &domain.User{ID: "user-1", Email: "test@example.com", Roles: []string{"customer"}}
	parentID := "parent-token-id"

	_, err := auth.generateTokenPair(context.Background(), user, "Chrome/100", "", "fam-1", &parentID)
	require.NoError(t, err)

	require.NotNil(t, storedToken)
	assert.Equal(t, "fam-1", storedToken.FamilyID, "rotation must inherit the parent's family")
	require.NotNil(t, storedToken.ParentID)
	assert.Equal(t, parentID, *storedToken.ParentID)
}
