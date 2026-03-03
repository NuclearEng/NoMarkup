package service

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"

	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// Argon2id parameters.
const (
	argonMemory      = 65536
	argonIterations  = 3
	argonParallelism = 4
	argonSaltLength  = 16
	argonKeyLength   = 32
)

// Auth implements authentication business logic.
type Auth struct {
	repo domain.UserRepository
	jwt  *JWTManager
}

// NewAuth creates a new Auth service.
func NewAuth(repo domain.UserRepository, jwt *JWTManager) *Auth {
	return &Auth{repo: repo, jwt: jwt}
}

// Register creates a new user account and returns the user ID and token pair.
func (a *Auth) Register(ctx context.Context, input domain.RegisterInput) (string, *domain.TokenPair, error) {
	hash, err := hashPassword(input.Password)
	if err != nil {
		return "", nil, fmt.Errorf("register user: %w", err)
	}

	user := &domain.User{
		Email:        input.Email,
		PasswordHash: hash,
		DisplayName:  input.DisplayName,
		Roles:        input.Roles,
		Status:       "active",
		Timezone:     "America/Los_Angeles",
	}

	if err := a.repo.CreateUser(ctx, user); err != nil {
		return "", nil, fmt.Errorf("register user: %w", err)
	}

	pair, err := a.generateTokenPair(ctx, user, "", "")
	if err != nil {
		return "", nil, fmt.Errorf("register user: %w", err)
	}

	slog.Info("user registered", "user_id", user.ID, "email", user.Email)
	return user.ID, pair, nil
}

// Login authenticates a user and returns the user ID, token pair, and whether MFA is required.
func (a *Auth) Login(ctx context.Context, input domain.LoginInput) (string, *domain.TokenPair, bool, error) {
	user, err := a.repo.GetUserByEmail(ctx, input.Email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return "", nil, false, domain.ErrInvalidCredentials
		}
		return "", nil, false, fmt.Errorf("login user: %w", err)
	}

	switch user.Status {
	case "suspended":
		return "", nil, false, domain.ErrAccountSuspended
	case "banned":
		return "", nil, false, domain.ErrAccountBanned
	case "deactivated":
		return "", nil, false, domain.ErrAccountDeactivated
	}

	if !verifyPassword(input.Password, user.PasswordHash) {
		return "", nil, false, domain.ErrInvalidCredentials
	}

	if user.MFAEnabled {
		// MFA is required; don't issue tokens yet.
		return user.ID, nil, true, nil
	}

	now := time.Now()
	if err := a.repo.UpdateLastLogin(ctx, user.ID, now); err != nil {
		slog.Warn("failed to update last login", "user_id", user.ID, "error", err)
	}

	pair, err := a.generateTokenPair(ctx, user, input.DeviceInfo, input.IPAddress)
	if err != nil {
		return "", nil, false, fmt.Errorf("login user: %w", err)
	}

	slog.Info("user logged in", "user_id", user.ID, "email", user.Email)
	return user.ID, pair, false, nil
}

// RefreshToken validates a refresh token, rotates it, and returns a new token pair.
func (a *Auth) RefreshToken(ctx context.Context, rawToken string) (*domain.TokenPair, error) {
	tokenHash := HashToken(rawToken)

	stored, err := a.repo.GetRefreshToken(ctx, tokenHash)
	if err != nil {
		return nil, fmt.Errorf("refresh token: %w", err)
	}

	if stored.RevokedAt != nil {
		return nil, fmt.Errorf("refresh token: %w", domain.ErrTokenRevoked)
	}
	if time.Now().After(stored.ExpiresAt) {
		return nil, fmt.Errorf("refresh token: %w", domain.ErrTokenExpired)
	}

	// Revoke the old token (rotation).
	if err := a.repo.RevokeRefreshToken(ctx, tokenHash); err != nil {
		return nil, fmt.Errorf("refresh token revoke old: %w", err)
	}

	user, err := a.repo.GetUserByID(ctx, stored.UserID)
	if err != nil {
		return nil, fmt.Errorf("refresh token get user: %w", err)
	}

	pair, err := a.generateTokenPair(ctx, user, stored.DeviceInfo, "")
	if err != nil {
		return nil, fmt.Errorf("refresh token: %w", err)
	}

	return pair, nil
}

// Logout revokes a refresh token.
func (a *Auth) Logout(ctx context.Context, rawToken string) error {
	tokenHash := HashToken(rawToken)
	if err := a.repo.RevokeRefreshToken(ctx, tokenHash); err != nil {
		return fmt.Errorf("logout: %w", err)
	}
	return nil
}

// VerifyEmail marks a user's email as verified using the email verification token.
// For Slice 1, the token is the user ID (a real implementation would use a signed token).
func (a *Auth) VerifyEmail(ctx context.Context, token string) (bool, error) {
	if err := a.repo.UpdateEmailVerified(ctx, token, true); err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return false, nil
		}
		return false, fmt.Errorf("verify email: %w", err)
	}
	return true, nil
}

// generateTokenPair creates a new access token + refresh token and stores the refresh token.
func (a *Auth) generateTokenPair(ctx context.Context, user *domain.User, deviceInfo, ipAddress string) (*domain.TokenPair, error) {
	accessToken, expiresAt, err := a.jwt.GenerateAccessToken(user.ID, user.Email, user.Roles)
	if err != nil {
		return nil, err
	}

	rawRefresh, refreshHash, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	rt := &domain.RefreshToken{
		UserID:     user.ID,
		TokenHash:  refreshHash,
		DeviceInfo: deviceInfo,
		IPAddress:  net.ParseIP(ipAddress),
		ExpiresAt:  time.Now().Add(RefreshTokenExpiry()),
	}
	if err := a.repo.CreateRefreshToken(ctx, rt); err != nil {
		return nil, err
	}

	return &domain.TokenPair{
		AccessToken:          accessToken,
		RefreshToken:         rawRefresh,
		AccessTokenExpiresAt: expiresAt,
	}, nil
}

// hashPassword hashes a password using argon2id.
func hashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}

	hash := argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)

	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonIterations, argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

// verifyPassword checks a password against an argon2id hash string.
func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}

	var memory uint32
	var iterations uint32
	var parallelism uint8
	_, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism)
	if err != nil {
		return false
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}

	expectedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}

	hash := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(expectedHash)))
	return subtle.ConstantTimeCompare(hash, expectedHash) == 1
}
